#!/usr/bin/env bash
# Runner do REFRESH RECENTE de Recebimentos Nomus — acelerador de latência
# intraday, NÃO um segundo motor de sincronização.
#
# Reaproveita INTEGRALMENTE o full scan diário (scripts/nomusReceivableReceiptsSync.ts):
# mesmo mapper, mesmo runApply/upsert, mesma tabela (NomusReceivableReceipt),
# mesma identidade (externalId), mesmo cliente HTTP, mesmo retry/backoff 429.
# A única diferença é `--maxPages` menor (primeiras páginas — mais recentes),
# em vez de varrer a origem inteira.
#
# best-effort de baixa latência. Este runner NUNCA prova cobertura completa:
# quem prova cobertura é o full scan diário (03:50, ver
# runNomusReceivableReceiptsSync.sh). Por isso é deliberadamente SEM
# --require-full-scan — uma execução limitada por --maxPages é incompleta por
# definição (assessReceiptsFullScan/STOPPED_BY_MAX_PAGES) e isso é esperado,
# não deve derrubar o cron.
#
# "Primeira página sempre traz tudo que é novo" NÃO é um contrato documentado
# do endpoint — é evidência observada nesta instalação em 10/09/2026 (27
# recebimentos novos apareceram todos na página 1 num full scan do mesmo dia).
# Se o full scan diário algum dia encontrar um evento modificado que não voltou
# nas páginas recentes, é o full scan que corrige — nunca este refresh.
#
# Concorrência: usa o MESMO lock exclusivo do full scan diário
# (NOMUS_RECEIPTS_SYNC_LOCK_FILE) — nunca um lock paralelo. Full scan e
# refresh recente nunca rodam ao mesmo tempo.
set -Eeuo pipefail

APP_DIR="${INDUSCOST_APP_DIR:-/opt/induscost}"
LOG_DIR="${NOMUS_SYNC_LOG_DIR:-/tmp/induscost-nomus-sync}"
LOCK_FILE="${NOMUS_RECEIPTS_SYNC_LOCK_FILE:-/tmp/induscost-nomus-receivable-receipts.lock}"
MAX_PAGES="${NOMUS_RECEIPTS_RECENT_MAX_PAGES:-3}"
MODE="${1:-preview}"

case "$MODE" in
  preview|apply|dry)
    ;;
  *)
    echo "[nomus-receivable-receipts-recent-runner] ERRO: modo inválido: $MODE. Use: preview|apply|dry."
    exit 2
    ;;
esac

if [[ "$MODE" == "dry" ]]; then
  MODE="preview"
fi

mkdir -p "$LOG_DIR"

RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="$LOG_DIR/runner-receivable-receipts-recent_${MODE}_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

echo "=== NOMUS RECEIVABLE RECEIPTS RECENT REFRESH RUNNER (best-effort) ==="
echo "MODE=$MODE"
echo "APP_DIR=$APP_DIR"
echo "LOG_DIR=$LOG_DIR"
echo "RUN_LOG=$RUN_LOG"
echo "MAX_PAGES=$MAX_PAGES"
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
# MESMO lock do full scan diário (runNomusReceivableReceiptsSync.sh).
# Deliberadamente NÃO cria um lock paralelo: garante que o refresh recente
# nunca roda concorrente com o full scan (mesma tabela, mesmo mapper, mesma
# identidade externalId, mesmo risco de corrida).
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[nomus-receivable-receipts-recent-runner] SKIPPED: full scan diário (ou outro refresh recente) em andamento."
  echo "FINISHED_AT=$(date -Iseconds)"
  echo "EXIT_CODE=0"
  exit 0
fi
echo "[nomus-receivable-receipts-recent-runner] Lock adquirido: $LOCK_FILE"

echo
echo "=== CONFIGURAÇÃO ==="
export NOMUS_SYNC_LOG_DIR="$LOG_DIR"
export NOMUS_RECEIPTS_RUNNER_LOG="$RUN_LOG"

echo "NOMUS_SYNC_LOG_DIR=$NOMUS_SYNC_LOG_DIR"
echo "SYNC_STRATEGY=recent_refresh_best_effort (NÃO prova cobertura completa — ver full scan diário)"
echo "SYNC_WINDOW=primeiras ${MAX_PAGES} páginas (mais recentes) — best-effort, não prova cobertura completa"

echo
echo "=== EXECUÇÃO ==="
# Mesmo script (nomusReceivableReceiptsSync.ts), mesmo mapper/persistência/
# cliente HTTP do full scan — só limita --maxPages e omite --require-full-scan
# de propósito: uma varredura truncada por maxPages é incompleta por
# definição (ver assessReceiptsFullScan) e deve terminar em SUCCESS mesmo
# assim, porque este runner nunca alega cobertura total.
echo "CMD=npm run sync:nomus:receipts:recent:${MODE} -- --maxPages ${MAX_PAGES}"
set +e
npm run "sync:nomus:receipts:recent:${MODE}" -- --maxPages "$MAX_PAGES"
EXIT_CODE=$?
set -e

echo
echo "=== RESULTADO ==="
echo "EXIT_CODE=$EXIT_CODE"
echo "FINISHED_AT=$(date -Iseconds)"

exit "$EXIT_CODE"
