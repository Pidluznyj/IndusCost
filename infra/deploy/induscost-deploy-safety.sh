#!/usr/bin/env bash
# Biblioteca de segurança dos executores de deploy do IndusCost (produção AWS e homologação).
#
# Uso: os executores (/usr/local/bin/deploy-induscost-producao, induscost-deploy-homologacao) fazem
#   source /opt/induscost/infra/deploy/induscost-deploy-safety.sh
# e trocam os trechos de backup, gate de testes e rollback do banco pelas funções abaixo.
#
# Garantias (incidente de 26/10/2026: um teste falhou, o rollback apagou o banco e não conseguiu
# restaurar porque o postgres não lia o backup):
#   1. Backup gravado DIRETO como postgres e verificado COMO postgres antes de qualquer mudança;
#      backup ilegível ou sem tabelas aborta o deploy antes do código novo.
#   2. O banco só é restaurado se o deploy chegou a alterá-lo (marcador gravado imediatamente antes de
#      `prisma migrate deploy`). Falha em teste/build antes das migrations nunca toca no banco.
#   3. Restauração NÃO destrutiva: restaura num banco novo; só depois troca os nomes. O banco atual é
#      preservado como <db>__failed_<ts>. Nenhum `dropdb` nesta biblioteca.
#   4. Gate de testes isolado: sem .env, banco inalcançável, credenciais externas vazias e locks em
#      diretório temporário — teste nenhum consegue tocar banco, Nomus, e-mail ou locks reais.
#
# Variáveis: IDS_PG (prefixo para rodar como postgres; padrão `runuser -u postgres --`),
# IDS_PG_USER (dono do diretório de backup; padrão postgres).

IDS_PG="${IDS_PG-runuser -u postgres --}"
IDS_PG_USER="${IDS_PG_USER-postgres}"
IDS_MARKER_NAME="db-changes-started"

ids_log() {
  echo "[deploy-safety] $*"
}

# Diretório do backup desta execução, legível pelo usuário do banco. Pais com 0711 (atravessar, sem listar).
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

# Confere o dump COMO o usuário que fará o restore. Retorna ≠ 0 se ilegível ou sem tabelas.
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
  ids_log "backup legível pelo usuário do restore: $tables tabela(s)"
}

# pg_dump direto no diretório final (sem mv entre donos) + verificação. ≠ 0 aborta o deploy.
ids_backup_db() {
  local db="$1" dump="$2"
  $IDS_PG pg_dump -Fc -Z 6 --no-owner --no-acl -d "$db" -f "$dump" || {
    ids_log "ERRO: pg_dump falhou"
    return 30
  }
  ids_assert_backup_readable "$dump"
}

# Chamar IMEDIATAMENTE antes de `prisma migrate deploy` (ou de qualquer escrita de deploy no banco).
ids_mark_db_changes_started() {
  : > "$1/$IDS_MARKER_NAME"
}

ids_db_changed_by_deploy() {
  [[ -f "$1/$IDS_MARKER_NAME" ]]
}

ids_psql() {
  $IDS_PG psql -d postgres -v ON_ERROR_STOP=1 -Atc "$1"
}

# Restaura sem destruir: banco novo ← dump; troca de nomes; o banco atual fica preservado.
ids_restore_db_safely() {
  local db="$1" owner="$2" dump="$3" ts="$4"
  local staging="${db}__rollback_${ts}" failed="${db}__failed_${ts}" attempt
  ids_assert_backup_readable "$dump" || return $?
  if ! $IDS_PG createdb -O "$owner" "$staging"; then
    ids_log "ERRO: não foi possível criar o banco temporário $staging; banco $db intocado"
    return 33
  fi
  if ! $IDS_PG pg_restore --dbname="$staging" --no-owner --no-acl --role="$owner" --exit-on-error "$dump"; then
    ids_log "ERRO: restore no banco temporário falhou; banco $db intocado ($staging mantido para análise)"
    return 34
  fi
  for attempt in 1 2 3; do
    ids_psql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$db','$staging') AND pid <> pg_backend_pid();" >/dev/null || true
    if ids_psql "ALTER DATABASE \"$db\" RENAME TO \"$failed\";" >/dev/null; then
      if ids_psql "ALTER DATABASE \"$staging\" RENAME TO \"$db\";" >/dev/null; then
        ids_log "banco $db restaurado do backup; estado anterior preservado em $failed (remover só após conferência)"
        return 0
      fi
      ids_psql "ALTER DATABASE \"$failed\" RENAME TO \"$db\";" >/dev/null || true
      ids_log "ERRO: troca de nomes falhou; $db voltou ao nome original; restaurado disponível em $staging"
      return 36
    fi
    sleep 2
  done
  ids_log "ERRO: conexões ativas impediram a troca; $db intocado; restaurado disponível em $staging"
  return 35
}

# Rollback do banco somente quando este deploy alterou o banco.
ids_rollback_db_if_needed() {
  local backup_dir="$1" db="$2" owner="$3" dump="$4" ts="$5"
  if ! ids_db_changed_by_deploy "$backup_dir"; then
    ids_log "banco não foi alterado por este deploy (falha antes das migrations): restauração do banco NÃO executada"
    return 0
  fi
  ids_restore_db_safely "$db" "$owner" "$dump" "$ts"
}

# Gate de testes: mesmos arquivos, mas sem nenhum acesso a recursos reais do servidor.
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
