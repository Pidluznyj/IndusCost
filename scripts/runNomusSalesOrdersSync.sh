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
    echo "[nomus-sales-orders-runner] ERRO: modo inválido: $MODE. Use: dry ou apply."
    exit 2
    ;;
esac

mkdir -p "$LOG_DIR"

RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="$LOG_DIR/runner-sales-orders_${MODE}_${RUN_STAMP}.log"

# Mostra no terminal quando rodado manualmente e também grava log.
exec > >(tee -a "$RUN_LOG") 2>&1

echo "=== NOMUS SALES ORDERS RUNNER ==="
echo "MODE=$MODE"
echo "APP_DIR=$APP_DIR"
echo "LOG_DIR=$LOG_DIR"
echo "RUN_LOG=$RUN_LOG"
echo "STARTED_AT=$(date -Iseconds)"

cd "$APP_DIR"

echo
echo "=== VALIDANDO AMBIENTE ==="
echo "PWD=$(pwd)"
echo "NODE=$(command -v node || true)"
echo "NPM=$(command -v npm || true)"
node --version
npm --version

echo
echo "=== LOCK ==="
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[nomus-sales-orders-runner] SKIPPED: outra execução ainda está em andamento."
  echo "FINISHED_AT=$(date -Iseconds)"
  exit 0
fi
echo "[nomus-sales-orders-runner] Lock adquirido: $LOCK_FILE"

echo
echo "=== CONFIGURAÇÃO SEGURA DO BLOCO ==="
export NOMUS_SYNC_LOG_DIR="$LOG_DIR"
export NOMUS_SALES_ORDERS_PAGE_CURSOR_FILE="${NOMUS_SALES_ORDERS_PAGE_CURSOR_FILE:-/tmp/induscost-nomus-sales-orders-page.cursor}"
export NOMUS_SALES_ORDERS_MAX_PAGES="${NOMUS_SALES_ORDERS_MAX_PAGES:-5}"

echo "NOMUS_SYNC_LOG_DIR=$NOMUS_SYNC_LOG_DIR"
echo "NOMUS_SALES_ORDERS_PAGE_CURSOR_FILE=$NOMUS_SALES_ORDERS_PAGE_CURSOR_FILE"
echo "NOMUS_SALES_ORDERS_MAX_PAGES=$NOMUS_SALES_ORDERS_MAX_PAGES"

echo
echo "=== EXECUÇÃO ==="
set +e
npm run "sync:nomus:all:${MODE}" -- --only=sales-orders
EXIT_CODE=$?
set -e

echo
echo "=== RESULTADO ==="
echo "EXIT_CODE=$EXIT_CODE"
echo "FINISHED_AT=$(date -Iseconds)"

exit "$EXIT_CODE"
