#!/usr/bin/env bash
# NOMUS-CRON-02 — Wrapper de orquestração: Contas a Receber → Pedidos de
# Compra Nomus.
#
# Substitui a estratégia original de cron fixo independente para Pedidos de
# Compra (`27 */2 * * *`). Diagnóstico real de produção mostrou que
# escolher um minuto "aparentemente vazio" não garante ausência de
# concorrência: NF-e faz full scan de ~160 páginas/~8 mil registros, recebe
# HTTP 429 regularmente e pode levar de ~8 a ~17 minutos; um AR iniciado às
# 14:17 só terminou às 14:38:24. Minuto fixo é aposta, não garantia.
#
# Nova estratégia: Pedidos de Compra deixa de ter cron próprio e passa a ser
# disparado como TRIGGER logo após o runner de Contas a Receber (que já roda
# a cada 2h) terminar — o horário passa a ser CONSEQUÊNCIA do término do AR,
# não um minuto fixo escolhido a priori. Segue o mesmo padrão conceitual já
# usado no host para Pedidos de Venda → Documentos de Saída (encadeamento
# sequencial simples: etapa 1 termina, dispara etapa 2).
#
# O trigger é temporal/orquestracional — NÃO verifica se os dados do AR
# mudaram. Roda sempre que o AR desta execução concluiu tecnicamente.
#
# Semântica de falha (auditada nos runners existentes antes de decidir):
#   - AR SUCCESS (exit 0)   → dispara Pedidos de Compra normalmente.
#   - AR SKIPPED (exit 0, outra execução de AR já em andamento — ver
#     runNomusAccountsReceivableSync.sh) → também dispara Pedidos de Compra:
#     não é uma falha, é apenas este ciclo específico do AR não ter rodado
#     porque outro já está rodando; o encadeamento é temporal, não depende
#     do AR ter de fato produzido dados novos nesta execução.
#   - AR FAILED (exit != 0) → Pedidos de Compra NÃO é disparado. Não faz
#     sentido encadear uma nova chamada à API Nomus em cima de uma falha
#     técnica ativa do AR (poderia agravar a causa raiz — ex.: Nomus fora do
#     ar, rede instável, etc. — ou disputar limite de taxa já sob pressão).
#     O exit code do AR é preservado integralmente (não escondido).
#
# O exit code final deste wrapper é:
#   - o exit code do AR, se o AR falhou (Pedidos de Compra nem rodou);
#   - o exit code de Pedidos de Compra, se o AR terminou (SUCCESS/SKIPPED).
# Em ambos os casos, AR_EXIT_CODE e PO_EXIT_CODE ficam gravados
# separadamente no log — falha de Pedidos de Compra nunca se disfarça de
# falha (ou sucesso) do AR, e vice-versa.
#
# Lock: cada runner filho continua responsável pelo próprio lock (AR: lock
# de entidade `/tmp/induscost-nomus-accounts-receivable.lock`; Pedidos de
# Compra: lock de entidade + probe do lock global Nomus, ver
# nomusPurchaseOrdersSyncLock.ts). Este wrapper não introduz um lock próprio
# — orquestra apenas a ORDEM de execução.
#
# NÃO instalado no crontab do host nesta entrega — ver
# docs/NOMUS_PURCHASE_ORDERS_MIRROR.md seção 10 para o comando exato de cron
# (marcado NOT EXECUTED).

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

AR_MODE="${1:-apply}"
PO_MODE="${2:-apply}"

# Overridáveis apenas para teste automatizado (stubs) — em produção sempre
# resolvem para os runners reais ao lado deste script.
AR_RUNNER="${NOMUS_AR_RUNNER_SCRIPT:-$SCRIPT_DIR/runNomusAccountsReceivableSync.sh}"
PO_RUNNER="${NOMUS_PO_RUNNER_SCRIPT:-$SCRIPT_DIR/runNomusPurchaseOrdersSync.sh}"

LOG_DIR="${NOMUS_SYNC_LOG_DIR:-/tmp/induscost-nomus-sync}"
mkdir -p "$LOG_DIR"

RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="$LOG_DIR/runner-ar-then-purchase-orders_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

echo "=== NOMUS AR → PURCHASE ORDERS CHAIN RUNNER (NOMUS-CRON-02) ==="
echo "AR_MODE=$AR_MODE"
echo "PO_MODE=$PO_MODE"
echo "LOG_DIR=$LOG_DIR"
echo "RUN_LOG=$RUN_LOG"
echo "STARTED_AT=$(date -Iseconds)"

echo
echo "=== ETAPA 1/2: CONTAS A RECEBER ==="
set +e
"$AR_RUNNER" "$AR_MODE"
AR_EXIT_CODE=$?
set -e
echo "AR_EXIT_CODE=$AR_EXIT_CODE"

if [[ "$AR_EXIT_CODE" -ne 0 ]]; then
  echo
  echo "[nomus-ar-then-po-runner] AR FALHOU (exit=$AR_EXIT_CODE) — Pedidos de Compra NÃO será disparado nesta execução."
  echo "[nomus-ar-then-po-runner] Não encadeia uma nova chamada à API Nomus em cima de uma falha técnica ativa do AR."
  echo "PO_EXIT_CODE=NOT_RUN"
  echo "CHAIN_RESULT=AR_FAILED"
  echo "FINISHED_AT=$(date -Iseconds)"
  exit "$AR_EXIT_CODE"
fi

echo
echo "[nomus-ar-then-po-runner] AR concluiu tecnicamente (exit=0) — disparando Pedidos de Compra."
echo "[nomus-ar-then-po-runner] Trigger é temporal/orquestracional: dispara mesmo se o AR não tiver produzido dados novos (SKIPPED por lock próprio conta como conclusão técnica, não como falha)."

echo
echo "=== ETAPA 2/2: PEDIDOS DE COMPRA ==="
set +e
"$PO_RUNNER" "$PO_MODE"
PO_EXIT_CODE=$?
set -e
echo "PO_EXIT_CODE=$PO_EXIT_CODE"

if [[ "$PO_EXIT_CODE" -ne 0 ]]; then
  echo "[nomus-ar-then-po-runner] Pedidos de Compra falhou (exit=$PO_EXIT_CODE) — isso NÃO reabre nem reclassifica o resultado do AR (AR_EXIT_CODE=$AR_EXIT_CODE permanece SUCCESS)."
  echo "CHAIN_RESULT=AR_OK_PO_FAILED"
else
  echo "CHAIN_RESULT=AR_OK_PO_OK"
fi

echo "FINISHED_AT=$(date -Iseconds)"
exit "$PO_EXIT_CODE"
