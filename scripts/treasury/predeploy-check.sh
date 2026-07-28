#!/usr/bin/env bash
# Pré-checagem de deploy da Central de Tesouraria (produção).
#
# Uso (no servidor, como operador humano):
#   cd /opt/induscost
#   bash scripts/treasury/predeploy-check.sh
#   bash scripts/treasury/predeploy-check.sh --require-backup
#
# Não faz: pull, migrate, build, restart, delete, reset --hard.
# Não esconde falhas (exit != 0 se algum gate falhar).
#
# Cursor/agentes: NÃO executar contra produção.
set -Eeuo pipefail

APP_DIR="${INDUSCOST_APP_DIR:-/opt/induscost}"
LOG_DIR="${TREASURY_DEPLOY_LOG_DIR:-/tmp/induscost-treasury-deploy}"
LOCK_FILE="${TREASURY_DEPLOY_LOCK_FILE:-/tmp/induscost-deploy.lock}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/induscost-backups}"
REQUIRE_BACKUP=0
EXPECTED_BRANCH="${TREASURY_DEPLOY_BRANCH:-main}"

for arg in "$@"; do
  case "$arg" in
    --require-backup) REQUIRE_BACKUP=1 ;;
    --app-dir=*) APP_DIR="${arg#--app-dir=}" ;;
    --backup-dir=*) BACKUP_DIR="${arg#--backup-dir=}" ;;
    -h|--help)
      cat <<'EOF'
Uso: bash scripts/treasury/predeploy-check.sh [opções]

Opções:
  --require-backup   Exige arquivo .dump recente em BACKUP_DIR (ou BACKUP_FILE)
  --app-dir=PATH     Padrão: /opt/induscost (ou INDUSCOST_APP_DIR)
  --backup-dir=PATH  Padrão: /tmp/induscost-backups (ou BACKUP_DIR)
  -h, --help         Esta ajuda

Variáveis úteis:
  BACKUP_FILE=/caminho/arquivo.dump   Backup explícito a validar
  TREASURY_DEPLOY_BRANCH=main         Branch esperada
  TREASURY_DEPLOY_LOG_DIR=/tmp/...    Diretório de logs
  TREASURY_DEPLOY_LOCK_FILE=/tmp/...  Lock de processo concorrente
EOF
      exit 0
      ;;
    *)
      echo "[treasury-predeploy] ERRO: argumento desconhecido: $arg" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$LOG_DIR"
RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)"
RUN_LOG="${LOG_DIR}/predeploy-check_${RUN_STAMP}.log"

exec > >(tee -a "$RUN_LOG") 2>&1

log() { echo "[treasury-predeploy] $*"; }
fail() { echo "[treasury-predeploy] FALHA: $*" >&2; exit 1; }

finalize() {
  local ec="${1:-$?}"
  if ! grep -q '^FINISHED_AT=' "$RUN_LOG" 2>/dev/null; then
    echo "EXIT_CODE=${ec}"
    echo "FINISHED_AT=$(date -Iseconds)"
    echo "LOG_FILE=${RUN_LOG}"
  fi
}
trap 'finalize $?' EXIT

log "=== PREDEPLOY CHECK — Central de Tesouraria ==="
log "STARTED_AT=$(date -Iseconds)"
log "APP_DIR=${APP_DIR}"
log "EXPECTED_BRANCH=${EXPECTED_BRANCH}"
log "REQUIRE_BACKUP=${REQUIRE_BACKUP}"
log "LOG_FILE=${RUN_LOG}"
log "HOST=$(hostname 2>/dev/null || echo unknown)"
log "USER=$(id -un 2>/dev/null || echo unknown)"

[[ -d "$APP_DIR" ]] || fail "Diretório da aplicação não encontrado: ${APP_DIR}"
cd "$APP_DIR"
log "PWD=$(pwd)"

# --- Gate de processos concorrentes (deploy) ---
log "=== LOCK DE DEPLOY ==="
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  fail "Outro deploy/check está em andamento (lock: ${LOCK_FILE}). Abortando."
fi
log "Lock adquirido: ${LOCK_FILE}"

# Locks Nomus conhecidos — aviso forte (não aborta se flock ausente no check read-only)
log "=== PROCESSOS CONCORRENTES (avisos) ==="
for lf in \
  /tmp/induscost-nomus-sync-global.lock \
  /tmp/induscost-nomus-accounts-receivable.lock \
  /tmp/induscost-nomus-accounts-payable.lock
do
  if [[ -e "$lf" ]] && command -v fuser >/dev/null 2>&1; then
    if fuser "$lf" >/dev/null 2>&1; then
      log "AVISO: lock ativo detectado: ${lf} (sync Nomus pode estar rodando)"
    fi
  fi
done

# --- Ferramentas ---
log "=== FERRAMENTAS ==="
command -v git >/dev/null 2>&1 || fail "git não encontrado no PATH"
command -v node >/dev/null 2>&1 || fail "node não encontrado no PATH"
command -v npm >/dev/null 2>&1 || fail "npm não encontrado no PATH"
command -v npx >/dev/null 2>&1 || fail "npx não encontrado no PATH"
log "git=$(command -v git) $(git --version)"
log "node=$(command -v node) $(node --version)"
log "npm=$(command -v npm) $(npm --version)"

# --- Git status / branch ---
log "=== GIT STATUS ==="
[[ -d .git ]] || fail "Não é um repositório git: ${APP_DIR}"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
log "branch=${CURRENT_BRANCH}"
[[ "$CURRENT_BRANCH" == "$EXPECTED_BRANCH" ]] \
  || fail "Branch atual '${CURRENT_BRANCH}' != esperada '${EXPECTED_BRANCH}'"

git status --branch --short
DIRTY="$(git status --porcelain)"
if [[ -n "$DIRTY" ]]; then
  fail "Working tree suja. Resolva/descarte alterações locais antes do deploy (sem reset --hard automático)."
fi
log "Working tree limpa."

log "HEAD=$(git rev-parse HEAD)"
log "HEAD_MSG=$(git log -1 --format='%s')"

git fetch origin "$EXPECTED_BRANCH"
BEHIND="$(git rev-list --count "HEAD..origin/${EXPECTED_BRANCH}" 2>/dev/null || echo 0)"
AHEAD="$(git rev-list --count "origin/${EXPECTED_BRANCH}..HEAD" 2>/dev/null || echo 0)"
log "behind_origin_${EXPECTED_BRANCH}=${BEHIND}"
log "ahead_of_origin_${EXPECTED_BRANCH}=${AHEAD}"
if [[ "${AHEAD}" -gt 0 ]]; then
  fail "HEAD está à frente de origin/${EXPECTED_BRANCH} (${AHEAD} commit(s)). Não faça deploy com commits locais não publicados."
fi
if [[ "${BEHIND}" -gt 0 ]]; then
  log "INFO: há ${BEHIND} commit(s) em origin/${EXPECTED_BRANCH} ainda não aplicados (pull no passo de deploy)."
fi

# --- Artefatos Tesouraria ---
log "=== ARTEFATOS TESOURARIA ==="
[[ -f prisma/schema.prisma ]] || fail "prisma/schema.prisma ausente"
[[ -f src/lib/treasury/treasuryRoutes.ts ]] || fail "treasuryRoutes.ts ausente"
[[ -f docs/treasury/PRODUCTION-DEPLOYMENT.md ]] \
  || fail "docs/treasury/PRODUCTION-DEPLOYMENT.md ausente"
[[ -f docs/treasury/ROLLBACK.md ]] || fail "docs/treasury/ROLLBACK.md ausente"
[[ -f scripts/deploy-induscost.sh ]] || fail "scripts/deploy-induscost.sh ausente"
[[ -f scripts/backupDatabaseBeforeDeploy.sh ]] \
  || fail "scripts/backupDatabaseBeforeDeploy.sh ausente"
grep -q 'model TreasuryFinancialAccount' prisma/schema.prisma \
  || fail "Schema sem TreasuryFinancialAccount"
log "Artefatos obrigatórios presentes."

# --- Backup ---
log "=== BACKUP ==="
BACKUP_OK=0
if [[ -n "${BACKUP_FILE:-}" ]]; then
  if [[ -s "${BACKUP_FILE}" ]]; then
    log "BACKUP_FILE ok: ${BACKUP_FILE} ($(wc -c <"${BACKUP_FILE}" | tr -d ' ') bytes)"
    BACKUP_OK=1
  else
    fail "BACKUP_FILE inexistente ou vazio: ${BACKUP_FILE}"
  fi
elif [[ -d "$BACKUP_DIR" ]]; then
  LATEST=""
  # shellcheck disable=SC2012
  while IFS= read -r candidate; do
    LATEST="$candidate"
    break
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -nr | cut -d' ' -f2-)
  if [[ -z "${LATEST}" ]]; then
    # Fallback sem -printf (macOS/BSD find)
    # shellcheck disable=SC2012
    LATEST="$(ls -1t "${BACKUP_DIR}"/*.dump 2>/dev/null | head -1 || true)"
  fi
  if [[ -n "${LATEST}" && -s "${LATEST}" ]]; then
    log "Backup mais recente em ${BACKUP_DIR}: ${LATEST}"
    BACKUP_OK=1
  else
    log "Nenhum .dump encontrado em ${BACKUP_DIR}"
  fi
else
  log "BACKUP_DIR inexistente: ${BACKUP_DIR}"
fi

if [[ "$REQUIRE_BACKUP" -eq 1 && "$BACKUP_OK" -ne 1 ]]; then
  fail "Backup obrigatório ausente. Rode: bash scripts/backupDatabaseBeforeDeploy.sh --reason=pre_deploy_treasury"
fi
if [[ "$BACKUP_OK" -ne 1 ]]; then
  log "AVISO: backup não verificado neste check. Produza backup antes do migrate deploy."
fi

# --- Prisma (somente validate; sem migrate) ---
log "=== PRISMA VALIDATE (sem migrate) ==="
if [[ -z "${DATABASE_URL:-}" && -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
[[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL não definida (exporte ou configure .env)"
# Não imprime DATABASE_URL
npx prisma validate
log "prisma validate OK"

# --- npm script de validação estrutural ---
log "=== VALIDATE TESOURARIA (dry) ==="
if npm run --silent validate:treasury:deploy; then
  log "validate:treasury:deploy OK"
else
  fail "validate:treasury:deploy falhou"
fi

log "=== PREDEPLOY CHECK OK ==="
log "Próximo passo (operador): backup confirmado → bash scripts/deploy-induscost.sh"
log "Ver: docs/treasury/PRODUCTION-DEPLOYMENT.md"
