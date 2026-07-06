#!/usr/bin/env bash
# Backup read-only do PostgreSQL antes de deploy (IndusCost).
#
# Uso:
#   ./scripts/backupDatabaseBeforeDeploy.sh --reason=pre_deploy_frota
#   BACKUP_DIR=/var/backups/induscost ./scripts/backupDatabaseBeforeDeploy.sh --reason=hotfix
#
# Requer: pg_dump, pg_restore (client), DATABASE_URL no ambiente ou em .env
# Não contém senhas. Não altera o banco.
set -euo pipefail

ROOT="${INDUSCOST_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/induscost-backups}"
REASON=""

log() { echo "[backup-pre-deploy] $*"; }
fail() { echo "[backup-pre-deploy] FALHA: $*" >&2; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --reason=*) REASON="${arg#--reason=}" ;;
    -h|--help)
      echo "Uso: $0 --reason=MOTIVO_OBRIGATORIO"
      echo "  BACKUP_DIR=/caminho (padrão: /tmp/induscost-backups)"
      echo "  INDUSCOST_ROOT=/opt/induscost (padrão: raiz do repo)"
      exit 0
      ;;
    *)
      fail "Argumento desconhecido: $arg (use --reason=...)"
      ;;
  esac
done

[[ -n "${REASON// }" ]] || fail "Informe --reason= (ex.: --reason=pre_deploy_frota)"

if ! command -v pg_dump >/dev/null 2>&1; then
  fail "pg_dump não encontrado no PATH"
fi
if ! command -v pg_restore >/dev/null 2>&1; then
  fail "pg_restore não encontrado no PATH"
fi

cd "$ROOT"

if [[ -z "${DATABASE_URL:-}" ]] && [[ -f "${ROOT}/.env" ]]; then
  # Carrega só DATABASE_URL sem exibir valor
  line=$(grep -E '^DATABASE_URL=' "${ROOT}/.env" | tail -1 || true)
  if [[ -n "$line" ]]; then
    val="${line#DATABASE_URL=}"
    val="${val%\"}"
    val="${val#\"}"
    val="${val%\'}"
    val="${val#\'}"
    export DATABASE_URL="$val"
  fi
fi

[[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL não definida (exporte ou configure .env em $ROOT)"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

TS=$(date +%Y%m%d_%H%M%S)
SAFE_REASON=$(echo "$REASON" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9_' '_' | sed 's/^_//;s/_$//' | cut -c1-48)
[[ -n "$SAFE_REASON" ]] || SAFE_REASON="backup"

OUTFILE="${BACKUP_DIR}/teste_bi_${TS}_${SAFE_REASON}.dump"

log "Iniciando pg_dump (formato custom)..."
log "Destino: $OUTFILE"
log "Motivo: $REASON"

if ! pg_dump "$DATABASE_URL" -Fc --no-owner --no-acl -f "$OUTFILE"; then
  fail "pg_dump falhou"
fi

if [[ ! -s "$OUTFILE" ]]; then
  fail "Arquivo de backup vazio: $OUTFILE"
fi

if ! pg_restore --list "$OUTFILE" >/dev/null 2>&1; then
  fail "Validação pg_restore --list falhou — dump pode estar corrompido"
fi

OBJECT_COUNT=$(pg_restore --list "$OUTFILE" 2>/dev/null | wc -l | tr -d ' ')
FILE_SIZE=$(ls -lh "$OUTFILE" | awk '{print $5}')

log "OK: backup validado"
log "  Arquivo: $OUTFILE"
log "  Tamanho: $FILE_SIZE"
log "  Objetos listados (pg_restore --list): $OBJECT_COUNT"
log "Não execute restore em produção sem autorização."

exit 0
