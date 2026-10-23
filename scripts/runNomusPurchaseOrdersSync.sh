#!/usr/bin/env bash
# Runner oficial do espelho de Pedidos de Compra Nomus (`GET /rest/pedidoscompra`). Read-only no ERP.
#
# Fino de propósito: valida argumentos e chama o CLI, que usa o serviço canônico
# runNomusPurchaseOrdersSync (lock de entidade /tmp/induscost-nomus-purchase-orders.canonical.lock,
# espera pelo lock global sem adquiri-lo, run registrado, completude e presença).
# Nenhuma regra de negócio aqui.
#
# Uso: runNomusPurchaseOrdersSync.sh <apply|preview|dry> <incremental|reconcile|backfill>
#   NOMUS_PO_TRIGGER=SCHEDULED_HOURLY|SCHEDULED_DAILY|CHAIN_AFTER_AR|ADMIN_PANEL|CLI (padrão CLI)
#
# Fonte única de agendamento: NOMUS_PO_SCHEDULE_SOURCE=chain|independent (.env do app).
# Disparo da fonte inativa termina como SKIPPED registrado (exit 0), nunca roda duas vezes.
set -Eeuo pipefail

APP_DIR="${INDUSCOST_APP_DIR:-/opt/induscost}"
LOG_DIR="${NOMUS_SYNC_LOG_DIR:-/tmp/induscost-nomus-sync}"
MODE="${1:-apply}"
STRATEGY="${2:-incremental}"
TRIGGER="${NOMUS_PO_TRIGGER:-CLI}"

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
  incremental|reconcile|backfill)
    ;;
  *)
    echo "[nomus-purchase-orders-runner] ERRO: estratégia inválida: $STRATEGY. Use: incremental|reconcile|backfill."
    exit 2
    ;;
esac

mkdir -p "$LOG_DIR"

RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="$LOG_DIR/runner-purchase-orders_${MODE}_${STRATEGY}_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

echo "=== NOMUS PURCHASE ORDERS RUNNER ==="
echo "MODE=$MODE"
echo "STRATEGY=$STRATEGY"
echo "TRIGGER=$TRIGGER"
echo "APP_DIR=$APP_DIR"
echo "RUN_LOG=$RUN_LOG"
echo "STARTED_AT=$(date -Iseconds)"

cd "$APP_DIR"

export NOMUS_SYNC_LOG_DIR="$LOG_DIR"
export NOMUS_PO_RUNNER_LOG="$RUN_LOG"
export NOMUS_PO_TRIGGER="$TRIGGER"

echo
echo "=== EXECUÇÃO ==="
set +e
npm run "nomus:purchase-orders:${STRATEGY}:${MODE}" -- "--trigger=${TRIGGER}"
EXIT_CODE=$?
set -e

echo
echo "=== RESULTADO ==="
echo "EXIT_CODE=$EXIT_CODE"
echo "FINISHED_AT=$(date -Iseconds)"

exit "$EXIT_CODE"
