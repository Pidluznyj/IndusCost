#!/usr/bin/env bash
set -Eeuo pipefail

# PURCH-MIRROR-01 — Runner do sync recorrente (janela recente, sem cursor)
# de Pedidos de Compra Nomus. Candidato de cron: 27 */2 * * * (a cada 2h).
#
# NÃO instalar no host nesta entrega — ver docs/NOMUS_PURCHASE_ORDERS_MIRROR.md
# "Cron futuro" para o pré-requisito de deploy (checar CRON_JOBS 8→9 antes de
# adicionar este job).

APP_DIR="/opt/induscost"
LOG_DIR="${NOMUS_SYNC_LOG_DIR:-/tmp/induscost-nomus-sync}"
LOCK_FILE="/tmp/induscost-nomus-purchase-orders-sync-global.lock"
MODE="${1:-apply}"

case "$MODE" in
  preview|apply)
    ;;
  *)
    echo "[nomus-purchase-orders-runner] ERRO: modo inválido: $MODE. Use: preview ou apply."
    exit 2
    ;;
esac

mkdir -p "$LOG_DIR"

RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="$LOG_DIR/runner-purchase-orders_${MODE}_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

echo "=== NOMUS PURCHASE ORDERS RUNNER (recent-window / recurring) ==="
echo "MODE=$MODE"
echo "APP_DIR=$APP_DIR"
echo "LOG_DIR=$LOG_DIR"
echo "RUN_LOG=$RUN_LOG"
echo "STARTED_AT=$(date -Iseconds)"

cd "$APP_DIR"

echo
echo "=== LOCK (defesa em profundidade — o CLI Node também trava via arquivo próprio) ==="
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[nomus-purchase-orders-runner] SKIPPED: outra execução (host lock) ainda em andamento."
  echo "FINISHED_AT=$(date -Iseconds)"
  exit 0
fi
echo "[nomus-purchase-orders-runner] Lock de host adquirido: $LOCK_FILE"

echo
echo "=== EXECUTANDO SYNC RECORRENTE ==="
npx tsx scripts/nomusPurchaseOrdersSync.ts sync "--${MODE}"
STATUS=$?

echo
echo "FINISHED_AT=$(date -Iseconds)"
echo "EXIT_STATUS=$STATUS"
exit "$STATUS"
