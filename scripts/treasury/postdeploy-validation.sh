#!/usr/bin/env bash
# Validação pós-deploy da Central de Tesouraria (produção).
#
# Uso (no servidor, como operador humano):
#   cd /opt/induscost
#   bash scripts/treasury/postdeploy-validation.sh
#   bash scripts/treasury/postdeploy-validation.sh --base-url=http://127.0.0.1:3000
#
# Não faz: migrate, pull, delete, reset --hard, alteração de .env.
# Não esconde falhas (exit != 0 se health/artefatos falharem).
#
# Cursor/agentes: NÃO executar contra produção.
set -Eeuo pipefail

APP_DIR="${INDUSCOST_APP_DIR:-/opt/induscost}"
LOG_DIR="${TREASURY_DEPLOY_LOG_DIR:-/tmp/induscost-treasury-deploy}"
BASE_URL="${TREASURY_POSTDEPLOY_BASE_URL:-http://127.0.0.1:3000}"
SERVER_LOG="${INDUSCOST_SERVER_LOG:-/tmp/induscost-server.log}"
CURL_CONNECT_TIMEOUT="${TREASURY_CURL_CONNECT_TIMEOUT:-5}"
CURL_MAX_TIME="${TREASURY_CURL_MAX_TIME:-20}"

for arg in "$@"; do
  case "$arg" in
    --base-url=*) BASE_URL="${arg#--base-url=}" ;;
    --app-dir=*) APP_DIR="${arg#--app-dir=}" ;;
    --server-log=*) SERVER_LOG="${arg#--server-log=}" ;;
    -h|--help)
      cat <<'EOF'
Uso: bash scripts/treasury/postdeploy-validation.sh [opções]

Opções:
  --base-url=URL     Padrão: http://127.0.0.1:3000
  --app-dir=PATH     Padrão: /opt/induscost
  --server-log=PATH  Padrão: /tmp/induscost-server.log
  -h, --help         Esta ajuda
EOF
      exit 0
      ;;
    *)
      echo "[treasury-postdeploy] ERRO: argumento desconhecido: $arg" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$LOG_DIR"
RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="${LOG_DIR}/postdeploy-validation_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

log() { echo "[treasury-postdeploy] $*"; }
fail() { echo "[treasury-postdeploy] FALHA: $*" >&2; exit 1; }

finalize() {
  local ec="${1:-$?}"
  if ! grep -q '^FINISHED_AT=' "$RUN_LOG" 2>/dev/null; then
    echo "EXIT_CODE=${ec}"
    echo "FINISHED_AT=$(date -Iseconds)"
    echo "LOG_FILE=${RUN_LOG}"
  fi
}
trap 'finalize $?' EXIT

log "=== POSTDEPLOY VALIDATION — Central de Tesouraria ==="
log "STARTED_AT=$(date -Iseconds)"
log "APP_DIR=${APP_DIR}"
log "BASE_URL=${BASE_URL}"
log "LOG_FILE=${RUN_LOG}"

[[ -d "$APP_DIR" ]] || fail "Diretório da aplicação não encontrado: ${APP_DIR}"
cd "$APP_DIR"
log "PWD=$(pwd)"
log "HEAD=$(git rev-parse HEAD 2>/dev/null || echo unknown)"
log "BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

command -v curl >/dev/null 2>&1 || fail "curl não encontrado no PATH"
command -v npm >/dev/null 2>&1 || fail "npm não encontrado no PATH"

# --- Porta / processo ---
log "=== PORTA 3000 ==="
if command -v ss >/dev/null 2>&1; then
  if ss -ltnp 2>/dev/null | grep -q ':3000'; then
    log "Porta 3000 em escuta:"
    ss -ltnp 2>/dev/null | grep ':3000' || true
  else
    fail "Nada escutando na porta 3000"
  fi
else
  log "AVISO: ss indisponível — pulando inspeção de porta (health HTTP ainda obrigatório)"
fi

# --- Health global ---
log "=== HEALTH GLOBAL ==="
HEALTH_BODY="$(curl -fsS \
  --connect-timeout "${CURL_CONNECT_TIMEOUT}" \
  --max-time "${CURL_MAX_TIME}" \
  "${BASE_URL}/api/health")" \
  || fail "GET ${BASE_URL}/api/health falhou"
log "health_body=${HEALTH_BODY}"
echo "${HEALTH_BODY}" | grep -Eqi 'ok|status|true|healthy|"ok"[[:space:]]*:[[:space:]]*true' \
  || fail "Resposta de /api/health sem indicação de sucesso"

# --- App version (informativo; falha se endpoint cair) ---
log "=== APP VERSION ==="
if VERSION_BODY="$(curl -fsS \
  --connect-timeout "${CURL_CONNECT_TIMEOUT}" \
  --max-time "${CURL_MAX_TIME}" \
  "${BASE_URL}/api/app-version" 2>/dev/null)"; then
  log "app_version=${VERSION_BODY}"
else
  fail "GET ${BASE_URL}/api/app-version falhou"
fi

# --- Bundle de produção no HTML ---
log "=== BUNDLE PRODUÇÃO ==="
HTML="$(curl -fsS \
  --connect-timeout "${CURL_CONNECT_TIMEOUT}" \
  --max-time "${CURL_MAX_TIME}" \
  "${BASE_URL}/")" \
  || fail "GET ${BASE_URL}/ falhou"
if echo "${HTML}" | grep -Eq '/src/main\.tsx|\?v='; then
  fail "HTML contém referências de desenvolvimento (Vite). App NÃO está em produção."
fi
if echo "${HTML}" | grep -Eq '/assets/index-.*\.js'; then
  log "OK: HTML referencia bundle /assets/index-*.js"
else
  fail "Bundle de produção (/assets/index-*.js) não encontrado no HTML"
fi

# --- Health Tesouraria (fail-closed se módulo off: 404 é aceitável com flag off) ---
log "=== HEALTH TESOURARIA ==="
TMP_BODY="$(mktemp)"
set +e
TREASURY_HTTP_CODE="$(curl -sS \
  --connect-timeout "${CURL_CONNECT_TIMEOUT}" \
  --max-time "${CURL_MAX_TIME}" \
  -o "${TMP_BODY}" \
  -w '%{http_code}' \
  "${BASE_URL}/api/finance/treasury/health")"
TREASURY_CURL_EC=$?
set -e
TREASURY_BODY="$(cat "${TMP_BODY}" 2>/dev/null || true)"
rm -f "${TMP_BODY}"
[[ "${TREASURY_CURL_EC}" -eq 0 ]] || fail "curl treasury/health falhou (ec=${TREASURY_CURL_EC})"
log "treasury_health_http=${TREASURY_HTTP_CODE}"
log "treasury_health_body=${TREASURY_BODY}"
case "${TREASURY_HTTP_CODE}" in
  200)
    log "Tesouraria health 200 (módulo/rota disponível)"
    ;;
  401|403)
    log "Tesouraria health ${TREASURY_HTTP_CODE} (auth) — endpoint alcançável"
    ;;
  404)
    log "Tesouraria health 404 — esperado se flag mestra OFF (fail-closed)"
    ;;
  *)
    fail "Tesouraria health HTTP inesperado: ${TREASURY_HTTP_CODE}"
    ;;
esac

# --- Validação estrutural local (sem escrita) ---
log "=== VALIDATE TESOURARIA (dry) ==="
npm run --silent validate:treasury:deploy \
  || fail "validate:treasury:deploy falhou após deploy"

# --- Logs recentes (não mascaram falhas anteriores) ---
log "=== LOGS ==="
if [[ -f "${SERVER_LOG}" ]]; then
  log "tail -80 ${SERVER_LOG}"
  tail -n 80 "${SERVER_LOG}" || true
else
  log "AVISO: log do servidor não encontrado: ${SERVER_LOG}"
fi

log "=== POSTDEPLOY VALIDATION OK ==="
log "Verifique availability autenticada e UI /finance/treasury conforme PRODUCTION-DEPLOYMENT.md"
log "Rollback: docs/treasury/ROLLBACK.md"
