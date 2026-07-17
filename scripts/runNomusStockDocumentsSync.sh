#!/usr/bin/env bash
# Runner manual do sync de Documentos de Saída (sem cron nesta etapa).
# Usa flock no servidor Linux; o script TS também aplica lock por PID.
set -Eeuo pipefail

APP_DIR="${INDUSCOST_APP_DIR:-/opt/induscost}"
LOG_DIR="${NOMUS_SYNC_LOG_DIR:-/tmp/induscost-nomus-sync}"
LOCK_FILE="${NOMUS_STOCK_DOCUMENTS_SYNC_LOCK_FILE:-/tmp/induscost-nomus-stock-documents.lock}"
MODE="${1:-preview}"

case "$MODE" in
  preview|apply|dry)
    ;;
  *)
    echo "[nomus-stock-documents-runner] ERRO: modo inválido: $MODE. Use: preview|apply|dry."
    exit 2
    ;;
esac

if [[ "$MODE" == "dry" ]]; then
  MODE="preview"
fi

mkdir -p "$LOG_DIR"

RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="$LOG_DIR/runner-stock-documents_${MODE}_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

echo "=== NOMUS STOCK DOCUMENTS RUNNER ==="
echo "MODE=$MODE"
echo "APP_DIR=$APP_DIR"
echo "LOCK_FILE=$LOCK_FILE"
echo "RUN_LOG=$RUN_LOG"
echo "STARTED_AT=$(date -Iseconds)"
echo "NOTE=sem cron nesta etapa (execução manual)"

cd "$APP_DIR"

echo
echo "=== LOCK ==="
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[nomus-stock-documents-runner] SKIPPED: outra execução ainda em andamento."
  echo "FINISHED_AT=$(date -Iseconds)"
  echo "EXIT_CODE=0"
  exit 0
fi
echo "[nomus-stock-documents-runner] Lock adquirido: $LOCK_FILE"

export NOMUS_STOCK_DOCUMENTS_UNDER_SHELL_LOCK=1
export NOMUS_STOCK_DOCUMENTS_RUNNER_LOG="$RUN_LOG"

echo
echo "=== EXECUÇÃO ==="
set +e
shift || true
npm run "sync:nomus:stock-documents:${MODE}" -- "$@"
EXIT_CODE=$?
set -e

echo
echo "=== RESULTADO ==="
echo "EXIT_CODE=$EXIT_CODE"
echo "FINISHED_AT=$(date -Iseconds)"

exit "$EXIT_CODE"
