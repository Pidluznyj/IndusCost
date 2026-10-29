# O que coletar nos servidores antes de instalar o executor versionado

O executor versionado (`induscost-deploy-executor.sh`) não presume o comportamento dos executores atuais: tudo que
não foi visto está como `A_COLETAR` em `environments/<ambiente>.env`, e com isso o instalador e o executor recusam
rodar. Todos os comandos abaixo são **somente leitura**. Os que leem executores redigem segredos antes de imprimir:
copie-os dos blocos de código (não de tabelas) para que a alternância `|` do `sed`/`grep` chegue intacta. Cole a
saída completa na conversa; o arquivo de ambiente é preenchido a partir dela e os testes rodam de novo antes de
qualquer instalação.

## Homologação (servidor-01) — estado em 28/10/2026

Confirmado pelo operador e já preenchido em `environments/homologacao.env`: aplicação `/opt/induscost-homolog/app`,
serviço `induscost-homolog.service`, health `http://127.0.0.1:3001/api/health`, PostgreSQL 17 na porta 5433 com
socket `/run/induscost-pg17`, papel administrador `pg17homolog`, banco `teste_bi_homolog` (~3,3 GB), backups de
deploy em `/var/backups/induscost-homolog/deploys`, executor antigo `/usr/local/bin/deploy-induscost-homologacao`
(sha256 `114c438f…97411`), wrapper `/usr/local/bin/induscost-deploy-homologacao`, ~48 GB livres. Propriedades do
cluster 17: `track_counts=on`, `max_prepared_transactions=0`, sem subscriptions, sem `pg_cron`, collation
`en_US.UTF-8` (libc), sem configurações por banco. Recursos do mesmo host que a janela de manutenção **não pode
tocar** e que já estão protegidos por configuração: PostgreSQL 12 (5432, banco `teste_bi`), `induscost-db-backup.timer`
(22h30, só PG12), crons Nomus do root para `/opt/induscost`, bancos `teste_bi_homolog_prev` e
`teste_bi_cloud_standby`, drop-ins de systemd (egress, Direct Data/QUOD) e `/usr/local/bin/update-induscost-homolog-egress`.

**Atualização de 29/10/2026** (confirmado pelo operador e preenchido): H2 — o wrapper repassa `"$@"`; H3 — sem
agendamentos próprios da homologação (`CRON_GLOB='induscost-homolog*'`, `UNIT_GLOB='induscost-homolog-*'`, conferidos
pela G8 a cada deploy); H5 — `IDS_PG_OS_USER=pg17homolog`, `IDS_PG_BIN=/opt/postgresql-17/bin`; H6 — sem arquivo de
modo nem drop-in de pré-cutover (`none`); `START_SERVICE_POLICY=if-was-active`; H1/H7 — o executor antigo usa
`induscost-runtime-role get/check` (exige `CLOUD_PRIMARY`), produção Node local desligada, Nginx ativo, gateway
`http://192.168.100.5:3000/api/health`, AWS `http://100.85.97.124:3000/api/health` e o commit da AWS lido por SSH em
`/opt/induscost` → hook versionado `hooks/servidor01-checks.sh` ([docs/deploy/hooks-servidor01.md](../../docs/deploy/hooks-servidor01.md)).
Restam só as três chaves de **H12**. As seções abaixo ficam como registro de como cada valor foi obtido.

### H12 — valores exatos das verificações do executor antigo → `HOOK_AWS_SSH_TARGET`, `HOOK_LOCAL_PROD_SERVICE`, `HOOK_RUNTIME_ROLE_CHECK_ARGS`

```bash
sudo grep -nE 'ssh|induscost-runtime-role|systemctl|is-active' /usr/local/bin/deploy-induscost-homologacao
/usr/local/bin/induscost-runtime-role get
```

Da saída: o destino do `ssh` (e o comando remoto, que o hook só aceita como `git -C /opt/induscost rev-parse`), a
unidade da produção Node local que o executor antigo exige parada e os argumentos de `induscost-runtime-role check`
(`none` se ele só compara a saída de `get`). A segunda linha precisa imprimir exatamente `CLOUD_PRIMARY`.

Ainda `A_COLETAR` antes de 29/10 (cada item diz qual chave preenche). Nos comandos, `<usuário>` e `<bin>` são os valores de H5.

### H1 — executor antigo completo, com segredos redigidos → `HOOKS_PRE_DEPLOY`, `HOOKS_POST_START`, `HOOKS_POST_ROLLBACK`, `START_SERVICE_POLICY`

```bash
sudo sed -E 's/((PASSWORD|TOKEN|SECRET|KEY|DATABASE_URL|DIRECT_URL)[A-Z_]*=)[^[:space:]]+/\1<REDACTED>/g' /usr/local/bin/deploy-induscost-homologacao
```

Dele saem: o que é feito antes de parar o serviço (saúde da AWS e do gateway → `HOOKS_PRE_DEPLOY`), depois do
health (egress, BrasilAPI/cnpj.ws → `HOOKS_POST_START`), no rollback (`HOOKS_POST_ROLLBACK`) e se o serviço é
religado sempre ou só se estava ativo (`START_SERVICE_POLICY`).

### H2 — wrapper do operador (conferido pelo instalador)

```bash
sudo cat /usr/local/bin/induscost-deploy-homologacao
sudo sha256sum /usr/local/bin/induscost-deploy-homologacao /usr/local/bin/deploy-induscost-homologacao
ls -l /usr/local/bin/induscost-deploy-homologacao /usr/local/bin/deploy-induscost-homologacao
```

O instalador exige que o wrapper chame `deploy-induscost-homologacao` repassando os argumentos (`"$@"`) e sem
`pkill`/`killall`/`flock`; se for um link simbólico, precisa apontar para o executor. Se fizer mais (log, `tee`,
`sudo`), isso vira hook ou fica no wrapper — e, até a conferência, o roteiro de validação usa
`deploy-induscost-homologacao` diretamente.

### H3 — agendamentos próprios do homolog → `CRON_GLOB`, `UNIT_GLOB`

```bash
ls -l /etc/cron.d/
sudo sh -c 'grep -nH /opt/induscost-homolog /etc/crontab /etc/cron.d/* /var/spool/cron/crontabs/* 2>/dev/null'
sudo crontab -l
systemctl list-units --all --plain --no-legend '*induscost*'
systemctl list-timers --all
for u in $(systemctl list-units --all --plain --no-legend '*induscost*' | awk '{print $1}'); do echo "== $u"; systemctl show -p Unit -p ExecStart -p WorkingDirectory "$u"; done
systemctl show -p Unit induscost-db-backup.timer
```

O glob precisa casar **só** o que executa em `/opt/induscost-homolog`, **sem** o sufixo `.timer`/`.service`
(a biblioteca acrescenta) e num único padrão sem espaços; nunca `induscost-*`, que casaria
`induscost-db-backup.timer`. Sem agendamentos próprios, use globs que não casem nada (ex.: `induscost-homolog*`
/ `induscost-homolog-*`). A última linha diz qual unidade o timer do PG12 dispara (confirma `PROTECTED_UNITS`).

### H4 — linhas de cron do homolog fora de `/etc/cron.d/<CRON_GLOB>` (recusa 47 se houver)

Saída de H3: qualquer linha com `/opt/induscost-homolog` na crontab do root ou noutro arquivo precisa ir para um
arquivo casado por `CRON_GLOB` antes do primeiro deploy.

### H5 — usuário do SO e binários do cluster 17 → `IDS_PG_OS_USER`, `IDS_PG_BIN`

```bash
sudo ss -lxp | grep induscost-pg17
```

Com o pid do postmaster que aparece aí:

```bash
ps -o user=,args= -p <pid>
sudo readlink /proc/<pid>/exe
```

O diretório dos binários é o `dirname` do `exe`. Conferir a autenticação pelo socket **com ambiente limpo** (como o
executor fará, sem `HOME`/`PG*` do root), e a versão dos clientes:

```bash
sudo runuser -u <usuário> -- env -i <bin>/psql -h /run/induscost-pg17 -p 5433 -U pg17homolog -d postgres -Atc "select current_user, rolsuper from pg_roles where rolname = current_user" -c "show unix_socket_directories" -c "show data_directory"
<bin>/pg_dump --version
<bin>/pg_restore --version
<bin>/createdb --version
```

### H6 — modo do servidor e drop-ins → `MODE_FILE`, `EXPECTED_MODE`, `PRECUTOVER_DROPIN`, `PRECUTOVER_EXPECTED`

```bash
sudo ls -l /etc/induscost/ /etc/systemd/system/induscost-homolog.service.d/
sudo cat /etc/induscost/deploy-mode 2>/dev/null
```

Sem arquivo de modo: `MODE_FILE=none`, `EXPECTED_MODE=none`; sem drop-in de pré-cutover: `PRECUTOVER_DROPIN=none`,
`PRECUTOVER_EXPECTED=none`.

### H7 — egress e validações externas → hooks de H1

```bash
sudo cat /usr/local/bin/update-induscost-homolog-egress
sudo systemctl show induscost-homolog -p IPAddressDeny -p IPAddressAllow -p DropInPaths
grep -nE 'brasilapi|cnpj\.ws|aws|gateway|egress' /usr/local/bin/deploy-induscost-homologacao
```

Onde o executor antigo chama isso (antes de parar? depois do health?) define a fase do hook; o executor versionado
nunca altera drop-ins nem egress.

### H8 — sessões permanentes, slots e publicações no banco (recusa 41 se houver)

```bash
sudo runuser -u <usuário> -- env -i <bin>/psql -h /run/induscost-pg17 -p 5433 -U pg17homolog -d postgres -Atc "select pid, usename, application_name, client_addr, backend_type from pg_stat_activity where datname = 'teste_bi_homolog'" -c "select slot_name, slot_type, active from pg_replication_slots where database = 'teste_bi_homolog'"
sudo runuser -u <usuário> -- env -i <bin>/psql -h /run/induscost-pg17 -p 5433 -U pg17homolog -d teste_bi_homolog -Atc "select pubname from pg_publication"
```

A conexão da própria aplicação some quando o serviço para; qualquer outra (BI, pgAdmin), um slot de replicação
ou uma publicação lógica recusa a janela.

### H9 — `DATABASE_URL` da aplicação, sem credenciais (recusa 58 se apontar para outro banco/porta/versão)

```bash
sudo grep -E '^(export )?DATABASE_URL=' /opt/induscost-homolog/app/.env | sed -E 's#//([^:/]*):[^@]*@#//\1:<REDACTED>@#; s#(password|sslpassword)=[^&]*#\1=<REDACTED>#g'
```

Mostra usuário, host, porta, banco e parâmetros (senha redigida). Deve chegar a `teste_bi_homolog` na porta 5433 e
não pode ter `options` nem `application_name` (a exceção da trava é acrescentada pelo executor).

### H10 — espaço (conferido pelo executor, 51)

```bash
df -h /var/backups/induscost-homolog "$(sudo runuser -u <usuário> -- env -i <bin>/psql -h /run/induscost-pg17 -p 5433 -U pg17homolog -d postgres -Atc 'show data_directory')"
ls -ld /var/backups/induscost-homolog /var/backups/induscost-homolog/deploys
```

A restauração cria um banco do tamanho do atual ao lado dele. Os diretórios de backup existentes **não têm o modo
alterado** pelo executor: se `<usuário>` não os atravessar (`sudo runuser -u <usuário> -- test -x <dir>`), o
executor recusa (30) e diz o que conceder.

### H11 — dono do checkout e usuário do serviço

```bash
stat -c '%U:%G %a' /opt/induscost-homolog/app /opt/induscost-homolog/app/.git
sudo git -C /opt/induscost-homolog/app config --show-origin --get-all safe.directory
systemctl show induscost-homolog -p User -p Group
```

O executor roda `git`/`npm` como root no checkout; com dono diferente, o git recusa ("dubious ownership") e o
executor termina com `RECUSADO` (8/3) antes de qualquer alteração.

Depois de preenchido, o instalador (`--dry-run`) mostra o que falta e o executor confere, em `--check`, cluster
(versão 17, porta 5433, socket, superusuário, clientes 17, usuário do SO), disco, escopo dos globs, hooks e a
`DATABASE_URL` da aplicação — sem alterar nada além das referências remotas do git.

## Produção (AWS, `induscost-prod-saopaulo`)

Do executor atual foram vistas só as linhas 1–25 e 350–690 (grep de 26/10/2026). Faltam (copiar dos blocos):

### P1 — executor completo, com segredos redigidos → `HOOKS_*`, `START_SERVICE_POLICY`

Linhas 25–349: resolução do alvo, `--check`, uso de `MODE_FILE`/drop-in de pré-cutover e onde `DB_OWNER` é
definido. Linhas 484–512: rollback do código. Linhas 557–593: fetch/`npm ci`/seleção de testes. Linhas 620–666:
migrations com falha, política de subida do serviço e laço do health.

```bash
sudo sed -E 's/((PASSWORD|TOKEN|SECRET|KEY|DATABASE_URL|DIRECT_URL)[A-Z_]*=)[^[:space:]]+/\1<REDACTED>/g' /usr/local/bin/deploy-induscost-producao
```

### P2 — modo do servidor → `EXPECTED_MODE`, `PRECUTOVER_EXPECTED`

```bash
sudo cat /etc/induscost/deploy-mode
sudo ls -l /etc/systemd/system/induscost.service.d/
sudo cat /etc/systemd/system/induscost.service.d/10-precutover-isolation.conf
```

### P3 — agendamentos do IndusCost → `PROTECTED_UNITS` (e confirmação dos globs)

A janela pausa só `/etc/cron.d/induscost*` e `induscost-*`; cada um precisa executar em `/opt/induscost` (senão
recusa 52). Uma linha fora disso recusa o deploy (47).

```bash
ls -l /etc/cron.d/
sudo sh -c 'grep -n induscost /etc/crontab /var/spool/cron/crontabs/* 2>/dev/null'
systemctl list-units --all --plain --no-legend 'induscost*'
systemctl list-timers --all 'induscost*'
for u in $(systemctl list-units --all --plain --no-legend 'induscost*' | awk '{print $1}'); do systemctl show -p Unit -p ExecStart -p WorkingDirectory "$u"; done
```

### P4 — implementação do cron (o ensaio considera o `cron` do Debian/Ubuntu)

```bash
systemctl status cron --no-pager | head -5
```

### P5 — sessões permanentes no banco (recusa 41)

```bash
sudo -u postgres psql -Atc "select usename, application_name, client_addr, backend_type from pg_stat_activity where datname = 'teste_bi'" -c "select slot_name, active from pg_replication_slots where database = 'teste_bi'"
```

### P6 — propriedades do banco e do cluster → `PROTECTED_DATABASES`

Collation libc, trava ainda não usada, estatísticas ligadas, sem 2PC/assinaturas/pg_cron, outros bancos. Um `-c`
por instrução (psql anterior ao 15 só imprime o último resultado de um `-c`):

```bash
sudo -u postgres psql -Atc "select datname, datlocprovider, datcollate, datconnlimit from pg_database"
sudo -u postgres psql -Atc "select d.datname, s.setconfig from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase"
sudo -u postgres psql -Atc "show track_counts" -c "show max_prepared_transactions" -c "select count(*) from pg_subscription" -c "select count(*) from pg_extension where extname = 'pg_cron'"
```

### P7 — parâmetros da `DATABASE_URL`, sem credenciais (recusa se já tiver `options`/`application_name`)

```bash
sudo grep -E '^(export )?DATABASE_URL=' /opt/induscost/.env | sed -E 's#//([^:/]*):[^@]*@#//\1:<REDACTED>@#; s#(password|sslpassword)=[^&]*#\1=<REDACTED>#g'
```

### P8 — espaço para backup e restauração

```bash
df -h /var/backups /var/lib/postgresql
sudo -u postgres psql -Atc "select pg_size_pretty(pg_database_size('teste_bi'))"
```

### P9 — integridade do executor atual → `EXECUTOR_EXPECTED_SHA256`

```bash
sudo sha256sum /usr/local/bin/deploy-induscost-producao*
```

### P10 — cluster explícito → `IDS_PG_HOST`, `IDS_PG_PORT`, `IDS_PG_ADMIN_ROLE`, `IDS_PG_EXPECT_MAJOR`, `IDS_PG_OS_USER`, `IDS_PG_BIN`

```bash
sudo -u postgres psql -Atc "show unix_socket_directories" -c "show port" -c "show server_version" -c "show data_directory"
sudo readlink /proc/$(pgrep -o -x postgres)/exe
pg_dump --version
```

### P11 — dono do checkout e usuário do serviço

```bash
stat -c '%U:%G %a' /opt/induscost /opt/induscost/.git
sudo git -C /opt/induscost config --show-origin --get-all safe.directory
systemctl show induscost -p User -p Group
```

## Depois da coleta

1. Os valores coletados entram em `environments/<ambiente>.env`. Nenhum `A_COLETAR` pode sobrar (`none` é o valor
   explícito de "nenhum" em hooks, `LEGACY_WRAPPER_PATH`, `PROTECTED_*`, `MODE_FILE`/`PRECUTOVER_*`).
2. As particularidades do executor atual que não estiverem no executor versionado (saúde da AWS e do gateway,
   egress, BrasilAPI/cnpj.ws, passos extras de build) entram como **hooks** (`HOOKS_PRE_DEPLOY`, `HOOKS_POST_START`,
   `HOOKS_POST_ROLLBACK`): executáveis do root, com caminho absoluto, não graváveis por outros, com prazo
   (`HOOK_TIMEOUT`). O executor versionado não altera drop-ins, firewall nem egress.
3. As suítes rodam de novo (`deploySafety.test.ts`, `deploySafety.pg17.integration.test.ts`,
   `deployExecutor.pg17.e2e.test.ts`). Elas validam o código, não o arquivo de ambiente: o arquivo é validado pelo
   instalador (`--dry-run`) e pelo `--check` no servidor.
4. A validação em homologação segue [VALIDACAO-HOMOLOGACAO.md](VALIDACAO-HOMOLOGACAO.md).
