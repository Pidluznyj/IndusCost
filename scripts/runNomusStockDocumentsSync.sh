#!/usr/bin/env bash
# Runner oficial do sync de Documentos de Saída (incremental + soft-fail).
# Cadência: mesma frequência do ecossistema financeiro (2h), com offset próprio.
# Backfill amplo: somente manual com --from/--to explícitos (não use este runner).
# --from/--to (quando passados ao CLI) são dias-calendário inclusivos; o sync
# converte o limite superior para o próximo dia civil na API Nomus (DS-SYNC-03).
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
export NOMUS_SYNC_LOG_DIR="$LOG_DIR"

# Incremental por padrão no runner; args explícitos (--from/--to/--idNfe) têm precedência no CLI.
shift || true
EXTRA_ARGS=("$@")
HAS_EXPLICIT_WINDOW=0
for arg in "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"; do
  case "$arg" in
    --from=*|--to=*|--idNfe=*)
      HAS_EXPLICIT_WINDOW=1
      ;;
  esac
done

if [[ "$HAS_EXPLICIT_WINDOW" -eq 0 ]]; then
  export NOMUS_STOCK_DOCUMENTS_INCREMENTAL="${NOMUS_STOCK_DOCUMENTS_INCREMENTAL:-1}"
else
  export NOMUS_STOCK_DOCUMENTS_INCREMENTAL="${NOMUS_STOCK_DOCUMENTS_INCREMENTAL:-0}"
fi

echo
echo "=== CONFIGURAÇÃO ==="
echo "NOMUS_STOCK_DOCUMENTS_INCREMENTAL=$NOMUS_STOCK_DOCUMENTS_INCREMENTAL"
echo "SYNC_STRATEGY=incremental_window_upsert"
echo "BACKFILL=manual_only"
echo "SCHEDULE_HINT=cron: 23 */2 * * * (a cada 2 horas; offset NF-e/AR)"

echo
echo "=== EXECUÇÃO ==="
set +e
npm run "sync:nomus:stock-documents:${MODE}" -- "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
EXIT_CODE=$?
set -e

echo
echo "=== RESULTADO ==="
echo "EXIT_CODE=$EXIT_CODE"
echo "FINISHED_AT=$(date -Iseconds)"

exit "$EXIT_CODE"
