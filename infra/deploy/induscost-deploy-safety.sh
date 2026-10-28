#!/usr/bin/env bash
# Biblioteca de segurança dos executores de deploy do IndusCost (produção AWS e homologação) — v4 (G1–G8).
#
# Uso: infra/deploy/induscost-deploy-executor.sh (instalado por infra/deploy/install-induscost-deploy.sh) faz
# `source` desta biblioteca. Ver infra/deploy/APLICAR.md.
#
# Incidente de 26/10/2026: um teste falhou antes das migrations, o rollback apagou o banco e não conseguiu
# restaurar (o postgres não lia o backup). Garantias desta versão:
#   G1. Janela de manutenção SELETIVA e persistente: só os agendamentos desta instalação (arquivos
#       $IDS_CRON_DIR/$IDS_CRON_GLOB, timers $IDS_UNIT_GLOB.timer que estavam ativos, serviços do glob em execução,
#       rotinas Nomus/Exposure já iniciadas). O estado anterior de cada um é gravado em $IDS_STATE_DIR e restaurado exatamente; timers
#       inativos ou com falha não são tocados. Interrupção do executor: o estado persiste e o próximo deploy
#       recusa (46) até `ids_maintenance_recover --resume`.
#   G2. Trava de escrita: durante a janela o banco fica com default_transaction_read_only=on — toda sessão nova
#       (aplicação, cron, BI, superusuário) só lê; só as migrations recebem a exceção explícita na URL. Antes
#       disso o banco precisa estar sem sessões, sem transações preparadas, sem assinaturas lógicas e com
#       estatísticas ligadas.
#   G3. Prova de ausência de escrita, independente do XID global: contadores de tuplas do banco
#       (pg_stat_database), valores das sequências (nextval não consome XID) e arquivos das tabelas (TRUNCATE não
#       conta tupla), conferidos entre o backup e as migrations, durante as migrations (observador de sessões) e
#       entre a liberação para a aplicação e o rollback.
#   G4. Rollback por compatibilidade: schema novo compatível com o código anterior → banco mantido (só o código
#       volta); incompatível e sem escrita legítima comprovada → restauração integral; incompatível sem prova →
#       BLOQUEIO (nada destrutivo, serviço e janela mantidos, instruções de recuperação).
#   G5. Restauração fiel: banco congelado (sem conexões) e prova reconferida antes de restaurar; banco novo com
#       encoding/collation/dono/limite/ACL/configurações; pg_restore completo; conferência integral (tabelas e
#       linhas, colunas, índices, constraints, sequências, triggers, views, funções, enums, extensões, donos, ACL,
#       migrations); troca atômica (dois RENAME numa transação); <db>__failed_<ts> preservado; nenhum dropdb.
#   G6. Gate de testes isolado: sem .env, banco inalcançável, chaves do .env vazias, locks temporários.
#
#   G7. Cluster explícito e conferido: todo psql/pg_dump/pg_restore/createdb recebe host (socket), porta, papel
#       administrador e diretório de binários configurados (IDS_PG_HOST/PORT/ADMIN_ROLE/BIN); antes de qualquer ação
#       ids_assert_cluster confere versão maior, porta, socket, superusuário e versão dos clientes. Num host com dois
#       clusters (servidor-01: PostgreSQL 12 em 5432 e 17 em 5433) os padrões do libpq levariam ao cluster errado.
#   G8. Isolamento verificável: cada arquivo de cron casado por IDS_CRON_GLOB precisa referenciar o IDS_APP_MARK_PATTERN
#       e cada timer casado por IDS_UNIT_GLOB precisa executar dentro dele (systemctl show); unidades de
#       IDS_PROTECTED_UNITS jamais podem ser casadas; rotinas em execução só contam se forem desta instalação
#       (linha de comando ou cwd dentro do IDS_APP_MARK_PATTERN); bancos de IDS_PROTECTED_DATABASES nunca são tocados.
#
# Variáveis (padrão): IDS_PG (`runuser -u postgres --`), IDS_PG_USER (postgres), IDS_PG_BIN (vazio = PATH),
# IDS_PG_HOST (vazio = libpq/PGHOST; diretório = socket), IDS_PG_PORT (vazio = libpq/PGPORT), IDS_PG_ADMIN_ROLE (vazio =
# libpq/PGUSER), IDS_PG_EXPECT_MAJOR (vazio = não confere), IDS_PG_MAINT_DB (postgres), IDS_PROTECTED_DATABASES (vazio),
# IDS_PROTECTED_UNITS (vazio), IDS_PROC_DIR (/proc), IDS_SYSTEMCTL (systemctl),
# IDS_STATE_DIR (/var/lib/induscost/deploy-safety), IDS_APP_SERVICE (induscost.service), IDS_UNIT_GLOB (induscost-*),
# IDS_CRON_DIR (/etc/cron.d), IDS_CRON_GLOB (induscost*), IDS_CRON_SCAN_FILES (/etc/crontab),
# IDS_CRON_SPOOL_DIRS (/var/spool/cron/crontabs /var/spool/cron), IDS_APP_MARK_PATTERN (/opt/induscost),
# IDS_CRON_RELOAD_WAIT (1), IDS_WRITER_PROCESS_PATTERN, IDS_WRITER_WAIT_SECONDS (1800), IDS_WRITER_POLL_SECONDS (5),
# IDS_STATS_SETTLE_SECONDS (2), IDS_WATCH_INTERVAL (0.05), IDS_MAINT_FLAG (/run/induscost/deploy-maintenance),
# IDS_DISK_BACKUP_FACTOR (1), IDS_DISK_DATA_FACTOR (2): espaço livre mínimo em múltiplos do tamanho do banco.

IDS_VERSION="4"
IDS_PG="${IDS_PG-runuser -u postgres --}"
IDS_PG_USER="${IDS_PG_USER-postgres}"
IDS_PG_BIN="${IDS_PG_BIN:-}"
IDS_PG_HOST="${IDS_PG_HOST:-}"
IDS_PG_PORT="${IDS_PG_PORT:-}"
IDS_PG_ADMIN_ROLE="${IDS_PG_ADMIN_ROLE:-}"
IDS_PG_EXPECT_MAJOR="${IDS_PG_EXPECT_MAJOR:-}"
IDS_PG_MAINT_DB="${IDS_PG_MAINT_DB:-postgres}"
IDS_PROTECTED_DATABASES="${IDS_PROTECTED_DATABASES:-}"
IDS_PROTECTED_UNITS="${IDS_PROTECTED_UNITS:-}"
IDS_PROC_DIR="${IDS_PROC_DIR:-/proc}"
IDS_DISK_BACKUP_FACTOR="${IDS_DISK_BACKUP_FACTOR:-1}"
IDS_DISK_DATA_FACTOR="${IDS_DISK_DATA_FACTOR:-2}"
IDS_SYSTEMCTL="${IDS_SYSTEMCTL:-systemctl}"
IDS_STATE_DIR="${IDS_STATE_DIR:-/var/lib/induscost/deploy-safety}"
IDS_APP_SERVICE="${IDS_APP_SERVICE:-induscost.service}"
IDS_UNIT_GLOB="${IDS_UNIT_GLOB:-induscost-*}"
IDS_CRON_DIR="${IDS_CRON_DIR:-/etc/cron.d}"
IDS_CRON_GLOB="${IDS_CRON_GLOB:-induscost*}"
IDS_CRON_SCAN_FILES="${IDS_CRON_SCAN_FILES-/etc/crontab}"
IDS_CRON_SPOOL_DIRS="${IDS_CRON_SPOOL_DIRS-/var/spool/cron/crontabs /var/spool/cron}"
IDS_APP_MARK_PATTERN="${IDS_APP_MARK_PATTERN:-/opt/induscost}"
IDS_CRON_RELOAD_WAIT="${IDS_CRON_RELOAD_WAIT:-1}"
IDS_WRITER_PROCESS_PATTERN="${IDS_WRITER_PROCESS_PATTERN:-runNomus[A-Za-z]*Sync|scripts/nomus[A-Za-z0-9]*\.ts|legal-exposure|legalExposure}"
IDS_WRITER_WAIT_SECONDS="${IDS_WRITER_WAIT_SECONDS:-1800}"
IDS_WRITER_POLL_SECONDS="${IDS_WRITER_POLL_SECONDS:-5}"
IDS_STATS_SETTLE_SECONDS="${IDS_STATS_SETTLE_SECONDS:-2}"
IDS_WATCH_INTERVAL="${IDS_WATCH_INTERVAL:-0.05}"
IDS_MAINT_FLAG="${IDS_MAINT_FLAG:-/run/induscost/deploy-maintenance}"
IDS_APPNAME="ids-deploy"
IDS_MIGRATE_APPNAME="ids-deploy-migrate"
IDS_MARKER_NAME="db-changes-started"
IDS_APP_MARKER_NAME="app-started"
# Parâmetro que a trava de escrita usa; nunca entra nos metadados nem na cópia de configurações.
IDS_LOCK_GUC="default_transaction_read_only"

ids_log() {
  echo "[deploy-safety] $*"
}

# ---------------------------------------------------------------------------------------------------------
# G7 — cluster explícito
# ---------------------------------------------------------------------------------------------------------

# Caminho de um cliente PostgreSQL: do diretório configurado ou do PATH.
ids_pg_bin() {
  if [[ -n "$IDS_PG_BIN" ]]; then printf '%s\n' "$IDS_PG_BIN/$1"; else printf '%s\n' "$1"; fi
}

# Conninfo com host/porta/papel configurados (só os preenchidos; os demais seguem o libpq), identificado.
ids_conninfo() {
  local db="$1" app="${2:-$IDS_APPNAME}" s
  s="dbname='$db' application_name=$app"
  [[ -n "$IDS_PG_HOST" ]] && s="$s host='$IDS_PG_HOST'"
  [[ -n "$IDS_PG_PORT" ]] && s="$s port=$IDS_PG_PORT"
  [[ -n "$IDS_PG_ADMIN_ROLE" ]] && s="$s user='$IDS_PG_ADMIN_ROLE'"
  printf '%s\n' "$s"
}

# Opções -h/-p/-U equivalentes, para createdb/dropdb (que não aceitam conninfo no banco alvo).
ids_pg_connopts() {
  [[ -n "$IDS_PG_HOST" ]] && printf '%s\n' "-h" "$IDS_PG_HOST"
  [[ -n "$IDS_PG_PORT" ]] && printf '%s\n' "-p" "$IDS_PG_PORT"
  [[ -n "$IDS_PG_ADMIN_ROLE" ]] && printf '%s\n' "-U" "$IDS_PG_ADMIN_ROLE"
  return 0
}

# Uma instrução por chamada; saída no formato `psql -At` (colunas separadas por |, sem CR). Sessões identificadas.
ids_psql() {
  local db="$1" sql="$2" out
  out="$($IDS_PG "$(ids_pg_bin psql)" -X -d "$(ids_conninfo "$db")" -v ON_ERROR_STOP=1 -Atc "$sql")" || return $?
  if [[ -n "$out" ]]; then printf '%s\n' "${out//$'\r'/}"; fi
}

# Várias instruções numa única transação (tudo ou nada).
ids_psql_tx() {
  local db="$1" sql="$2"
  $IDS_PG "$(ids_pg_bin psql)" -X -d "$(ids_conninfo "$db")" -v ON_ERROR_STOP=1 -Atc "BEGIN; $sql COMMIT;"
}

# Versão maior de um cliente (pg_dump/pg_restore/psql); vazio se não executa.
ids_client_major() {
  local v
  v="$($IDS_PG "$(ids_pg_bin "$1")" --version 2>/dev/null)" || return 1
  printf '%s\n' "$v" | sed -nE 's/.*\(PostgreSQL\) ([0-9]+)[.0-9]*.*/\1/p' | head -n 1
}

# Confere que a conexão administrativa chega ao cluster esperado e que os clientes são da mesma versão maior.
# ≠ 0 (50) = cluster diferente do configurado: nada mais pode ser feito.
ids_assert_cluster() {
  local info vernum port sockdirs super user major client c
  info="$(ids_psql "$IDS_PG_MAINT_DB" "SELECT format('%s|%s|%s|%s|%s', current_setting('server_version_num'), current_setting('port'), current_setting('unix_socket_directories'), (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), current_user)" 2>&1)" || {
    ids_log "ERRO: sem conexão administrativa com o cluster (host='${IDS_PG_HOST:-<libpq>}' porta='${IDS_PG_PORT:-<libpq>}' papel='${IDS_PG_ADMIN_ROLE:-<libpq>}' banco=$IDS_PG_MAINT_DB): $info"
    return 50
  }
  IFS='|' read -r vernum port sockdirs super user <<< "$info"
  major=$(( ${vernum:-0} / 10000 ))
  if [[ -n "$IDS_PG_EXPECT_MAJOR" && "$major" != "$IDS_PG_EXPECT_MAJOR" ]]; then
    ids_log "ERRO: cluster conectado é PostgreSQL $major; esperado $IDS_PG_EXPECT_MAJOR"
    return 50
  fi
  if [[ -n "$IDS_PG_PORT" && "$port" != "$IDS_PG_PORT" ]]; then
    ids_log "ERRO: cluster conectado escuta na porta $port; esperado $IDS_PG_PORT"
    return 50
  fi
  if [[ "$IDS_PG_HOST" == /* && ",${sockdirs// /}," != *",$IDS_PG_HOST,"* ]]; then
    ids_log "ERRO: cluster conectado usa socket '$sockdirs'; esperado $IDS_PG_HOST"
    return 50
  fi
  if [[ "$super" != "t" && "$super" != "true" ]]; then
    ids_log "ERRO: papel $user não é superusuário no cluster (trava, congelamento e restauração exigem)"
    return 50
  fi
  for c in psql pg_dump pg_restore createdb; do
    client="$(ids_client_major "$c")"
    if [[ -z "$client" ]]; then
      ids_log "ERRO: cliente $(ids_pg_bin "$c") não executa (IDS_PG_BIN='$IDS_PG_BIN')"
      return 50
    fi
    if [[ "$client" != "$major" ]]; then
      ids_log "ERRO: $(ids_pg_bin "$c") é da versão $client; o cluster é $major (dump/restore exigem a mesma versão maior)"
      return 50
    fi
  done
  # O usuário do SO que executa os clientes (IDS_PG) é o dono dos backups (IDS_PG_USER): o dump precisa ser
  # legível por quem fará o restore (causa do incidente de 26/10/2026).
  if [[ -n "$IDS_PG_USER" ]]; then
    local osuser
    osuser="$($IDS_PG id -un 2>/dev/null)" || osuser=""
    if [[ "$osuser" != "$IDS_PG_USER" ]]; then
      ids_log "ERRO: os clientes executam como '${osuser:-?}' (IDS_PG='$IDS_PG'), mas IDS_PG_USER='$IDS_PG_USER' seria o dono dos backups"
      return 50
    fi
  fi
  ids_log "cluster conferido: PostgreSQL $major, porta $port, socket '$sockdirs', papel $user (superusuário), clientes $major"
}

# Identidade do cluster e do banco gravada junto do backup; --restore-backup só aceita um backup deste banco/cluster.
ids_backup_identity() {
  local db="$1" id
  id="$(ids_psql "$db" "SELECT format('db=%s|sysid=%s|version=%s', current_database(), (SELECT system_identifier FROM pg_control_system()), current_setting('server_version_num'))")" || return 30
  printf 'env=%s|%s\n' "${IDS_ENV_NAME:-}" "$id"
}

# ≠ 0 (33) = o backup não é deste banco/cluster (ou não tem identidade): nada é restaurado.
ids_assert_backup_matches() {
  local dir="$1" db="$2" recorded current
  [[ -f "$dir/backup-meta.txt" ]] || { ids_log "ERRO: $dir sem backup-meta.txt (backup de outra versão ou incompleto)"; return 33; }
  recorded="$(cut -d'|' -f2,3 "$dir/backup-meta.txt")"
  current="$(ids_backup_identity "$db" | cut -d'|' -f2,3)" || return 33
  if [[ "$recorded" != "$current" ]]; then
    ids_log "ERRO: backup de outro banco/cluster ($recorded ≠ $current); restauração recusada"
    return 33
  fi
}

# Banco protegido (de outro ambiente ou cluster): a biblioteca recusa operar nele. ≠ 0 (50).
ids_assert_not_protected_db() {
  local db="$1" p
  for p in $IDS_PROTECTED_DATABASES; do
    if [[ "$db" == "$p" ]]; then
      ids_log "ERRO: $db está em IDS_PROTECTED_DATABASES; nenhuma operação permitida"
      return 50
    fi
  done
}

# Espaço livre (KiB) do sistema de arquivos de um caminho (ou do ancestral existente mais próximo), visto por este
# processo. Não cria nada.
ids_free_kib() {
  local p="$1"
  while [[ ! -d "$p" && "$p" != "/" && "$p" != "." ]]; do p="$(dirname "$p")"; done
  df -Pk "$p" 2>/dev/null | awk 'NR == 2 { print $4 }'
}

# Espaço para o backup (BACKUP_ROOT) e para a restauração (data_directory: o banco restaurado nasce ao lado do atual
# antes da troca). ≠ 0 (51) = insuficiente; nada foi feito.
ids_assert_disk_space() {
  local db="$1" backup_root="$2" size_kib data_dir free_backup free_data need_backup need_data
  size_kib="$(ids_psql "$IDS_PG_MAINT_DB" "SELECT ceil(pg_database_size('$db') / 1024.0)::bigint")" || return 51
  data_dir="$(ids_psql "$IDS_PG_MAINT_DB" "SELECT current_setting('data_directory')")" || return 51
  free_backup="$(ids_free_kib "$backup_root")"
  free_data="$(ids_free_kib "$data_dir")"
  need_backup=$(( size_kib * IDS_DISK_BACKUP_FACTOR ))
  need_data=$(( size_kib * IDS_DISK_DATA_FACTOR ))
  if [[ -z "$free_backup" || -z "$free_data" ]]; then
    ids_log "ERRO: não foi possível medir o espaço livre em $backup_root ou $data_dir"
    return 51
  fi
  if (( free_backup < need_backup )); then
    ids_log "ERRO: $backup_root tem $(( free_backup / 1024 )) MiB livres; o backup de $db (${size_kib} KiB) exige $(( need_backup / 1024 )) MiB"
    return 51
  fi
  if (( free_data < need_data )); then
    ids_log "ERRO: $data_dir tem $(( free_data / 1024 )) MiB livres; a restauração de $db exige $(( need_data / 1024 )) MiB (banco restaurado ao lado do atual)"
    return 51
  fi
  ids_log "espaço: banco $db $(( size_kib / 1024 )) MiB; livres $(( free_backup / 1024 )) MiB em $backup_root e $(( free_data / 1024 )) MiB em $data_dir"
}

# Informativo (cluster inteiro; ver G3 para a prova real).
ids_next_xid() {
  ids_psql "$IDS_PG_MAINT_DB" "SELECT pg_snapshot_xmax(pg_current_snapshot())::text"
}

# Sessões no banco (qualquer tipo, exceto autovacuum e a própria consulta). pid|usuário|aplicação|origem|tipo.
ids_foreign_sessions() {
  ids_psql "$IDS_PG_MAINT_DB" "SELECT format('%s|%s|%s|%s|%s', pid, coalesce(usename,''), coalesce(application_name,''), coalesce(client_addr::text,'local'), backend_type) FROM pg_stat_activity WHERE datname = '$1' AND pid <> pg_backend_pid() AND backend_type NOT IN ('autovacuum worker') ORDER BY pid"
}

# Contadores de escrita do banco: tuplas inseridas+alteradas+apagadas nas tabelas de usuário (o autovacuum/
# autoanalyze escreve em catálogos e não entra aqui; estrutura é conferida pela impressão digital)|reset das
# estatísticas. Lido dentro do banco.
ids_db_counters() {
  ids_psql "$1" "SELECT format('%s|%s', (SELECT coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) FROM pg_stat_all_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') AND schemaname NOT LIKE 'pg_toast%'), (SELECT coalesce(stats_reset::text, 'never') FROM pg_stat_database WHERE datname = current_database()))"
}

# Sessões já abertas no banco (contador cumulativo, só clientes)|reset. Lido de fora (funciona com o banco
# congelado): igual antes e depois = ninguém conectou no intervalo.
ids_db_sessions() {
  ids_psql "$IDS_PG_MAINT_DB" "SELECT format('%s|%s', sessions, coalesce(stats_reset::text, 'never')) FROM pg_stat_database WHERE datname = '$1'"
}

ids_settle() {
  sleep "$IDS_STATS_SETTLE_SECONDS"
}

# ---------------------------------------------------------------------------------------------------------
# G1 — janela de manutenção seletiva e persistente
# ---------------------------------------------------------------------------------------------------------

ids_state_file() {
  printf '%s\n' "$IDS_STATE_DIR/maintenance.state"
}

ids_state_add() {
  printf '%s\n' "$*" >> "$(ids_state_file)"
}

# IDS_APP_MARK_PATTERN é o caminho da instalação; só casa seguido de "/", espaço, aspas ou fim de linha, para que
# /opt/induscost não case /opt/induscost-homolog (dois ambientes no mesmo host).
ids_mark_regex() {
  local escaped
  escaped="$(printf '%s' "$IDS_APP_MARK_PATTERN" | sed -E 's/[]\\.*^$+?(){}|[]/\\&/g')"
  printf '%s\n' "(^|[^A-Za-z0-9_.-])${escaped}(/|[[:space:]]|\"|'|\$)"
}

# cwd de um processo (vazio se não legível).
ids_proc_cwd() {
  readlink -f "$IDS_PROC_DIR/$1/cwd" 2>/dev/null || true
}

# O processo pertence a ESTA instalação? Linha de comando ou cwd dentro de IDS_APP_MARK_PATTERN. Sem cwd legível e
# sem o caminho na linha de comando, conta como nosso (conservador: o deploy espera).
ids_process_is_ours() {
  local pid="$1" cmd="$2" cwd
  [[ "$cmd" =~ $(ids_mark_regex) ]] && return 0
  cwd="$(ids_proc_cwd "$pid")"
  [[ -z "$cwd" ]] && return 0
  local real
  real="$(readlink -f "$IDS_APP_MARK_PATTERN" 2>/dev/null || printf '%s' "$IDS_APP_MARK_PATTERN")"
  [[ "$cwd" == "$IDS_APP_MARK_PATTERN" || "$cwd" == "$IDS_APP_MARK_PATTERN"/* || "$cwd" == "$real" || "$cwd" == "$real"/* ]]
}

# Propriedades de uma unidade que dizem onde ela executa.
ids_unit_props() {
  $IDS_SYSTEMCTL show -p Unit -p ExecStart -p ExecStartPre -p WorkingDirectory -p EnvironmentFiles -p Environment -- "$1" 2>/dev/null || true
}

# A unidade (timer ou serviço) executa dentro de IDS_APP_MARK_PATTERN? Timer: segue a unidade disparada (Unit=).
ids_unit_is_ours() {
  local unit="$1" props target
  [[ "$unit" == "$IDS_APP_SERVICE" ]] && return 0
  props="$(ids_unit_props "$unit")"
  if [[ "$unit" == *.timer ]]; then
    target="$(printf '%s\n' "$props" | sed -n 's/^Unit=//p' | head -n 1)"
    [[ -n "$target" ]] || target="${unit%.timer}.service"
    props="$props"$'\n'"$(ids_unit_props "$target")"
  fi
  [[ "$props" =~ $(ids_mark_regex) ]]
}

ids_is_protected_unit() {
  local u="$1" p
  for p in $IDS_PROTECTED_UNITS; do [[ "$u" == "$p" ]] && return 0; done
  return 1
}

# G8: os globs só podem casar o que é desta instalação (cada arquivo de cron executa o IDS_APP_MARK_PATTERN; cada
# timer/serviço roda dentro dele; nenhuma unidade protegida). ≠ 0 (52) = escopo amplo demais; nada foi tocado.
ids_assert_isolation_scope() {
  local f unit state rc=0
  for f in "$IDS_CRON_DIR"/$IDS_CRON_GLOB; do
    [[ -f "$f" ]] || continue
    if ! grep -vE '^[[:space:]]*#' "$f" | grep -qE -e "$(ids_mark_regex)"; then
      ids_log "ERRO: IDS_CRON_GLOB='$IDS_CRON_GLOB' casa $f, que não executa $IDS_APP_MARK_PATTERN (escopo amplo demais)"
      rc=52
    else
      ids_log "janela pausaria o cron $f (desta instalação)"
    fi
  done
  while read -r unit _; do
    [[ -n "$unit" ]] || continue
    state="$($IDS_SYSTEMCTL is-active "$unit" 2>/dev/null || true)"
    if ids_is_protected_unit "$unit"; then
      ids_log "ERRO: IDS_UNIT_GLOB='$IDS_UNIT_GLOB' casa a unidade protegida $unit"
      rc=52
    elif ! ids_unit_is_ours "$unit"; then
      ids_log "ERRO: IDS_UNIT_GLOB='$IDS_UNIT_GLOB' casa $unit, que não executa em $IDS_APP_MARK_PATTERN (escopo amplo demais)"
      rc=52
    elif [[ "$unit" == *.timer ]]; then
      ids_log "janela $([[ "$state" == active ]] && echo pausaria || echo "não tocaria") o timer $unit (${state:-?}; desta instalação)"
    fi
  done < <({ $IDS_SYSTEMCTL list-units --type=timer --all --no-legend --plain "${IDS_UNIT_GLOB}.timer"; $IDS_SYSTEMCTL list-units --type=service --all --no-legend --plain "${IDS_UNIT_GLOB}.service"; } 2>/dev/null)
  if [[ "$rc" == 0 ]]; then ids_log "escopo da janela conferido: cron $IDS_CRON_DIR/$IDS_CRON_GLOB e unidades $IDS_UNIT_GLOB só desta instalação ($IDS_APP_MARK_PATTERN)"; fi
  return "$rc"
}

# Filhos diretos de um pid (procps; ou o ps do MSYS, que lista PID PPID ...).
ids_children() {
  ps -o pid= --ppid "$1" 2>/dev/null || ps 2>/dev/null | awk -v p="$1" 'NR > 1 && $2 == p { print $1 }'
}

ids_descendants() {
  local c
  for c in $(ids_children "$1"); do
    ids_descendants "$c"
    echo "$c"
  done
}

# Envia um sinal à árvore de um pid (descendentes primeiro, depois o próprio) — sem pkill -f, só os pids da árvore.
ids_kill_tree() {
  local pid="$1" sig="${2:-TERM}" p
  for p in $(ids_descendants "$pid") "$pid"; do
    kill -s "$sig" "$p" 2>/dev/null || true
  done
}

# Linhas de cron fora de /etc/cron.d/induscost* que executam o IndusCost: não dá para pausá-las sem editar
# crontabs de terceiros, então o deploy recusa (47) até que sejam movidas para um arquivo induscost*.
ids_unmanaged_cron_lines() {
  local f d
  for f in $IDS_CRON_SCAN_FILES; do
    [[ -f "$f" ]] && grep -HnE -e "$(ids_mark_regex)" "$f" 2>/dev/null | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' || true
  done
  for d in $IDS_CRON_SPOOL_DIRS; do
    [[ -d "$d" ]] || continue
    for f in "$d"/*; do
      [[ -f "$f" ]] && grep -HnE -e "$(ids_mark_regex)" "$f" 2>/dev/null | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' || true
    done
  done
  for f in "$IDS_CRON_DIR"/*; do
    [[ -f "$f" ]] || continue
    # shellcheck disable=SC2053
    [[ "$(basename "$f")" == $IDS_CRON_GLOB ]] && continue
    grep -HnE -e "$(ids_mark_regex)" "$f" 2>/dev/null | grep -vE '^[^:]+:[0-9]+:[[:space:]]*#' || true
  done
}

# Rotinas do IndusCost em execução: processos do padrão QUE SÃO DESTA INSTALAÇÃO (G8) e serviços do glob (exceto a
# aplicação) ativos.
ids_running_writers() {
  local unit state pid cmd
  while read -r pid cmd; do
    [[ -n "$pid" ]] || continue
    ids_process_is_ours "$pid" "$cmd" && echo "$pid $cmd"
  done < <(${IDS_PGREP:-pgrep} -af -- "$IDS_WRITER_PROCESS_PATTERN" 2>/dev/null | grep -v -- "pgrep" || true)
  while read -r unit _; do
    [[ -n "$unit" && "$unit" != "$IDS_APP_SERVICE" ]] || continue
    state="$($IDS_SYSTEMCTL is-active "$unit" 2>/dev/null || true)"
    case "$state" in
      active|activating|reloading|deactivating) echo "unit $unit $state" ;;
    esac
  done < <($IDS_SYSTEMCTL list-units --type=service --all --no-legend --plain "${IDS_UNIT_GLOB}.service" 2>/dev/null)
}

# Pré-condições da prova: nada conectado, nada preparado, nada replicando, estatísticas ligadas.
ids_assert_quiescent() {
  local db="$1" sessions other
  sessions="$(ids_foreign_sessions "$db")" || return 41
  if [[ -n "$sessions" ]]; then
    ids_log "ERRO: há sessões no banco $db (pid|usuário|aplicação|origem|tipo):"
    printf '%s\n' "$sessions" | sed 's/^/[deploy-safety]   /'
    return 41
  fi
  other="$(ids_psql "$IDS_PG_MAINT_DB" "SELECT concat_ws(',', CASE WHEN current_setting('track_counts') <> 'on' THEN 'track_counts=off' END, (SELECT 'prepared_xacts=' || count(*) FROM pg_prepared_xacts WHERE database = '$db' HAVING count(*) > 0), (SELECT 'subscriptions=' || string_agg(subname, ' ') FROM pg_subscription s JOIN pg_database d ON d.oid = s.subdbid WHERE d.datname = '$db' AND s.subenabled HAVING count(*) > 0), (SELECT 'replication_slots=' || string_agg(slot_name, ' ') FROM pg_replication_slots WHERE database = '$db' HAVING count(*) > 0), CASE WHEN current_setting('cron.database_name', true) = '$db' THEN 'pg_cron=database' END)")" || return 41
  if [[ -n "$other" ]]; then
    ids_log "ERRO: não é possível provar ausência de escrita em $db: $other"
    return 41
  fi
  # Publicações lógicas vivem dentro do banco: um RENAME deixaria assinantes e slots presos ao __failed_.
  other="$(ids_psql "$db" "SELECT coalesce('publications=' || string_agg(pubname, ' '), '') FROM pg_publication")" || return 41
  if [[ -n "$other" ]]; then
    ids_log "ERRO: $db publica replicação lógica ($other); restauração por troca de nome não é segura"
    return 41
  fi
}

ids_write_lock_on() {
  local db="$1" pre
  pre="$(ids_psql "$IDS_PG_MAINT_DB" "SELECT count(*) FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE s.setrole = 0 AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = '$db') AND c LIKE '$IDS_LOCK_GUC=%'")" || return 48
  if [[ "$pre" != 0 ]] && ! grep -qx "readonly $db" "$(ids_state_file)" 2>/dev/null; then
    ids_log "ERRO: $db já tem $IDS_LOCK_GUC configurado fora da janela de deploy; trava não aplicada"
    return 48
  fi
  grep -qx "readonly $db" "$(ids_state_file)" 2>/dev/null || ids_state_add "readonly $db"
  ids_psql "$IDS_PG_MAINT_DB" "ALTER DATABASE \"$db\" SET $IDS_LOCK_GUC = on" >/dev/null || return 48
  sed -i "/^released $db\$/d" "$(ids_state_file)" 2>/dev/null || true
  ids_log "trava de escrita ligada em $db (sessões novas só leem)"
}

ids_write_lock_off() {
  local db="$1"
  ids_psql "$IDS_PG_MAINT_DB" "ALTER DATABASE \"$db\" RESET $IDS_LOCK_GUC" >/dev/null || return 48
  grep -qx "released $db" "$(ids_state_file)" 2>/dev/null || ids_state_add "released $db"
  ids_log "trava de escrita desligada em $db"
}

ids_sha256() {
  sha256sum "$1" | awk '{print $1}'
}

# Abre a janela: ≠ 0 = não abriu; desfazer com ids_maintenance_end (nada no banco foi alterado além da trava).
ids_maintenance_begin() {
  local db="$1" unmanaged f parked unit state waited=0 running reload_wait
  if [[ -f "$(ids_state_file)" ]]; then
    ids_log "ERRO: janela de manutenção anterior não encerrada ($(ids_state_file)); rode ids_maintenance_recover"
    return 46
  fi
  ids_assert_not_protected_db "$db" || return $?
  ids_assert_isolation_scope || return $?
  unmanaged="$(ids_unmanaged_cron_lines)"
  if [[ -n "$unmanaged" ]]; then
    ids_log "ERRO: agendamentos do IndusCost fora de $IDS_CRON_DIR/$IDS_CRON_GLOB (mover para um arquivo próprio):"
    printf '%s\n' "$unmanaged" | sed 's/^/[deploy-safety]   /'
    return 47
  fi
  mkdir -p "$IDS_STATE_DIR/cron-parked" && chmod 0700 "$IDS_STATE_DIR" "$IDS_STATE_DIR/cron-parked" || return 46
  ids_state_add "begin $(date -u +%Y-%m-%dT%H:%M:%SZ) $db"
  mkdir -p "$(dirname "$IDS_MAINT_FLAG")" && : > "$IDS_MAINT_FLAG" && ids_state_add "flag $IDS_MAINT_FLAG"

  # Cron: arquivos induscost* saem de /etc/cron.d (preservados com hash) — o cron deixa de agendá-los.
  for f in "$IDS_CRON_DIR"/$IDS_CRON_GLOB; do
    [[ -f "$f" ]] || continue
    parked="$IDS_STATE_DIR/cron-parked/$(basename "$f")"
    cp -p "$f" "$parked" || return 46
    [[ "$(ids_sha256 "$f")" == "$(ids_sha256 "$parked")" ]] || return 46
    ids_state_add "cron $f $parked $(ids_sha256 "$f")"
    rm -f "$f" || return 46
    ids_log "cron pausado: $f"
  done

  # Timers: só os ativos param; inativos/falhos ficam como estão (registrados como intocados).
  while read -r unit _; do
    [[ -n "$unit" ]] || continue
    state="$($IDS_SYSTEMCTL is-active "$unit" 2>/dev/null || true)"
    if [[ "$state" == active ]]; then
      ids_state_add "timer $unit active stopped"
      $IDS_SYSTEMCTL stop "$unit" || return 46
      ids_log "timer pausado: $unit"
    else
      ids_state_add "timer $unit ${state:-unknown} untouched"
    fi
  done < <($IDS_SYSTEMCTL list-units --type=timer --all --no-legend --plain "${IDS_UNIT_GLOB}.timer" 2>/dev/null)

  # O cron relê /etc/cron.d a cada minuto: espera a virada para que nenhuma execução já agendada escape.
  if [[ "$IDS_CRON_RELOAD_WAIT" == 1 ]] && grep -q '^cron ' "$(ids_state_file)"; then
    reload_wait=$(( 65 - $(date +%-S) ))
    ids_log "aguardando ${reload_wait}s para o cron reler $IDS_CRON_DIR"
    sleep "$reload_wait"
  fi

  while running="$(ids_running_writers)"; [[ -n "$running" ]]; do
    if [[ -n "${INTERRUPTED:-}" ]]; then
      ids_log "ERRO: espera por rotinas interrompida por sinal (SIG$INTERRUPTED)"
      return 40
    fi
    if (( waited >= IDS_WRITER_WAIT_SECONDS )); then
      ids_log "ERRO: rotinas ainda em execução após ${IDS_WRITER_WAIT_SECONDS}s:"
      printf '%s\n' "$running" | sed 's/^/[deploy-safety]   /'
      return 40
    fi
    if (( waited % 60 == 0 )); then ids_log "aguardando rotinas em execução terminarem (${waited}s)"; fi
    sleep "$IDS_WRITER_POLL_SECONDS"
    waited=$(( waited + IDS_WRITER_POLL_SECONDS ))
  done

  ids_write_lock_on "$db" || return $?
  ids_assert_quiescent "$db" || return $?
  ids_log "janela de manutenção aberta: agendamentos do IndusCost pausados, banco $db travado para escrita e sem sessões"
}

# Encerra a janela restaurando exatamente o estado anterior. Idempotente; ≠ 0 mantém o estado para nova tentativa.
ids_maintenance_end() {
  local state kind a b c rc=0 db
  state="$(ids_state_file)"
  [[ -f "$state" ]] || return 0
  while read -r kind a b c; do
    case "$kind" in
      readonly)
        db="$a"
        if [[ "$(ids_psql "$IDS_PG_MAINT_DB" "SELECT count(*) FROM pg_database WHERE datname = '$db'")" == 1 ]]; then
          ids_psql "$IDS_PG_MAINT_DB" "ALTER DATABASE \"$db\" RESET $IDS_LOCK_GUC" >/dev/null && ids_log "trava de escrita removida: $db" || rc=42
        fi
        ;;
      cron)
        if [[ -f "$b" ]]; then
          if [[ -f "$a" && "$(ids_sha256 "$a")" != "$c" ]]; then
            ids_log "ERRO: $a foi recriado com outro conteúdo durante a janela; original mantido em $b"
            rc=42
            continue
          fi
          [[ -f "$a" ]] || cp -p "$b" "$a" || { rc=42; continue; }
          if [[ "$(ids_sha256 "$a")" == "$c" ]]; then
            rm -f "$b"
            ids_log "cron retomado: $a"
          else
            ids_log "ERRO: $a restaurado com hash diferente; original mantido em $b"
            rc=42
          fi
        fi
        ;;
    esac
  done < "$state"
  while read -r kind a b c; do
    if [[ "$kind" == timer && "$c" == stopped ]]; then
      if $IDS_SYSTEMCTL start "$a"; then ids_log "timer retomado: $a"; else ids_log "ERRO: não foi possível retomar $a"; rc=42; fi
    fi
  done < <(tac "$state")
  if [[ "$rc" == 0 ]]; then
    { grep '^flag ' "$state" || true; } | while read -r _ a; do rm -f "$a"; done
    mv "$state" "$IDS_STATE_DIR/maintenance.$(date -u +%Y%m%dT%H%M%SZ).done"
    ids_log "janela de manutenção encerrada; agendamentos no estado anterior ao deploy"
  fi
  return "$rc"
}

# Janela deixada por um executor interrompido: mostra o estado; com --resume, restaura o estado anterior.
ids_maintenance_recover() {
  local state
  state="$(ids_state_file)"
  if [[ ! -f "$state" ]]; then
    ids_log "nenhuma janela de manutenção pendente"
    return 0
  fi
  ids_log "janela de manutenção pendente ($state):"
  sed 's/^/[deploy-safety]   /' "$state"
  if [[ "${1:-}" == "--resume" ]]; then
    ids_maintenance_end
    return $?
  fi
  ids_log "conferir banco e aplicação; depois: ids_maintenance_recover --resume"
  return 46
}

# ---------------------------------------------------------------------------------------------------------
# Backup e prova de ausência de escrita (G3)
# ---------------------------------------------------------------------------------------------------------

# Diretório do backup desta execução, do usuário do banco; pais com 0711 (atravessar, sem listar).
ids_prepare_backup_dir() {
  local root="$1" ts="$2" dir parent
  dir="$root/$ts"
  parent="$(dirname "$root")"
  case "$parent" in
    /|/var|/var/backups|/var/lib|/opt|/home|/root|/srv|/mnt|/tmp)
      ids_log "ERRO: raiz de backup $root precisa ficar num diretório próprio do ambiente (o pai $parent é do sistema e não será alterado)" >&2
      return 30
      ;;
  esac
  # Diretórios que já existiam (ex.: /var/backups/induscost-homolog, do executor antigo) NUNCA têm o modo trocado:
  # se o usuário do banco não os atravessa, a função recusa (30) e diz o que fazer — o operador decide. Os criados
  # agora nascem 0711. Esta função devolve o caminho por stdout: toda mensagem vai para stderr.
  local p created
  for p in "$parent" "$root"; do
    created=0
    [[ -d "$p" ]] || { mkdir -p "$p" && chmod 0711 "$p" && created=1; } || return 30
    if [[ "$created" == 0 && -n "$IDS_PG" ]] && ! $IDS_PG test -x "$p" 2>/dev/null; then
      ids_log "ERRO: $p (modo $(stat -c '%a %U:%G' "$p" 2>/dev/null)) não é atravessável pelo usuário do banco (${IDS_PG_USER:-?}); o dump não poderia ser lido no restore. Conceda só a ele: setfacl -m u:${IDS_PG_USER:-<usuário>}:x $p (ou chmod o+x $p) e repita" >&2
      return 30
    fi
  done
  mkdir -p "$dir" && chmod 0700 "$dir" || return 30
  if [[ -n "$IDS_PG_USER" ]]; then
    chown "$IDS_PG_USER:" "$dir" || return 30
  fi
  printf '%s\n' "$dir"
}

# Confere o dump COMO o usuário que fará o restore. ≠ 0 se ilegível ou sem tabelas.
ids_assert_backup_readable() {
  local dump="$1" listing tables
  if ! listing="$($IDS_PG "$(ids_pg_bin pg_restore)" -l "$dump" 2>&1)"; then
    ids_log "ERRO: backup ilegível pelo usuário do restore ($dump): $listing"
    return 31
  fi
  tables="$(printf '%s\n' "$listing" | grep -c ' TABLE ' || true)"
  if [[ "${tables:-0}" -lt 1 ]]; then
    ids_log "ERRO: backup sem tabelas ($dump)"
    return 32
  fi
  ids_log "backup legível pelo usuário do restore"
}

# Propriedades do banco que o pg_dump não leva (só com --create): encoding, collation, dono, limite de
# conexões, ACL (concessões normalizadas) e configurações por banco (exceto a trava). Comparável entre bancos.
ids_db_meta() {
  ids_psql "$IDS_PG_MAINT_DB" "SELECT format('encoding=%s|collate=%s|ctype=%s|locprovider=%s|owner=%s|connlimit=%s|aclset=%s|settings=%s', pg_encoding_to_char(d.encoding), d.datcollate, d.datctype, d.datlocprovider, pg_get_userbyid(d.datdba), d.datconnlimit, (SELECT string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type, ',' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type) FROM aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a), coalesce((SELECT md5(string_agg(c, chr(31) ORDER BY c)) FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE s.setdatabase = d.oid AND s.setrole = 0 AND c NOT LIKE '$IDS_LOCK_GUC=%'), 'none')) FROM pg_database d WHERE d.datname = '$1'"
}

# Impressão digital do banco. Modos (combináveis, separados por vírgula): rows (linhas exatas por tabela), seq
# (valor das sequências), files (arquivo físico das tabelas: muda com TRUNCATE/reescrita). Sem modo = estrutura.
# Uma linha por objeto, ordenada. Nomes sem esquema nas definições seguem o search_path do banco.
ids_db_fingerprint() {
  local db="$1" modes=",${2:-},"
  local rows="''" seq="''" files="''" migrations="" has
  [[ "$modes" == *,rows,* ]] && rows="'|rows=' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text"
  [[ "$modes" == *,seq,* ]] && seq="'|last=' || coalesce(s.last_value::text, 'null')"
  local lo=""
  if [[ "$modes" == *,files,* ]]; then
    files="'|file=' || c.relfilenode"
    lo="UNION ALL SELECT 'largeobjects|' || count(*) FROM pg_largeobject_metadata"
  fi
  has="$(ids_psql "$db" "SELECT to_regclass('public._prisma_migrations') IS NOT NULL")" || return 1
  if [[ "$has" == "t" ]]; then
    migrations="UNION ALL SELECT format('migration|%s|finished=%s|rolledback=%s', migration_name, finished_at IS NOT NULL, rolled_back_at IS NOT NULL) FROM public._prisma_migrations"
  fi
  ids_psql "$db" "WITH ns AS (SELECT oid, nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%')
SELECT line FROM (
  SELECT format('table|%s.%s|owner=%s|acl=%s', n.nspname, c.relname, pg_get_userbyid(c.relowner), coalesce(c.relacl::text,'')) || $rows || $files AS line FROM pg_class c JOIN ns n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p')
  UNION ALL SELECT format('column|%s.%s|%s|%s|notnull=%s|default=%s|identity=%s|generated=%s', n.nspname, c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(ad.adbin, ad.adrelid),''), a.attidentity, a.attgenerated) FROM pg_class c JOIN ns n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum WHERE c.relkind IN ('r','p')
  UNION ALL SELECT format('index|%s.%s|%s|unique=%s|%s', n.nspname, t.relname, i.relname, x.indisunique, pg_get_indexdef(i.oid)) FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid JOIN ns n ON n.oid = t.relnamespace
  UNION ALL SELECT format('constraint|%s.%s|%s|%s|%s', n.nspname, t.relname, co.conname, co.contype, pg_get_constraintdef(co.oid)) FROM pg_constraint co JOIN ns n ON n.oid = co.connamespace JOIN pg_class t ON t.oid = co.conrelid
  UNION ALL SELECT format('sequence|%s.%s|owner=%s', s.schemaname, s.sequencename, s.sequenceowner) || $seq FROM pg_sequences s
  UNION ALL SELECT format('trigger|%s.%s|%s|%s', n.nspname, t.relname, tg.tgname, pg_get_triggerdef(tg.oid)) FROM pg_trigger tg JOIN pg_class t ON t.oid = tg.tgrelid JOIN ns n ON n.oid = t.relnamespace WHERE NOT tg.tgisinternal
  UNION ALL SELECT format('view|%s.%s|owner=%s|%s', schemaname, viewname, viewowner, md5(definition)) FROM pg_views WHERE schemaname NOT IN ('pg_catalog','information_schema')
  UNION ALL SELECT format('function|%s|owner=%s|%s', p.oid::regprocedure, pg_get_userbyid(p.proowner), md5(pg_get_functiondef(p.oid))) FROM pg_proc p JOIN ns n ON n.oid = p.pronamespace WHERE p.prokind IN ('f','p')
  UNION ALL SELECT format('enum|%s.%s|%s', n.nspname, t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)) FROM pg_type t JOIN ns n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY n.nspname, t.typname
  UNION ALL SELECT format('extension|%s|%s', extname, extversion) FROM pg_extension
  UNION ALL SELECT format('schema|%s|owner=%s|acl=%s', nspname, pg_get_userbyid(n2.nspowner), coalesce(n2.nspacl::text,'')) FROM pg_namespace n2 WHERE n2.oid IN (SELECT oid FROM ns)
  UNION ALL SELECT format('defacl|%s|%s|%s|%s', pg_get_userbyid(da.defaclrole), coalesce(dn.nspname, '*'), da.defaclobjtype, da.defaclacl::text) FROM pg_default_acl da LEFT JOIN pg_namespace dn ON dn.oid = da.defaclnamespace
  ${migrations}
  ${lo}
) x ORDER BY line"
}

ids_schema_fingerprint() {
  ids_db_fingerprint "$1" ""
}

ids_tup() {
  printf '%s\n' "$1" | cut -d'|' -f1
}

ids_reset_of() {
  printf '%s\n' "$1" | cut -d'|' -f2
}

# Compara contadores: mesmas tuplas escritas e mesmo reset de estatísticas.
ids_counters_equal() {
  [[ "$(ids_tup "$1")" == "$(ids_tup "$2")" && "$(ids_reset_of "$1")" == "$(ids_reset_of "$2")" ]]
}

# Backup completo (donos e permissões) dentro da janela, conferido como postgres. Prova (G3) de que nada foi
# escrito durante o dump: contadores de tuplas iguais antes e depois. ≠ 0 aborta o deploy antes de mudanças.
ids_backup_db() {
  local db="$1" dump="$2" dir c0 c1
  dir="$(dirname "$dump")"
  [[ -n "$db" && -n "$dir" && -d "$dir" ]] || { ids_log "ERRO: backup sem banco ou sem diretório"; return 30; }
  ids_assert_not_protected_db "$db" || return $?
  ids_assert_quiescent "$db" || return $?
  ids_settle
  c0="$(ids_db_counters "$db")" || return 30
  ids_next_xid "$db" > "$dir/xid-at-backup" || return 30
  ids_backup_identity "$db" > "$dir/backup-meta.txt" || return 30
  $IDS_PG "$(ids_pg_bin pg_dump)" -Fc -Z 6 -d "$(ids_conninfo "$db")" -f "$dump" || { ids_log "ERRO: pg_dump falhou"; return 30; }
  ids_assert_backup_readable "$dump" || return $?
  ids_db_meta "$db" > "$dir/db-meta.txt" || return 30
  ids_db_fingerprint "$db" rows,seq > "$dir/fingerprint-before.txt" || return 30
  ids_schema_fingerprint "$db" > "$dir/schema-before.txt" || return 30
  ids_db_fingerprint "$db" seq,files > "$dir/state-before.txt" || return 30
  ids_assert_quiescent "$db" || return $?
  ids_settle
  c1="$(ids_db_counters "$db")" || return 30
  if ! ids_counters_equal "$c0" "$c1"; then
    ids_log "ERRO: o banco recebeu escritas durante o backup (tuplas $(ids_tup "$c0") → $(ids_tup "$c1")); backup descartado"
    return 39
  fi
  printf '%s\n' "$c1" > "$dir/counters-at-backup"
  ids_log "backup íntegro e sem escrita concorrente (tuplas escritas: $(ids_tup "$c1"))"
}

# Chamar IMEDIATAMENTE antes de `prisma migrate deploy`. Recusa (43) se, desde o backup, houve qualquer escrita
# (tuplas, sequências, arquivos de tabela, estrutura) ou se há sessões: o backup deixaria de ser o estado atual.
ids_mark_db_changes_started() {
  local dir="$1" db="$2" c
  [[ -n "$db" && -n "$dir" && -d "$dir" ]] || { ids_log "ERRO: marcador sem banco ou sem diretório; migrations NÃO serão aplicadas"; return 43; }
  [[ -f "$dir/counters-at-backup" ]] || { ids_log "ERRO: backup sem prova de integridade; migrations NÃO serão aplicadas"; return 43; }
  ids_assert_quiescent "$db" || return 43
  if ! diff -q "$dir/state-before.txt" <(ids_db_fingerprint "$db" seq,files) >/dev/null || ! diff -q "$dir/schema-before.txt" <(ids_schema_fingerprint "$db") >/dev/null; then
    ids_log "ERRO: sequências, tabelas ou estrutura mudaram depois do backup; migrations NÃO serão aplicadas"
    return 43
  fi
  ids_settle
  c="$(ids_db_counters "$db")" || return 43
  if ! ids_counters_equal "$(cat "$dir/counters-at-backup")" "$c"; then
    ids_log "ERRO: houve escrita no banco depois do backup (tuplas $(ids_tup "$(cat "$dir/counters-at-backup")") → $(ids_tup "$c")); migrations NÃO serão aplicadas"
    return 43
  fi
  printf '%s\n' "$c" > "$dir/$IDS_MARKER_NAME"
  ids_log "início das alterações do banco registrado; nenhuma escrita desde o backup"
}

# URL das migrations: a única com exceção à trava de escrita, identificada para o observador de sessões.
ids_migrate_database_url() {
  local url="$1" sep="?"
  if [[ "$url" == *"options="* || "$url" == *"application_name="* ]]; then
    ids_log "ERRO: DATABASE_URL já define options/application_name; exceção da trava não pode ser aplicada com segurança"
    return 1
  fi
  [[ "$url" == *"?"* ]] && sep="&"
  printf '%s%soptions=-c%%20%s%%3Doff&application_name=%s\n' "$url" "$sep" "$IDS_LOCK_GUC" "$IDS_MIGRATE_APPNAME"
}

# Observador de sessões durante as migrations: registra toda sessão no banco; qualquer uma que não seja das
# migrations ou da própria biblioteca invalida a prova (restauração automática deixa de ser permitida).
ids_migrate_watch_start() {
  local dir="$1" db="$2"
  [[ -n "$db" && -n "$dir" && -d "$dir" ]] || { ids_log "ERRO: observador sem banco ou sem diretório"; return 30; }
  rm -f "$dir/migrate-watch.stop" "$dir/migrate-sessions.raw"
  : > "$dir/migrate-sessions.raw"
  (
    # O observador não herda a trava do executor (IDS_LOCK_FD): uma queda do executor não deixa o lock preso nele.
    if [[ -n "${IDS_LOCK_FD:-}" ]]; then eval "exec ${IDS_LOCK_FD}>&-"; fi
    while [[ ! -f "$dir/migrate-watch.stop" ]]; do
      ids_psql "$IDS_PG_MAINT_DB" "SELECT format('%s|%s|%s|%s|%s', pid, backend_start, coalesce(application_name,''), coalesce(usename,''), backend_type) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid() AND backend_type NOT IN ('autovacuum worker')" >> "$dir/migrate-sessions.raw" 2>/dev/null || true
      sleep "$IDS_WATCH_INTERVAL"
    done
  ) >/dev/null 2>&1 &
  # pid + instante de início (/proc/<pid>/stat, campo 22): depois de uma queda/reboot o número pode ter sido
  # reatribuído a outro processo, e ids_migrate_watch_stop só sinaliza o observador que registrou.
  printf '%s %s\n' "$!" "$(ids_proc_starttime "$!")" > "$dir/migrate-watch.pid"
}

# Instante de início de um processo (vazio quando /proc não dá a informação).
ids_proc_starttime() {
  awk '{print $22}' "$IDS_PROC_DIR/$1/stat" 2>/dev/null || true
}

ids_migrate_watch_stop() {
  local dir="$1" pid started now i
  [[ -f "$dir/migrate-watch.pid" ]] || return 0
  read -r pid started < "$dir/migrate-watch.pid"
  : > "$dir/migrate-watch.stop"
  now="$(ids_proc_starttime "$pid")"
  if [[ -n "$started" && -n "$now" && "$started" != "$now" ]]; then
    ids_log "observador $pid já não existe (pid reatribuído a outro processo): nenhum sinal enviado"
  else
    for i in $(seq 1 100); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$dir/migrate-watch.pid"
  sort -u "$dir/migrate-sessions.raw" > "$dir/migrate-sessions.log"
  awk -F'|' -v m="$IDS_MIGRATE_APPNAME" -v s="$IDS_APPNAME" '$3 != m && $3 != s' "$dir/migrate-sessions.log" > "$dir/migrate-foreign-sessions.log"
  if [[ -s "$dir/migrate-foreign-sessions.log" ]]; then
    ids_log "ATENÇÃO: sessões estranhas durante as migrations (restauração automática deixa de ser permitida):"
    sed 's/^/[deploy-safety]   /' "$dir/migrate-foreign-sessions.log"
  fi
}

# Chamar imediatamente antes de subir a aplicação nova: registra o ponto de controle (contadores, sequências,
# arquivos, estrutura), libera a escrita para a aplicação e marca app-started.
ids_open_for_app() {
  local dir="$1" db="$2"
  [[ -n "$db" && -n "$dir" && -d "$dir" ]] || { ids_log "ERRO: ponto de controle sem banco ou sem diretório"; return 30; }
  ids_migrate_watch_stop "$dir"
  ids_assert_quiescent "$db" || return $?
  ids_schema_fingerprint "$db" > "$dir/schema-after-migrate.txt" || return 30
  ids_db_fingerprint "$db" seq,files > "$dir/state-before-app.txt" || return 30
  ids_settle
  ids_db_counters "$db" > "$dir/counters-before-app" || return 30
  ids_write_lock_off "$db" || return $?
  date -u +%Y-%m-%dT%H:%M:%SZ > "$dir/$IDS_APP_MARKER_NAME"
}

ids_db_changed_by_deploy() {
  [[ -f "$1/$IDS_MARKER_NAME" ]]
}

# Prova de que restaurar o backup não perde escrita legítima. Imprime o motivo quando não há prova.
ids_restore_proof() {
  local dir="$1" db="$2" c
  [[ -f "$dir/counters-at-backup" ]] || { echo "backup sem prova de integridade"; return 1; }
  ids_db_changed_by_deploy "$dir" || { echo "migrations não iniciadas"; return 1; }
  [[ -f "$dir/migrate-sessions.log" ]] || { echo "sessões durante as migrations não observadas"; return 1; }
  [[ ! -s "$dir/migrate-foreign-sessions.log" ]] || { echo "sessões estranhas durante as migrations"; return 1; }
  if [[ -f "$dir/$IDS_APP_MARKER_NAME" ]]; then
    [[ -f "$dir/counters-before-app" ]] || { echo "ponto de controle anterior à aplicação ausente"; return 1; }
    diff -q "$dir/state-before-app.txt" <(ids_db_fingerprint "$db" seq,files) >/dev/null || { echo "sequências ou tabelas mudaram depois que a aplicação subiu"; return 1; }
    diff -q "$dir/schema-after-migrate.txt" <(ids_schema_fingerprint "$db") >/dev/null || { echo "estrutura mudou depois que a aplicação subiu"; return 1; }
    ids_settle
    c="$(ids_db_counters "$db")" || { echo "contadores indisponíveis"; return 1; }
    ids_counters_equal "$(cat "$dir/counters-before-app")" "$c" || { echo "a aplicação escreveu $(( $(ids_tup "$c") - $(ids_tup "$(cat "$dir/counters-before-app")") )) tupla(s) depois de subir"; return 1; }
  fi
  echo "sem escrita legítima desde o backup (trava de escrita + contadores + sequências + observador)"
}

# ---------------------------------------------------------------------------------------------------------
# G4 — compatibilidade do schema atual com o código anterior
# ---------------------------------------------------------------------------------------------------------

# Saída: linhas "OK|motivo", "INCOMPATIVEL|motivo", "CHECK-EMPTY|tabela|fk", "CHECK-ENUM|tipo|rótulos novos",
# "FAILED|migration". Regras conservadoras: o código anterior funciona com tabelas, colunas anuláveis/com valor
# padrão, índices não únicos, sequências, views, funções e extensões NOVOS; qualquer remoção/alteração, coluna
# obrigatória sem padrão, índice único, constraint ou trigger em tabela existente é incompatível.
ids_compat_classify() {
  local before="$1" now="$2"
  diff <(cat "$before") <(cat "$now") | awk -F'|' -v BEFORE="$before" '
    BEGIN { while ((getline l < BEFORE) > 0) { split(l, f, "|"); if (f[1] == "table") T[f[2]] = 1; if (f[1] == "enum") E[f[2]] = f[3] } }
    /^< / { sub(/^< /, ""); split($0, f, "|"); if (f[1] == "enum") { RE[f[2]] = f[3]; next } print "INCOMPATIVEL|removido ou alterado: " $0; next }
    /^> / {
      sub(/^> /, ""); n = split($0, f, "|"); k = f[1]
      if (k == "table") { if (f[2] in T) print "INCOMPATIVEL|tabela existente alterada: " f[2]; else print "OK|tabela nova: " f[2]; next }
      if (k == "column") {
        if (!(f[2] in T)) next
        if (f[5] == "notnull=f" || f[6] != "default=" || f[7] != "identity=" || f[8] != "generated=") print "OK|coluna nova opcional: " f[2] "." f[3]
        else print "INCOMPATIVEL|coluna nova obrigatória sem valor padrão: " f[2] "." f[3]
        next
      }
      if (k == "index") { if ((f[2] in T) && f[4] == "unique=t") print "INCOMPATIVEL|índice único em tabela existente: " f[3]; else print "OK|índice novo: " f[3]; next }
      if (k == "constraint") {
        if (f[2] in T) { print "INCOMPATIVEL|constraint em tabela existente: " f[2] "." f[3]; next }
        if (f[4] == "f" && f[5] !~ /ON DELETE (CASCADE|SET NULL|SET DEFAULT)/) { print "CHECK-EMPTY|" f[2] "|" f[3]; next }
        print "OK|constraint de tabela nova: " f[2] "." f[3]; next
      }
      if (k == "trigger") { if (f[2] in T) print "INCOMPATIVEL|trigger em tabela existente: " f[2] "." f[3]; else print "OK|trigger de tabela nova: " f[3]; next }
      if (k == "enum") { AE[f[2]] = f[3]; next }
      if (k == "migration") { if (f[3] == "finished=t") print "OK|migration aplicada: " f[2]; else print "FAILED|" f[2]; next }
      print "OK|" k " novo: " f[2]
    }
    END {
      for (t in RE) {
        if (!(t in AE)) { print "INCOMPATIVEL|enum removido ou alterado: " t; continue }
        o = split(RE[t], old, ","); m = split(AE[t], cur, ","); j = 1; added = ""
        for (i = 1; i <= m; i++) { if (j <= o && cur[i] == old[j]) j++; else added = added (added == "" ? "" : ",") cur[i] }
        if (j <= o) print "INCOMPATIVEL|enum com rótulo removido ou reordenado: " t
        else print "CHECK-ENUM|" t "|" added
      }
      for (t in AE) if (!(t in RE)) { if (t in E) print "INCOMPATIVEL|enum alterado: " t; else print "OK|enum novo: " t }
    }'
}

# Resolve as verificações que dependem de dados e grava compat-report.txt. Retorno: 0 compatível, 1 incompatível.
# Também marca FAILED (migration com falha registrada) em compat-failed.txt.
ids_compat_report() {
  local dir="$1" db="$2" migrations_dir="${3:-}" line kind a b n cols col tbl name
  : > "$dir/compat-report.txt"
  : > "$dir/compat-failed.txt"
  while IFS= read -r line; do
    kind="${line%%|*}"
    case "$kind" in
      OK|INCOMPATIVEL) echo "$line" >> "$dir/compat-report.txt" ;;
      FAILED) echo "${line#FAILED|}" >> "$dir/compat-failed.txt"; echo "OK|migration com falha registrada: ${line#FAILED|}" >> "$dir/compat-report.txt" ;;
      CHECK-EMPTY)
        IFS='|' read -r _ a b <<< "$line"
        n="$(ids_psql "$db" "SELECT count(*) FROM (SELECT 1 FROM $(printf '%s' "$a" | awk -F. '{printf "\"%s\".\"%s\"", $1, $2}') LIMIT 1) x")" || n=1
        if [[ "$n" == 0 ]]; then echo "OK|tabela nova vazia com FK restritiva: $a ($b)" >> "$dir/compat-report.txt"
        else echo "INCOMPATIVEL|tabela nova com linhas e FK restritiva para tabela existente: $a ($b)" >> "$dir/compat-report.txt"; fi
        ;;
      CHECK-ENUM)
        IFS='|' read -r _ a b <<< "$line"
        cols="$(ids_psql "$db" "SELECT format('%I.%I|%I|%s', n.nspname, c.relname, at.attname, CASE WHEN at.atttypid = t.oid THEN 'scalar' ELSE 'array' END) FROM pg_type t JOIN pg_namespace tn ON tn.oid = t.typnamespace JOIN pg_attribute at ON at.atttypid IN (t.oid, t.typarray) AND at.attnum > 0 AND NOT at.attisdropped JOIN pg_class c ON c.oid = at.attrelid AND c.relkind IN ('r','p') JOIN pg_namespace n ON n.oid = c.relnamespace WHERE tn.nspname || '.' || t.typname = '$a'")" || cols="?|?|array"
        name="OK|enum com rótulos novos ainda sem uso: $a ($b)"
        while IFS='|' read -r tbl col kind; do
          [[ -n "$tbl" ]] || continue
          if [[ "$kind" == array ]]; then name="INCOMPATIVEL|enum com rótulos novos em coluna array: $a ($tbl)"; break; fi
          n="$(ids_psql "$db" "SELECT count(*) FROM $tbl WHERE $col::text = ANY (string_to_array('$b', ','))")" || n=1
          if [[ "$n" != 0 ]]; then name="INCOMPATIVEL|enum com rótulos novos já usados: $a ($tbl.$col, $n linha(s))"; break; fi
        done <<< "$cols"
        echo "$name" >> "$dir/compat-report.txt"
        ;;
    esac
  done < <(ids_compat_classify "$dir/schema-before.txt" <(ids_schema_fingerprint "$db"))
  # Migrations que apagam dados: o código anterior funcionaria, mas manter o banco perpetuaria a remoção.
  if [[ -n "$migrations_dir" ]]; then
    while IFS= read -r name; do
      [[ -f "$migrations_dir/$name/migration.sql" ]] || continue
      if grep -qiE '^[[:space:]]*(DELETE|TRUNCATE)[[:space:]]' "$migrations_dir/$name/migration.sql"; then
        echo "INCOMPATIVEL|migration remove dados: $name" >> "$dir/compat-report.txt"
      fi
    done < <(diff <(cat "$dir/schema-before.txt") <(ids_schema_fingerprint "$db") | sed -n 's/^> migration|\([^|]*\)|.*/\1/p')
  fi
  ! grep -q '^INCOMPATIVEL|' "$dir/compat-report.txt"
}

# ---------------------------------------------------------------------------------------------------------
# Restauração (G5)
# ---------------------------------------------------------------------------------------------------------

ids_meta_field() {
  # $1 = linha de metadados, $2 = campo
  printf '%s\n' "$1" | tr '|' '\n' | sed -n "s/^$2=//p"
}

# Journal da troca: permite recuperar qualquer interrupção.
ids_journal() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" >> "$1/restore-journal"
}

ids_unfreeze() {
  ids_psql "$IDS_PG_MAINT_DB" "ALTER DATABASE \"$1\" WITH ALLOW_CONNECTIONS true" >/dev/null || true
}

ids_restore_db_safely() {
  local db="$1" dump="$2" ts="$3" dir meta staging failed owner diff_file k1 k2 terminated
  local -a connopts=()
  dir="$(dirname "$dump")"
  staging="${db}__rollback_${ts}"
  failed="${db}__failed_${ts}"
  ids_assert_not_protected_db "$db" || return $?
  mapfile -t connopts < <(ids_pg_connopts)
  [[ -f "$dir/db-meta.txt" && -f "$dir/fingerprint-before.txt" ]] || { ids_log "ERRO: backup sem metadados/impressão digital"; return 33; }
  ids_assert_backup_readable "$dump" || return $?
  meta="$(cat "$dir/db-meta.txt")"
  owner="$(ids_meta_field "$meta" owner)"
  if [[ "$(ids_meta_field "$meta" locprovider)" != "c" ]]; then
    ids_log "ERRO: banco com provedor de collation '$(ids_meta_field "$meta" locprovider)' (não libc): restauração automática não suportada; $db intocado"
    return 33
  fi
  # Espaço para o banco restaurado ao lado do atual (medido agora, não só nas pré-condições do deploy).
  ids_assert_disk_space "$db" "$dir" || return $?
  ids_journal "$dir" "restore-start db=$db staging=$staging"

  # 0. Congela o banco atual (ninguém conecta, nem superusuário) e reconfere que nada mudou desde a prova.
  ids_settle
  k1="$(ids_db_sessions "$db")" || return 49
  ids_psql "$IDS_PG_MAINT_DB" "ALTER DATABASE \"$db\" WITH ALLOW_CONNECTIONS false" >/dev/null || return 35
  ids_journal "$dir" "frozen db=$db"
  terminated="$(ids_psql "$IDS_PG_MAINT_DB" "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid() AND backend_type NOT IN ('autovacuum worker')")" || terminated=1
  ids_settle
  k2="$(ids_db_sessions "$db")" || k2="?"
  if [[ "$terminated" != 0 || "$k1" != "$k2" ]]; then
    ids_unfreeze "$db"
    ids_journal "$dir" "aborted-after-freeze reopened=$db"
    ids_log "ERRO: sessão ou escrita surgiu entre a prova e o congelamento; restauração cancelada; $db reaberto e intocado"
    return 49
  fi

  # 1. Banco novo com as mesmas propriedades do original (encoding/collation do backup, não do template).
  if ! $IDS_PG "$(ids_pg_bin createdb)" "${connopts[@]}" -T template0 -E "$(ids_meta_field "$meta" encoding)" \
      --lc-collate="$(ids_meta_field "$meta" collate)" --lc-ctype="$(ids_meta_field "$meta" ctype)" \
      -O "$owner" "$staging"; then
    ids_unfreeze "$db"
    ids_log "ERRO: não foi possível criar $staging; banco $db reaberto e intocado"
    return 33
  fi
  ids_journal "$dir" "staging-created"

  # 2. Restauração completa (donos e permissões preservados).
  if ! $IDS_PG "$(ids_pg_bin pg_restore)" --exit-on-error --dbname="$(ids_conninfo "$staging")" "$dump"; then
    ids_unfreeze "$db"
    ids_log "ERRO: restore em $staging falhou; banco $db reaberto e intocado ($staging mantido para análise)"
    return 34
  fi
  # 3. Propriedades de nível de banco copiadas do original (que ainda existe): limite de conexões,
  #    configurações (ALTER DATABASE … SET, exceto a trava) e concessões. Conferidas abaixo contra o backup.
  #    Parâmetros de lista (search_path etc.) já estão gravados na sintaxe de SET ("$user", public) e vão sem
  #    aspas — entre aspas virariam um único elemento; os demais vão como literal (mesma regra do pg_dumpall).
  ids_psql "$IDS_PG_MAINT_DB" "ALTER DATABASE \"$staging\" CONNECTION LIMIT $(ids_meta_field "$meta" connlimit)" >/dev/null || { ids_unfreeze "$db"; return 34; }
  local -a stmts=()
  mapfile -t stmts < <(ids_psql "$IDS_PG_MAINT_DB" "SELECT format('ALTER DATABASE %I SET %s TO %s', '$staging', split_part(c, '=', 1), CASE WHEN split_part(c, '=', 1) IN ('search_path', 'temp_tablespaces', 'session_preload_libraries', 'local_preload_libraries') THEN substr(c, strpos(c, '=') + 1) ELSE quote_literal(substr(c, strpos(c, '=') + 1)) END) FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE s.setrole = 0 AND c NOT LIKE '$IDS_LOCK_GUC=%' AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = '$db')
UNION ALL SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', '$staging') FROM pg_database WHERE datname = '$db' AND datacl IS NOT NULL
UNION ALL SELECT format('GRANT %s ON DATABASE %I TO %s', a.privilege_type, '$staging', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END) FROM pg_database d, aclexplode(d.datacl) a WHERE d.datname = '$db'") || { ids_unfreeze "$db"; return 34; }
  local stmt
  for stmt in "${stmts[@]}"; do
    [[ -n "$stmt" ]] || continue
    ids_psql "$IDS_PG_MAINT_DB" "$stmt" >/dev/null || { ids_log "ERRO: falhou ao aplicar em $staging: $stmt"; ids_unfreeze "$db"; return 34; }
  done

  # 4. Conferência integral ANTES da troca: conteúdo e propriedades do banco iguais aos do backup.
  diff_file="$dir/restore-verification.diff"
  if ! diff <(cat "$dir/fingerprint-before.txt") <(ids_db_fingerprint "$staging" rows,seq) > "$diff_file"; then
    ids_unfreeze "$db"
    ids_log "ERRO: banco restaurado difere do backup (ver $diff_file); troca NÃO realizada; $db reaberto e intocado"
    return 38
  fi
  if ! diff <(printf '%s\n' "$meta") <(ids_db_meta "$staging") >> "$diff_file"; then
    ids_unfreeze "$db"
    ids_log "ERRO: propriedades do banco restaurado diferem do backup (ver $diff_file); troca NÃO realizada; $db reaberto e intocado"
    return 38
  fi
  ids_journal "$dir" "verified"

  # 5. Troca atômica: fecha o restaurado para conexões e renomeia os dois numa única transação.
  ids_psql "$IDS_PG_MAINT_DB" "ALTER DATABASE \"$staging\" WITH ALLOW_CONNECTIONS false" >/dev/null || { ids_unfreeze "$db"; return 35; }
  ids_psql "$IDS_PG_MAINT_DB" "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = '$staging' AND pid <> pg_backend_pid()" >/dev/null || true
  ids_journal "$dir" "connections-closed"
  if ! ids_psql_tx "$IDS_PG_MAINT_DB" "ALTER DATABASE \"$db\" RENAME TO \"$failed\"; ALTER DATABASE \"$staging\" RENAME TO \"$db\";" >/dev/null; then
    ids_unfreeze "$db"
    ids_journal "$dir" "swap-failed reopened=$db"
    ids_log "ERRO: troca não concluída (transação desfeita); $db reaberto e intocado; restaurado disponível em $staging"
    return 36
  fi
  ids_journal "$dir" "swapped failed=$failed"
  ids_psql "$IDS_PG_MAINT_DB" "ALTER DATABASE \"$db\" WITH ALLOW_CONNECTIONS true" >/dev/null || { ids_log "ERRO: $db restaurado mas fechado para conexões — rode ids_recover_db_state"; return 44; }
  ids_psql "$IDS_PG_MAINT_DB" "ALTER DATABASE \"$failed\" WITH ALLOW_CONNECTIONS true" >/dev/null || true
  ids_journal "$dir" "done"
  ids_log "banco $db restaurado e conferido; estado anterior preservado em $failed (remover só após conferência)"
}

# Recupera interrupções (queda do processo/servidor) em qualquer ponto da restauração. Idempotente.
ids_recover_db_state() {
  local db="$1" dir="$2" exists allow
  exists="$(ids_psql "$IDS_PG_MAINT_DB" "SELECT count(*) FROM pg_database WHERE datname = '$db'")" || return 45
  if [[ "$exists" != 1 ]]; then
    ids_log "ERRO: banco $db não existe; candidatos (NÃO alterados automaticamente):"
    ids_psql "$IDS_PG_MAINT_DB" "SELECT datname FROM pg_database WHERE datname LIKE '${db}\_\_%' ESCAPE '\' AND datname <> '$db' ORDER BY datname" | sed 's/^/[deploy-safety]   /'
    return 45
  fi
  allow="$(ids_psql "$IDS_PG_MAINT_DB" "SELECT datallowconn FROM pg_database WHERE datname = '$db'")" || return 45
  if [[ "$allow" != "t" && "$allow" != "true" ]]; then
    ids_psql "$IDS_PG_MAINT_DB" "ALTER DATABASE \"$db\" WITH ALLOW_CONNECTIONS true" >/dev/null || return 45
    if [[ -n "$dir" ]]; then ids_journal "$dir" "recovered reopened=$db"; fi
    ids_log "recuperado: $db voltou a aceitar conexões"
  else
    ids_log "estado consistente: $db existe e aceita conexões"
  fi
}

# Decide e executa a recuperação do banco depois de uma falha (G4). Pré-condição: aplicação parada.
# Retorno: 0 = banco pronto para o código anterior (mantido ou restaurado); 2 = BLOQUEIO (nada destrutivo
# feito; manter serviço parado e a janela aberta); outro ≠ 0 = falha da restauração (banco atual intocado).
# Grava rollback-decision.txt.
ids_rollback_db_if_needed() {
  local dir="$1" db="$2" dump="$3" ts="$4" migrations_dir="${5:-}" proof compat=0 failed rc
  [[ -n "$db" && -n "$dir" && -d "$dir" ]] || { ids_log "ERRO: rollback sem banco ou sem diretório de backup; nada feito"; return 30; }
  ids_recover_db_state "$db" "$dir" || return $?
  ids_migrate_watch_stop "$dir"
  if ! ids_db_changed_by_deploy "$dir"; then
    echo "decision=NO_DB_CHANGE" > "$dir/rollback-decision.txt"
    ids_log "banco não foi alterado por este deploy (falha antes das migrations): restauração NÃO executada"
    return 0
  fi
  ids_write_lock_on "$db" || true
  if ! ids_assert_quiescent "$db"; then
    printf 'decision=BLOCKED\nreason=sessões abertas no banco durante o rollback\n' > "$dir/rollback-decision.txt"
    ids_log "BLOQUEIO: sessões abertas no banco; nada foi alterado"
    return 2
  fi
  if diff -q "$dir/schema-before.txt" <(ids_schema_fingerprint "$db") >/dev/null; then
    echo "decision=NO_SCHEMA_CHANGE" > "$dir/rollback-decision.txt"
    ids_log "schema e migrations iguais ao backup: nenhuma migration foi aplicada; restauração NÃO executada"
    return 0
  fi
  ids_compat_report "$dir" "$db" "$migrations_dir" || compat=1
  failed="$(cat "$dir/compat-failed.txt" 2>/dev/null)"
  proof="$(ids_restore_proof "$dir" "$db")" && rc=0 || rc=1
  {
    echo "compatible=$([[ "$compat" == 0 ]] && echo yes || echo no)"
    echo "failed_migrations=${failed//$'\n'/,}"
    echo "restore_proven=$([[ "$rc" == 0 ]] && echo yes || echo no)"
    echo "proof=$proof"
  } > "$dir/rollback-decision.txt"
  ids_log "compatibilidade do schema atual com o código anterior: $([[ "$compat" == 0 ]] && echo COMPATÍVEL || echo INCOMPATÍVEL) (ver $dir/compat-report.txt)"
  { grep '^INCOMPATIVEL|' "$dir/compat-report.txt" || true; } | sed 's/^INCOMPATIVEL|/[deploy-safety]   incompatível: /'
  ids_log "prova para restauração: $proof"
  if [[ "$compat" == 0 && ( -z "$failed" || "$rc" != 0 ) ]]; then
    echo "decision=KEEP_DB" >> "$dir/rollback-decision.txt"
    ids_log "decisão: banco MANTIDO (schema compatível); só o código volta"
    if [[ -n "$failed" ]]; then
      ids_log "  migration com falha registrada ($failed): antes do próximo deploy, prisma migrate resolve --rolled-back <nome>"
    fi
    return 0
  fi
  if [[ "$rc" == 0 ]]; then
    echo "decision=RESTORE" >> "$dir/rollback-decision.txt"
    ids_log "decisão: RESTAURAR o backup (schema $([[ "$compat" == 0 ]] && echo 'com migration falha' || echo incompatível); nenhuma escrita legítima a perder)"
    ids_restore_db_safely "$db" "$dump" "$ts"
    return $?
  fi
  echo "decision=BLOCKED" >> "$dir/rollback-decision.txt"
  ids_log "BLOQUEIO: schema incompatível com o código anterior e sem prova de que restaurar não perde escrita."
  ids_log "  Nada foi restaurado nem apagado. Serviço parado; janela de manutenção e trava de escrita mantidas."
  ids_log "  Opções após avaliar $dir/compat-report.txt e $dir/rollback-decision.txt:"
  ids_log "   a) corrigir para frente e reimplantar;"
  ids_log "   b) restaurar mesmo assim (descarta o que foi escrito depois do backup): ${IDS_EXECUTOR_NAME:-<executor>} --restore-backup $dir"
  ids_log "  Encerrar a janela depois: ${IDS_EXECUTOR_NAME:-<executor>} --recover --resume"
  return 2
}

# ---------------------------------------------------------------------------------------------------------
# G6 — gate de testes isolado
# ---------------------------------------------------------------------------------------------------------

ids_run_test_gate() {
  local lockdir rc had_errexit=0 key
  local -a blanks=()
  lockdir="$(mktemp -d "${TMPDIR:-/tmp}/induscost-test-gate-locks.XXXXXX")"
  # Toda chave do .env real (só os NOMES; valores nunca são lidos) entra vazia: dotenv e o Prisma Client
  # não sobrescrevem variável já definida, então nenhum segredo do servidor chega aos testes.
  if [[ -f "${IDS_ENV_FILE:-$PWD/.env}" ]]; then
    while IFS= read -r key; do
      blanks+=("$key=")
    done < <(grep -oE '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=' "${IDS_ENV_FILE:-$PWD/.env}" |
      sed -E 's/^[[:space:]]*(export[[:space:]]+)?//; s/[[:space:]]*=$//' | sort -u)
  fi
  [[ $- == *e* ]] && had_errexit=1
  set +e
  env \
    "${blanks[@]}" \
    DOTENV_CONFIG_PATH="$lockdir/.env.inexistente" \
    DATABASE_URL="postgresql://offline:offline@127.0.0.1:1/induscost_test_gate_offline" \
    DIRECT_URL="postgresql://offline:offline@127.0.0.1:1/induscost_test_gate_offline" \
    NOMUS_BASE_URL="https://nomus.test-gate.invalid/rest" \
    NOMUS_TOKEN="" \
    NOMUS_AUTH_HEADER_NAME="" \
    NOMUS_AUTH_HEADER_VALUE="" \
    INDUSCOST_TEST_GATE="1" \
    NOMUS_SALES_ORDERS_SYNC_LOCK_FILE="$lockdir/sales-orders.lock" \
    NOMUS_ACCOUNTS_RECEIVABLE_CANONICAL_LOCK_FILE="$lockdir/ar.canonical.lock" \
    NOMUS_ACCOUNTS_PAYABLE_CANONICAL_LOCK_FILE="$lockdir/ap.canonical.lock" \
    NOMUS_PURCHASE_ORDERS_CANONICAL_LOCK_FILE="$lockdir/po.canonical.lock" \
    NOMUS_SYNC_GLOBAL_LOCK_FILE="$lockdir/global.lock" \
    NOMUS_SYNC_LOCK_FILE="$lockdir/global-shell.lock" \
    NOMUS_AR_SYNC_LOCK_FILE="$lockdir/ar.lock" \
    NOMUS_AP_SYNC_LOCK_FILE="$lockdir/ap.lock" \
    "${IDS_TEST_RUNNER:-npx}" ${IDS_TEST_RUNNER_ARGS-tsx --test} "$@"
  rc=$?
  [[ "$had_errexit" == 1 ]] && set -e
  rm -rf "$lockdir"
  return "$rc"
}
