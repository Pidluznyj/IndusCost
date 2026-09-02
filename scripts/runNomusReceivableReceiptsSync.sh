#!/usr/bin/env bash
# Runner oficial do sync de Recebimentos Nomus (`GET /rest/recebimentos`).
#
# Fonte oficial da COMPETÊNCIA da comissão (`dataRecebimento` → `receiptDate`).
#
# FULL SCAN diário, sempre da página 1 até o fim real da paginação. O endpoint
# não tem parâmetro comprovado de janela/cursor/ordenação — só `pagina` — então
# não existe varredura incremental possível: qualquer recorte seria adivinhação.
# Por isso a rotina automática NÃO usa `--since` e roda uma vez por dia (03:50),
# nunca a cada 2h: o scan completo custa ~12 min e ~96 páginas.
#
# Truncamento silencioso é o pior defeito para esta fonte, então o comando
# canônico passa `--require-full-scan`: sem prova de que a origem foi percorrida
# inteira, o script termina em exit 1 e o cron acusa falha.
set -Eeuo pipefail

APP_DIR="${INDUSCOST_APP_DIR:-/opt/induscost}"
LOG_DIR="${NOMUS_SYNC_LOG_DIR:-/tmp/induscost-nomus-sync}"
LOCK_FILE="${NOMUS_RECEIPTS_SYNC_LOCK_FILE:-/tmp/induscost-nomus-receivable-receipts.lock}"
MODE="${1:-preview}"

case "$MODE" in
  preview|apply|dry)
    ;;
  *)
    echo "[nomus-receivable-receipts-runner] ERRO: modo inválido: $MODE. Use: preview|apply|dry."
    exit 2
    ;;
esac

if [[ "$MODE" == "dry" ]]; then
  MODE="preview"
fi

mkdir -p "$LOG_DIR"

RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="$LOG_DIR/runner-receivable-receipts_${MODE}_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

echo "=== NOMUS RECEIVABLE RECEIPTS RUNNER ==="
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
echo "=== LOCK (Recebimentos) ==="
# Lock EXCLUSIVO desta entidade. Deliberadamente não adquire o lock global do
# Nomus (/tmp/induscost-nomus-sync-global.lock): OP-04 do projeto proíbe
# compartilhar pathname entre locks justamente para evitar autolock, e a janela
# das 03:50 já é isolada das demais rotinas.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[nomus-receivable-receipts-runner] SKIPPED: outra execução de Recebimentos ainda está em andamento."
  echo "FINISHED_AT=$(date -Iseconds)"
  echo "EXIT_CODE=0"
  exit 0
fi
echo "[nomus-receivable-receipts-runner] Lock adquirido: $LOCK_FILE"

echo
echo "=== CONFIGURAÇÃO ==="
export NOMUS_SYNC_LOG_DIR="$LOG_DIR"
export NOMUS_RECEIPTS_RUNNER_LOG="$RUN_LOG"

echo "NOMUS_SYNC_LOG_DIR=$NOMUS_SYNC_LOG_DIR"
echo "SYNC_STRATEGY=full_scan_page_1_to_end"
echo "SYNC_WINDOW=none (endpoint sem parâmetro de janela comprovado)"

echo
echo "=== EXECUÇÃO ==="
# Comando lógico: tsx scripts/nomusReceivableReceiptsSync.ts <MODE> \
#   --maxPages 200 --json --require-full-scan
# Sem --since, sem --page, sem --startPage: full scan determinístico.
echo "CMD=npm run sync:nomus:receipts:fullscan:${MODE}"
set +e
npm run "sync:nomus:receipts:fullscan:${MODE}"
EXIT_CODE=$?
set -e

echo
echo "=== RESULTADO ==="
echo "EXIT_CODE=$EXIT_CODE"
echo "FINISHED_AT=$(date -Iseconds)"

exit "$EXIT_CODE"
