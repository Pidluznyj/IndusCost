#!/usr/bin/env bash
# Executor de deploy do IndusCost — versionado (produção AWS e homologação). Substitui os executores editados à mão
# (/usr/local/bin/deploy-induscost-producao, /usr/local/bin/deploy-induscost-homologacao). Instalado por
# infra/deploy/install-induscost-deploy.sh, que grava o wrapper no caminho do executor antigo:
#
#   <executor> <alvo>                   deploy (alvo padrão: DEFAULT_TARGET do ambiente)
#   <executor> --check [alvo]           plano, sem alterar nada (cluster, disco, escopo e hooks só conferidos)
#   <executor> --recover                estado de uma janela interrompida (nada é alterado)
#   <executor> --recover --rollback     conclui a interrupção pelo rollback normal (banco por compatibilidade, código
#                                       anterior, serviço, janela encerrada)
#   <executor> --recover --resume       só encerra a janela (operador já conferiu banco e código)
#   <executor> --restore-backup <dir>   restauração manual após BLOQUEIO (decisão do operador)
#   <executor> --stop                   interrupção CONTROLADA do deploy em andamento (SIGTERM ao executor, que mata
#                                       só a sua árvore de processos e faz o rollback normal)
#   <executor> --abort-hard             simula uma queda (SIGKILL à árvore inteira); só para validar --recover
#   <executor> --version
#
# Diferenças entre ambientes ficam só no arquivo de ambiente (infra/deploy/environments/<env>.env → /etc/induscost/).
# Valores A_COLETAR bloqueiam a execução: ver infra/deploy/COLETA.md.
#
# Fluxo: pré-condições (cluster PostgreSQL conferido, disco, escopo da janela, hooks prévios) → backup (janela de
# manutenção, trava de escrita, prova) → código → testes isolados → build → migrations (marcador, observador, exceção
# da trava só para elas) → aplicação (ponto de controle, libera escrita, health, hooks posteriores) → encerramento da
# janela. Qualquer falha ou interrupção → rollback(): banco decidido por compatibilidade (manter / restaurar com prova
# / bloquear), código anterior reinstalado, janela encerrada só com o sistema saudável.
#
# Saídas: 0 ok; 2 BLOQUEIO (decisão manual; serviço parado; janela e trava mantidas); 3 configuração incompleta;
# 4 biblioteca/executor adulterados; 5 outro deploy em andamento; 6 modo do servidor diferente do esperado;
# 7 árvore git suja; 8 alvo não é avanço rápido; 9 hook prévio falhou (nada alterado); 30–52 códigos da biblioteca;
# 53 health da aplicação nova; 54 migration com falha registrada; 55 concluído/rollback com janela pendente; 56 serviço
# não parou; 57 commit final ≠ alvo; 58 DATABASE_URL da aplicação aponta para outro banco/porta/versão; 59 concluído,
# mas um hook pós-subida reportou ALERTA (falha a investigar que um rollback daqui não corrige; sem rollback) — também
# --recover --rollback concluído com hook pós-rollback em falha/ALERTA; 130/143
# interrompido por SIGINT/SIGTERM (rollback feito ou nada alterado); demais = etapa que falhou (npm, prisma, build).
# Toda execução que passa da leitura do ambiente termina com a linha RESULTADO: ... rc=<n> (exceto --recover sem
# --rollback, --restore-backup, --stop, --abort-hard e --version, que são utilitários).
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

# Caminho absoluto: os hooks leem a própria configuração do mesmo arquivo (IDS_ENV_FILE).
ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
# shellcheck disable=SC1090
source "$ENV_FILE"

REQUIRED=(IDS_ENV_NAME APP SERVICE DB HEALTH BACKUP_ROOT LOCK GIT_REMOTE DEFAULT_TARGET EXECUTOR_PATH APP_MARK_PATTERN CRON_GLOB UNIT_GLOB EXPECTED_MODE PRECUTOVER_EXPECTED START_SERVICE_POLICY
  IDS_PG_OS_USER IDS_PG_BIN IDS_PG_HOST IDS_PG_PORT IDS_PG_ADMIN_ROLE IDS_PG_EXPECT_MAJOR HOOKS_PRE_DEPLOY HOOKS_POST_START HOOKS_POST_ROLLBACK)
missing=()
for v in "${REQUIRED[@]}"; do
  if [[ -z "${!v:-}" || "${!v}" == *A_COLETAR* ]]; then missing+=("$v"); fi
done
if (( ${#missing[@]} > 0 )); then
  echo "ERRO: configuração de ambiente incompleta em $ENV_FILE (ver infra/deploy/COLETA.md): ${missing[*]}"
  exit 3
fi
# Qualquer A_COLETAR fora de comentário bloqueia, mesmo numa chave opcional (MODE_FILE, PRECUTOVER_DROPIN, hooks...).
if grep -qE '^[^#]*A_COLETAR' "$ENV_FILE"; then
  echo "ERRO: chaves A_COLETAR em $ENV_FILE (ver infra/deploy/COLETA.md):"
  grep -nE '^[^#]*A_COLETAR' "$ENV_FILE" | sed 's/^/  /'
  exit 3
fi
if [[ "$EXPECTED_MODE" != none && -z "${MODE_FILE:-}" ]]; then echo "ERRO: EXPECTED_MODE exige MODE_FILE"; exit 3; fi
if [[ "$PRECUTOVER_EXPECTED" != none && -z "${PRECUTOVER_DROPIN:-}" ]]; then echo "ERRO: PRECUTOVER_EXPECTED exige PRECUTOVER_DROPIN"; exit 3; fi
case "$START_SERVICE_POLICY" in if-was-active|always) ;; *) echo "ERRO: START_SERVICE_POLICY='$START_SERVICE_POLICY' (if-was-active | always)"; exit 3 ;; esac
# Globs: um único padrão, sem espaço/barra/aspas (um segundo termo seria expandido relativo ao cwd); a biblioteca
# acrescenta .timer/.service ao UNIT_GLOB.
glob_re='^[]A-Za-z0-9_.*?@[-]+$'
for v in CRON_GLOB UNIT_GLOB; do
  if [[ ! "${!v}" =~ $glob_re ]]; then echo "ERRO: $v='${!v}' precisa ser um único padrão sem espaço, barra ou aspas"; exit 3; fi
done
if [[ "$UNIT_GLOB" == *.timer || "$UNIT_GLOB" == *.service ]]; then echo "ERRO: UNIT_GLOB='$UNIT_GLOB' sem sufixo .timer/.service (a biblioteca acrescenta)"; exit 3; fi
case "${HOOKS_POST_START_FAILURE:-rollback}" in rollback|warn) ;; *) echo "ERRO: HOOKS_POST_START_FAILURE='$HOOKS_POST_START_FAILURE' (rollback | warn)"; exit 3 ;; esac

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

# PostgreSQL (G7): usuário do SO que executa os clientes (none = o usuário atual), diretório dos binários (PATH = os
# do PATH), socket/host, porta, papel administrador e versão maior esperada. Tudo explícito: num host com dois
# clusters, os padrões do libpq levariam ao cluster errado.
if [[ "$IDS_PG_OS_USER" == none ]]; then
  export IDS_PG="" IDS_PG_USER=""
else
  export IDS_PG="runuser -u $IDS_PG_OS_USER --" IDS_PG_USER="$IDS_PG_OS_USER"
fi
[[ "$IDS_PG_BIN" == PATH ]] && IDS_PG_BIN=""
export IDS_PG_BIN IDS_PG_HOST IDS_PG_PORT IDS_PG_ADMIN_ROLE IDS_PG_EXPECT_MAJOR
export IDS_PG_MAINT_DB="${IDS_PG_MAINT_DB:-postgres}"
# "none" = confirmado que não há nada a proteger (vazio sem coleta fica A_COLETAR no arquivo de ambiente).
export IDS_PROTECTED_DATABASES="${PROTECTED_DATABASES:-}"
export IDS_PROTECTED_UNITS="${PROTECTED_UNITS:-}"
[[ "$IDS_PROTECTED_DATABASES" == none ]] && IDS_PROTECTED_DATABASES=""
[[ "$IDS_PROTECTED_UNITS" == none ]] && IDS_PROTECTED_UNITS=""
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
TIMEOUT="${IDS_TIMEOUT:-timeout}"
HEALTH_TRIES="${HEALTH_TRIES:-60}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"
HOOK_TIMEOUT="${HOOK_TIMEOUT:-300}"
PIDFILE="${IDS_PIDFILE:-$(dirname "$IDS_MAINT_FLAG")/deploy-$IDS_ENV_NAME.pid}"

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

# Hooks: o que o executor antigo fazia além deste fluxo (saúde da AWS e do gateway, BrasilAPI/cnpj.ws) entra como
# executáveis listados por fase no arquivo de ambiente ("none" = nenhum). Exigências: caminho absoluto (ou
# @release/<caminho>, um arquivo desta release, coberto pelo MANIFEST), do root, não gravável por grupo/outros, com
# prazo. O executor nunca altera drop-ins, firewall ou egress, e recusa listar o atualizador de egress como hook (ele
# reinicia a homologação: só o operador o executa).
# Contexto entregue a cada hook: IDS_DEPLOY_PHASE, IDS_TARGET, IDS_OLD_COMMIT, IDS_BACKUP_DIR, IDS_ENV_NAME,
# IDS_ENV_FILE, IDS_DEPLOY_RUN_ID e IDS_HOOK_CONTEXT_DIR (diretório 0700 só desta execução, onde um hook prévio guarda o
# que um hook posterior compara — também na retomada por --recover --rollback). Saída IDS_HOOK_RC_ALERT (10) de um hook
# posterior = ALERTA: o deploy segue sem rollback e termina com 59; qualquer outra ≠ 0 segue a política da fase.
IDS_HOOK_RC_ALERT=10
hooks_of() {
  local v="${!1:-}" h
  [[ "$v" == none ]] && return 0
  local -a list
  # -d '': a lista inteira, mesmo que o valor tenha quebras de linha (nenhum hook é descartado em silêncio).
  read -r -d '' -a list <<< "$v" || true
  for h in "${list[@]}"; do
    [[ "$h" == @release/* ]] && h="$SELF_DIR/${h#@release/}"
    printf '%s\n' "$h"
  done
}

validate_hooks() {
  local phase h mode
  for phase in HOOKS_PRE_DEPLOY HOOKS_POST_START HOOKS_POST_ROLLBACK; do
    for h in $(hooks_of "$phase"); do
      if [[ "$h" != /* || ! -f "$h" || ! -x "$h" ]]; then
        echo "ERRO: $phase: '$h' não é um executável com caminho absoluto"
        exit 3
      fi
      if [[ "$(basename "$h")" == update-induscost-*egress* ]]; then
        echo "ERRO: $phase: $h altera drop-in/egress e reinicia o serviço; não pode ser hook (o operador o executa à parte)"
        exit 3
      fi
      if [[ "$(uname -s)" == Linux ]]; then
        if [[ "$(stat -c %u "$h")" != 0 ]]; then echo "ERRO: $phase: $h precisa pertencer ao root"; exit 3; fi
        mode="$(stat -c %a "$h")"
        if [[ "${mode: -2:1}" == [2367] || "${mode: -1}" == [2367] ]]; then echo "ERRO: $phase: $h gravável por grupo/outros (modo $mode)"; exit 3; fi
      fi
    done
  done
}

# Executa os hooks de uma fase; ≠ 0 = código do primeiro que falhou. Um ALERTA (só nas fases posteriores) não
# interrompe os demais hooks da fase: a fase devolve IDS_HOOK_RC_ALERT se nenhum falhou de fato.
run_hooks() {
  local phase="$1" h rc alert=0
  for h in $(hooks_of "$phase"); do
    echo "--- hook $phase: $h"
    rc=0
    IDS_DEPLOY_PHASE="$phase" IDS_TARGET="${TARGET:-}" IDS_OLD_COMMIT="${OLD_COMMIT:-}" IDS_BACKUP_DIR="${BACKUP_DIR:-}" \
      IDS_ENV_NAME="$IDS_ENV_NAME" IDS_ENV_FILE="$ENV_FILE" IDS_DEPLOY_RUN_ID="${RUN_ID:-}" IDS_HOOK_CONTEXT_DIR="${HOOK_CONTEXT_DIR:-}" \
      IDS_HOOK_RC_ALERT="$IDS_HOOK_RC_ALERT" IDS_APP_STARTED="${HOOK_APP_STARTED:-1}" $TIMEOUT "$HOOK_TIMEOUT" "$h" 9>&- || rc=$?
    if [[ "$rc" == 0 ]]; then
      echo "--- hook $phase: $h OK"
    elif [[ "$rc" == "$IDS_HOOK_RC_ALERT" && "$phase" != HOOKS_PRE_DEPLOY ]]; then
      echo "ALERTA: hook $phase: $h reportou falha que não pede rollback (RC=$rc)"
      alert=1
    else
      echo "ERRO: hook $phase: $h falhou (RC=$rc)"
      return "$rc"
    fi
  done
  [[ "$alert" == 0 ]] || return "$IDS_HOOK_RC_ALERT"
}

# Contexto dos hooks desta execução: identificador único (data, pid, aleatório) e diretório 0700 próprio, criado
# vazio. Um hook posterior só compara com o que um hook prévio DESTA execução gravou — nunca com o de outro deploy.
RUN_ID=""
HOOK_CONTEXT_DIR=""
new_hook_context() {
  local rnd
  rnd="$(od -An -N6 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')" || rnd=""
  [[ -n "$rnd" ]] || rnd="$(printf '%04x%04x%04x' "$RANDOM" "$RANDOM" "$RANDOM")"
  RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$-$rnd"
  HOOK_CONTEXT_DIR="$IDS_STATE_DIR/hook-context/$RUN_ID"
  # mkdir sem -p: falha se já existir (identificador repetido nunca reaproveita contexto); umask 077 → 0700.
  mkdir -p "$IDS_STATE_DIR/hook-context" && chmod 0700 "$IDS_STATE_DIR" "$IDS_STATE_DIR/hook-context" && (umask 077 && mkdir "$HOOK_CONTEXT_DIR")
}

# pid gravado no PIDFILE pertence a um executor vivo? (confere a linha de comando quando /proc existe)
executor_pid() {
  local pid
  pid="$(cat "$PIDFILE" 2>/dev/null)" || return 1
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null || return 1
  if [[ -r "$IDS_PROC_DIR/$pid/cmdline" ]] && ! tr '\0' ' ' < "$IDS_PROC_DIR/$pid/cmdline" | grep -q "induscost-deploy-executor"; then
    return 1
  fi
  printf '%s\n' "$pid"
}

ACTION="${1:-}"
case "$ACTION" in
  --version)
    echo "induscost-deploy-executor ambiente=$IDS_ENV_NAME biblioteca=v$IDS_VERSION dir=$SELF_DIR"
    exit 0
    ;;
  --stop|--abort-hard)
    # Antes da trava: o executor em andamento é quem a segura.
    pid="$(executor_pid)" || { echo "nenhum executor em andamento ($PIDFILE)"; exit 1; }
    echo "executor em andamento: pid $pid; árvore: $(ids_descendants "$pid" | tr '\n' ' ')"
    if [[ "$ACTION" == --stop ]]; then
      kill -s TERM "$pid"
      echo "SIGTERM enviado ao executor $pid: ele interrompe a etapa atual e faz o rollback; acompanhe a saída dele."
    else
      echo "ATENÇÃO: simulação de queda — SIGKILL em toda a árvore, sem rollback; depois: $IDS_EXECUTOR_NAME --recover"
      ids_kill_tree "$pid" KILL
    fi
    exit 0
    ;;
esac

# Um executor por vez — inclusive recuperação e restauração manual. O descritor da trava é fechado nos filhos
# (subshell de deploy, hooks, observador): uma queda do executor nunca deixa o lock preso num órfão.
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "ERRO: outro deploy em andamento ($LOCK)"
  exit 5
fi
export IDS_LOCK_FD=9
mkdir -p "$(dirname "$PIDFILE")"
printf '%s\n' "$$" > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT

# Linha final única, para o operador e para o arquivamento da saída.
finish() {
  local rc="$1" what="$2"
  echo "RESULTADO: $what ambiente=$IDS_ENV_NAME rc=$rc alvo=${TARGET:-?} anterior=${OLD_COMMIT:-?} backup=${BACKUP_DIR:-nenhum}"
  exit "$rc"
}

# Interrupção controlada (SIGTERM/SIGINT, inclusive via --stop), ativa desde o início: antes da etapa de deploy o
# sinal só fica registrado (a etapa em curso — espera por rotinas, backup — termina ou é interrompida pela
# biblioteca) e o executor aborta/faz o rollback em seguida; durante a etapa de deploy, só a árvore do subshell
# recebe TERM e o executor segue para o rollback normal. Um segundo sinal durante o rollback é ignorado.
DEPLOY_PID=""
INTERRUPTED=""
on_signal() {
  INTERRUPTED="$1"
  echo
  if [[ -n "$DEPLOY_PID" ]]; then
    echo "!!! SIG$1 recebido: interrompendo a etapa atual (pid $DEPLOY_PID e descendentes) e iniciando o rollback"
    ids_kill_tree "$DEPLOY_PID" TERM
  else
    echo "!!! SIG$1 recebido: registrado; a etapa em curso termina e o executor aborta com o sistema de volta"
  fi
}
trap 'on_signal TERM' TERM
trap 'on_signal INT' INT

# A URL que as migrations usam (DATABASE_URL do .env da aplicação) precisa chegar ao MESMO banco, porta e versão
# que a biblioteca confere — senão as migrations iriam para outro lugar (ex.: o PostgreSQL 12) sem nenhuma prova.
assert_app_database_url() {
  local url info db port vernum
  url="$(env_value "$APP/.env" DATABASE_URL)" || { echo "ERRO: DATABASE_URL ausente em $APP/.env"; return 58; }
  info="$("$(ids_pg_bin psql)" -X -At -d "${url%%\?*}" -c "SELECT format('%s|%s|%s', current_database(), current_setting('port'), current_setting('server_version_num'))" 2>&1)" || { echo "ERRO: DATABASE_URL da aplicação não conecta: ${info//$'\r'/}"; return 58; }
  IFS='|' read -r db port vernum <<< "${info//$'\r'/}"
  if [[ "$db" != "$DB" || "$port" != "$IDS_PG_PORT" || "$(( ${vernum:-0} / 10000 ))" != "$IDS_PG_EXPECT_MAJOR" ]]; then
    echo "ERRO: DATABASE_URL da aplicação aponta para banco=$db porta=$port versão=$(( ${vernum:-0} / 10000 )); esperado $DB/$IDS_PG_PORT/$IDS_PG_EXPECT_MAJOR"
    return 58
  fi
  echo "DATABASE_URL da aplicação conferida: $db na porta $port (PostgreSQL $(( vernum / 10000 )))"
}

# Variáveis de contexto do deploy (também recuperadas do backup em --recover --rollback).
OLD_COMMIT=""
TARGET=""
TS=""
BACKUP_DIR=""
DB_BACKUP=""
SERVICE_WAS_ACTIVE=1

rollback() {
  local reason="${1:-falha desconhecida}" DB_RC NPM_RC=0 PRISMA_RC=0 BUILD_RC=0 HEALTH_RC=0 HOOK_RC=0 MAINT_RC=0
  set +e
  trap '' TERM INT
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
    echo "Ver $BACKUP_DIR/restore-journal. Depois de resolver: $IDS_EXECUTOR_NAME --recover --rollback"
    return "$DB_RC"
  fi
  if [[ ! -d "$APP/.git" ]]; then echo "ERRO: $APP não é um checkout git; código não revertido"; return 1; fi

  echo "--- código ---"
  cd "$APP" || return 1
  local GIT_RC=0
  git reset --hard "$OLD_COMMIT" 9>&- || GIT_RC=$?
  [[ "$(git rev-parse HEAD 2>/dev/null)" == "$OLD_COMMIT" ]] || GIT_RC=${GIT_RC/#0/1}
  if [[ "$GIT_RC" != 0 ]]; then
    echo "ERRO: git reset --hard $OLD_COMMIT falhou (RC=$GIT_RC); HEAD=$(git rev-parse HEAD 2>/dev/null || echo '?')"
    [[ -f "$APP/.git/index.lock" ]] && echo "  $APP/.git/index.lock existe: lock órfão de um git interrompido; conferir que nenhum git roda e remover à mão"
    echo "  código NÃO reinstalado e serviço NÃO religado; depois de corrigir: $IDS_EXECUTOR_NAME --recover --rollback"
    echo "Git RC:        $GIT_RC"
    return 1
  fi
  npm ci 9>&- || NPM_RC=$?
  ./node_modules/.bin/prisma generate 9>&- || PRISMA_RC=$?
  npm run build 9>&- || BUILD_RC=$?
  if [[ "$SERVICE_WAS_ACTIVE" == 1 || "$START_SERVICE_POLICY" == always ]]; then
    # A trava de escrita vale para sessões NOVAS: o pool da aplicação abre as suas na subida, então ela sai antes.
    ids_write_lock_off "$DB" || true
    $SYSTEMCTL start "$SERVICE" || HEALTH_RC=1
    if [[ "$HEALTH_RC" == 0 ]]; then health_ok || HEALTH_RC=1; fi
    if [[ "$HEALTH_RC" != 0 ]]; then $SYSTEMCTL stop "$SERVICE" >/dev/null 2>&1; $SYSTEMCTL reset-failed "$SERVICE" >/dev/null 2>&1; fi
    if [[ "$HEALTH_RC" == 0 ]]; then run_hooks HOOKS_POST_ROLLBACK || HOOK_RC=$?; fi
  else
    # Serviço mantido parado: os hooks pós-rollback (só verificações) rodam mesmo assim, sem a aplicação no ar.
    HOOK_APP_STARTED=0 run_hooks HOOKS_POST_ROLLBACK || HOOK_RC=$?
  fi
  # Um hook pós-rollback que reportou falha/ALERTA não muda o rollback, mas aparece no resultado (e 59 na retomada).
  [[ "$HOOK_RC" != 0 && -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]] && : > "$BACKUP_DIR/hook-alert-rollback"
  echo "Banco:  $(grep '^decision=' "$BACKUP_DIR/rollback-decision.txt" 2>/dev/null | tail -n 1)"
  echo "Git RC:        $GIT_RC"
  echo "npm ci RC:     $NPM_RC"
  echo "Prisma RC:     $PRISMA_RC"
  echo "Build RC:      $BUILD_RC"
  echo "Health RC:     $HEALTH_RC"
  echo "Hooks RC:      $HOOK_RC (HOOKS_POST_ROLLBACK; falha só avisa)"
  if [[ "$NPM_RC" == 0 && "$PRISMA_RC" == 0 && "$BUILD_RC" == 0 && "$HEALTH_RC" == 0 ]]; then
    ids_maintenance_end || MAINT_RC=$?
    if [[ "$MAINT_RC" != 0 ]]; then
      echo "ROLLBACK CONCLUÍDO COM JANELA PENDENTE (RC=$MAINT_RC): código e serviço de volta, mas algum agendamento/trava não foi retomado; conferir e rodar $IDS_EXECUTOR_NAME --recover --resume"
      return 55
    fi
    echo "ROLLBACK AUTOMÁTICO CONCLUÍDO (janela RC=$MAINT_RC)"
    return 0
  fi
  echo "ATENÇÃO: ROLLBACK NÃO FICOU SAUDÁVEL — agendamentos continuam pausados; conferir e rodar $IDS_EXECUTOR_NAME --recover --rollback"
  return 1
}

# Contexto de um deploy interrompido, a partir do diretório de backup registrado na janela.
load_interrupted_context() {
  BACKUP_DIR="$(sed -n 's/^deploy //p' "$(ids_state_file)" 2>/dev/null | tail -n 1)"
  [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR" && -f "$BACKUP_DIR/commit-before.txt" ]] || return 1
  OLD_COMMIT="$(cat "$BACKUP_DIR/commit-before.txt")"
  TARGET="$(cat "$BACKUP_DIR/commit-target.txt" 2>/dev/null || echo "?")"
  TS="$(basename "$BACKUP_DIR")"
  DB_BACKUP="$BACKUP_DIR/database-before.dump"
  SERVICE_WAS_ACTIVE="$(cat "$BACKUP_DIR/service-was-active" 2>/dev/null || echo 1)"
  # Contexto dos hooks do deploy interrompido (os pós-rollback comparam com o que os prévios dele gravaram).
  RUN_ID="$(cat "$BACKUP_DIR/deploy-run-id" 2>/dev/null || true)"
  if [[ "$RUN_ID" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9]+-[0-9a-f]+$ && -d "$IDS_STATE_DIR/hook-context/$RUN_ID" ]]; then
    HOOK_CONTEXT_DIR="$IDS_STATE_DIR/hook-context/$RUN_ID"
  else
    RUN_ID=""
    HOOK_CONTEXT_DIR=""
  fi
}

case "$ACTION" in
  --recover)
    ids_assert_cluster || exit $?
    ids_recover_db_state "$DB" "" || exit $?
    # Observador das migrations de um executor morto: parado pelo diretório registrado na janela.
    if [[ -f "$(ids_state_file)" ]] && load_interrupted_context; then ids_migrate_watch_stop "$BACKUP_DIR"; fi
    if [[ -f "$(ids_state_file)" && -n "$BACKUP_DIR" && -f "$BACKUP_DIR/app-started" ]]; then
      echo "ATENÇÃO: a aplicação nova JÁ SUBIU neste deploy (app-started): a interrupção foi depois das migrations/health. Use --recover --resume (só encerra a janela); --recover --rollback desfaria um deploy concluído e exige --force-rollback."
    fi
    if [[ "${2:-}" == "--rollback" ]]; then
      validate_hooks
      [[ -f "$(ids_state_file)" ]] || { echo "nenhuma janela de manutenção pendente"; exit 0; }
      [[ -n "$BACKUP_DIR" ]] || { echo "ERRO: a janela pendente não tem diretório de backup registrado; use --recover --resume depois de conferir"; exit 3; }
      if [[ -f "$BACKUP_DIR/app-started" && "${3:-}" != "--force-rollback" ]]; then echo "ERRO: aplicação nova já subiu; --recover --resume, ou --recover --rollback --force-rollback para desfazer mesmo assim"; exit 3; fi
      $SYSTEMCTL is-active --quiet "$SERVICE" && { echo "ERRO: $SERVICE está ativo; pare-o antes de concluir o rollback"; exit 3; }
      echo "Retomando a interrupção: backup $BACKUP_DIR, commit anterior $OLD_COMMIT, alvo $TARGET"
      rollback "retomada após interrupção (--recover --rollback)"
      rc=$?
      [[ "$rc" == 2 ]] && finish 2 "BLOQUEIO na retomada"
      [[ "$rc" == 0 && -f "$BACKUP_DIR/hook-alert-rollback" ]] && finish 59 "ROLLBACK CONCLUÍDO COM ALERTA (retomada; hook pós-rollback)"
      [[ "$rc" == 0 ]] && finish 0 "ROLLBACK CONCLUÍDO (retomada)"
      [[ "$rc" == 55 ]] && finish 55 "ROLLBACK CONCLUÍDO COM JANELA PENDENTE (retomada)"
      finish "$rc" "RETOMADA INCOMPLETA"
    fi
    ids_maintenance_recover "${2:-}"
    exit $?
    ;;
  --restore-backup)
    dir="${2:-}"
    [[ -d "$dir" && -f "$dir/database-before.dump" ]] || { echo "ERRO: informe o diretório do backup do deploy"; exit 3; }
    # Só backups deste ambiente (sob BACKUP_ROOT, sem links) e deste banco/cluster (backup-meta.txt).
    root_real="$(cd "$BACKUP_ROOT" 2>/dev/null && pwd -P)" || { echo "ERRO: BACKUP_ROOT $BACKUP_ROOT não existe"; exit 3; }
    if [[ "$(cd "$dir" && pwd -P)" != "$root_real"/* ]]; then echo "ERRO: $dir não está sob $BACKUP_ROOT"; exit 3; fi
    if [[ -L "$dir" || -L "$dir/database-before.dump" || -L "$dir/backup-meta.txt" ]]; then echo "ERRO: $dir ou o dump é um link simbólico; só arquivos regulares do executor"; exit 3; fi
    $SYSTEMCTL is-active --quiet "$SERVICE" && { echo "ERRO: pare $SERVICE antes de restaurar"; exit 3; }
    ids_assert_cluster || exit $?
    ids_recover_db_state "$DB" "$dir" || exit $?
    ids_assert_backup_matches "$dir" "$DB" || exit $?
    ids_write_lock_on "$DB" || exit $?
    ids_assert_quiescent "$DB" || exit $?
    rc=0
    ids_restore_db_safely "$DB" "$dir/database-before.dump" "$(basename "$dir")" || rc=$?
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
validate_hooks
if [[ -f "$(ids_state_file)" ]]; then
  ids_maintenance_recover || true
  if load_interrupted_context && [[ -f "$BACKUP_DIR/app-started" ]]; then
    echo "ERRO: janela de um deploy interrompido DEPOIS de a aplicação nova subir está aberta. Conferir e rodar: $IDS_EXECUTOR_NAME --recover --resume (não --rollback)"
  else
    echo "ERRO: janela de manutenção de um deploy interrompido está aberta. Conferir e rodar: $IDS_EXECUTOR_NAME --recover --rollback (ou --recover --resume)"
  fi
  finish 46 "RECUSADO (janela pendente)"
fi
ids_assert_cluster || finish $? "RECUSADO (cluster)"
ids_assert_not_protected_db "$DB" || finish $? "RECUSADO (banco protegido)"
if [[ "$CHECK_ONLY" == 1 ]]; then
  # Só leitura: um banco fechado para conexões é relatado, não reaberto (isso é do --recover).
  allow="$(ids_psql "$IDS_PG_MAINT_DB" "SELECT datallowconn FROM pg_database WHERE datname = '$DB'")" || { echo "ERRO: banco $DB não encontrado no cluster"; finish 45 "RECUSADO (banco ausente)"; }
  [[ "$allow" == t || "$allow" == true ]] || echo "ATENÇÃO: $DB está fechado para conexões (datallowconn=$allow); rode $IDS_EXECUTOR_NAME --recover"
else
  ids_recover_db_state "$DB" "" || finish $? "RECUSADO (banco)"
fi
ids_assert_disk_space "$DB" "$BACKUP_ROOT" || finish $? "RECUSADO (disco)"
ids_assert_isolation_scope || finish $? "RECUSADO (escopo da janela)"
assert_app_database_url || finish $? "RECUSADO (DATABASE_URL da aplicação)"

cd "$APP" || finish 3 "RECUSADO (APP inexistente)"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || finish 3 "RECUSADO ($APP não é um checkout git legível por este usuário; ver dono do .git e git config safe.directory)"
git fetch --quiet "$GIT_REMOTE" 9>&- || finish 8 "RECUSADO (git fetch $GIT_REMOTE falhou)"
OLD_COMMIT="$(git rev-parse HEAD)"
TARGET="$(git rev-parse --verify "${TARGET_REQUESTED}^{commit}")" || finish 8 "RECUSADO (alvo $TARGET_REQUESTED não resolvido)"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "ERRO: árvore de $APP com alterações locais:"
  git status --short --untracked-files=no
  finish 7 "RECUSADO (árvore suja)"
fi
if ! git merge-base --is-ancestor "$OLD_COMMIT" "$TARGET"; then
  echo "ERRO: $TARGET não é avanço rápido de $OLD_COMMIT"
  finish 8 "RECUSADO (alvo não é avanço rápido)"
fi

echo "===== 2/11 PLANO ====="
echo "Atual:  $OLD_COMMIT"
echo "Alvo:   $TARGET"
mapfile -t TEST_FILES < <(git diff --name-only --diff-filter=d "$OLD_COMMIT" "$TARGET" -- '*.test.ts' '*.test.tsx')
mapfile -t NEW_MIGRATIONS < <(git diff --name-only --diff-filter=A "$OLD_COMMIT" "$TARGET" -- 'prisma/migrations/*/migration.sql' | sed -n 's#^prisma/migrations/\([^/]*\)/migration.sql$#\1#p')
echo "Commits:          $(git rev-list --count "$OLD_COMMIT..$TARGET")"
echo "Testes alterados: ${#TEST_FILES[@]}"
echo "Migrations novas: ${#NEW_MIGRATIONS[@]} ${NEW_MIGRATIONS[*]:-}"
echo "Hooks prévios:    $(hooks_of HOOKS_PRE_DEPLOY | tr '\n' ' ')"
echo "Hooks pós-subida: $(hooks_of HOOKS_POST_START | tr '\n' ' ')(falha: ${HOOKS_POST_START_FAILURE:-rollback})"
echo "Hooks pós-rollback: $(hooks_of HOOKS_POST_ROLLBACK | tr '\n' ' ')"

if [[ "$CHECK_ONLY" == 1 ]]; then
  echo "Modo --check: nada foi alterado (só as referências remotas do git foram atualizadas; hooks não executados)."
  finish 0 "CHECK OK"
fi
if [[ "$OLD_COMMIT" == "$TARGET" ]]; then
  echo "Nada para instalar."
  finish 0 "NADA PARA INSTALAR"
fi
new_hook_context || finish 9 "ABORTADO (contexto dos hooks em $IDS_STATE_DIR/hook-context não criado)"
echo "Execução:         $RUN_ID (contexto dos hooks: $HOOK_CONTEXT_DIR)"
if ! run_hooks HOOKS_PRE_DEPLOY; then
  echo "ERRO: verificação prévia falhou — deploy abortado; nada foi alterado."
  finish 9 "ABORTADO (hook prévio)"
fi
# Sinal recebido durante as verificações prévias (o bash só o trata quando o hook termina): aborta ANTES de parar o
# serviço, sem derrubar e religar a aplicação à toa.
interrupted_rc() { [[ "$INTERRUPTED" == INT ]] && echo 130 || echo 143; }
if [[ -n "$INTERRUPTED" ]]; then finish "$(interrupted_rc)" "ABORTADO (SIG$INTERRUPTED durante as verificações prévias; nada alterado)"; fi

echo "===== 3/11 BACKUP E JANELA DE MANUTENÇÃO ====="
TS="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$(ids_prepare_backup_dir "$BACKUP_ROOT" "$TS")" || finish $? "ABORTADO (diretório de backup)"
[[ "$BACKUP_DIR" == /* && -d "$BACKUP_DIR" && "$BACKUP_DIR" != *$'\n'* ]] || { echo "ERRO: diretório de backup inválido: '$BACKUP_DIR'"; finish 30 "ABORTADO (diretório de backup)"; }
DB_BACKUP="${BACKUP_DIR}/database-before.dump"
printf '%s\n' "$OLD_COMMIT" > "$BACKUP_DIR/commit-before.txt"
printf '%s\n' "$TARGET" > "$BACKUP_DIR/commit-target.txt"
printf '%s\n' "$RUN_ID" > "$BACKUP_DIR/deploy-run-id"
git diff --stat "$OLD_COMMIT..$TARGET" > "$BACKUP_DIR/git-diff-stat.txt"

SERVICE_WAS_ACTIVE=0
if $SYSTEMCTL is-active --quiet "$SERVICE"; then
  SERVICE_WAS_ACTIVE=1
  echo "Parando $SERVICE..."
fi
printf '%s\n' "$SERVICE_WAS_ACTIVE" > "$BACKUP_DIR/service-was-active"
restart_after_abort() {
  ids_maintenance_end || true
  if [[ "$SERVICE_WAS_ACTIVE" == 1 ]]; then $SYSTEMCTL start "$SERVICE" || true; fi
}
if [[ -n "$INTERRUPTED" ]]; then finish "$(interrupted_rc)" "ABORTADO (SIG$INTERRUPTED antes de parar o serviço; nada alterado)"; fi
service_stop || { echo "ERRO: $SERVICE não parou; tentando religar"; restart_after_abort; finish 56 "ABORTADO (serviço não parou)"; }
if [[ -n "$INTERRUPTED" ]]; then restart_after_abort; finish 143 "ABORTADO (SIG$INTERRUPTED antes da janela; nada alterado)"; fi

# `cmd || { rc=$?; ... }`: dentro do `||` o $? é o status real do comando (num `if ! cmd` seria o da negação, 0).
ids_maintenance_begin "$DB" || {
  rc=$?
  echo "ERRO: janela de manutenção não abriu (RC=$rc) — deploy abortado; código e banco não foram alterados."
  restart_after_abort
  [[ -n "$INTERRUPTED" ]] && finish 143 "ABORTADO (SIG$INTERRUPTED na abertura da janela; nada alterado)"
  finish "$rc" "ABORTADO (janela)"
}
if [[ -n "$INTERRUPTED" ]]; then restart_after_abort; finish 143 "ABORTADO (SIG$INTERRUPTED antes do backup; nada alterado)"; fi
# A janela registra o backup deste deploy: --recover --rollback recupera o contexto daqui.
ids_state_add "deploy $BACKUP_DIR"
ids_backup_db "$DB" "$DB_BACKUP" 9>&- || {
  rc=$?
  echo "ERRO: backup inválido (RC=$rc) — deploy abortado; código e banco não foram alterados."
  restart_after_abort
  finish "$rc" "ABORTADO (backup)"
}
echo "Backup: $(du -h "$DB_BACKUP" | awk '{print $1}') em $BACKUP_DIR"
if [[ -n "$INTERRUPTED" ]]; then restart_after_abort; finish 143 "ABORTADO (SIG$INTERRUPTED depois do backup; nada alterado)"; fi

DEPLOY_RC=0
set +e
(
  set -Eeuo pipefail
  trap - TERM INT
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
    exit 54
  fi

  echo "===== 8/11 APLICAÇÃO ====="
  ids_open_for_app "$BACKUP_DIR" "$DB"
  if [[ "$SERVICE_WAS_ACTIVE" == 1 || "$START_SERVICE_POLICY" == always ]]; then
    $SYSTEMCTL start "$SERVICE"
    echo "===== 9/11 HEALTH ====="
    health_ok || { echo "ERRO: health $HEALTH não respondeu"; exit 53; }
    echo "Health: OK"
    HOOK_RC=0
    run_hooks HOOKS_POST_START || HOOK_RC=$?
    if [[ "$HOOK_RC" == "$IDS_HOOK_RC_ALERT" ]]; then
      echo "ALERTA: verificação pós-subida reportou falha que um rollback da homologação não corrige: deploy segue SEM rollback e termina com 59"
      : > "$BACKUP_DIR/hook-alert"
    elif [[ "$HOOK_RC" != 0 ]]; then
      if [[ "${HOOKS_POST_START_FAILURE:-rollback}" == rollback ]]; then
        echo "ERRO: verificação pós-subida falhou"
        exit 44
      fi
      echo "ATENÇÃO: verificação pós-subida falhou (HOOKS_POST_START_FAILURE=warn): deploy segue"
    fi
  else
    echo "ATENÇÃO: $SERVICE estava parado antes do deploy: mantido parado (START_SERVICE_POLICY=$START_SERVICE_POLICY); health NÃO executado."
    # Os hooks pós-subida rodam mesmo assim (IDS_APP_STARTED=0): as verificações da produção e do commit AWS não
    # dependem da aplicação. Sem aplicação no ar não há o que desfazer: qualquer falha vira ALERTA (59).
    HOOK_RC=0
    HOOK_APP_STARTED=0 run_hooks HOOKS_POST_START || HOOK_RC=$?
    if [[ "$HOOK_RC" != 0 ]]; then
      echo "ALERTA: verificação pós-deploy falhou (RC=$HOOK_RC) com $SERVICE mantido parado: sem rollback, termina com 59"
      : > "$BACKUP_DIR/hook-alert"
    fi
  fi
) 9>&- &
DEPLOY_PID=$!
wait "$DEPLOY_PID"
DEPLOY_RC=$?
if [[ -n "$INTERRUPTED" ]]; then
  for i in $(seq 1 30); do
    kill -0 "$DEPLOY_PID" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$DEPLOY_PID" 2>/dev/null; then ids_kill_tree "$DEPLOY_PID" KILL; fi
  wait "$DEPLOY_PID" 2>/dev/null
  case "$INTERRUPTED" in INT) DEPLOY_RC=130 ;; *) DEPLOY_RC=143 ;; esac
fi
trap - TERM INT
set -e

if [[ "$DEPLOY_RC" -ne 0 ]]; then
  set +e
  if [[ -n "$INTERRUPTED" ]]; then
    rollback "interrompido por SIG$INTERRUPTED (etapa de deploy)"
  else
    rollback "etapa de deploy retornou RC=$DEPLOY_RC"
  fi
  RB_RC=$?
  set -e
  rb_note=""
  [[ -f "$BACKUP_DIR/hook-alert-rollback" ]] && rb_note="; ALERTA de hook pós-rollback (ver linhas acima)"
  if [[ "$RB_RC" == 2 ]]; then finish 2 "BLOQUEIO (etapa rc=$DEPLOY_RC)"; fi
  if [[ "$RB_RC" == 0 ]]; then finish "$DEPLOY_RC" "FALHOU, ROLLBACK CONCLUÍDO (etapa rc=$DEPLOY_RC)$rb_note"; fi
  if [[ "$RB_RC" == 55 ]]; then finish 55 "FALHOU, ROLLBACK CONCLUÍDO COM JANELA PENDENTE (etapa rc=$DEPLOY_RC)$rb_note"; fi
  finish "$DEPLOY_RC" "FALHOU, ROLLBACK INCOMPLETO rc_rollback=$RB_RC (etapa rc=$DEPLOY_RC)$rb_note"
fi

# Um ALERTA pós-subida não pode sumir atrás de outro resultado (55/57): o texto do RESULTADO o carrega.
alert_note=""
[[ -f "$BACKUP_DIR/hook-alert" ]] && alert_note="; ALERTA de hook pós-subida (ver linhas ALERTA)"
echo "===== 10/11 ENCERRAMENTO DA JANELA ====="
if ! ids_maintenance_end; then
  echo "ATENÇÃO: deploy concluído, mas algum agendamento não foi retomado; conferir e rodar $IDS_EXECUTOR_NAME --recover --resume"
  finish 55 "CONCLUÍDO COM JANELA PENDENTE$alert_note"
fi

echo "===== 11/11 VALIDAÇÃO FINAL ====="
FINAL_COMMIT="$(git -C "$APP" rev-parse HEAD)"
echo "Commit em execução: $FINAL_COMMIT"
[[ "$FINAL_COMMIT" == "$TARGET" ]] || { echo "ERRO: commit final diferente do alvo"; finish 57 "COMMIT FINAL DIFERENTE DO ALVO$alert_note"; }
if [[ -f "$BACKUP_DIR/hook-alert" ]]; then
  echo "DEPLOY ($IDS_ENV_NAME) CONCLUÍDO COM ALERTA: ver as linhas ALERTA dos hooks pós-subida acima (nada foi desfeito). Backup: $BACKUP_DIR"
  finish 59 "DEPLOY CONCLUÍDO COM ALERTA (hook pós-subida; sem rollback)"
fi
echo "DEPLOY ($IDS_ENV_NAME) CONCLUÍDO. Backup: $BACKUP_DIR"
finish 0 "DEPLOY CONCLUÍDO"
