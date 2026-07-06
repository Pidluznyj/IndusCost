#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${INDUSCOST_APP_DIR:-/opt/induscost}"
LOG_DIR="${NOMUS_SYNC_LOG_DIR:-/tmp/induscost-nomus-sync}"
LOCK_FILE="${NOMUS_NFE_SYNC_LOCK_FILE:-/tmp/induscost-nomus-nfes.lock}"
MODE="${1:-apply}"

case "$MODE" in
  dry|apply)
    ;;
  *)
    echo "[nomus-nfes-runner] ERRO: modo inválido: $MODE. Use: dry ou apply."
    exit 2
    ;;
esac

mkdir -p "$LOG_DIR"

RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="$LOG_DIR/runner-nfes_${MODE}_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

echo "=== NOMUS NFES RUNNER ==="
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
echo "=== LOCK (NF-e) ==="
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[nomus-nfes-runner] SKIPPED: outra execução de NF-e ainda está em andamento."
  echo "FINISHED_AT=$(date -Iseconds)"
  echo "EXIT_CODE=0"
  exit 0
fi
echo "[nomus-nfes-runner] Lock adquirido: $LOCK_FILE"

echo
echo "=== CONFIGURAÇÃO ==="
export NOMUS_SYNC_LOG_DIR="$LOG_DIR"
export NOMUS_NFE_INCREMENTAL=1
export NOMUS_NFE_RUNNER_LOG="$RUN_LOG"

echo "NOMUS_SYNC_LOG_DIR=$NOMUS_SYNC_LOG_DIR"
echo "NOMUS_NFE_INCREMENTAL=$NOMUS_NFE_INCREMENTAL"
echo "NOMUS_NFE_CUTOFF_DATE=${NOMUS_NFE_CUTOFF_DATE:-2025-01-01}"
echo "SYNC_STRATEGY=scheduled_from_2025_01_01_upsert"
echo "SYNC_WINDOW=from_2025_01_01"
echo "SCHEDULE_HINT=cron: 0 */2 * * * (a cada 2 horas)"

echo
echo "=== EXECUÇÃO ==="
set +e
npm run "sync:nomus:nfes:${MODE}"
EXIT_CODE=$?
set -e

echo
echo "=== RESULTADO ==="
echo "EXIT_CODE=$EXIT_CODE"
echo "FINISHED_AT=$(date -Iseconds)"

exit "$EXIT_CODE"
