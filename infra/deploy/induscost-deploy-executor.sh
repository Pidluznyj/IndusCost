#!/usr/bin/env bash
# Executor de deploy do IndusCost — versionado (produção AWS e homologação). Substitui os executores editados à mão
# (/usr/local/bin/deploy-induscost-producao, induscost-deploy-homologacao). Instalado por
# infra/deploy/install-induscost-deploy.sh, que grava o wrapper no caminho do executor antigo:
#
#   deploy-induscost-producao <alvo>                 deploy (alvo padrão: DEFAULT_TARGET do ambiente)
#   deploy-induscost-producao --check [alvo]         plano, sem alterar nada
#   deploy-induscost-producao --recover [--resume]   estado de uma janela interrompida / encerra a janela
#   deploy-induscost-producao --restore-backup <dir> restauração manual após BLOQUEIO (decisão do operador)
#
# Diferenças entre ambientes ficam só no arquivo de ambiente (infra/deploy/environments/<env>.env → /etc/induscost/).
# Valores A_COLETAR bloqueiam a execução: ver infra/deploy/COLETA.md.
#
# Fluxo: pré-condições → backup (janela de manutenção, trava de escrita, prova) → código → testes isolados → build
# → migrations (marcador, observador, exceção da trava só para elas) → aplicação (ponto de controle, libera escrita,
# health) → encerramento da janela. Qualquer falha → rollback(): banco decidido por compatibilidade (manter /
# restaurar com prova / bloquear), código anterior reinstalado, janela encerrada só com o sistema saudável.
#
# Saídas: 0 ok; 2 BLOQUEIO (decisão manual; serviço parado; janela e trava mantidas); 3 configuração incompleta;
# 4 biblioteca/executor adulterados; 5 outro deploy em andamento; 6 modo do servidor diferente do esperado;
# 7 árvore git suja; 8 alvo não é avanço rápido; 30–49 códigos da biblioteca; demais = etapa que falhou.
set -Eeuo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE=""
if [[ "${1:-}" == "--env-file" ]]; then
  ENV_FILE="${2:-}"
  shift 2
fi
if [[ -z "$ENV_FILE" || ! -r "$ENV_FILE" ]]; then
  echo "ERRO: informe --env-file <arquivo de ambiente legível>"
  exit 3
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

REQUIRED=(IDS_ENV_NAME APP SERVICE DB HEALTH BACKUP_ROOT LOCK GIT_REMOTE DEFAULT_TARGET EXECUTOR_PATH APP_MARK_PATTERN CRON_GLOB UNIT_GLOB EXPECTED_MODE PRECUTOVER_EXPECTED START_SERVICE_POLICY)
missing=()
for v in "${REQUIRED[@]}"; do
  if [[ -z "${!v:-}" || "${!v}" == *A_COLETAR* ]]; then missing+=("$v"); fi
done
if (( ${#missing[@]} > 0 )); then
  echo "ERRO: configuração de ambiente incompleta em $ENV_FILE (ver infra/deploy/COLETA.md): ${missing[*]}"
  exit 3
fi

# Integridade: o executor e a biblioteca precisam ser exatamente os instalados (MANIFEST gerado na instalação).
if [[ -f "$SELF_DIR/MANIFEST.sha256" ]]; then
  if ! (cd "$SELF_DIR" && sha256sum -c --quiet --strict MANIFEST.sha256 >/dev/null 2>&1); then
    echo "ERRO: executor/biblioteca diferentes do MANIFEST de $SELF_DIR — instalação adulterada; nada foi feito"
    exit 4
  fi
elif [[ "${IDS_ALLOW_UNINSTALLED:-0}" != 1 ]]; then
  echo "ERRO: executor fora de uma instalação verificada (sem MANIFEST.sha256); use install-induscost-deploy.sh"
  exit 4
fi

export IDS_APP_SERVICE="$SERVICE"
export IDS_APP_MARK_PATTERN="$APP_MARK_PATTERN"
export IDS_CRON_GLOB="$CRON_GLOB"
export IDS_UNIT_GLOB="$UNIT_GLOB"
export IDS_STATE_DIR="${IDS_STATE_DIR:-/var/lib/induscost/deploy-safety/$IDS_ENV_NAME}"
export IDS_MAINT_FLAG="${IDS_MAINT_FLAG:-/run/induscost/deploy-maintenance-$IDS_ENV_NAME}"
export IDS_EXECUTOR_NAME="$(basename "$EXECUTOR_PATH")"
# shellcheck disable=SC1091
source "$SELF_DIR/induscost-deploy-safety.sh"

SYSTEMCTL="${IDS_SYSTEMCTL:-systemctl}"
CURL="${IDS_CURL:-curl}"
HEALTH_TRIES="${HEALTH_TRIES:-60}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"

# Valor de uma chave do .env da aplicação, sem imprimir (só para montar a URL das migrations).
env_value() {
  local file="$1" key="$2" line
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$file" | tail -n 1)" || return 1
  line="${line#*=}"
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  if [[ "$line" == \"*\" || "$line" == \'*\' ]]; then line="${line:1:${#line}-2}"; fi
  printf '%s' "$line"
}

service_stop() {
  $SYSTEMCTL stop "$SERVICE" || true
  local i
  for i in $(seq 1 30); do
    $SYSTEMCTL is-active --quiet "$SERVICE" || return 0
    sleep 1
  done
  return 1
}

health_ok() {
  local i
  for i in $(seq 1 "$HEALTH_TRIES"); do
    if $CURL -fsS --max-time 5 "$HEALTH" >/dev/null 2>&1; then return 0; fi
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

check_server_mode() {
  local mode
  if [[ "$EXPECTED_MODE" != "none" ]]; then
    mode="$(cat "${MODE_FILE:-/nonexistent}" 2>/dev/null || echo "<ausente>")"
    if [[ "$mode" != "$EXPECTED_MODE" ]]; then
      echo "ERRO: modo do servidor '$mode' ≠ esperado '$EXPECTED_MODE' ($MODE_FILE)"
      exit 6
    fi
  fi
  if [[ "$PRECUTOVER_EXPECTED" != "none" ]]; then
    local present=absent
    [[ -f "${PRECUTOVER_DROPIN:-/nonexistent}" ]] && present=present
    if [[ "$present" != "$PRECUTOVER_EXPECTED" ]]; then
      echo "ERRO: drop-in de pré-cutover $PRECUTOVER_DROPIN está '$present', esperado '$PRECUTOVER_EXPECTED'"
      exit 6
    fi
  fi
}

ACTION="${1:-}"
if [[ "$ACTION" == "--version" ]]; then
  echo "induscost-deploy-executor ambiente=$IDS_ENV_NAME biblioteca=v$IDS_VERSION dir=$SELF_DIR"
  exit 0
fi

# Um executor por vez — inclusive recuperação e restauração manual.
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "ERRO: outro deploy em andamento ($LOCK)"
  exit 5
fi

case "$ACTION" in
  --recover)
    ids_recover_db_state "$DB" "" || exit $?
    ids_maintenance_recover "${2:-}"
    exit $?
    ;;
  --restore-backup)
    dir="${2:-}"
    [[ -d "$dir" && -f "$dir/database-before.dump" ]] || { echo "ERRO: informe o diretório do backup do deploy"; exit 3; }
    $SYSTEMCTL is-active --quiet "$SERVICE" && { echo "ERRO: pare $SERVICE antes de restaurar"; exit 3; }
    ids_write_lock_on "$DB" || exit $?
    ids_assert_quiescent "$DB" || exit $?
    ids_restore_db_safely "$DB" "$dir/database-before.dump" "$(basename "$dir")"
    rc=$?
    echo "Restauração manual RC=$rc. Reverter o código (git -C $APP reset --hard \$(cat $dir/commit-before.txt)), conferir e encerrar a janela: $IDS_EXECUTOR_NAME --recover --resume"
    exit "$rc"
    ;;
  --check)
    CHECK_ONLY=1
    TARGET_REQUESTED="${2:-$DEFAULT_TARGET}"
    ;;
  --*)
    echo "ERRO: opção desconhecida $ACTION"
    exit 3
    ;;
  *)
    CHECK_ONLY=0
    TARGET_REQUESTED="${ACTION:-$DEFAULT_TARGET}"
    ;;
esac

echo "===== 1/11 PRÉ-CONDIÇÕES ($IDS_ENV_NAME) ====="
check_server_mode
if [[ -f "$(ids_state_file)" ]]; then
  ids_maintenance_recover || true
  echo "ERRO: janela de manutenção de um deploy interrompido está aberta. Conferir e rodar: $IDS_EXECUTOR_NAME --recover --resume"
  exit 46
fi
ids_recover_db_state "$DB" "" || exit $?

cd "$APP"
git fetch --quiet "$GIT_REMOTE"
OLD_COMMIT="$(git rev-parse HEAD)"
TARGET="$(git rev-parse --verify "${TARGET_REQUESTED}^{commit}")"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "ERRO: árvore de $APP com alterações locais:"
  git status --short --untracked-files=no
  exit 7
fi
if ! git merge-base --is-ancestor "$OLD_COMMIT" "$TARGET"; then
  echo "ERRO: $TARGET não é avanço rápido de $OLD_COMMIT"
  exit 8
fi

echo "===== 2/11 PLANO ====="
echo "Atual:  $OLD_COMMIT"
echo "Alvo:   $TARGET"
mapfile -t TEST_FILES < <(git diff --name-only --diff-filter=d "$OLD_COMMIT" "$TARGET" -- '*.test.ts' '*.test.tsx')
mapfile -t NEW_MIGRATIONS < <(git diff --name-only --diff-filter=A "$OLD_COMMIT" "$TARGET" -- 'prisma/migrations/*/migration.sql' | sed -n 's#^prisma/migrations/\([^/]*\)/migration.sql$#\1#p')
echo "Commits:          $(git rev-list --count "$OLD_COMMIT..$TARGET")"
echo "Testes alterados: ${#TEST_FILES[@]}"
echo "Migrations novas: ${#NEW_MIGRATIONS[@]} ${NEW_MIGRATIONS[*]:-}"

if [[ "$CHECK_ONLY" == 1 ]]; then
  echo "Modo --check: nada foi alterado."
  exit 0
fi
if [[ "$OLD_COMMIT" == "$TARGET" ]]; then
  echo "Nada para instalar."
  exit 0
fi

echo "===== 3/11 BACKUP E JANELA DE MANUTENÇÃO ====="
TS="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$(ids_prepare_backup_dir "$BACKUP_ROOT" "$TS")"
DB_BACKUP="${BACKUP_DIR}/database-before.dump"
printf '%s\n' "$OLD_COMMIT" > "$BACKUP_DIR/commit-before.txt"
printf '%s\n' "$TARGET" > "$BACKUP_DIR/commit-target.txt"
git diff --stat "$OLD_COMMIT..$TARGET" > "$BACKUP_DIR/git-diff-stat.txt"

SERVICE_WAS_ACTIVE=0
if $SYSTEMCTL is-active --quiet "$SERVICE"; then
  SERVICE_WAS_ACTIVE=1
  echo "Parando $SERVICE..."
fi
service_stop || { echo "ERRO: $SERVICE não parou"; exit 30; }

restart_after_abort() {
  ids_maintenance_end || true
  if [[ "$SERVICE_WAS_ACTIVE" == 1 ]]; then $SYSTEMCTL start "$SERVICE" || true; fi
}
if ! ids_maintenance_begin "$DB"; then
  rc=$?
  echo "ERRO: janela de manutenção não abriu (RC=$rc) — deploy abortado; código e banco não foram alterados."
  restart_after_abort
  exit "$rc"
fi
if ! ids_backup_db "$DB" "$DB_BACKUP"; then
  rc=$?
  echo "ERRO: backup inválido (RC=$rc) — deploy abortado; código e banco não foram alterados."
  restart_after_abort
  exit "$rc"
fi
echo "Backup: $(du -h "$DB_BACKUP" | awk '{print $1}') em $BACKUP_DIR"

rollback() {
  local reason="${1:-falha desconhecida}" DB_RC NPM_RC=0 PRISMA_RC=0 BUILD_RC=0 HEALTH_RC=0 MAINT_RC=0
  set +e
  echo
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo "DEPLOY ($IDS_ENV_NAME) FALHOU: $reason"
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  service_stop || echo "ATENÇÃO: $SERVICE não parou"
  ids_migrate_watch_stop "$BACKUP_DIR"

  echo "--- banco ---"
  ids_rollback_db_if_needed "$BACKUP_DIR" "$DB" "$DB_BACKUP" "$TS" "$APP/prisma/migrations"
  DB_RC=$?
  if [[ "$DB_RC" == 2 ]]; then
    echo "BLOQUEIO: código continua em $TARGET; $SERVICE parado; janela de manutenção e trava de escrita mantidas."
    echo "Decisão em $BACKUP_DIR/rollback-decision.txt e $BACKUP_DIR/compat-report.txt."
    return 2
  fi
  if [[ "$DB_RC" != 0 ]]; then
    echo "FALHA AO RECUPERAR O BANCO (RC=$DB_RC): banco atual intocado; $SERVICE parado; janela mantida."
    echo "Ver $BACKUP_DIR/restore-journal. Depois de resolver: $IDS_EXECUTOR_NAME --recover --resume"
    return "$DB_RC"
  fi

  echo "--- código ---"
  cd "$APP" || return 1
  git reset --hard "$OLD_COMMIT"
  npm ci || NPM_RC=$?
  ./node_modules/.bin/prisma generate || PRISMA_RC=$?
  npm run build || BUILD_RC=$?
  if [[ "$SERVICE_WAS_ACTIVE" == 1 || "$START_SERVICE_POLICY" == always ]]; then
    $SYSTEMCTL start "$SERVICE" || HEALTH_RC=1
    if [[ "$HEALTH_RC" == 0 ]]; then health_ok || HEALTH_RC=1; fi
    if [[ "$HEALTH_RC" != 0 ]]; then $SYSTEMCTL stop "$SERVICE" >/dev/null 2>&1; $SYSTEMCTL reset-failed "$SERVICE" >/dev/null 2>&1; fi
  fi
  echo "Banco:  $(grep '^decision=' "$BACKUP_DIR/rollback-decision.txt" 2>/dev/null | tail -n 1)"
  echo "npm ci RC:     $NPM_RC"
  echo "Prisma RC:     $PRISMA_RC"
  echo "Build RC:      $BUILD_RC"
  echo "Health RC:     $HEALTH_RC"
  if [[ "$NPM_RC" == 0 && "$PRISMA_RC" == 0 && "$BUILD_RC" == 0 && "$HEALTH_RC" == 0 ]]; then
    ids_maintenance_end || MAINT_RC=$?
    echo "ROLLBACK AUTOMÁTICO CONCLUÍDO (janela RC=$MAINT_RC)"
    return 0
  fi
  echo "ATENÇÃO: ROLLBACK NÃO FICOU SAUDÁVEL — agendamentos continuam pausados; conferir e rodar $IDS_EXECUTOR_NAME --recover --resume"
  return 1
}

DEPLOY_RC=0
set +e
(
  set -Eeuo pipefail
  cd "$APP"
  echo "===== 4/11 CÓDIGO ====="
  git reset --hard "$TARGET"
  npm ci
  ./node_modules/.bin/prisma generate

  echo "===== 5/11 TESTES DO PACOTE ====="
  if (( ${#TEST_FILES[@]} > 0 )); then
    IDS_ENV_FILE="$APP/.env" ids_run_test_gate "${TEST_FILES[@]}"
    echo "Testes do pacote: OK"
  else
    echo "Nenhum teste alterado neste pacote."
  fi

  echo "===== 6/11 BUILD ====="
  npm run build

  echo "===== 7/11 MIGRATIONS ====="
  ids_mark_db_changes_started "$BACKUP_DIR" "$DB"
  ids_migrate_watch_start "$BACKUP_DIR" "$DB"
  MIGRATE_URL="$(ids_migrate_database_url "$(env_value "$APP/.env" DATABASE_URL)")"
  DATABASE_URL="$MIGRATE_URL" ./node_modules/.bin/prisma migrate deploy
  DATABASE_URL="$MIGRATE_URL" ./node_modules/.bin/prisma migrate status
  FAILED_MIGRATIONS="$(ids_psql "$DB" 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL')"
  if [[ "$FAILED_MIGRATIONS" != 0 ]]; then
    echo "ERRO: $FAILED_MIGRATIONS migration(s) com falha registrada"
    exit 41
  fi

  echo "===== 8/11 APLICAÇÃO ====="
  ids_open_for_app "$BACKUP_DIR" "$DB"
  if [[ "$SERVICE_WAS_ACTIVE" == 1 || "$START_SERVICE_POLICY" == always ]]; then
    $SYSTEMCTL start "$SERVICE"
    echo "===== 9/11 HEALTH ====="
    health_ok || { echo "ERRO: health $HEALTH não respondeu"; exit 42; }
    echo "Health: OK"
  else
    echo "$SERVICE estava parado antes do deploy: mantido parado (START_SERVICE_POLICY=$START_SERVICE_POLICY)."
  fi
)
DEPLOY_RC=$?
set -e

if [[ "$DEPLOY_RC" -ne 0 ]]; then
  set +e
  rollback "etapa de deploy retornou RC=$DEPLOY_RC"
  RB_RC=$?
  set -e
  if [[ "$RB_RC" == 2 ]]; then exit 2; fi
  exit "$DEPLOY_RC"
fi

echo "===== 10/11 ENCERRAMENTO DA JANELA ====="
if ! ids_maintenance_end; then
  echo "ATENÇÃO: deploy concluído, mas algum agendamento não foi retomado; conferir e rodar $IDS_EXECUTOR_NAME --recover --resume"
  exit 42
fi

echo "===== 11/11 VALIDAÇÃO FINAL ====="
FINAL_COMMIT="$(git -C "$APP" rev-parse HEAD)"
echo "Commit em execução: $FINAL_COMMIT"
[[ "$FINAL_COMMIT" == "$TARGET" ]] || { echo "ERRO: commit final diferente do alvo"; exit 43; }
echo "DEPLOY ($IDS_ENV_NAME) CONCLUÍDO. Backup: $BACKUP_DIR"
