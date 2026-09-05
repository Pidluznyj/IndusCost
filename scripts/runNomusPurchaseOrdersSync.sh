#!/usr/bin/env bash
# Runner oficial do espelho de Pedidos de Compra Nomus (`GET /rest/pedidoscompra`).
# Read-only no ERP. Lock global Nomus + lock próprio para evitar sobreposição.
set -Eeuo pipefail

APP_DIR="${INDUSCOST_APP_DIR:-/opt/induscost}"
LOG_DIR="${NOMUS_SYNC_LOG_DIR:-/tmp/induscost-nomus-sync}"
GLOBAL_LOCK_FILE="${NOMUS_SYNC_LOCK_FILE:-/tmp/induscost-nomus-sync-global.lock}"
LOCK_FILE="${NOMUS_PO_SYNC_LOCK_FILE:-/tmp/induscost-nomus-purchase-orders.lock}"
MODE="${1:-apply}"
STRATEGY="${2:-incremental}"

case "$MODE" in
  preview|apply|dry)
    ;;
  *)
    echo "[nomus-purchase-orders-runner] ERRO: modo inválido: $MODE. Use: preview|apply|dry."
    exit 2
    ;;
esac

if [[ "$MODE" == "dry" ]]; then
  MODE="preview"
fi

case "$STRATEGY" in
  incremental|backfill)
    ;;
  *)
    STRATEGY="incremental"
    ;;
esac

mkdir -p "$LOG_DIR"

RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="$LOG_DIR/runner-purchase-orders_${MODE}_${STRATEGY}_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

echo "=== NOMUS PURCHASE ORDERS RUNNER ==="
echo "MODE=$MODE"
echo "STRATEGY=$STRATEGY"
echo "APP_DIR=$APP_DIR"
echo "LOG_DIR=$LOG_DIR"
echo "RUN_LOG=$RUN_LOG"
echo "STARTED_AT=$(date -Iseconds)"

cd "$APP_DIR"

echo
echo "=== LOCK GLOBAL NOMUS ==="
exec 8>"$GLOBAL_LOCK_FILE"
if ! flock -n 8; then
  echo "[nomus-purchase-orders-runner] SKIPPED: lock global Nomus ocupado ($GLOBAL_LOCK_FILE)."
  echo "FINISHED_AT=$(date -Iseconds)"
  echo "EXIT_CODE=0"
  exit 0
fi
echo "[nomus-purchase-orders-runner] Lock global adquirido: $GLOBAL_LOCK_FILE"

echo
echo "=== LOCK (Pedidos de Compra) ==="
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[nomus-purchase-orders-runner] SKIPPED: outra execução de Pedidos de Compra ainda está em andamento."
  echo "FINISHED_AT=$(date -Iseconds)"
  echo "EXIT_CODE=0"
  exit 0
fi
echo "[nomus-purchase-orders-runner] Lock próprio adquirido: $LOCK_FILE"

echo
echo "=== CONFIGURAÇÃO ==="
export NOMUS_SYNC_LOG_DIR="$LOG_DIR"
export NOMUS_PO_RUNNER_LOG="$RUN_LOG"
if [[ "$STRATEGY" == "incremental" ]]; then
  export NOMUS_PO_INCREMENTAL=1
fi

echo
echo "=== EXECUÇÃO ==="
set +e
if [[ "$STRATEGY" == "backfill" ]]; then
  npm run "nomus:purchase-orders:backfill:${MODE}"
else
  npm run "nomus:purchase-orders:${MODE}"
fi
EXIT_CODE=$?
set -e

echo
echo "=== RESULTADO ==="
echo "EXIT_CODE=$EXIT_CODE"
echo "FINISHED_AT=$(date -Iseconds)"

exit "$EXIT_CODE"
