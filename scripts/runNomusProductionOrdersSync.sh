#!/usr/bin/env bash
set -Eeuo pipefail

# Runner operacional de Ordens de Produção Nomus (OP-11).
# Serializa via flock dedicado + Node lock compartilhado (backfill/incremental).

APP_DIR="${INDUSCOST_APP_DIR:-/opt/induscost}"
LOG_DIR="${NOMUS_SYNC_LOG_DIR:-/tmp/induscost-nomus-sync}"
LOCK_FILE="${NOMUS_PRODUCTION_ORDERS_SYNC_LOCK_FILE:-/tmp/induscost-nomus-production-orders.lock}"
STRATEGY="${1:-incremental}"
MODE="${2:-apply}"

case "$STRATEGY" in
  incremental|backfill)
    ;;
  *)
    echo "[nomus-production-orders] ERRO: estratégia inválida: $STRATEGY. Use: incremental ou backfill."
    exit 2
    ;;
esac

case "$MODE" in
  preview|dry|apply)
    ;;
  *)
    echo "[nomus-production-orders] ERRO: modo inválido: $MODE. Use: preview|dry|apply."
    exit 2
    ;;
esac

if [[ "$MODE" == "dry" ]]; then
  MODE="preview"
fi

mkdir -p "$LOG_DIR"

RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="$LOG_DIR/runner-production-orders_${STRATEGY}_${MODE}_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

echo "=== NOMUS PRODUCTION ORDERS RUNNER ==="
echo "STRATEGY=$STRATEGY"
echo "MODE=$MODE"
echo "APP_DIR=$APP_DIR"
echo "LOCK_FILE=$LOCK_FILE"
echo "RUN_LOG=$RUN_LOG"
echo "STARTED_AT=$(date -Iseconds)"

cd "$APP_DIR"

echo
echo "=== LOCK (Ordens de Produção) ==="
FLOCK_FILE="${LOCK_FILE}.flock"
exec 9>"$FLOCK_FILE"
if ! flock -n 9; then
  echo "[nomus-production-orders] SKIPPED: outra execução de Ordens de Produção ainda está em andamento."
  echo "FINISHED_AT=$(date -Iseconds)"
  echo "EXIT_CODE=0"
  exit 0
fi
echo "[nomus-production-orders] Lock adquirido: $FLOCK_FILE"

export NOMUS_SYNC_LOG_DIR="$LOG_DIR"
export NOMUS_PRODUCTION_ORDERS_SYNC_LOCK_FILE="$LOCK_FILE"
export NOMUS_PRODUCTION_ORDERS_RESPECT_GLOBAL_LOCK="${NOMUS_PRODUCTION_ORDERS_RESPECT_GLOBAL_LOCK:-1}"
# Filho npm: não tratar o próprio flock do shell como conflito.
export NOMUS_PRODUCTION_ORDERS_UNDER_SHELL_LOCK=1

echo
echo "=== EXECUÇÃO ==="
set +e
npm run "sync:nomus:production-orders:${STRATEGY}:${MODE}"
EXIT_CODE=$?
set -e

echo
echo "=== RESULTADO ==="
echo "EXIT_CODE=$EXIT_CODE"
echo "FINISHED_AT=$(date -Iseconds)"

exit "$EXIT_CODE"
