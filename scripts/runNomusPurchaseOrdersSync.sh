#!/usr/bin/env bash
set -Eeuo pipefail

# PURCH-MIRROR-01 / NOMUS-CRON-02 — Runner do sync recorrente (janela
# recente, sem cursor) de Pedidos de Compra Nomus.
#
# NÃO tem mais cron próprio independente. O candidato original
# (`27 */2 * * *`) foi ABANDONADO — ver docs/NOMUS_PURCHASE_ORDERS_MIRROR.md
# seção 10 para a justificativa (risco de disputar 429 com NF-e/AR sem
# nenhuma garantia de minuto livre). Este runner agora é disparado como
# ETAPA 2 do wrapper `runNomusAccountsReceivableThenPurchaseOrdersSync.sh`,
# na sequência: cron AR (2h) → AR roda e termina → Pedidos de Compra.
# Continua podendo ser chamado isoladamente (manual/debug) — o lock e o
# probe do lock global abaixo continuam válidos nesse uso direto.
#
# NÃO instalar no host nesta entrega — ver docs/NOMUS_PURCHASE_ORDERS_MIRROR.md
# seção 10 ("Cron — o que muda no host, NOT EXECUTED").

APP_DIR="/opt/induscost"
LOG_DIR="${NOMUS_SYNC_LOG_DIR:-/tmp/induscost-nomus-sync}"
# Lock de defesa em profundidade DESTA entidade (não é o lock global
# compartilhado — esse é probado, não adquirido, pelo lock Node em
# nomusPurchaseOrdersSyncLock.ts). Nome corrigido nesta entrega: o path
# antigo (`...-purchase-orders-sync-global.lock`) sugeria erroneamente ser o
# lock global compartilhado do ecossistema Nomus; não era — era só o próprio
# lock de shell de Pedidos de Compra.
LOCK_FILE="${NOMUS_PURCHASE_ORDERS_SHELL_LOCK_FILE:-/tmp/induscost-nomus-purchase-orders-shell.lock}"
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
