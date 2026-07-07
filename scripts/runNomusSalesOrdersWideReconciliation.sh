#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/induscost"
LOG_DIR="${NOMUS_SYNC_LOG_DIR:-/tmp/induscost-nomus-sync}"
LOCK_FILE="/tmp/induscost-nomus-sync-global.lock"
MODE="${1:-apply}"

case "$MODE" in
  dry|apply)
    ;;
  *)
    echo "[nomus-sales-orders-reconciliation] ERRO: modo inválido: $MODE. Use: dry ou apply."
    exit 2
    ;;
esac

mkdir -p "$LOG_DIR"

RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="$LOG_DIR/runner-sales-orders-reconciliation_${MODE}_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

echo "=== NOMUS SALES ORDERS WIDE RECONCILIATION ==="
echo "MODE=$MODE"
echo "STARTED_AT=$(date -Iseconds)"

cd "$APP_DIR"

echo
echo "=== LOCK ==="
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[nomus-sales-orders-reconciliation] SKIPPED: outra execução ainda está em andamento."
  exit 0
fi

echo
echo "=== CONFIGURAÇÃO RECONCILIAÇÃO AMPLA ==="
export NOMUS_SYNC_LOG_DIR="$LOG_DIR"
export NOMUS_SALES_ORDERS_SYNC_STRATEGY="full-reconciliation"
export NOMUS_SALES_ORDERS_PAGE_CURSOR_FILE="${NOMUS_SALES_ORDERS_PAGE_CURSOR_FILE:-/tmp/induscost-nomus-sales-orders-page.cursor}"
export NOMUS_SALES_ORDERS_MAX_PAGES="${NOMUS_SALES_ORDERS_MAX_PAGES:-5}"
export NOMUS_PEDIDO_DATA_EMISSAO_INICIAL="${NOMUS_PEDIDO_DATA_EMISSAO_INICIAL:-01/01/2020}"
export NOMUS_PEDIDO_DATA_EMISSAO_FINAL="${NOMUS_PEDIDO_DATA_EMISSAO_FINAL:-31/12/2030}"

echo "NOMUS_SALES_ORDERS_SYNC_STRATEGY=$NOMUS_SALES_ORDERS_SYNC_STRATEGY"
echo "NOMUS_SALES_ORDERS_PAGE_CURSOR_FILE=$NOMUS_SALES_ORDERS_PAGE_CURSOR_FILE"
echo "NOMUS_SALES_ORDERS_MAX_PAGES=$NOMUS_SALES_ORDERS_MAX_PAGES"

echo
echo "=== EXECUÇÃO ==="
set +e
npm run "sync:nomus:sales-orders:${MODE}" -- --strategy=full-reconciliation
EXIT_CODE=$?
set -e

echo
echo "EXIT_CODE=$EXIT_CODE"
echo "FINISHED_AT=$(date -Iseconds)"
exit "$EXIT_CODE"
