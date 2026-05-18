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
    echo "[nomus-daily-runner] ERRO: modo inválido: $MODE. Use: dry ou apply."
    exit 2
    ;;
esac

mkdir -p "$LOG_DIR"

RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="$LOG_DIR/runner-daily-${MODE}_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

echo "=== NOMUS DAILY SYNC RUNNER ==="
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
  echo "[nomus-daily-runner] SKIPPED: outra execução diária ainda está em andamento."
  echo "FINISHED_AT=$(date -Iseconds)"
  exit 0
fi
echo "[nomus-daily-runner] Lock adquirido: $LOCK_FILE"

echo
echo "=== CONFIGURAÇÃO SEGURA ==="
export NOMUS_SYNC_LOG_DIR="$LOG_DIR"
export NOMUS_PAGE_SIZE="${NOMUS_PAGE_SIZE:-50}"
export NOMUS_MAX_RETRIES="${NOMUS_MAX_RETRIES:-8}"
export NOMUS_RETRY_BASE_MS="${NOMUS_RETRY_BASE_MS:-1200}"

export NOMUS_CUSTOMERS_START_PAGE=1
export NOMUS_PRODUCTS_START_PAGE=1
export NOMUS_BOM_COMPONENTS_START_PAGE=1
export NOMUS_PROPOSALS_START_PAGE=1

unset NOMUS_CUSTOMERS_MAX_PAGES || true
unset NOMUS_PRODUCTS_MAX_PAGES || true
unset NOMUS_BOM_COMPONENTS_MAX_PAGES || true
unset NOMUS_PROPOSALS_MAX_PAGES || true

export NOMUS_BOM_COMPONENTS_DELAY_MS="${NOMUS_BOM_COMPONENTS_DELAY_MS:-1200}"

echo "NOMUS_SYNC_LOG_DIR=$NOMUS_SYNC_LOG_DIR"
echo "NOMUS_PAGE_SIZE=$NOMUS_PAGE_SIZE"
echo "NOMUS_MAX_RETRIES=$NOMUS_MAX_RETRIES"
echo "NOMUS_RETRY_BASE_MS=$NOMUS_RETRY_BASE_MS"
echo "NOMUS_CUSTOMERS_START_PAGE=$NOMUS_CUSTOMERS_START_PAGE"
echo "NOMUS_PRODUCTS_START_PAGE=$NOMUS_PRODUCTS_START_PAGE"
echo "NOMUS_BOM_COMPONENTS_START_PAGE=$NOMUS_BOM_COMPONENTS_START_PAGE"
echo "NOMUS_BOM_COMPONENTS_DELAY_MS=$NOMUS_BOM_COMPONENTS_DELAY_MS"
echo "NOMUS_PROPOSALS_START_PAGE=$NOMUS_PROPOSALS_START_PAGE"

run_target() {
  local target="$1"

  echo
  echo "=== EXECUTANDO TARGET: $target ==="
  echo "TARGET_STARTED_AT=$(date -Iseconds)"

  set +e
  npm run "sync:nomus:all:${MODE}" -- --only="$target"
  local exit_code=$?
  set -e

  echo "TARGET=$target"
  echo "TARGET_EXIT_CODE=$exit_code"
  echo "TARGET_FINISHED_AT=$(date -Iseconds)"

  if [ "$exit_code" -ne 0 ]; then
    echo "[nomus-daily-runner] ERRO: target $target falhou. Interrompendo fila."
    exit "$exit_code"
  fi
}

run_target "customers"

echo
echo "=== PAUSA ENTRE CUSTOMERS E PRODUCTS ==="
sleep 120

run_target "products"

echo
echo "=== PAUSA ENTRE PRODUCTS E BOM-COMPONENTS ==="
sleep 120

run_target "bom-components"

echo
echo "=== PAUSA ENTRE BOM-COMPONENTS E PROPOSALS ==="
sleep 180

run_target "proposals"

echo
echo "=== RESULTADO FINAL ==="
echo "EXIT_CODE=0"
echo "FINISHED_AT=$(date -Iseconds)"

exit 0
