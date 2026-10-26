#!/usr/bin/env bash
# Biblioteca de segurança dos executores de deploy do IndusCost (produção AWS e homologação) — v2.
#
# Uso: os executores fazem `source /usr/local/lib/induscost/induscost-deploy-safety.sh` (cópia fixa desta
# versão; ver infra/deploy/APLICAR.md) e chamam as funções abaixo nos pontos indicados.
#
# Incidente de 26/10/2026: um teste falhou antes das migrations, o rollback apagou o banco e não conseguiu
# restaurar (o postgres não lia o backup). Garantias desta versão:
#   G1. Escritores pausados (cron, timers, processos Nomus em execução) e sem sessões no banco ANTES do backup.
#   G2. Cerca de escrita: o próximo XID do banco é registrado antes do pg_dump; qualquer escrita até o início
#       das migrations invalida o backup e ABORTA o deploy antes de alterar o banco.
#   G3. Restauração automática só quando: as migrations começaram, o schema/migrations mudaram em relação ao
#       backup e a aplicação nova NÃO chegou a subir (sem escrita de negócio possível). Fora disso, nada é
#       restaurado automaticamente; o executor recebe "decisão manual" (DB_RC=2) com o diagnóstico.
#   G4. Restauração fiel e não destrutiva: banco novo com encoding/collation/dono/ACL/configurações do original,
#       pg_restore completo (donos e permissões), conferência integral (tabelas, linhas, índices, constraints,
#       sequências, triggers, funções, extensões, donos, ACL, migrations) ANTES da troca.
#   G5. Troca atômica (dois RENAME numa única transação, com o banco fechado para conexões); o banco atual é
#       preservado como <db>__failed_<ts>. Nenhum dropdb. Interrupção em qualquer ponto é recuperável
#       (ids_recover_db_state) — o banco <db> nunca deixa de existir.
#   G6. Gate de testes isolado: sem .env, banco inalcançável, chaves do .env vazias, locks temporários.
#
# Variáveis: IDS_PG (prefixo para rodar como postgres; padrão `runuser -u postgres --`), IDS_PG_USER (dono do
# diretório de backup; padrão postgres), IDS_WRITER_TIMER_GLOB (padrão induscost-*.timer), IDS_PAUSE_CRON
# (padrão 1), IDS_WRITER_PROCESS_PATTERN, IDS_WRITER_WAIT_SECONDS (padrão 1800), IDS_WRITER_POLL_SECONDS (padrão 5), IDS_SYSTEMCTL (padrão systemctl).
# O padrão de processos só decide ESPERAR; a prova de ausência de escrita é a cerca de XID + sessões (G2).

IDS_PG="${IDS_PG-runuser -u postgres --}"
IDS_PG_USER="${IDS_PG_USER-postgres}"
IDS_SYSTEMCTL="${IDS_SYSTEMCTL:-systemctl}"
IDS_WRITER_TIMER_GLOB="${IDS_WRITER_TIMER_GLOB:-induscost-*.timer}"
IDS_PAUSE_CRON="${IDS_PAUSE_CRON:-1}"
IDS_WRITER_PROCESS_PATTERN="${IDS_WRITER_PROCESS_PATTERN:-runNomus[A-Za-z]*Sync|scripts/nomus[A-Za-z0-9]*\.ts|legal-exposure|legalExposure}"
IDS_WRITER_WAIT_SECONDS="${IDS_WRITER_WAIT_SECONDS:-1800}"
IDS_WRITER_POLL_SECONDS="${IDS_WRITER_POLL_SECONDS:-5}"
IDS_MARKER_NAME="db-changes-started"
IDS_APP_MARKER_NAME="app-started"

ids_log() {
  echo "[deploy-safety] $*"
}

# Uma instrução por chamada; saída no formato `psql -At` (colunas separadas por |).
ids_psql() {
  local db="$1" sql="$2"
  $IDS_PG psql -d "$db" -v ON_ERROR_STOP=1 -Atc "$sql"
}

# Várias instruções numa única transação (tudo ou nada).
ids_psql_tx() {
  local db="$1" sql="$2"
  $IDS_PG psql -d "$db" -v ON_ERROR_STOP=1 -Atc "BEGIN; $sql COMMIT;"
}

ids_next_xid() {
  ids_psql "$1" "SELECT pg_snapshot_xmax(pg_current_snapshot())::text"
}

# Sessões de clientes no banco, exceto a própria consulta. Saída: uma linha por sessão.
ids_foreign_sessions() {
  ids_psql postgres "SELECT format('%s|%s|%s|%s', pid, coalesce(usename,''), coalesce(application_name,''), coalesce(client_addr::text,'local')) FROM pg_stat_activity WHERE datname = '$1' AND pid <> pg_backend_pid() AND backend_type = 'client backend' ORDER BY pid"
}

# ---------------------------------------------------------------------------------------------------------
# G1 — escritores
# ---------------------------------------------------------------------------------------------------------

# Para timers induscost-*, o cron (opcional) e espera processos Nomus terminarem. Registra o que parou em
# $state para ids_resume_writers. ≠ 0 = não foi possível pausar (nada foi alterado no banco; retome e aborte).
ids_pause_writers() {
  local state="$1" db="$2" unit waited=0 running sessions
  : > "$state"
  while IFS= read -r unit; do
    [[ -n "$unit" ]] || continue
    if $IDS_SYSTEMCTL is-active --quiet "$unit"; then
      $IDS_SYSTEMCTL stop "$unit" && echo "unit $unit" >> "$state" && ids_log "pausado: $unit"
    fi
  done < <($IDS_SYSTEMCTL list-units --type=timer --all --no-legend --plain "$IDS_WRITER_TIMER_GLOB" 2>/dev/null | awk '{print $1}')
  if [[ "$IDS_PAUSE_CRON" == 1 ]] && $IDS_SYSTEMCTL is-active --quiet cron; then
    $IDS_SYSTEMCTL stop cron && echo "unit cron" >> "$state" && ids_log "pausado: cron (novas execuções agendadas não começam)"
  fi
  while running="$(pgrep -af -- "$IDS_WRITER_PROCESS_PATTERN" | grep -v -- "pgrep" || true)"; [[ -n "$running" ]]; do
    if (( waited >= IDS_WRITER_WAIT_SECONDS )); then
      ids_log "ERRO: rotinas ainda em execução após ${IDS_WRITER_WAIT_SECONDS}s:"
      printf '%s\n' "$running" | sed 's/^/[deploy-safety]   /'
      return 40
    fi
    if (( waited % 60 == 0 )); then ids_log "aguardando rotinas em execução terminarem (${waited}s)"; fi
    sleep "$IDS_WRITER_POLL_SECONDS"
    waited=$(( waited + IDS_WRITER_POLL_SECONDS ))
  done
  if [[ -n "$db" ]]; then
    sessions="$(ids_foreign_sessions "$db")" || return 41
    if [[ -n "$sessions" ]]; then
      ids_log "ERRO: ainda há sessões no banco $db (pid|usuário|aplicação|origem):"
      printf '%s\n' "$sessions" | sed 's/^/[deploy-safety]   /'
      return 41
    fi
  fi
  ids_log "escritores pausados e banco sem sessões"
}

# Retoma exatamente o que ids_pause_writers parou (idempotente; chamar no fim do deploy E do rollback).
ids_resume_writers() {
  local state="$1" kind unit rc=0
  [[ -f "$state" ]] || return 0
  while read -r kind unit; do
    [[ "$kind" == unit && -n "$unit" ]] || continue
    if $IDS_SYSTEMCTL start "$unit"; then
      ids_log "retomado: $unit"
    else
      ids_log "ERRO: não foi possível retomar $unit"
      rc=42
    fi
  done < <(tac "$state" 2>/dev/null || cat "$state")
  [[ "$rc" == 0 ]] && : > "$state"
  return "$rc"
}

# ---------------------------------------------------------------------------------------------------------
# Backup + cerca de escrita (G2)
# ---------------------------------------------------------------------------------------------------------

# Diretório do backup desta execução, do usuário do banco; pais com 0711 (atravessar, sem listar).
ids_prepare_backup_dir() {
  local root="$1" ts="$2" dir
  install -d -m 0711 "$(dirname "$root")" "$root"
  dir="$root/$ts"
  if [[ -n "$IDS_PG_USER" ]]; then
    install -d -m 0700 -o "$IDS_PG_USER" -g "$IDS_PG_USER" "$dir"
  else
    install -d -m 0700 "$dir"
  fi
  printf '%s\n' "$dir"
}

# Confere o dump COMO o usuário que fará o restore. ≠ 0 se ilegível ou sem tabelas.
ids_assert_backup_readable() {
  local dump="$1" listing tables
  if ! listing="$($IDS_PG pg_restore -l "$dump" 2>&1)"; then
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
# conexões, ACL (concessões normalizadas, sem o concedente) e configurações por banco. Uma linha, sem o nome
# do banco — comparável entre o original e o restaurado.
ids_db_meta() {
  ids_psql postgres "SELECT format('encoding=%s|collate=%s|ctype=%s|locprovider=%s|owner=%s|connlimit=%s|aclset=%s|settings=%s', pg_encoding_to_char(d.encoding), d.datcollate, d.datctype, d.datlocprovider, pg_get_userbyid(d.datdba), d.datconnlimit, (SELECT string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type, ',' ORDER BY CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type) FROM aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a), coalesce((SELECT md5(string_agg(c, chr(31) ORDER BY c)) FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE s.setdatabase = d.oid AND s.setrole = 0), 'none')) FROM pg_database d WHERE d.datname = '$1'"
}

# Impressão digital do conteúdo: tabelas (dono, ACL, linhas exatas), colunas, índices, constraints, sequências
# (valor), triggers, views, funções, extensões e migrations Prisma. Ordenada, uma linha por objeto.
# Nomes sem esquema nas definições seguem o search_path do banco, por isso as configurações do banco são
# copiadas para o restaurado ANTES desta conferência.
ids_db_fingerprint() {
  local migrations="" has
  # A tabela de migrations só entra se existir (referenciá-la ausente faria a consulta inteira falhar).
  has="$(ids_psql "$1" "SELECT to_regclass('public._prisma_migrations') IS NOT NULL")" || return 1
  if [[ "$has" == "t" ]]; then
    migrations="UNION ALL SELECT format('migration|%s|finished=%s|rolledback=%s', migration_name, finished_at IS NOT NULL, rolled_back_at IS NOT NULL) FROM public._prisma_migrations"
  fi
  ids_psql "$1" "WITH t AS (SELECT c.oid, n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%')
SELECT line FROM (
  SELECT format('table|%s.%s|owner=%s|acl=%s|rows=%s', t.nspname, t.relname, pg_get_userbyid(c.relowner), coalesce(c.relacl::text,''), (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', t.nspname, t.relname), false, true, '')))[1]::text) AS line FROM t JOIN pg_class c ON c.oid = t.oid
  UNION ALL SELECT format('column|%s.%s|%s|%s|notnull=%s|default=%s', t.nspname, t.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(ad.adbin, ad.adrelid),'')) FROM t JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  UNION ALL SELECT format('index|%s.%s|%s', schemaname, indexname, indexdef) FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema')
  UNION ALL SELECT format('constraint|%s|%s|%s', conrelid::regclass, conname, pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace NOT IN (SELECT oid FROM pg_namespace WHERE nspname IN ('pg_catalog','information_schema'))
  UNION ALL SELECT format('sequence|%s.%s|owner=%s|last=%s', schemaname, sequencename, sequenceowner, coalesce(last_value::text,'null')) FROM pg_sequences
  UNION ALL SELECT format('trigger|%s|%s|%s', tgrelid::regclass, tgname, pg_get_triggerdef(oid)) FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT format('view|%s.%s|owner=%s|%s', schemaname, viewname, viewowner, md5(definition)) FROM pg_views WHERE schemaname NOT IN ('pg_catalog','information_schema')
  UNION ALL SELECT format('function|%s|owner=%s|%s', p.oid::regprocedure, pg_get_userbyid(p.proowner), md5(pg_get_functiondef(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND p.prokind IN ('f','p')
  UNION ALL SELECT format('extension|%s|%s', extname, extversion) FROM pg_extension
  ${migrations}
) x ORDER BY line"
}

# Só a parte estrutural (sem contagem de linhas nem valores de sequência): detecta se o deploy mudou o banco.
ids_schema_fingerprint() {
  ids_db_fingerprint "$1" | sed -E 's/\|rows=[0-9]+$//; s/\|last=[^|]*$//'
}

# Backup completo (donos e permissões), conferido como postgres, com metadados, impressão digital e cerca de
# escrita. ≠ 0 aborta o deploy antes de qualquer mudança.
ids_backup_db() {
  local db="$1" dump="$2" dir xid_before xid_after
  dir="$(dirname "$dump")"
  xid_before="$(ids_next_xid "$db")" || { ids_log "ERRO: não consegui ler o XID de $db"; return 30; }
  $IDS_PG pg_dump -Fc -Z 6 -d "$db" -f "$dump" || { ids_log "ERRO: pg_dump falhou"; return 30; }
  ids_assert_backup_readable "$dump" || return $?
  ids_db_meta "$db" > "$dir/db-meta.txt" || return 30
  ids_db_fingerprint "$db" > "$dir/fingerprint-before.txt" || return 30
  ids_schema_fingerprint "$db" > "$dir/schema-before.txt" || return 30
  xid_after="$(ids_next_xid "$db")" || return 30
  if [[ "$xid_before" != "$xid_after" ]]; then
    ids_log "ERRO: o banco recebeu escritas durante o backup (XID $xid_before → $xid_after); escritores não estavam pausados"
    return 39
  fi
  printf '%s\n' "$xid_before" > "$dir/xid-at-backup"
  ids_log "backup íntegro; cerca de escrita no XID $xid_before"
}

# Chamar IMEDIATAMENTE antes de `prisma migrate deploy`. Recusa (≠ 0) se houve escrita desde o backup ou se
# há sessões no banco: nesse caso o backup não representa o estado atual e o deploy deve parar aqui.
ids_mark_db_changes_started() {
  local dir="$1" db="$2" xid sessions
  xid="$(ids_next_xid "$db")" || return 43
  if [[ "$xid" != "$(cat "$dir/xid-at-backup" 2>/dev/null)" ]]; then
    ids_log "ERRO: houve escrita no banco depois do backup (XID $(cat "$dir/xid-at-backup" 2>/dev/null) → $xid); migrations NÃO serão aplicadas"
    return 43
  fi
  sessions="$(ids_foreign_sessions "$db")" || return 43
  if [[ -n "$sessions" ]]; then
    ids_log "ERRO: sessões abertas no banco antes das migrations:"
    printf '%s\n' "$sessions" | sed 's/^/[deploy-safety]   /'
    return 43
  fi
  printf '%s\n' "$xid" > "$dir/$IDS_MARKER_NAME"
  ids_log "início das alterações do banco registrado (XID $xid)"
}

# Chamar imediatamente antes de subir a aplicação nova: a partir daqui pode haver escrita de negócio.
ids_mark_app_starting() {
  date -u +%Y-%m-%dT%H:%M:%SZ > "$1/$IDS_APP_MARKER_NAME"
}

ids_db_changed_by_deploy() {
  [[ -f "$1/$IDS_MARKER_NAME" ]]
}

# ---------------------------------------------------------------------------------------------------------
# Restauração (G4/G5)
# ---------------------------------------------------------------------------------------------------------

ids_meta_field() {
  # $1 = linha de metadados, $2 = campo
  printf '%s\n' "$1" | tr '|' '\n' | sed -n "s/^$2=//p"
}

# Journal da troca: permite recuperar qualquer interrupção.
ids_journal() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" >> "$1/restore-journal"
}

ids_restore_db_safely() {
  local db="$1" dump="$2" ts="$3" dir meta staging failed owner diff_file
  dir="$(dirname "$dump")"
  staging="${db}__rollback_${ts}"
  failed="${db}__failed_${ts}"
  [[ -f "$dir/db-meta.txt" && -f "$dir/fingerprint-before.txt" ]] || { ids_log "ERRO: backup sem metadados/impressão digital"; return 33; }
  ids_assert_backup_readable "$dump" || return $?
  meta="$(cat "$dir/db-meta.txt")"
  owner="$(ids_meta_field "$meta" owner)"
  if [[ "$(ids_meta_field "$meta" locprovider)" != "c" ]]; then
    ids_log "ERRO: banco com provedor de collation '$(ids_meta_field "$meta" locprovider)' (não libc): restauração automática não suportada; $db intocado"
    return 33
  fi
  ids_journal "$dir" "restore-start db=$db staging=$staging"

  # 1. Banco novo com as mesmas propriedades do original (encoding/collation do backup, não do template).
  if ! $IDS_PG createdb -T template0 -E "$(ids_meta_field "$meta" encoding)" \
      --lc-collate="$(ids_meta_field "$meta" collate)" --lc-ctype="$(ids_meta_field "$meta" ctype)" \
      -O "$owner" "$staging"; then
    ids_log "ERRO: não foi possível criar $staging; banco $db intocado"
    return 33
  fi
  ids_journal "$dir" "staging-created"

  # 2. Restauração completa (donos e permissões preservados).
  if ! $IDS_PG pg_restore --exit-on-error --dbname="$staging" "$dump"; then
    ids_log "ERRO: restore em $staging falhou; banco $db intocado ($staging mantido para análise)"
    return 34
  fi
  # 3. Propriedades de nível de banco copiadas do original (que ainda existe): limite de conexões,
  #    configurações (ALTER DATABASE … SET) e concessões. Conferidas abaixo contra o estado do backup.
  ids_psql postgres "ALTER DATABASE \"$staging\" CONNECTION LIMIT $(ids_meta_field "$meta" connlimit)" >/dev/null || return 34
  #    Parâmetros de lista (search_path etc.) já estão gravados na sintaxe de SET ("$user", public) e vão sem
  #    aspas — entre aspas virariam um único elemento; os demais vão como literal (mesma regra do pg_dumpall).
  local -a stmts=()
  mapfile -t stmts < <(ids_psql postgres "SELECT format('ALTER DATABASE %I SET %s TO %s', '$staging', split_part(c, '=', 1), CASE WHEN split_part(c, '=', 1) IN ('search_path', 'temp_tablespaces', 'session_preload_libraries', 'local_preload_libraries') THEN substr(c, strpos(c, '=') + 1) ELSE quote_literal(substr(c, strpos(c, '=') + 1)) END) FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE s.setrole = 0 AND s.setdatabase = (SELECT oid FROM pg_database WHERE datname = '$db')
UNION ALL SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', '$staging') FROM pg_database WHERE datname = '$db' AND datacl IS NOT NULL
UNION ALL SELECT format('GRANT %s ON DATABASE %I TO %s', a.privilege_type, '$staging', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END) FROM pg_database d, aclexplode(d.datacl) a WHERE d.datname = '$db'") || return 34
  local stmt
  for stmt in "${stmts[@]}"; do
    [[ -n "$stmt" ]] || continue
    ids_psql postgres "$stmt" >/dev/null || { ids_log "ERRO: falhou ao aplicar em $staging: $stmt"; return 34; }
  done

  # 4. Conferência integral ANTES da troca: conteúdo e propriedades do banco iguais aos do backup.
  diff_file="$dir/restore-verification.diff"
  if ! diff <(cat "$dir/fingerprint-before.txt") <(ids_db_fingerprint "$staging") > "$diff_file"; then
    ids_log "ERRO: banco restaurado difere do backup (ver $diff_file); troca NÃO realizada; $db intocado"
    return 38
  fi
  if ! diff <(printf '%s\n' "$meta") <(ids_db_meta "$staging") >> "$diff_file"; then
    ids_log "ERRO: propriedades do banco restaurado diferem do backup (ver $diff_file); troca NÃO realizada; $db intocado"
    return 38
  fi
  ids_journal "$dir" "verified"

  # 5. Troca atômica: fecha os dois bancos para conexões, encerra sessões e renomeia numa única transação.
  ids_psql postgres "ALTER DATABASE \"$db\" WITH ALLOW_CONNECTIONS false" >/dev/null || return 35
  ids_psql postgres "ALTER DATABASE \"$staging\" WITH ALLOW_CONNECTIONS false" >/dev/null || return 35
  ids_journal "$dir" "connections-closed"
  ids_psql postgres "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname IN ('$db','$staging') AND pid <> pg_backend_pid()" >/dev/null || true
  if ! ids_psql_tx postgres "ALTER DATABASE \"$db\" RENAME TO \"$failed\"; ALTER DATABASE \"$staging\" RENAME TO \"$db\";" >/dev/null; then
    ids_psql postgres "ALTER DATABASE \"$db\" WITH ALLOW_CONNECTIONS true" >/dev/null || true
    ids_journal "$dir" "swap-failed reopened=$db"
    ids_log "ERRO: troca não concluída (transação desfeita); $db reaberto e intocado; restaurado disponível em $staging"
    return 36
  fi
  ids_journal "$dir" "swapped failed=$failed"
  ids_psql postgres "ALTER DATABASE \"$db\" WITH ALLOW_CONNECTIONS true" >/dev/null || { ids_log "ERRO: $db restaurado mas fechado para conexões — rode ids_recover_db_state"; return 44; }
  ids_psql postgres "ALTER DATABASE \"$failed\" WITH ALLOW_CONNECTIONS true" >/dev/null || true
  ids_journal "$dir" "done"
  ids_log "banco $db restaurado e conferido; estado anterior preservado em $failed (remover só após conferência)"
}

# Recupera interrupções (queda do processo/servidor) em qualquer ponto da restauração. Idempotente.
ids_recover_db_state() {
  local db="$1" dir="$2" exists allow
  exists="$(ids_psql postgres "SELECT count(*) FROM pg_database WHERE datname = '$db'")" || return 45
  if [[ "$exists" != 1 ]]; then
    ids_log "ERRO: banco $db não existe; candidatos (NÃO alterados automaticamente):"
    ids_psql postgres "SELECT datname FROM pg_database WHERE datname LIKE '${db}\_\_%' ORDER BY datname" | sed 's/^/[deploy-safety]   /'
    return 45
  fi
  allow="$(ids_psql postgres "SELECT datallowconn FROM pg_database WHERE datname = '$db'")" || return 45
  if [[ "$allow" != "t" && "$allow" != "true" ]]; then
    ids_psql postgres "ALTER DATABASE \"$db\" WITH ALLOW_CONNECTIONS true" >/dev/null || return 45
    [[ -n "$dir" ]] && ids_journal "$dir" "recovered reopened=$db"
    ids_log "recuperado: $db voltou a aceitar conexões ($(tail -n 2 "$dir/restore-journal" 2>/dev/null | head -1 | cut -d' ' -f2-))"
  else
    ids_log "estado consistente: $db existe e aceita conexões"
  fi
}

# Decide se o banco deve ser restaurado (G3) e restaura. Retorno: 0 = nada a restaurar ou restaurado;
# 2 = decisão manual (diagnóstico impresso); outro ≠ 0 = falha da restauração (banco atual intocado).
ids_rollback_db_if_needed() {
  local dir="$1" db="$2" dump="$3" ts="$4" changed
  ids_recover_db_state "$db" "$dir" || return $?
  if ! ids_db_changed_by_deploy "$dir"; then
    ids_log "banco não foi alterado por este deploy (falha antes das migrations): restauração NÃO executada"
    return 0
  fi
  if diff -q <(cat "$dir/schema-before.txt") <(ids_schema_fingerprint "$db") >/dev/null; then
    ids_log "schema e migrations iguais ao backup: nenhuma migration foi aplicada; restauração NÃO executada"
    return 0
  fi
  changed="$(diff <(cat "$dir/schema-before.txt") <(ids_schema_fingerprint "$db") | grep -c '^[<>]' || true)"
  if [[ -f "$dir/$IDS_APP_MARKER_NAME" ]]; then
    ids_log "DECISÃO MANUAL: o schema mudou ($changed diferença(s)) e a aplicação nova chegou a subir ($(cat "$dir/$IDS_APP_MARKER_NAME"));"
    ids_log "  pode haver escrita de negócio depois do backup. Nada foi restaurado. Para restaurar após avaliar:"
    ids_log "  source /usr/local/lib/induscost/induscost-deploy-safety.sh && ids_restore_db_safely $db $dump $ts"
    return 2
  fi
  ids_log "schema mudou ($changed diferença(s)) e a aplicação nova não subiu: restaurando o backup"
  ids_restore_db_safely "$db" "$dump" "$ts"
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
