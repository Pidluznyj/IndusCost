#!/usr/bin/env bash
# Runner oficial — rebuild OrderToCashAudit (Pedido → Caixa).
# Não chama Nomus. Usa somente a base local já sincronizada.
# Alimenta as abas: Conciliação | Inteligência | Auditoria Pedido → Caixa
#
# Uso:
#   bash scripts/runOrderToCashAuditRebuild.sh preview 2025-06-01 2026-12-31
#   bash scripts/runOrderToCashAuditRebuild.sh apply 2025-06-01 2026-12-31
#   bash scripts/runOrderToCashAuditRebuild.sh preview --customerExternalId 200 --year 2026
#   bash scripts/runOrderToCashAuditRebuild.sh apply --customerExternalId 200 --year 2026
#   bash scripts/runOrderToCashAuditRebuild.sh apply --from 2025-06-01 --to 2026-12-31 --fail-if-sync-active
#
# Docs: docs/finance/order-to-cash-audit-rebuild-official.md
set -Eeuo pipefail

APP_DIR="${INDUSCOST_APP_DIR:-/opt/induscost}"
PRIMARY_LOG_DIR="${ORDER_TO_CASH_AUDIT_LOG_DIR:-/var/log/induscost/order-to-cash-audit}"
FALLBACK_LOG_DIR="${ORDER_TO_CASH_AUDIT_LOG_DIR_FALLBACK:-/tmp/induscost-order-to-cash-audit}"
LOCK_FILE="${ORDER_TO_CASH_AUDIT_LOCK_FILE:-/tmp/induscost-order-to-cash-audit-rebuild.lock}"

if [[ $# -lt 1 ]]; then
  echo "[order-to-cash-audit-runner] ERRO: informe o modo."
  echo "Uso: $0 preview|apply [FROM TO] [flags...]"
  echo "  ou: $0 preview|apply --from YYYY-MM-DD --to YYYY-MM-DD [flags...]"
  echo "  ou: $0 preview|apply --customerExternalId N --year YYYY [flags...]"
  exit 2
fi

MODE="$1"
shift

case "$MODE" in
  preview|apply)
    ;;
  *)
    echo "[order-to-cash-audit-runner] ERRO: modo inválido: $MODE. Use: preview ou apply."
    exit 2
    ;;
esac

TSX_ARGS=(--mode "$MODE")

# Atalho posicional: MODE FROM TO  (compatível com o procedimento temporário)
if [[ $# -ge 2 && "$1" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ && "$2" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  TSX_ARGS+=(--from "$1" --to "$2")
  shift 2
fi

# Flags restantes passam direto ao TS
TSX_ARGS+=("$@")

LOG_DIR="$PRIMARY_LOG_DIR"
if ! mkdir -p "$LOG_DIR" 2>/dev/null; then
  LOG_DIR="$FALLBACK_LOG_DIR"
  mkdir -p "$LOG_DIR"
  echo "[order-to-cash-audit-runner] AVISO: não foi possível criar $PRIMARY_LOG_DIR — usando $LOG_DIR"
fi

RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
SAFE_MODE="$MODE"
RUN_LOG="$LOG_DIR/rebuild_${SAFE_MODE}_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

echo "=== ORDER TO CASH AUDIT REBUILD RUNNER ==="
echo "MODE=$MODE"
echo "APP_DIR=$APP_DIR"
echo "LOG_DIR=$LOG_DIR"
echo "RUN_LOG=$RUN_LOG"
echo "ARGS=${TSX_ARGS[*]}"
echo "STARTED_AT=$(date -Iseconds)"
echo "NOTE=Não chama Nomus. Lê somente base local. Grava OrderToCashAuditRun/Fact."

if [[ -d "$APP_DIR" ]]; then
  cd "$APP_DIR"
else
  # Desenvolvimento / worktree: roda a partir do cwd atual se /opt/induscost não existir
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "$SCRIPT_DIR/.."
  echo "[order-to-cash-audit-runner] AVISO: APP_DIR=$APP_DIR ausente — usando $(pwd)"
fi

echo
echo "=== VALIDANDO AMBIENTE ==="
echo "PWD=$(pwd)"
echo "NODE=$(command -v node || true)"
node --version || true

echo
echo "=== LOCK ==="
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[order-to-cash-audit-runner] SKIPPED: outra execução de rebuild O2C ainda está em andamento."
  echo "LOCK_FILE=$LOCK_FILE"
  echo "FINISHED_AT=$(date -Iseconds)"
  exit 0
fi
echo "[order-to-cash-audit-runner] Lock adquirido: $LOCK_FILE"

echo
echo "=== EXECUÇÃO ==="
set +e
npx tsx scripts/rebuildOrderToCashAudit.ts "${TSX_ARGS[@]}"
EXIT_CODE=$?
set -e

echo
echo "=== RESULTADO ==="
echo "EXIT_CODE=$EXIT_CODE"
echo "RUN_LOG=$RUN_LOG"
echo "FINISHED_AT=$(date -Iseconds)"

exit "$EXIT_CODE"
