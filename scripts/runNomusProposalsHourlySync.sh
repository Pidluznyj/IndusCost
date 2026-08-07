#!/usr/bin/env bash
# Runner oficial do sync HORÁRIO de Propostas Nomus (SYNC-07).
#
# Reutiliza o mesmo serviço oficial do sync diário (02:00): chama o
# orquestrador com --only=proposals, que por sua vez roda exatamente
# `npm run sync:nomus:proposals:apply` (scripts/nomusProposalsSyncV1.ts).
# Não é um segundo motor de sincronização.
#
# Concorrência: nomusProposalsSyncV1.ts adquire lock próprio
# (/tmp/induscost-nomus-proposals.lock por padrão) e também verifica — sem
# adquirir — o lock global Nomus usado pelo pipeline diário das 02:00
# (/tmp/induscost-nomus-sync-global.lock). Se qualquer um estiver ativo,
# a execução termina como SKIPPED (exit 0), sem matar a execução em curso.
#
# Cadência: cron: 37 * * * * (a cada hora; minuto livre no inventário atual —
# NF-e=0, AR/CP=17, Documentos de Saída=23, diário=02:00).
set -Eeuo pipefail

APP_DIR="${INDUSCOST_APP_DIR:-/opt/induscost}"
LOG_DIR="${NOMUS_SYNC_LOG_DIR:-/tmp/induscost-nomus-sync}"
MODE="${1:-apply}"

case "$MODE" in
  dry|apply)
    ;;
  *)
    echo "[nomus-proposals-hourly] ERRO: modo inválido: $MODE. Use: dry ou apply."
    exit 2
    ;;
esac

mkdir -p "$LOG_DIR"

RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="$LOG_DIR/runner-proposals-hourly_${MODE}_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

echo "=== NOMUS PROPOSALS HOURLY RUNNER (SYNC-07) ==="
echo "MODE=$MODE"
echo "APP_DIR=$APP_DIR"
echo "RUN_LOG=$RUN_LOG"
echo "SCHEDULE_HINT=cron: 37 * * * * (a cada hora; sync diário 02:00 preservado)"
echo "LOCK_FILE=${NOMUS_PROPOSALS_SYNC_LOCK_FILE:-/tmp/induscost-nomus-proposals.lock}"
echo "STARTED_AT=$(date -Iseconds)"

cd "$APP_DIR"

export NOMUS_SYNC_LOG_DIR="$LOG_DIR"
# Mesma convenção de NOMUS_AR_RUNNER_LOG: dá ao processo Node o caminho do
# próprio log, para o IntegrationRun apontar pro log real desta execução.
export NOMUS_PROPOSALS_RUNNER_LOG="$RUN_LOG"

echo
echo "=== EXECUÇÃO (orquestrador --only=proposals --incremental; reusa sync:nomus:proposals:${MODE}) ==="
set +e
npm run "sync:nomus:all:${MODE}" -- --only=proposals --incremental
EXIT_CODE=$?
set -e

echo
echo "=== RESULTADO ==="
echo "EXIT_CODE=$EXIT_CODE"
echo "FINISHED_AT=$(date -Iseconds)"

exit "$EXIT_CODE"
