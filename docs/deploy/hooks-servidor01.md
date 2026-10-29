# Hooks de segurança do executor v4 no servidor-01 (homologação)

Data: 29/10/2026. Base: `main` `cb69e16e` (executor seguro v4). Escopo: só o repositório — nada foi executado em
servidor, banco, serviço, `/etc`, `/usr/local/bin` ou na AWS.

## 1. O que existe agora

| Peça | Onde | O que faz |
|---|---|---|
| Hook versionado | `infra/deploy/hooks/servidor01-checks.sh` | Verificações do executor antigo, **somente leitura**, nas três fases |
| Instalação | `infra/deploy/install-induscost-deploy.sh` | Copia `hooks/*.sh` para a release (0555, no `MANIFEST.sha256`); recusa `@release/…` que não exista na release |
| Executor | `infra/deploy/induscost-deploy-executor.sh` | Resolve `@release/<caminho>`; contexto próprio por execução; ALERTA (10) → saída 59 sem rollback; recusa o atualizador de egress como hook |
| Biblioteca v5 | `infra/deploy/induscost-deploy-safety.sh` | `PROTECTED_UNITS` aceita padrões (`*postgres*`); contrato estático do `UNIT_GLOB`; ausência de agendamentos dita no log |
| Ambiente | `infra/deploy/environments/homologacao.env` | Valores confirmados em 29/10; 3 pendências justificadas (§6) |

## 2. Verificações (preservadas do executor antigo)

| Verificação | Como (só leitura) | Antes do deploy | Depois da subida / do rollback |
|---|---|---|---|
| Papel do servidor | `induscost-runtime-role get` = `CLOUD_PRIMARY` (e `check <args>` se configurado) | recusa (9) | ALERTA |
| Produção Node local desligada | `systemctl show -p LoadState --value` = loaded/masked **e** `systemctl is-active` = inactive/failed (unidade inexistente, sonda muda ou estado desconhecido reprovam — nunca contam como "desligada") | recusa (9) | ALERTA |
| Nginx ativo | `systemctl is-active nginx.service` = active | recusa (9) | ALERTA |
| Gateway | `GET http://192.168.100.5:3000/api/health` 2xx | recusa (9) | ALERTA |
| Produção AWS | `GET http://100.85.97.124:3000/api/health` 2xx | recusa (9) | ALERTA |
| Commit AWS | `ssh <destino> "git -C '/opt/induscost' rev-parse --verify HEAD"` | lido e **registrado** no contexto | relido e **comparado** com o registro: diferente = ALERTA |
| BrasilAPI / publica.cnpj.ws | `GET https://brasilapi.com.br/`, `GET https://publica.cnpj.ws/` (qualquer HTTP < 500 prova rede/DNS/TLS; nenhum CNPJ é consultado) | aviso (`HOOK_CNPJ_POLICY=warn`) ou recusa (`fail`) | aviso ou ALERTA |
| Egress do serviço | `systemctl show -p IPAddressDeny -p IPAddressAllow -- induscost-homolog.service` + `getent ahostsv4`, pela regra do systemd (passa se estiver no `IPAddressAllow` ou fora do `IPAddressDeny`); `systemctl show` sem resposta = "não conferida", nunca OK | segue `HOOK_CNPJ_POLICY`: aviso com instrução manual (`warn`) ou recusa (`fail`) | aviso (`warn`) ou ALERTA (`fail`) |

Nunca: `systemctl` com outro verbo que não `is-active`/`show`, firewall, allowlist, drop-in, reinício,
`/usr/local/bin/update-induscost-homolog-egress` (ele altera drop-in e reinicia a homologação: o executor recusa
listá-lo como hook e o hook recusa qualquer comando configurado com esse nome), escrita na AWS ou fora do contexto.
`ssh` com `BatchMode=yes`, `StrictHostKeyChecking=yes` (nunca aceita chave nova nem pede senha), `UpdateHostKeys=no`
(não regrava o `known_hosts` do root) e `ControlMaster=no`/`ControlPath=none` (nenhum socket ou processo mestre fica
para trás, mesmo que o `~/.ssh/config` do root os ative). Da ferramenta de papel só a saída padrão é comparada (avisos
no stderr, como os de locale, vão para o log e não reprovam).

Serviço parado antes do deploy (`START_SERVICE_POLICY=if-was-active` com a homologação parada): a aplicação continua
parada e o health não roda, mas os hooks pós-subida **rodam mesmo assim** (`IDS_APP_STARTED=0`), porque as
verificações da produção e do commit AWS não dependem dela; qualquer falha vira ALERTA (59), nunca rollback. O mesmo
vale para os hooks pós-rollback quando o rollback mantém o serviço parado.

## 3. Política contra falhas espúrias (sem enfraquecer as críticas)

- Cada sonda de rede tem prazo (`HOOK_HTTP_TIMEOUT=10`, `HOOK_SSH_TIMEOUT=10` com teto de 2× para o comando remoto,
  `HOOK_CNPJ_TIMEOUT=10`, `HOOK_COMMAND_TIMEOUT=10` para comandos locais) e novas tentativas (`HOOK_HTTP_ATTEMPTS=3`,
  `HOOK_SSH_ATTEMPTS=2`, `HOOK_CNPJ_ATTEMPTS=2`, intervalo `HOOK_RETRY_DELAY=5`). Uma crítica só falha se **todas** as
  tentativas falharem: um pacote perdido não reprova o deploy; uma indisponibilidade real (≥ 3 tentativas em ~40 s)
  reprova.
- Terceiros (BrasilAPI, publica.cnpj.ws) são intermitentes e não fazem parte do caminho de produção: só avisam por
  padrão. `HOOK_CNPJ_POLICY=fail` os torna bloqueantes antes do deploy (e ALERTA depois).
- O pior caso somado (todas as tentativas estourando) é calculado pelo próprio hook e precisa caber em
  `HOOK_TIMEOUT - 10 s`; senão a configuração é recusada (3) antes de qualquer sonda. Com os valores do ambiente:
  245 s (255 s com `check`) para `HOOK_TIMEOUT=300` (fixado por teste). Assim o executor nunca mata o hook no meio de
  uma sonda.
- Um SIGTERM/SIGINT (`--stop`, Ctrl+C) durante os hooks prévios é tratado quando o hook termina: o executor aborta
  em seguida (130/143) **antes** de parar o serviço — a homologação nunca é derrubada e religada por um cancelamento.
- Depois da subida, falha da produção (gateway, AWS, papel, commit AWS) é **ALERTA**: o executor conclui o deploy da
  homologação **sem rollback** e termina com **59** (`RESULTADO: DEPLOY CONCLUÍDO COM ALERTA`), porque desfazer a
  homologação não recupera a produção e a reinicia de novo. `HOOK_PROD_POST_POLICY=rollback` transforma em falha
  comum (rollback pela política `HOOKS_POST_START_FAILURE`). O health da própria homologação (`HEALTH`) continua
  decidindo rollback como antes.

## 4. Contexto por execução (commit AWS anterior ao deploy)

Cada hook é um processo separado; a comparação "antes × depois" não pode depender de um arquivo global (um deploy
anterior, uma execução manual ou dois processos concorrentes poderiam trocá-lo). Por isso:

1. o executor gera `RUN_ID` (`<data UTC>-<pid>-<aleatório de /dev/urandom>`) e cria `IDS_STATE_DIR/hook-context/<RUN_ID>`
   (0700, `mkdir` sem `-p`: um identificador repetido falha em vez de reaproveitar) antes dos hooks prévios;
2. o hook prévio grava `aws-commit.before` **uma única vez** (`noclobber`, criação exclusiva) com `run_id`, ambiente,
   commit anterior, alvo, destino SSH, diretório e o SHA da AWS;
3. o executor grava `RUN_ID` em `<backup>/deploy-run-id`; `--recover --rollback` o recupera de lá, então o hook
   pós-rollback de uma retomada compara com o registro da **mesma** execução;
4. o hook posterior confere que o diretório é o da execução (nome = `IDS_DEPLOY_RUN_ID`, 0700, deste usuário) e que
   o registro bate em `run_id`, ambiente, commit anterior, alvo e destino AWS; qualquer divergência, registro ausente
   ou contexto inválido = ALERTA sem comparar. A leitura de cada fase posterior fica em `aws-commit.after-<fase>`.

Os contextos ficam em `/var/lib/induscost/deploy-safety/homologacao/hook-context/` (poucos bytes cada) como trilha de
auditoria; não são apagados automaticamente.

## 5. Códigos

| Hook | Significado | Executor |
|---|---|---|
| 0 | ok | segue |
| 1 | falha | antes: 9 (nada alterado); pós-subida: `HOOKS_POST_START_FAILURE` (rollback 44 / warn) |
| 3 | configuração ou uso inválido | antes: 9; pós-subida: o hook devolve 10 |
| 10 | ALERTA (só fases posteriores) | pós-subida: conclui sem rollback, **59** (com 55/57 o texto do `RESULTADO` carrega o ALERTA); pós-rollback: o rollback segue, o `RESULTADO` cita o ALERTA e `--recover --rollback` termina com **59** |
| 124 | prazo `HOOK_TIMEOUT` estourado (não ocorre com a configuração validada) | como falha |

## 6. Pendências (`A_COLETAR` com justificativa)

O executor antigo usa três valores que o contexto confirmado não traz. Inventá-los daria uma verificação falsa (um
destino SSH errado "lê" outro commit; uma unidade inexistente aparece sempre `inactive`), então ficam `A_COLETAR` e o
instalador/executor recusam até o preenchimento. Um único comando, só leitura, revela os três:

```bash
sudo grep -nE 'ssh|induscost-runtime-role|systemctl|is-active' /usr/local/bin/deploy-induscost-homologacao
```

| Chave | O que copiar da saída |
|---|---|
| `HOOK_AWS_SSH_TARGET` | o destino do `ssh` (ex.: `ubuntu@100.85.97.124` ou o alias do `~/.ssh/config` do root). Se o comando remoto do executor antigo não for `git -C /opt/induscost rev-parse HEAD`, trazer a linha: o hook só aceita esse comando |
| `HOOK_LOCAL_PROD_SERVICE` | a unidade da produção Node local que precisa estar desligada |
| `HOOK_RUNTIME_ROLE_CHECK_ARGS` | os argumentos de `induscost-runtime-role check …`; `none` se o executor antigo só compara a saída de `get` |

Também a confirmar no `--validate`/`--check` manual (§7.2): que `induscost-runtime-role get` imprime exatamente
`CLOUD_PRIMARY` (o hook compara a saída inteira, sem espaços) e que o `known_hosts` do root já tem a chave da AWS.

## 7. Instruções exatas (NÃO executadas; para a validação controlada no Linux)

Pré-requisito: as três chaves do §6 preenchidas em `infra/deploy/environments/homologacao.env`, commitadas e
publicadas; o commit no checkout usado para instalar (`/opt/induscost-homolog/app` após o deploy anterior, ou um
clone à parte). Todos os comandos abaixo são do roteiro [VALIDACAO-HOMOLOGACAO.md](../../infra/deploy/VALIDACAO-HOMOLOGACAO.md).

### 7.1 `--dry-run` do instalador (simulação, padrão)

```bash
cd /opt/induscost-homolog/app
sudo bash infra/deploy/install-induscost-deploy.sh --env homologacao --dry-run
```

Esperado: `OK    HOOKS_PRE_DEPLOY: @release/hooks/servidor01-checks.sh faz parte da release` (e o mesmo para
`HOOKS_POST_START`/`HOOKS_POST_ROLLBACK`), `OK    … é o executor auditado (sha256 confere)`, `OK    … chama
deploy-induscost-homologacao com "$@"`, `(simulação) cp …/hooks/servidor01-checks.sh …/hooks/servidor01-checks.sh` e
`nada foi alterado (use --apply)`. Nenhuma linha `PENDENTE`/`RECUSADO`.

### 7.2 Verificação manual do hook (antes de instalar; só leitura, nada gravado)

```bash
sudo bash infra/deploy/hooks/servidor01-checks.sh --validate --env-file infra/deploy/environments/homologacao.env
sudo bash infra/deploy/hooks/servidor01-checks.sh --check --env-file infra/deploy/environments/homologacao.env
```

Esperado no `--validate`: `pior caso das sondas: 245s (HOOK_TIMEOUT=300s)` (255 s com `check`) e `RESULTADO:
configuração válida`. No `--check`: `OK    papel do servidor: CLOUD_PRIMARY`, `OK    produção Node local … desligada (inactive; loaded)`,
`OK    nginx.service ativo`, `OK    gateway respondeu`, `OK    produção AWS respondeu`, `OK    commit em execução na
produção AWS (…:/opt/induscost): <sha>` (conferir o SHA com o da AWS), as linhas de BrasilAPI/publica.cnpj.ws e do
egress, e `RESULTADO: --check OK …; nada foi gravado`. Um `ATENÇÃO CNPJ: egress … NÃO cobre …` indica que o
atualizador de egress precisa ser rodado **pelo operador**, à parte e numa janela própria (ele reinicia a homologação).

### 7.3 Instalação

```bash
sudo bash infra/deploy/install-induscost-deploy.sh --env homologacao --apply
```

Esperado: `OK    executor antigo guardado em /usr/local/lib/induscost/backups/… (sha256 confere)`, `OK    sintaxe
(induscost-deploy-safety.sh induscost-deploy-executor.sh hooks/servidor01-checks.sh)` e `RESULTADO: instalação
íntegra.`.

### 7.4 `--verify` da instalação

```bash
sudo bash infra/deploy/install-induscost-deploy.sh --env homologacao --verify
sudo sh -c 'cd "$(cat /usr/local/lib/induscost/homologacao.current)" && grep hooks/ MANIFEST.sha256 && stat -c "%U %a %n" hooks/servidor01-checks.sh'
```

Esperado: `OK    MANIFEST de … confere`, `OK    hooks/servidor01-checks.sh idêntico ao do repositório`, `OK    … completo`,
`RESULTADO: instalação íntegra.`; a linha do hook no MANIFEST e `root 555 hooks/servidor01-checks.sh`.

### 7.5 `--check` do executor (plano; hooks validados, não executados)

```bash
sudo deploy-induscost-homologacao --check
```

Esperado (além do passo 3 do roteiro): `escopo da janela conferido: cron /etc/cron.d/induscost-homolog* (0) e unidades
induscost-homolog-* (0) só desta instalação (/opt/induscost-homolog)` precedido de `nenhum agendamento desta instalação`,
`Hooks prévios:    /usr/local/lib/induscost/releases/<versão>/hooks/servidor01-checks.sh`, o mesmo nas outras fases, e
`RESULTADO: CHECK OK ambiente=homologacao rc=0`. O `--check` não cria contexto.

### 7.6 No primeiro deploy real (passo 8 do roteiro)

Esperado: `Execução:         <RUN_ID> (contexto dos hooks: /var/lib/induscost/deploy-safety/homologacao/hook-context/<RUN_ID>)`,
`--- hook HOOKS_PRE_DEPLOY: …servidor01-checks.sh OK` antes de `3/11`, `--- hook HOOKS_POST_START: … OK` depois de
`Health: OK`, `commit da produção AWS inalterado durante o deploy (<sha>)` e `RESULTADO: DEPLOY CONCLUÍDO … rc=0`.
`rc=59` = deploy concluído com ALERTA: ler as linhas `FALHA crítica`/`ALTERAÇÃO INESPERADA` e investigar a produção;
nada foi desfeito nem executado na AWS. `rc=9` com `FALHA crítica` = recusado antes de qualquer alteração.

## 8. Evidências locais

- `src/lib/ops/deployHooksServidor01.test.ts` (H1–H14; H14 só no Linux, onde o gate do servidor roda este arquivo):
  sucesso, gateway/AWS indisponíveis, falha passageira, papel (inclusive aviso no stderr), produção local (inexistente,
  sonda muda, estado ilegível), Nginx, SHA alterado, contexto de outra execução/adulterado/ausente/0755, CNPJ
  (warn/fail, 404/429/503), egress (CIDR, regra allow/deny do systemd, `show` falho, política fail), pós-rollback,
  configuração (pendências, pior caso REAL de 245/255 s, atualizador de egress, URL/SSH inválidos), `--check` sem
  gravação, varredura do código (sem verbos de escrita; ssh sem `UpdateHostKeys`/`ControlMaster`) e prova de nenhum
  efeito colateral (só o registro do contexto é criado; chamadas só de leitura). O executor só é chamado com cópia
  temporária do ambiente com pendência (sai com 3 antes de trava, pidfile ou leitura do servidor).
- `src/lib/ops/deploySafety.test.ts` S5–S7 e I5: globs reais da homologação sem agendamentos, padrões protegidos
  (também em lista de várias linhas), contrato estático, agendamento futuro validado (G8), instalação dos hooks na
  release/MANIFEST, `--verify` pelo conjunto instalado (checkout diferente = AVISO; hook do ambiente fora da release =
  FALHA) e permissões devolvidas numa release reutilizada (Linux).
- `src/lib/ops/deployExecutor.pg17.e2e.test.ts` X1–X6 (git, Prisma e PostgreSQL 17 reais, hook instalado pela release):
  deploy OK com contexto, recusa 9 por gateway/AWS antes de qualquer alteração, SHA AWS alterado → 59 sem rollback,
  pós-rollback (falha de build e `--recover --rollback` após queda) com o contexto da mesma execução, atualizador de
  egress recusado, hook adulterado recusado pelo MANIFEST (4), serviço parado antes do deploy (hooks rodam, 59) e
  retomada com ALERTA pós-rollback (59).
