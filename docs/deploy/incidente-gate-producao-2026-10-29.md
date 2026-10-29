# Incidente: gate de testes reprovou o deploy de produção (29/10/2026)

Deploy de `23b7ac7a` na AWS (`induscost-prod-saopaulo`, em execução `9d46d87a`): 540 testes, 528 aprovados, **11
reprovados**, 1 ignorado — todos em `src/lib/ops/deploySafety.test.ts`. O executor v4 fez o rollback automático
(`decision=NO_DB_CHANGE`, serviço e health OK). `teste_bi` intacto; as três migrations novas não foram aplicadas.

## 1. Causa raiz (uma só para os 11)

O executor **exporta** a configuração do cluster real antes do gate (`induscost-deploy-executor.sh`: `IDS_PG`,
`IDS_PG_USER`, `IDS_PG_BIN`, `IDS_PG_HOST`, `IDS_PG_PORT`, `IDS_PG_ADMIN_ROLE`, globs, estado…), e o gate
(`ids_run_test_gate`) só zerava as chaves do `.env` da aplicação — as `IDS_*`/`PG*` chegavam aos testes.

`deploySafety.test.ts` carrega a biblioteca num bash com `psql`/`pg_restore` **simulados no PATH**, mas só
sobrescrevia `IDS_PG`/`IDS_PG_USER`. Com `IDS_PG_BIN=/usr/lib/postgresql/17/bin` herdado, `ids_pg_bin psql` apontava
para o **psql real**; com `IDS_PG_HOST=/var/run/postgresql` e `IDS_PG_ADMIN_ROLE=postgres` herdados, conectava ao
socket da produção como `postgres`, sem `runuser` (o teste zera `IDS_PG`) → `Peer authentication failed`.

| Teste | O que o cenário chama | Efeito |
|---|---|---|
| D3 | `pg_restore -l` real em vez do simulado | `RC=31` (arquivo `x` inexistente) no lugar de 32 |
| M1–M6 | `ids_maintenance_begin` → `ids_write_lock_on` → psql real | `RC=48` no lugar de 0/47/40/41/42/46 |
| S3, S4, S5, S7 | idem (cenários de homologação/rotinas que chegam à trava) | `RC=48` |

S1, S2 e S6 recusam (52) antes de qualquer psql e passaram. **S4 não tem defeito próprio**: é a mesma conexão.

Agravantes encontrados:

- **Risco ao banco oficial:** os cenários M/S executam `ALTER DATABASE "teste_bi" SET default_transaction_read_only = on`
  (e o desfazem). Só a autenticação peer recusando o root impediu que isso fosse ao `teste_bi` real.
- **Fixture do D3:** o caso "sem tabelas (32)" usava um caminho inexistente e só passava porque o simulado ignorava
  o arquivo. Com o `pg_restore` real, 31 é a resposta **correta** da biblioteca; o teste estava errado.
- **Código enganoso:** falha de conexão/autenticação em `ids_write_lock_on` saía como 48 ("trava já usada por
  terceiros"). Agora é 50 (sem conexão administrativa), com mensagem própria.
- **predeployGate:** a passagem "isolada" não exportava o que o executor exporta, por isso não pegou o problema.

## 2. Correção (branch `fix/deploy-test-gate-env-isolation`)

| Arquivo | Mudança |
|---|---|
| `infra/deploy/induscost-deploy-safety.sh` (v5.1) | `ids_run_test_gate` remove toda `IDS_*` e `PG*` do ambiente dos testes; `ids_write_lock_on` devolve 50 em falha de conexão/autenticação |
| `src/lib/ops/deployTestIsolation.ts` (novo) | `isolatedHostEnv()`: `process.env` sem `IDS_*`/`PG*` |
| `src/lib/ops/deploySafety.test.ts` | cenários simulados: `isolatedHostEnv()`, `unset` de `IDS_*`/`PG*` no bash, `IDS_PG_BIN` vazio, socket/porta/papel de sandbox, sem `.pgpass`/serviço; simulados que **recusam** para todo outro cliente PostgreSQL; D3 corrigido; regressões G3–G6 |
| `src/lib/ops/deploySafety.pg17.integration.test.ts`, `deployExecutor.pg17.e2e.test.ts`, `deployHooksServidor01.test.ts` | todo spawn parte de `isolatedHostEnv()` (os de PostgreSQL real continuam usando só o cluster descartável que o próprio teste cria) |
| `scripts/testing/predeployGate.mjs` | a passagem isolada exporta a configuração do executor de produção com clientes que recusam a autenticação |
| `infra/deploy/APLICAR.md` | código 50 |

Três camadas independentes impedem um teste simulado de alcançar o banco oficial: (1) o gate não repassa
`IDS_*`/`PG*`; (2) o processo de teste também as remove de todo spawn; (3) dentro do bash do cenário, todo cliente
PostgreSQL resolve para um simulado e a conexão aponta para um socket inexistente do sandbox, porta 1, papel
inexistente, sem `.pgpass`. Nada foi relaxado: os mesmos cenários, as mesmas expectativas (exceto o D3, cuja fixture
estava errada), o gate continua rodando todos os arquivos alterados.

## 3. Evidências (locais, sem PostgreSQL real)

- **Antes** (commit `23b7ac7a`, `ids_run_test_gate` real com as variáveis que o executor de produção exporta):
  `deploySafety.test.ts` 31 testes, 18 ok, 13 falhas (no Windows S1/S2 falham a mais por conversão de caminho do
  MSYS; na produção, 11).
- **Depois**: o mesmo gate com as exportações da produção: 34/34; com as da homologação: 34/34; sem gate, com o
  processo de teste contaminado: 34/34 (antes das regressões G4-aceita/G6, que levaram o arquivo a 36).
- **Final** (`npm run test:deploy-safety`, sem banco real): 3 arquivos, 55 testes, 54 aprovados, 0 reprovados, 1
  ignorado (H14, só Linux: roda no gate do servidor). Typecheck: 1368 erros = linha de base (nenhum novo).
- Integrações PostgreSQL 17 e E2E: **não são mais executadas localmente** (política em `CLAUDE.md`); ficam para a
  homologação (§4.1). Uma execução local anterior à política deu `deploySafety.pg17.integration.test.ts` 20/20; o E2E
  local foi interrompido e não conta como evidência.
- **G4-aceita**: o cliente "oficial" **aceita** a autenticação (root com peer/trust/.pgpass) e fica primeiro no PATH e
  em `IDS_PG_BIN`; D3, M1, M4 e S de homologação dão os códigos esperados e **nenhum** SQL chega a ele.
- **Mutação**: removidas as camadas do harness, o G4-aceita reprova (o SQL chega ao cliente oficial) — o teste pega
  a regressão.

## 4. Atualização dos servidores

O gate roda a biblioteca **instalada** na release do executor, e os testes do **commit alvo**. Só o commit corrigido
já passaria (camadas 2 e 3), mas a biblioteca v5.1 instalada fecha a camada 1 para todos os testes e corrige o
código 50. Atualizar os dois servidores antes do próximo deploy.

O `infra/deploy/environments/producao.env` do repositório ainda tem `A_COLETAR`; o ambiente instalado foi preenchido
no servidor. Por isso a fonte do ambiente é o **próprio arquivo instalado** (`IDS_INSTALL_ENV_SOURCE`): o instalador
compara, vê que é igual e não o substitui. Nenhum `--replace-env`.

### 4.1 Validação em homologação (servidor-01) — antes de qualquer atualização

Os testes com PostgreSQL 17 real rodam num clone à parte (nunca em `/opt/induscost-homolog/app`, cujo `.env` aponta
para `teste_bi_homolog`), com usuário **sem privilégio** (o `initdb` do harness recusa root). O harness cria um
cluster descartável num diretório temporário, em porta de loopback livre, e o apaga no fim: `teste_bi_homolog`, o
cluster da aplicação (5433) e o PostgreSQL 12 não são tocados.

```bash
SHA=<sha da branch/PR>
git clone --no-checkout https://github.com/Pidluznyj/IndusCost.git ~/induscost-validacao-$SHA
cd ~/induscost-validacao-$SHA && git checkout --detach $SHA
npm ci
DATABASE_URL=postgresql://offline:offline@127.0.0.1:1/offline npx prisma generate
npm run test:deploy-safety
INDUSCOST_REAL_PG_TESTS=1 COMMISSION_PG17_BIN=/opt/postgresql-17/bin npm run test:pg17
```

Esperado: `[testes] RESULTADO: OK` nos dois (o H14 deixa de ser ignorado no Linux). Depois, o ensaio da biblioteca no
cluster 17 da homologação (bancos `ids_ensaio_*`, já documentado em `VALIDACAO-HOMOLOGACAO.md` §1):

```bash
sudo bash scripts/ops/rehearseDeploySafety.sh --env-file /etc/induscost/deploy-executor-homologacao.env
sudo bash scripts/ops/rehearseDeploySafety.sh --env-file /etc/induscost/deploy-executor-homologacao.env --cleanup
```

Limpeza do clone: `rm -rf ~/induscost-validacao-$SHA`.

### AWS (`induscost-prod-saopaulo`) — preservando `/etc/induscost/deploy-executor-producao.env`

```bash
SHA=<sha do merge do PR na main>
sudo git -C /opt/induscost fetch origin
sudo mkdir -p /root/ids-$SHA
sudo sh -c "git -C /opt/induscost archive $SHA infra/deploy | tar -x -C /root/ids-$SHA"
sudo cp -p /etc/induscost/deploy-executor-producao.env /root/deploy-executor-producao.env.antes-$SHA
sudo sha256sum /etc/induscost/deploy-executor-producao.env
sudo IDS_INSTALL_ENV_SOURCE=/etc/induscost/deploy-executor-producao.env bash /root/ids-$SHA/infra/deploy/install-induscost-deploy.sh --env producao --dry-run
```

Esperado: `OK    … é o wrapper de uma instalação anterior (reinstalação)`, a nova release e `nada foi alterado`;
nenhuma linha `RECUSADO`/`PENDENTE`/diferença de ambiente. Depois:

```bash
sudo IDS_INSTALL_ENV_SOURCE=/etc/induscost/deploy-executor-producao.env bash /root/ids-$SHA/infra/deploy/install-induscost-deploy.sh --env producao --apply
sudo IDS_INSTALL_ENV_SOURCE=/etc/induscost/deploy-executor-producao.env bash /root/ids-$SHA/infra/deploy/install-induscost-deploy.sh --env producao --verify
sudo cmp /etc/induscost/deploy-executor-producao.env /root/deploy-executor-producao.env.antes-$SHA && echo "ambiente preservado"
sudo sha256sum /etc/induscost/deploy-executor-producao.env
sudo deploy-induscost-producao --version
sudo deploy-induscost-producao --check $SHA
```

Esperado: `RESULTADO: instalação íntegra.`, `ambiente preservado`, o mesmo sha256 de antes, `biblioteca=v5.1` e
`RESULTADO: CHECK OK ambiente=producao rc=0`. O `--check` não altera nada.

Voltar à release anterior (se necessário): reinstalar do commit anterior (`23b7ac7a`) com os mesmos comandos. **Não**
usar `--uninstall` para isso: ele desfaz a cadeia inteira até o executor antigo (o do incidente de 26/10).

### servidor-01 (homologação) — preservando `/etc/induscost/deploy-executor-homologacao.env`

Os mesmos comandos, trocando `producao` por `homologacao`, `/opt/induscost` por `/opt/induscost-homolog/app` e o
executor por `deploy-induscost-homologacao`.

## 5. Sequência de publicação (comandos operacionais preservados)

Os três comandos do operador **não estão versionados neste repositório** (existem só nos servidores). Antes do deploy,
conferir no host onde cada um existe:

```bash
for c in induscost-deploy-homologacao induscost-aprovar-producao induscost-deploy-producao; do p="$(command -v $c)"; echo "== $c → $p"; [ -n "$p" ] && sudo sha256sum "$p" && sudo cat "$p"; done
```

O que precisa ser verdade (e o que olhar na saída):

1. `induscost-deploy-homologacao` chama `deploy-induscost-homologacao` repassando `"$@"` (o instalador já confere:
   `LEGACY_WRAPPER_PATH`).
2. `induscost-aprovar-producao` grava um **SHA completo** (40 hexadecimais) que esteja implantado em homologação — não
   `origin/main`, não um nome de branch.
3. `induscost-deploy-producao` lê esse SHA e chama `/usr/local/bin/deploy-induscost-producao <SHA aprovado>`
   **com o SHA como argumento**. Sem argumento, o executor usa `DEFAULT_TARGET=origin/main` e publicaria um commit
   posterior ao aprovado. Na produção o instalador não confere esse wrapper (`LEGACY_WRAPPER_PATH=none`).
4. Nenhum deles usa `exec` sobre o shell do operador, `set -e` para ser `source`ado, `pkill`/`killall`/`flock`, nem
   reimplementa backup/rollback: a lógica de deploy é a do executor versionado e do arquivo de ambiente instalado.

Se algum ponto não for verdade, trazer o conteúdo: o ajuste é no wrapper, mantendo o nome do comando.

Sequência:

```bash
# servidor-01 (depois de atualizar o executor de homologação)
# (argumentos conforme os wrappers existentes, conferidos acima; os nomes dos comandos não mudam)
induscost-deploy-homologacao <SHA>
#   esperado: RESULTADO: DEPLOY CONCLUÍDO ambiente=homologacao rc=0
induscost-aprovar-producao <SHA>
#   esperado: registro do SHA aprovado (conferir que é o mesmo <SHA>)

# AWS (depois de atualizar o executor de produção e do --check $SHA acima)
induscost-deploy-producao
#   esperado: Alvo: <SHA aprovado>; 540+ testes do gate sem falha; RESULTADO: DEPLOY CONCLUÍDO ambiente=producao rc=0
```

As três migrations do commit são aplicadas **pelo executor**, dentro da janela, com backup e prova (nunca à mão).
