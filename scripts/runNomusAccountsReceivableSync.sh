#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${INDUSCOST_APP_DIR:-/opt/induscost}"
LOG_DIR="${NOMUS_SYNC_LOG_DIR:-/tmp/induscost-nomus-sync}"
LOCK_FILE="${NOMUS_AR_SYNC_LOCK_FILE:-/tmp/induscost-nomus-accounts-receivable.lock}"
MODE="${1:-apply}"

case "$MODE" in
  dry|apply)
    ;;
  *)
    echo "[nomus-accounts-receivable-runner] ERRO: modo inválido: $MODE. Use: dry ou apply."
    exit 2
    ;;
esac

mkdir -p "$LOG_DIR"

RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="$LOG_DIR/runner-accounts-receivable_${MODE}_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

echo "=== NOMUS ACCOUNTS RECEIVABLE RUNNER ==="
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
echo "=== LOCK (Contas a Receber) ==="
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[nomus-accounts-receivable-runner] SKIPPED: outra execução de Contas a Receber ainda está em andamento."
  echo "FINISHED_AT=$(date -Iseconds)"
  echo "EXIT_CODE=0"
  exit 0
fi
echo "[nomus-accounts-receivable-runner] Lock adquirido: $LOCK_FILE"

echo
echo "=== CONFIGURAÇÃO ==="
export NOMUS_SYNC_LOG_DIR="$LOG_DIR"
export NOMUS_AR_INCREMENTAL=1
export NOMUS_AR_RUNNER_LOG="$RUN_LOG"
# SYNC-07 — canônico; label full_refresh_upsert ≠ prova COMPLETE (ausência off por padrão)
export NOMUS_CANONICAL_SOURCE_TRIGGER="${NOMUS_CANONICAL_SOURCE_TRIGGER:-SCHEDULED_HOURLY}"
export NOMUS_CANONICAL_STRATEGY="${NOMUS_CANONICAL_STRATEGY:-FULL_RECONCILIATION}"
export NOMUS_CANONICAL_ALLOW_MISSING_DETECTION="${NOMUS_CANONICAL_ALLOW_MISSING_DETECTION:-0}"
export NOMUS_CANONICAL_ALLOW_MISSING_CONFIRMATION=0

echo "NOMUS_SYNC_LOG_DIR=$NOMUS_SYNC_LOG_DIR"
echo "NOMUS_AR_INCREMENTAL=$NOMUS_AR_INCREMENTAL"
echo "SYNC_STRATEGY=full_refresh_upsert"
echo "NOMUS_CANONICAL_SOURCE_TRIGGER=$NOMUS_CANONICAL_SOURCE_TRIGGER"

echo
echo "=== EXECUÇÃO ==="
set +e
npm run "sync:nomus:accounts-receivable:${MODE}"
EXIT_CODE=$?
set -e

echo
echo "=== RESULTADO ==="
echo "EXIT_CODE=$EXIT_CODE"
echo "FINISHED_AT=$(date -Iseconds)"

exit "$EXIT_CODE"
