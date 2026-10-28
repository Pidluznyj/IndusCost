# Deploy seguro do IndusCost — executor versionado e biblioteca v4

Substitui os executores editados à mão (`/usr/local/bin/deploy-induscost-producao` na AWS e
`/usr/local/bin/deploy-induscost-homologacao` no servidor-01, atrás do wrapper `induscost-deploy-homologacao`) por
um executor versionado, instalado e desinstalado por script. Ninguém aplica isto automaticamente.

| Arquivo | Papel |
|---|---|
| `induscost-deploy-safety.sh` | Biblioteca (G1–G8 abaixo) |
| `induscost-deploy-executor.sh` | Executor completo (pré-condições → backup → código → testes → build → migrations → aplicação → encerramento; rollback; interrupção controlada; recuperação) |
| `environments/producao.env`, `environments/homologacao.env` | As **únicas** diferenças entre ambientes; `A_COLETAR` bloqueia |
| `install-induscost-deploy.sh` | Instalação reversível (`--dry-run` padrão, `--apply`, `--verify`, `--uninstall`) com MANIFEST sha256 e sha256 do executor antigo conferido |
| `../../scripts/ops/checkDeployExecutorSafety.sh` | Verificador somente leitura (aceita o wrapper instalado) |
| `../../scripts/ops/rehearseDeploySafety.sh` | Ensaio no servidor em bancos descartáveis `ids_ensaio_*` do cluster configurado (`--env-file`) |
| [COLETA.md](COLETA.md) | O que coletar antes de instalar |
| [VALIDACAO-HOMOLOGACAO.md](VALIDACAO-HOMOLOGACAO.md) | Roteiro manual de validação no servidor-01 |

## O incidente de 26/10/2026

1. O gate de testes falhou: um teste dependia do lock real de Contas a Receber, que a rotina real segurava.
2. O rollback do executor fez `dropdb teste_bi` + `createdb`. O `pg_restore` (como `postgres`) não leu o dump: o
   diretório era `root:root 0700`, e a conferência do dump tinha rodado como root.
3. A falha foi **antes** das migrations: o banco não precisava de restauração nenhuma.

## Garantias

| | Garantia | Como |
|---|---|---|
| G1 | Janela de manutenção seletiva e persistente | Ver o detalhamento abaixo da tabela |
| G2 | Trava de escrita | `default_transaction_read_only=on` no banco durante a janela: toda sessão nova só lê, inclusive superusuário e `nextval`. Só a URL das migrations recebe `options=-c default_transaction_read_only=off` |
| G3 | Prova de ausência de escrita (não depende do XID global) | Ver o detalhamento abaixo da tabela |
| G4 | Rollback por compatibilidade | Ver a decisão do rollback abaixo |
| G5 | Restauração fiel | Ver o detalhamento abaixo da tabela |
| G6 | Gate de testes isolado | Sem `.env`, banco inalcançável, chaves do `.env` vazias, locks temporários |
| G7 | Cluster explícito e conferido | Todo `psql`/`pg_dump`/`pg_restore`/`createdb` recebe socket/host, porta, papel e diretório de binários do arquivo de ambiente (`IDS_PG_HOST/PORT/ADMIN_ROLE/BIN`, `IDS_PG_OS_USER`); antes de qualquer ação, `ids_assert_cluster` confere versão maior, porta, socket, superusuário e versão dos clientes (50). Num host com dois clusters (servidor-01: 12 em 5432 e 17 em 5433), os padrões do libpq levariam ao cluster errado. Bancos de `PROTECTED_DATABASES` nunca são alvo (50). Espaço em disco conferido para o backup e para a restauração (51) |
| G8 | Isolamento verificável | Cada arquivo de cron casado por `CRON_GLOB` precisa executar o `APP_MARK_PATTERN`; cada timer/serviço casado por `UNIT_GLOB` precisa rodar dentro dele (`systemctl show`); unidades de `PROTECTED_UNITS` jamais podem ser casadas (52). Rotinas em execução só contam se forem desta instalação (linha de comando ou cwd dentro do `APP_MARK_PATTERN`, via `/proc`); `/opt/induscost` não casa `/opt/induscost-homolog` |

**G1 — janela de manutenção:**

- só os arquivos `/etc/cron.d/<CRON_GLOB>` saem, guardados com sha256;
- só os timers `<UNIT_GLOB>` **ativos** param; inativos ou com falha ficam intocados;
- serviços do glob e rotinas Nomus/Exposure desta instalação já iniciadas são aguardados;
- o estado fica em `/var/lib/induscost/deploy-safety/<amb>/maintenance.state`, com o diretório do backup do deploy
  (`deploy <dir>`), para a recuperação;
- o `cron.service` inteiro nunca é parado;
- uma linha do IndusCost (desta instalação) fora de `/etc/cron.d/<CRON_GLOB>` recusa o deploy (47).

**G3 — prova de ausência de escrita:**

- **tuplas** das tabelas de usuário (o autovacuum não conta);
- **sequências** (`nextval` não consome XID);
- **arquivos das tabelas** (`TRUNCATE` não conta tupla);
- **estrutura**;
- **sessões**: um observador durante as migrations e o contador de sessões no congelamento.

**G5 — restauração fiel:**

- banco atual congelado (`ALLOW_CONNECTIONS false`) e prova reconferida;
- banco novo com encoding, collation, dono, limite, ACL e configurações do original;
- `pg_restore` completo, com donos e permissões;
- conferência integral antes da troca;
- dois `RENAME` numa única transação;
- `<db>__failed_<ts>` preservado; nenhum `dropdb` (o único `dropdb` do repositório está no `--cleanup` do ensaio,
  restrito a nomes `ids_ensaio_<época>_<cenário>` sem sessões).

### Decisão do rollback

| Situação | Ação |
|---|---|
| Falha antes das migrations (inclusive interrupção) | Banco intocado; só o código volta |
| Migrations não mudaram o schema | Banco intocado; só o código volta |
| Schema novo **compatível** com o código anterior | Banco **mantido** (sem perda nem parada); só o código volta |
| Incompatível e **prova fecha** (nada escrito desde o backup, ou a aplicação subiu sem escrever) | Restauração integral, depois volta o código |
| Incompatível **sem prova** (a aplicação escreveu, sessão estranha etc.) | **BLOQUEIO** (saída 2): nada é restaurado nem apagado; serviço parado; janela e trava mantidas; instruções impressas |

**Compatível** = só acrescenta coisas que o código anterior ignora:

- tabelas novas;
- colunas anuláveis ou com valor padrão/identidade;
- índices não únicos;
- views, funções, sequências e extensões novas;
- rótulos de enum ainda não usados;
- FK restritiva só se a tabela nova estiver vazia.

Qualquer remoção ou alteração, coluna obrigatória sem padrão, índice único, constraint ou trigger em tabela existente,
ou migration que apague dados, é **incompatível**.

### Hooks: o que o executor antigo fazia além deste fluxo

Verificações de saúde da AWS e do gateway, controle de egress (`update-induscost-homolog-egress`) e validações
BrasilAPI/cnpj.ws não são reimplementadas: entram como **executáveis listados por fase** no arquivo de ambiente
(`HOOKS_PRE_DEPLOY`, `HOOKS_POST_START`, `HOOKS_POST_ROLLBACK`; `none` = nenhum), extraídos do executor antigo
(COLETA H1/H7). Exigências: caminho absoluto, do root, não gravável por grupo/outros, prazo `HOOK_TIMEOUT`.
Recebem `IDS_DEPLOY_PHASE`, `IDS_TARGET`, `IDS_OLD_COMMIT`, `IDS_BACKUP_DIR`.

| Fase | Quando | Falha |
|---|---|---|
| `HOOKS_PRE_DEPLOY` | Depois do plano, antes de parar o serviço | Saída 9; nada foi alterado |
| `HOOKS_POST_START` | Depois do health OK da aplicação nova | `HOOKS_POST_START_FAILURE=rollback` (padrão): rollback normal, saída 44; `warn`: só avisa |
| `HOOKS_POST_ROLLBACK` | Depois de o rollback subir o serviço com health OK | Só avisa |

O executor nunca altera drop-ins de systemd, firewall ou egress: isso é dos próprios scripts, preservados como estão.
`--check` lista os hooks e não os executa.

### Interrupção e recuperação (substitui `pkill -9 -f`)

O executor grava o pid em `/run/induscost/deploy-<amb>.pid` enquanto segura a trava. A etapa de deploy (código,
testes, build, migrations, aplicação) roda num subshell em segundo plano; SIGTERM/SIGINT ao executor fazem-no
enviar TERM **só à árvore desse subshell** (descendentes primeiro, pelos pids, sem `pkill -f`), esperar, e seguir
para o rollback normal. Um segundo sinal durante o rollback é ignorado.

| Comando | Efeito |
|---|---|
| `<wrapper> --stop` | SIGTERM ao executor em andamento: etapa atual interrompida, rollback normal, saída 130/143 |
| `<wrapper> --abort-hard` | SIGKILL a toda a árvore (simulação de queda, só para validar a recuperação); janela fica aberta |
| `<wrapper> --recover` | Mostra a janela pendente; nada é alterado |
| `<wrapper> --recover --rollback` | Recupera o contexto (`deploy <backup>` na janela, `commit-before.txt`, `service-was-active`) e executa o rollback normal: banco por compatibilidade, código anterior, serviço, janela encerrada |
| `<wrapper> --recover --resume` | Só encerra a janela (cron, timers, trava), quando o operador já tratou banco e código |

### Códigos de saída

| Código | Significado |
|---|---|
| 0 | OK |
| 2 | BLOQUEIO |
| 3 | Configuração incompleta / hook inválido |
| 4 | Instalação adulterada |
| 5 | Outro deploy em andamento |
| 6 | Modo do servidor inesperado |
| 7 | Árvore suja |
| 8 | Alvo não é avanço rápido |
| 9 | Hook prévio falhou (nada alterado) |
| 30–32 | Backup (30 inclui raiz de backup em diretório do sistema ou pai não atravessável pelo usuário do banco) |
| 33–38, 49 | Restauração não realizada (banco atual intocado; 33 inclui backup de outro banco/cluster) |
| 44 (biblioteca) | Banco já restaurado e trocado, mas fechado para conexões → `--recover` |
| 39 | Escrita durante o backup |
| 40 | Rotina desta instalação não terminou (ou espera interrompida por sinal) |
| 41 | Sessão, 2PC, assinatura, slot de replicação, publicação ou estatística desligada |
| 42 | Retomada da janela (cron/timer/trava não voltou) |
| 43 | Escrita depois do backup |
| 44 (executor) | Verificação pós-subida (hook) falhou → rollback |
| 45 | Banco ausente |
| 46 | Janela pendente |
| 47 | Agendamento não gerenciado |
| 48 | Trava já usada por terceiros |
| 50 | Cluster diferente do configurado (versão, porta, socket, superusuário, clientes, usuário do SO) ou banco protegido |
| 51 | Espaço em disco insuficiente |
| 52 | Escopo da janela amplo demais (glob casa unidade/cron de fora ou protegida) |
| 53 | Health da aplicação nova falhou → rollback |
| 54 | Migration com falha registrada → rollback |
| 55 | Deploy concluído, mas a janela não fechou inteira (`--recover --resume`) |
| 56 | Serviço não parou (nada alterado; religado) |
| 57 | Commit final diferente do alvo |
| 58 | `DATABASE_URL` da aplicação aponta para outro banco/porta/versão (migrations iriam para o lugar errado) |
| 130 / 143 | Interrompido por SIGINT / SIGTERM (rollback feito, ou nada alterado se antes da etapa de deploy) |

Toda execução que passa da leitura do arquivo de ambiente (deploy, `--check`, `--recover --rollback`) termina com a
linha `RESULTADO: <situação> ambiente=… rc=<n> alvo=… anterior=… backup=…`, para o arquivamento — inclusive as
recusas de pré-condição (`RECUSADO (…)`) e os aborts antes de qualquer alteração (`ABORTADO (…)`). Os utilitários
`--recover` (sem `--rollback`), `--restore-backup`, `--stop`, `--abort-hard` e `--version` não a imprimem. Os
códigos 1/outros são o `rc` da etapa que falhou (npm, prisma, build), com o rollback já feito.

## Como aplicar

1. Coleta: [COLETA.md](COLETA.md). Os valores entram em `environments/<amb>.env`; as particularidades do executor
   atual viram hooks.
2. Validação em homologação: [VALIDACAO-HOMOLOGACAO.md](VALIDACAO-HOMOLOGACAO.md), incluindo o ensaio
   `rehearseDeploySafety.sh --env-file`, a instalação, o deploy real, a falha, `--stop`, `--abort-hard` +
   `--recover --rollback` e a desinstalação.
3. Produção: os mesmos passos, com autorização explícita.

Instalação, sempre começando pela simulação:

```bash
sudo bash infra/deploy/install-induscost-deploy.sh --env homologacao
```

```bash
sudo bash infra/deploy/install-induscost-deploy.sh --env homologacao --apply
```

```bash
sudo bash scripts/ops/checkDeployExecutorSafety.sh /usr/local/bin/deploy-induscost-homologacao
```

Uso depois de instalado (o wrapper do operador continua o mesmo):

```bash
sudo induscost-deploy-homologacao --check
```

```bash
sudo induscost-deploy-homologacao
```

Interrupção controlada de um deploy em andamento (noutro terminal):

```bash
sudo induscost-deploy-homologacao --stop
```

Recuperação de uma janela interrompida (primeiro confere, depois conclui pelo rollback normal):

```bash
sudo induscost-deploy-homologacao --recover
```

```bash
sudo induscost-deploy-homologacao --recover --rollback
```

Restauração manual depois de um BLOQUEIO (decisão do operador; descarta o que foi escrito depois do backup):

```bash
sudo induscost-deploy-homologacao --restore-backup /var/backups/induscost-homolog/deploys/<ts>
```

Para voltar ao executor anterior, byte a byte (recusa se o arquivo já não for o wrapper desta instalação):

```bash
sudo bash infra/deploy/install-induscost-deploy.sh --env homologacao --uninstall
```

## Depois de um rollback com banco restaurado

O estado no momento da falha fica em `<db>__failed_<ts>`. A conferência fica em `<backup>/restore-journal`,
`restore-verification.diff`, `compat-report.txt` e `rollback-decision.txt`. Remover o banco `__failed_` só depois de
conferir, manualmente.

## Testes

| Suíte | O que roda |
|---|---|
| `src/lib/ops/deploySafety.test.ts` | Sem banco: janela seletiva, escopo dos globs e unidades protegidas (S1–S3), rotinas por instalação via cwd (S4), classificador, URL, gate, verificador, instalador com CRLF |
| `src/lib/ops/deploySafety.pg17.integration.test.ts` | PostgreSQL 17 com psql/pg_dump/pg_restore/createdb **reais**: trava, prova, decisões, restauração, troca, quedas, recuperação e o ensaio do servidor (R18 por ambiente, R19 guardas do `--cleanup`, R20 `--env-file` com cluster errado/certo) |
| `src/lib/ops/deployExecutor.pg17.e2e.test.ts` | Executor **instalado**, com git e Prisma reais e PostgreSQL 17 real; systemd, npm, curl e flock simulados: E1–E7 fluxo e rollbacks, E8 `--stop`, E9 `--abort-hard` + `--recover --rollback`, E10 hooks, E11 cluster, E12 disco, E13 escopo/protegidos, E14 janela recusada com rc real, E15 `git reset` impossível no rollback, E16 `DATABASE_URL` de outro banco (58), E17 `--restore-backup`, E18 globs malformados, I1–I3 instalador (sha256 do executor antigo, `--uninstall` em cadeia) |

As suítes PostgreSQL rodam com `COMMISSION_PG17_BIN=<bin do PostgreSQL 17 com os clientes>`. Sem essa variável,
elas ficam puladas.
