#!/usr/bin/env bash
# Deploy/validação segura — Gestão de Frota (servidor)
# Uso:
#   ./scripts/fleetServerDeployValidate.sh --validate-only
#   ./scripts/fleetServerDeployValidate.sh --with-restart
#
# Não usa: prisma db push, migrate dev, DROP, TRUNCATE.
set -euo pipefail

ROOT="${INDUSCOST_ROOT:-/opt/induscost}"
VALIDATE_ONLY=1
WITH_RESTART=0
REPORT_FILE=""

for arg in "$@"; do
  case "$arg" in
    --validate-only) VALIDATE_ONLY=1; WITH_RESTART=0 ;;
    --with-restart) VALIDATE_ONLY=0; WITH_RESTART=1 ;;
    --report=*) REPORT_FILE="${arg#--report=}" ;;
    -h|--help)
      echo "Uso: $0 [--validate-only | --with-restart] [--report=/caminho/relatorio.txt]"
      exit 0
      ;;
    *)
      echo "Argumento desconhecido: $arg" >&2
      exit 1
      ;;
  esac
done

log() { echo "[fleet-deploy] $*"; }
fail() { echo "[fleet-deploy] FALHA: $*" >&2; exit 1; }

if [[ ! -d "$ROOT" ]]; then
  fail "Diretório não encontrado: $ROOT (defina INDUSCOST_ROOT se necessário)"
fi

cd "$ROOT"

REPORT_LINES=()
record() { REPORT_LINES+=("$1"); log "$1"; }

run_step() {
  local title="$1"
  shift
  log ">>> $title"
  if "$@"; then
    record "OK: $title"
    return 0
  else
    record "FALHA: $title"
    return 1
  fi
}

FAILED=0

section_git() {
  git fetch origin
  echo "--- git status ---"
  git status --branch --short
  echo "--- commits em origin/main não presentes em HEAD ---"
  git log HEAD..origin/main --oneline || true
  echo "--- commits locais não em origin/main ---"
  git log origin/main..HEAD --oneline || true

  BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
  if [[ "${BEHIND:-0}" -gt 0 ]]; then
    log "Local atrás de origin/main ($BEHIND commit(s)). Executando git pull --rebase origin main"
    git pull --rebase origin main
  fi
  record "Commit atual: $(git rev-parse HEAD) ($(git log -1 --format='%s'))"
}

section_migrate() {
  if [[ -z "${DATABASE_URL:-}" ]]; then
    if [[ -f .env ]]; then
      set -a
      # shellcheck disable=SC1091
      source .env
      set +a
    fi
  fi
  if [[ -z "${DATABASE_URL:-}" ]]; then
    fail "DATABASE_URL não definida (.env ou ambiente)"
  fi
  npx prisma migrate status
  npx prisma migrate deploy
}

section_prisma() {
  npx prisma validate
  npx prisma generate
}

section_tests() {
  npm run test:fleet
  npm run lint
  npm run build
}

section_db() {
  npm run fleet:db-validate
}

section_permissions_catalog() {
  local missing=0
  local keys=(
    fleet.view
    fleet.manage
    fleet.vehicles.edit
    fleet.reservations.create
    fleet.reservations.approve
    fleet.maintenance.manage
    fleet.financial.view
    fleet.settings.manage
  )
  for k in "${keys[@]}"; do
    if ! grep -q "\"$k\"" src/lib/permissionCatalog.ts 2>/dev/null; then
      echo "  ausente no catálogo: $k" >&2
      missing=$((missing + 1))
    fi
  done
  if [[ "$missing" -gt 0 ]]; then
    return 1
  fi
  record "Catálogo: 8 permissões fleet.* presentes em permissionCatalog.ts"
}

section_restart() {
  log "Reiniciando app na porta 3000 (nohup npm run dev)"
  fuser -k 3000/tcp 2>/dev/null || true
  sleep 2
  nohup npm run dev > app.log 2>&1 &
  sleep 5
  echo "--- tail app.log (100 linhas) ---"
  tail -n 100 app.log || true
  if grep -E 'Error|ECONNREFUSED|prisma.*error' app.log 2>/dev/null | tail -n 5; then
    log "AVISO: possíveis erros no app.log — revisar manualmente"
  fi
}

log "Início — ROOT=$ROOT validate_only=$VALIDATE_ONLY with_restart=$WITH_RESTART"

run_step "Git sync" section_git || FAILED=1
run_step "Prisma migrate deploy" section_migrate || FAILED=1
run_step "Prisma validate/generate" section_prisma || FAILED=1
run_step "test:fleet + lint + build" section_tests || FAILED=1
run_step "fleet:db-validate" section_db || FAILED=1
run_step "Permissões fleet.* no catálogo" section_permissions_catalog || FAILED=1

if [[ "$WITH_RESTART" -eq 1 ]]; then
  if [[ "$FAILED" -ne 0 ]]; then
    fail "Reinício abortado: etapas anteriores falharam"
  fi
  run_step "Reinício aplicação" section_restart || FAILED=1
elif [[ "$VALIDATE_ONLY" -eq 1 ]]; then
  record "Reinício omitido (--validate-only). Use --with-restart após validar."
fi

echo ""
log "========== RESUMO =========="
printf '%s\n' "${REPORT_LINES[@]}"
if [[ "$FAILED" -ne 0 ]]; then
  log "RESULTADO: FALHA — corrigir antes de uso em produção"
else
  log "RESULTADO: OK — smoke manual UI (docs/fleet/deploy-servidor.md §8)"
  log "Permissões de usuário: conferir Admin; não alteradas por este script"
fi

if [[ -n "$REPORT_FILE" ]]; then
  {
    echo "# Fleet deploy — $(date -Iseconds)"
    printf '%s\n' "${REPORT_LINES[@]}"
    echo "FAILED=$FAILED"
  } >"$REPORT_FILE"
  log "Relatório gravado em $REPORT_FILE"
fi

exit "$FAILED"
