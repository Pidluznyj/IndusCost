# Adequação do executor seguro ao servidor real de homologação — relatório de 28/10/2026

Branch `fix/deploy-executor-homolog-real` (worktree `C:/Dev/induscost-deploy-homolog`, base `origin/main` 4cab35b5).
Nada foi executado em servidor, banco operacional, AWS ou produção; nada foi publicado na `main`.

## 1. Diagnóstico (o que o release 4cab35b5 faria no servidor-01 se instalado como estava)

| # | Problema | Consequência no servidor-01 |
|---|---|---|
| D1 | Biblioteca e ensaio falavam com o PostgreSQL pelos padrões do libpq (`runuser -u postgres -- psql` sem host/porta/papel; binários do `PATH`) | Toda consulta, `pg_dump`, `createdb` e `pg_restore` iria ao **PostgreSQL 12** (socket padrão, porta 5432), não ao 17 (`/run/induscost-pg17`, 5433). O ensaio criaria `ids_ensaio_*` no cluster 12; o executor pararia em 45 (banco inexistente) ou, pior, trabalharia num `teste_bi_homolog` residual do 12 |
| D2 | `UNIT_GLOB='induscost-*'` (padrão/produção) pararia `induscost-db-backup.timer` (backup diário 22h30 do PG12) e esperaria por `induscost-db-backup.service` | Interrupção do backup do PG12 durante a janela; espera de até 30 min + saída 40 |
| D3 | `pgrep -af` com o padrão Nomus/Exposure era global ao host | Um sync Nomus do legado `/opt/induscost` faria a homologação esperar até 30 min com o serviço já parado, e falhar (40) |
| D4 | `APP_MARK_PATTERN` era substring: `/opt/induscost` casava `/opt/induscost-homolog` | Com o padrão de produção, as linhas Nomus do root do legado disparariam a recusa 47; sem fronteira de caminho, dois ambientes no mesmo host se confundem |
| D5 | `--restore-backup` aceitava qualquer diretório com dump; nenhuma verificação de cluster, superusuário, versão dos clientes ou disco antes de agir | Restauração de um dump de outro banco/cluster era possível; `pg_dump` 12 contra servidor 17 falharia tarde |
| D6 | Interrupção: subshell em primeiro plano sem `trap`, sem pidfile; a doc mandava `pkill -9 -f induscost-deploy-executor.sh` | `pkill -f` mata qualquer processo com o texto na linha de comando; `-9` deixa a janela/trava sem registro; matar só o pai deixava o subshell continuar o deploy órfão |
| D7 | Instalador não conferia o sha256 do arquivo que substitui, não via o wrapper legado, guardava o executor antigo legível por todos e aceitava executor antigo em execução | Troca de um arquivo diferente do auditado; comando do operador podia continuar no executor antigo (rollback destrutivo); credenciais do executor antigo expostas |
| D8 | Nenhum ponto de extensão para o que o executor antigo faz além do fluxo (saúde da AWS e do gateway, egress, BrasilAPI/cnpj.ws) | Essas verificações sumiriam na troca |
| D9 | Ensaio: falha de `scenario()` engolida (DB/DIR vazios → arquivos na raiz), `rm -rf` de caminhos vindos do ambiente sem validação, `--cleanup` sem recusar bancos com sessões | Ensaio inseguro fora do ambiente controlado |
| D10 | Documentação com comandos `sudo -u postgres psql` (PG12), contagem `15 OK` fixa, `pkill -9 -f`, hash do arquivo errado na desinstalação | Roteiro de validação enganoso para o servidor-01 |

## 2. O que foi feito

- **Biblioteca v4** (`infra/deploy/induscost-deploy-safety.sh`): G7 cluster explícito — `IDS_PG_HOST/PORT/ADMIN_ROLE/BIN/EXPECT_MAJOR/MAINT_DB`
  em todo `psql`/`pg_dump`/`pg_restore`/`createdb`; `ids_assert_cluster` (50: versão maior, porta, socket, superusuário,
  versão dos quatro clientes, usuário do SO = dono dos backups); `ids_assert_disk_space` (51); `PROTECTED_DATABASES`
  (50); `backup-meta.txt` (banco + `system_identifier`) exigido no `--restore-backup`. G8 isolamento verificável —
  `ids_assert_isolation_scope` (52): cada cron do glob precisa executar no `APP_MARK_PATTERN`, cada timer/serviço
  do glob precisa rodar nele (`systemctl show`), `PROTECTED_UNITS` nunca; o `--check` imprime o que a janela pausaria;
  rotinas em execução só contam se forem desta instalação (linha de comando com fronteira de caminho ou cwd via
  `/proc`; cwd ilegível = conservador). `ids_prepare_backup_dir` não altera o modo de diretórios pré-existentes (só
  `+x` se o usuário do banco não atravessar) e recusa raiz em diretório do sistema. Guardas contra diretório vazio;
  observador fecha o FD da trava.
- **Executor** (`infra/deploy/induscost-deploy-executor.sh`): hooks por fase (`HOOKS_PRE_DEPLOY` → 9, `HOOKS_POST_START`
  → rollback 44 ou `warn`, `HOOKS_POST_ROLLBACK` → aviso; executáveis do root, caminho absoluto, não graváveis,
  `HOOK_TIMEOUT`); pidfile + `trap`; etapa de deploy em subshell em segundo plano com `9>&-`; `--stop` (SIGTERM só ao
  executor, que encerra a própria árvore pelos pids e faz o rollback normal; saída 143); `--abort-hard` (SIGKILL na
  árvore, só para validar); `--recover --rollback` (contexto `deploy <dir>` registrado na janela); `--recover` para o
  observador órfão; `--check` sem `ALTER` (só relata banco fechado); varredura genérica de `A_COLETAR`; códigos 53–57
  sem colisão com a biblioteca; linha final `RESULTADO:`.
- **Instalador**: `EXECUTOR_EXPECTED_SHA256` (recusa se o arquivo diferir; reinstalação sobre o próprio wrapper
  aceita); `LEGACY_WRAPPER_PATH` precisa chamar o executor; executor antigo em execução recusa (leitura de `/proc`);
  symlink recusado; backups em `backups/` 0700 com 0400, modo/dono/sha no histórico, restaurados na desinstalação;
  `--replace-env` guarda o env anterior; `--uninstall` recusa se o arquivo já não é o wrapper ou se o backup mudou.
- **Ensaio** (`scripts/ops/rehearseDeploySafety.sh`): `--env-file` obrigatório (só chaves `IDS_PG_*`, `DB`,
  `PROTECTED_DATABASES`, `BACKUP_ROOT`), `ids_assert_cluster` antes de tudo, 16 passos com total esperado impresso,
  `prepare()` aborta cenário incompleto, `trap` encerra observadores/janela, `--cleanup` só para
  `ids_ensaio_<época>_<cenário>[__failed|__rollback_…]` sem sessões e com diretórios validados.
- **Verificador** (`scripts/ops/checkDeployExecutorSafety.sh`): segue link simbólico e wrapper legado (`exec`, 2 saltos).
- **Ambientes**: `homologacao.env` com todos os fatos confirmados e os desconhecidos como `A_COLETAR`; `producao.env`
  ganhou as mesmas chaves, todas `A_COLETAR`.
- **Documentação**: `COLETA.md` (H1–H10 para servidor-01, P10), `VALIDACAO-HOMOLOGACAO.md` (procedimento exato com
  `PSQL17`, fotografia antes/depois dos recursos alheios, `--stop`, `--abort-hard` + `--recover --rollback`,
  desinstalação com sha256 conferido), `APLICAR.md` (G7/G8, hooks, interrupção, códigos), `docs/deploy/integridade-do-deploy.md`.
- **Testes**: sem banco `S1–S4`; PG17 real `R19–R20`; e2e `E8–E13`, `I3`; stubs de `systemctl show`. Resultado final na
  seção 4.

### 2.1 Correções após a revisão adversarial do diff (mesmo dia)

Uma revisão com quatro lentes (semântica bash, destrutividade/isolamento, configuração/documentação, lacunas de
teste) produziu 60 achados; a verificação automática caiu por limite de sessão e cada um foi julgado à mão.
Aplicados:

| Achado | Correção |
|---|---|
| `if ! cmd; then rc=$?` devolvia rc=0 nos aborts de janela/backup | `cmd \|\| { rc=$?; … }` nos dois pontos; E14 exige 41 + `RESULTADO: ABORTADO` |
| `git reset --hard` do rollback sem status conferido | `GIT_RC` + `rev-parse HEAD` == anterior; se falhar, não roda npm/build nem religa o serviço; aviso de `.git/index.lock` órfão; E15 |
| Rollback religava o serviço com a trava ainda ligada (pool nasce read-only) | `ids_write_lock_off` antes do `systemctl start` no rollback |
| Traps só depois do backup: `--stop` durante 3/11 matava o executor sem rollback | Traps desde o pidfile; sinal antes da etapa de deploy aborta com o sistema de volta (143, nada alterado); espera por rotinas interrompível |
| Rollback com `ids_maintenance_end` falhando era "CONCLUÍDO" rc 0 | Retorna 55 (`ROLLBACK CONCLUÍDO COM JANELA PENDENTE`) |
| `DATABASE_URL` da aplicação (usada pelo `prisma migrate`) não era conferida contra banco/porta/versão | `assert_app_database_url` (58) nas pré-condições, inclusive `--check`; E16 |
| Globs com espaço/sufixo `.timer` expandiam errado ou casavam nada em silêncio | Forma validada (3); E18 |
| `--restore-backup` aceitava qualquer diretório quando `BACKUP_ROOT` não existia; links; `set -e` engolia o roteiro final | Raiz obrigatória, sem links, `ids_recover_db_state` antes, `\|\| rc=$?`; E17 |
| `--recover --rollback` após a aplicação nova subir desfaria um deploy concluído | Recusa (3) sem `--force-rollback`; mensagem 46 orienta `--resume` |
| `ids_log` em stdout corrompia o caminho devolvido por `ids_prepare_backup_dir` (só com `runuser`) | Mensagens da função em stderr; executor valida o caminho |
| `ids_prepare_backup_dir` alterava o modo de diretórios do executor antigo | Recusa (30) com o comando a executar (`setfacl`), nunca altera |
| `ids_migrate_watch_stop` matava um pid lido de arquivo sem identidade (reuso após reboot) | pid + `starttime` de `/proc`; sinal só se conferir |
| Restauração sem conferir disco no momento; slots/publicações lógicas fora da quiescência | `ids_assert_disk_space` no início da restauração; `pg_replication_slots`/`pg_publication` → 41 |
| `pg_dump`/`git fetch` herdavam o FD da trava | `9>&-` |
| Pré-condições saíam sem `RESULTADO` | `finish` em 7/8/45/46/50/51/52/58 e no `--check` |
| Instalador: sha esperado + arquivo ausente instalava; wrapper legado aceito por substring; symlink; `--uninstall` parava no wrapper anterior após `--replace-env` | Recusas; exige `"$@"` e sem `pkill`/`flock`; link só se apontar para o executor; desfaz a cadeia até o executor legado (I3) |
| Verificador reprovava instalação íntegra com biblioteca de outra versão; sem G7/G8 | Aviso (só com MANIFEST íntegro); três checks novos (cluster, banco protegido, escopo antes de `service_stop`) |
| Reinstalar a mesma versão falhava (`cp` sobre release 0555) | Release já instalada e íntegra é reutilizada; sem MANIFEST válido os arquivos são refeitos |
| `IDS_APP_MARK_PATTERN` entrava numa ERE sem escape (`.`/`+`/`(`) | Caminho escapado (achado da própria correção: `[.` abre símbolo de collation no `sed`) |
| Docs: comandos com `\|` em tabelas (redação de segredos quebrada), crontab do root não lida pelo glob sob `sudo`, cenário de health quebrado derrubava o rollback, `pkill`, linhas esperadas imprecisas, `--uninstall` em cadeia | COLETA em blocos de código + H11; VALIDACAO reescrita (hook pós-subida, comandos pelo executor instalado, ordem 5–7 antes do deploy real, `diff` sem o arquivo que muda) |

Não aplicados (registrados como pendências): dividir `ids_maintenance_begin` para esperar rotinas **antes** de parar o
serviço (indisponibilidade de até 30 min com Nomus em execução — mitigado pelo `--stop` agora funcionar nessa
espera); separar o diretório de controle (root) do dump (usuário do banco); `IDS_WATCH_INTERVAL` com `runuser`
(20 conexões/s durante migrations); testes só possíveis no Linux (flock real, `ps --ppid`, `runuser`, symlinks).

## 3. Valores ainda pendentes de coleta (bloqueiam a instalação; comandos em `infra/deploy/COLETA.md`)

| Chave | Fato necessário | Item |
|---|---|---|
| `IDS_PG_OS_USER` | usuário do SO que roda o cluster 17 e autentica como `pg17homolog` pelo socket (dono dos backups) | H5 |
| `IDS_PG_BIN` | diretório dos binários 17 (`psql`, `pg_dump`, `pg_restore`, `createdb`) | H5 |
| `CRON_GLOB`, `UNIT_GLOB` | agendamentos **próprios** da homologação; nunca `induscost-*` (casaria `induscost-db-backup.timer`) | H3/H4 |
| `MODE_FILE`, `EXPECTED_MODE`, `PRECUTOVER_DROPIN`, `PRECUTOVER_EXPECTED` | existe arquivo de modo / drop-in de pré-cutover? (`none` se não) | H6 |
| `START_SERVICE_POLICY` | decisão do operador (`if-was-active` / `always`); o executor antigo não foi lido | H1 |
| `HOOKS_PRE_DEPLOY`, `HOOKS_POST_START`, `HOOKS_POST_ROLLBACK` | o que o executor antigo faz de AWS/gateway/egress/BrasilAPI/cnpj.ws e em que fase | H1/H7 |

Também a conferir na coleta (não bloqueiam a configuração, mas o executor recusa em `--check` se falharem): H2 (o
wrapper chama `deploy-induscost-homologacao`), H8 (nenhuma sessão permanente em `teste_bi_homolog` além da aplicação),
H9 (`DATABASE_URL` sem `options`/`application_name`, apontando para 5433), H10 (espaço).

## 4. Testes locais (Windows, Git Bash, PostgreSQL 17.11 real descartável)

| Suíte | Resultado | Novos |
|---|---|---|
| `src/lib/ops/deploySafety.test.ts` (sem banco) | 27/27 | S1 unidade protegida/fora do APP (52), S2 cron do glob sem o APP (52), S3 dois ambientes no mesmo host (`/opt/induscost` × `/opt/induscost-homolog`, 47 só para a linha do homolog), S4 rotinas por instalação (cmdline/cwd via `/proc`) |
| `src/lib/ops/deploySafety.pg17.integration.test.ts` (PostgreSQL 17 real) | 20/20 | R18 ensaio com 16 passos, R19 ensaio sem `--env-file` recusa / `--cleanup` só nomes do padrão, R20 `--env-file` com cluster errado (50) e certo |
| `src/lib/ops/deployExecutor.pg17.e2e.test.ts` (executor instalado, git + Prisma + PG17 reais) | 21/21 | E8 `--stop` (143, rollback), E9 `--abort-hard` + 46 + `--recover --rollback`, E10 hooks por fase, E11 cluster errado (50) antes de parar o serviço, E12 disco (51), E13 unidade protegida (52) e banco protegido (50), E14 janela recusada com rc real (41), E15 `git reset` impossível no rollback, E16 `DATABASE_URL` de outro banco (58), E17 `--restore-backup` (raiz, meta, restauração, `__failed_`), E18 globs malformados / `none`, I3 sha256 do executor antigo, reinstalação e `--uninstall` em cadeia |

Comandos: `npx tsx --test src/lib/ops/deploySafety.test.ts` e, com
`COMMISSION_PG17_BIN=<bin do PostgreSQL 17 com initdb/pg_ctl/psql/pg_dump/pg_restore/createdb>`, as outras duas.
O que só o servidor prova (ensaio §1 e roteiro de VALIDACAO-HOMOLOGACAO.md): `runuser` do usuário do cluster,
socket `/run/induscost-pg17`, `systemctl show` real, `/proc` real, `flock` real (nas suítes é simulado), permissões
de `/var/backups/induscost-homolog`.

## 5. Critério de aceite

Com os valores de §3 preenchidos, a instalação é reversível (`--apply` guarda o executor antigo com sha256 conferido;
`--uninstall` devolve byte a byte), os recursos alheios ficam fora do alcance por configuração **e** por verificação
em tempo de execução (cluster 50, bancos protegidos 50, escopo 52, rotinas por instalação), e nenhum caminho de
rollback apaga dados: restauração só com prova, sempre em banco novo com troca atômica, `__failed_` preservado, sem
`dropdb` fora do `--cleanup` do ensaio (restrito por nome e sem sessões).
