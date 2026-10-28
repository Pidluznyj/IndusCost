#!/usr/bin/env bash
# Instalação reversível do executor versionado de deploy do IndusCost.
#
#   sudo bash infra/deploy/install-induscost-deploy.sh --env producao            # simulação (padrão): só mostra
#   sudo bash infra/deploy/install-induscost-deploy.sh --env producao --apply    # instala
#   sudo bash infra/deploy/install-induscost-deploy.sh --env producao --verify   # confere a instalação (só leitura)
#   sudo bash infra/deploy/install-induscost-deploy.sh --env producao --uninstall # volta ao executor anterior
#
# O que --apply faz (nada além disto):
#   1. copia biblioteca + executor para $IDS_INSTALL_ROOT/releases/<versão>/ e grava MANIFEST.sha256 (somente leitura);
#   2. copia environments/<env>.env para $IDS_INSTALL_ETC/deploy-executor-<env>.env (0600) — recusa se já existir
#      com conteúdo diferente, salvo --replace-env;
#   3. guarda o executor atual (EXECUTOR_PATH do ambiente) em $IDS_INSTALL_ROOT/backups/ e registra em install-history;
#   4. troca EXECUTOR_PATH, de forma atômica, por um wrapper que chama o executor versionado.
# Não mexe em banco, serviços, cron, timers nem no código da aplicação. --uninstall devolve o executor guardado,
# byte a byte. Recusa se houver deploy em andamento ou janela de manutenção aberta.
set -Eeuo pipefail
[[ "${IDS_INSTALL_TRACE:-0}" == 1 ]] && set -x

REPO_DEPLOY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${IDS_INSTALL_ROOT:-/usr/local/lib/induscost}"
ETC="${IDS_INSTALL_ETC:-/etc/induscost}"
ENV_NAME=""
MODE="dry-run"
REPLACE_ENV=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_NAME="${2:-}"; shift 2 ;;
    --apply) MODE=apply; shift ;;
    --verify) MODE=verify; shift ;;
    --uninstall) MODE=uninstall; shift ;;
    --dry-run) MODE=dry-run; shift ;;
    --replace-env) REPLACE_ENV=1; shift ;;
    *) echo "opção desconhecida: $1"; exit 2 ;;
  esac
done
# IDS_INSTALL_ENV_SOURCE: outro arquivo de ambiente (ensaios locais); senão, environments/<env>.env do repositório.
if [[ -z "${IDS_INSTALL_ENV_SOURCE:-}" ]]; then
  [[ "$ENV_NAME" == producao || "$ENV_NAME" == homologacao ]] || { echo "informe --env producao|homologacao"; exit 2; }
fi
[[ "$ENV_NAME" =~ ^[a-z][a-z0-9-]*$ ]] || { echo "nome de ambiente inválido"; exit 2; }
if [[ "$MODE" != dry-run && "${EUID:-$(id -u)}" != 0 && "${IDS_INSTALL_ALLOW_NONROOT:-0}" != 1 ]]; then
  echo "rode como root (sudo)"
  exit 2
fi

SRC_ENV="${IDS_INSTALL_ENV_SOURCE:-$REPO_DEPLOY/environments/$ENV_NAME.env}"
DEST_ENV="$ETC/deploy-executor-$ENV_NAME.env"
HISTORY="$ROOT/install-history"
CURRENT="$ROOT/$ENV_NAME.current"
FILES=(induscost-deploy-safety.sh induscost-deploy-executor.sh)

say() { echo "[install] $*"; }
# CR em qualquer linha. Por comparação de tamanho: o grep do Git Bash ignora o CR do fim da linha.
has_cr() { [[ "$(tr -d '\r' < "$1" | wc -c)" != "$(wc -c < "$1")" ]]; }
do_or_show() {
  if [[ "$MODE" == apply ]]; then "$@"; else say "(simulação) $*"; fi
}

# Chaves do arquivo de ambiente que o instalador usa (lidas sem exportar nada).
env_key() { (set +u; source "$SRC_ENV" >/dev/null 2>&1; printf '%s' "${!1:-}"); }
# shellcheck disable=SC1090
EXECUTOR_PATH="$(env_key EXECUTOR_PATH)"
EXPECTED_SHA="$(env_key EXECUTOR_EXPECTED_SHA256)"
LEGACY_WRAPPER="$(env_key LEGACY_WRAPPER_PATH)"
VERSION="$(cat "${FILES[@]/#/$REPO_DEPLOY/}" "$SRC_ENV" | sha256sum | cut -c1-16)"
RELEASE="$ROOT/releases/$VERSION"
WRAPPER_MARK="# Gerado por infra/deploy/install-induscost-deploy.sh"

wrapper_content() {
  printf '#!/usr/bin/env bash\n%s (versão %s, ambiente %s). Não editar.\nexec "%s/induscost-deploy-executor.sh" --env-file "%s" "$@"\n' "$WRAPPER_MARK" "$VERSION" "$ENV_NAME" "$RELEASE" "$DEST_ENV"
}
is_our_wrapper() { [[ -f "$1" ]] && grep -qF "$WRAPPER_MARK" "$1"; }
sha_of() { sha256sum "$1" | awk '{print $1}'; }

# O arquivo que será substituído é o executor antigo auditado? (sha256 esperado do arquivo de ambiente). Um wrapper
# desta instalação (reinstalação/atualização) não é conferido: o executor antigo já está guardado em backups/.
check_old_executor() {
  if [[ ! -f "$EXECUTOR_PATH" ]]; then
    if [[ -n "$EXPECTED_SHA" && "$EXPECTED_SHA" != *A_COLETAR* ]]; then say "RECUSADO: $EXECUTOR_PATH não existe, mas EXECUTOR_EXPECTED_SHA256 diz que o executor antigo deveria estar aí (caminho errado?)"; return 1; fi
    say "AVISO $EXECUTOR_PATH não existe: o wrapper será criado do zero"
    return 0
  fi
  if is_our_wrapper "$EXECUTOR_PATH"; then say "OK    $EXECUTOR_PATH é o wrapper de uma instalação anterior (reinstalação)"; return 0; fi
  if [[ -z "$EXPECTED_SHA" || "$EXPECTED_SHA" == *A_COLETAR* ]]; then
    say "AVISO sha256 de $EXECUTOR_PATH não conferido (EXECUTOR_EXPECTED_SHA256 vazio): $(sha_of "$EXECUTOR_PATH")"
    return 0
  fi
  if [[ "$(sha_of "$EXECUTOR_PATH")" != "$EXPECTED_SHA" ]]; then
    say "RECUSADO: $EXECUTOR_PATH não é o executor auditado (sha256 $(sha_of "$EXECUTOR_PATH") ≠ esperado $EXPECTED_SHA); conferir antes de instalar"
    return 1
  fi
  say "OK    $EXECUTOR_PATH é o executor auditado (sha256 confere)"
}

# O comando do operador (wrapper legado) precisa chamar EXECUTOR_PATH; senão a troca não o alcançaria.
check_legacy_wrapper() {
  [[ -n "$LEGACY_WRAPPER" && "$LEGACY_WRAPPER" != none && "$LEGACY_WRAPPER" != *A_COLETAR* ]] || return 0
  if [[ ! -e "$LEGACY_WRAPPER" ]]; then say "RECUSADO: wrapper legado $LEGACY_WRAPPER não existe"; return 1; fi
  if [[ -L "$LEGACY_WRAPPER" ]]; then
    if [[ "$(readlink -f "$LEGACY_WRAPPER")" == "$(readlink -f "$EXECUTOR_PATH")" ]]; then say "OK    $LEGACY_WRAPPER é um link simbólico para $EXECUTOR_PATH"; return 0; fi
    say "RECUSADO: $LEGACY_WRAPPER é um link simbólico para $(readlink -f "$LEGACY_WRAPPER"), não para $EXECUTOR_PATH"
    return 1
  fi
  local base code
  base="$(basename "$EXECUTOR_PATH")"
  code="$(grep -vE '^[[:space:]]*#|^[[:space:]]*$' "$LEGACY_WRAPPER")"
  # A linha que invoca o executor precisa repassar os argumentos ("$@"): senão --check/--stop/--recover do operador
  # virariam um deploy. pkill/killall/flock no wrapper interfeririam com o executor novo.
  if ! grep -E "(^|[[:space:]\"'/])${base}([[:space:]\"']|\$)" <<<"$code" | grep -qE '"\$@"|\$@|\$\*'; then
    say "RECUSADO: $LEGACY_WRAPPER não chama $base repassando os argumentos (\"\$@\"); o comando do operador não chegaria ao executor novo como esperado:"
    printf '%s\n' "$code" | head -n 20 | sed 's/^/[install]   /'
    return 1
  fi
  if grep -qE '(^|[[:space:]])(pkill|killall|flock)([[:space:]]|$)' <<<"$code"; then
    say "RECUSADO: $LEGACY_WRAPPER usa pkill/killall/flock, que interferem com o executor novo (interrupção e trava):"
    printf '%s\n' "$code" | head -n 20 | sed 's/^/[install]   /'
    return 1
  fi
  say "OK    $LEGACY_WRAPPER chama $base com \"\$@\" (conteúdo não-comentado abaixo)"
  printf '%s\n' "$code" | head -n 20 | sed 's/^/[install]   /'
}

# Executor antigo (ou wrapper legado) em execução neste momento? Leitura de /proc, sem pkill/pgrep -f.
legacy_executor_running() {
  local p cmd
  [[ -d /proc/self ]] || return 1
  for p in /proc/[0-9]*; do
    [[ "${p#/proc/}" == "$$" ]] && continue
    cmd="$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null)" || continue
    if [[ -n "$cmd" && ( "$cmd" == *"$EXECUTOR_PATH"* || ( -n "$LEGACY_WRAPPER" && "$LEGACY_WRAPPER" != none && "$cmd" == *"$LEGACY_WRAPPER"* ) ) ]]; then
      say "executor em execução: pid ${p#/proc/}: $cmd"
      return 0
    fi
  done
  return 1
}

maintenance_or_lock_busy() {
  local state_dir lock
  state_dir="$(set +u; source "$SRC_ENV" >/dev/null 2>&1; printf '%s' "${IDS_STATE_DIR:-/var/lib/induscost/deploy-safety/$ENV_NAME}")"
  lock="$(set +u; source "$SRC_ENV" >/dev/null 2>&1; printf '%s' "${LOCK:-}")"
  if [[ -f "$state_dir/maintenance.state" ]]; then say "janela de manutenção aberta ($state_dir/maintenance.state)"; return 0; fi
  if [[ -n "$lock" && -e "$lock" ]] && command -v flock >/dev/null && ! flock -n "$lock" true; then say "deploy em andamento ($lock)"; return 0; fi
  return 1
}

verify() {
  local ok=0 release
  if [[ ! -f "$CURRENT" ]]; then say "FALHA: nada instalado para $ENV_NAME ($CURRENT ausente)"; return 1; fi
  release="$(cat "$CURRENT")"
  if (cd "$release" && sha256sum -c --quiet --strict MANIFEST.sha256); then say "OK    MANIFEST de $release confere"; else say "FALHA MANIFEST de $release"; ok=1; fi
  for f in "${FILES[@]}"; do
    if cmp -s "$release/$f" "$REPO_DEPLOY/$f"; then say "OK    $f idêntico ao do repositório"; else say "AVISO $f difere do repositório em $REPO_DEPLOY (outra versão instalada)"; fi
  done
  if [[ -f "$EXECUTOR_PATH" ]] && grep -qF "exec \"$release/induscost-deploy-executor.sh\" --env-file \"$DEST_ENV\"" "$EXECUTOR_PATH"; then
    say "OK    $EXECUTOR_PATH chama $release"
  else
    say "FALHA $EXECUTOR_PATH não é o wrapper desta instalação"; ok=1
  fi
  if [[ -f "$DEST_ENV" ]] && ! grep -qE '^[^#]*A_COLETAR' "$DEST_ENV"; then say "OK    $DEST_ENV completo"; else say "FALHA $DEST_ENV ausente ou com A_COLETAR"; ok=1; fi
  if [[ -n "$EXPECTED_SHA" && "$EXPECTED_SHA" != *A_COLETAR* ]]; then
    local backup_old
    backup_old="$(awk -F'|' -v e="$ENV_NAME" '$2 == e && $3 != "uninstall" { print $5 }' "$HISTORY" 2>/dev/null | head -n 1)"
    if [[ -n "$backup_old" && -f "$backup_old" && "$(sha_of "$backup_old")" == "$EXPECTED_SHA" ]]; then say "OK    executor antigo guardado em $backup_old (sha256 confere)"; else say "FALHA executor antigo guardado ($backup_old) ausente ou com sha256 diferente do esperado"; ok=1; fi
  fi
  if [[ "$(uname -s)" == Linux ]]; then
    if [[ -f "$DEST_ENV" && "$(stat -c %a "$DEST_ENV")" != 600 ]]; then say "FALHA $DEST_ENV deveria ter permissão 600"; ok=1; fi
    if [[ -d "$ROOT/backups" && "$(stat -c '%U:%a' "$ROOT/backups")" != root:700 ]]; then say "FALHA $ROOT/backups deveria ser root:700 (executores antigos podem conter credenciais)"; ok=1; fi
    if [[ -f "$EXECUTOR_PATH" && "$(stat -c '%a' "$EXECUTOR_PATH")" =~ [2367].$|[2367]$ ]]; then say "FALHA $EXECUTOR_PATH gravável por grupo/outros"; ok=1; fi
  else
    say "AVISO permissões de arquivo não conferidas fora do Linux"
  fi
  if bash -n "$release/induscost-deploy-executor.sh" && bash -n "$release/induscost-deploy-safety.sh"; then say "OK    sintaxe"; else ok=1; fi
  local f crlf_installed=0
  for f in "$release/induscost-deploy-executor.sh" "$release/induscost-deploy-safety.sh" "$DEST_ENV" "$EXECUTOR_PATH"; do
    if [[ -f "$f" ]] && has_cr "$f"; then say "FALHA $f com fim de linha CRLF"; crlf_installed=1; fi
  done
  if [[ "$crlf_installed" == 0 ]]; then say "OK    fim de linha LF"; else ok=1; fi
  [[ "$ok" == 0 ]] && say "RESULTADO: instalação íntegra." || say "RESULTADO: instalação com problemas."
  return "$ok"
}

case "$MODE" in
  verify)
    verify
    exit $?
    ;;
  uninstall)
    if maintenance_or_lock_busy; then exit 3; fi
    if legacy_executor_running; then say "RECUSADO: deploy em andamento"; exit 3; fi
    # Desfaz as instalações deste ambiente, da mais recente para trás, até devolver um executor que não seja um
    # wrapper desta instalação (reinstalações com --replace-env guardam o wrapper anterior como backup).
    undone=0
    while :; do
      last="$(awk -F'|' -v e="$ENV_NAME" '$2 == e && $3 == "uninstall" { u[$4] = 1 } $2 == e && $3 != "uninstall" { l[++n] = $0; t[n] = $1 } END { for (i = n; i >= 1; i--) if (!(t[i] in u)) { print l[i]; exit } }' "$HISTORY" 2>/dev/null)" || true
      if [[ -z "$last" ]]; then
        [[ "$undone" == 0 ]] && { say "nada a desinstalar para $ENV_NAME"; exit 1; }
        break
      fi
      IFS='|' read -r ts _ version exec_path backup prev_current old_mode old_sha <<< "$last"
      [[ -f "$backup" ]] || { say "RECUSADO: backup $backup ausente"; exit 3; }
      say "restaurando $exec_path a partir de $backup (instalação $ts, versão $version; sha256 $(sha_of "$backup"))"
      if [[ -n "${old_sha:-}" && "$(sha_of "$backup")" != "$old_sha" ]]; then
        say "RECUSADO: $backup foi alterado depois da instalação (sha256 registrado $old_sha); conferir manualmente"
        exit 3
      fi
      if [[ -f "$exec_path" ]] && ! is_our_wrapper "$exec_path"; then
        say "RECUSADO: $exec_path já não é o wrapper desta instalação (sha256 $(sha_of "$exec_path")); conferir manualmente antes de desinstalar"
        exit 3
      fi
      if [[ ! -s "$backup" && -z "${old_sha:-}" ]]; then
        rm -f "$exec_path"
        say "não havia executor antes da instalação: $exec_path removido"
      else
        tmp="$exec_path.ids-tmp.$$"
        cp "$backup" "$tmp"
        if [[ -n "${old_mode:-}" ]]; then
          IFS=':' read -r m u g <<< "$old_mode"
          chmod "$m" "$tmp" && chown "$u:$g" "$tmp" 2>/dev/null || chmod "$m" "$tmp"
        else
          chmod 0755 "$tmp"
        fi
        mv -f "$tmp" "$exec_path"
      fi
      if [[ -n "$prev_current" ]]; then printf '%s\n' "$prev_current" > "$CURRENT"; else rm -f "$CURRENT"; fi
      printf '%s|%s|uninstall|%s|%s\n' "$(date -u +%Y%m%dT%H%M%SZ)" "$ENV_NAME" "$ts" "$exec_path" >> "$HISTORY"
      undone=$((undone + 1))
      if [[ -f "$exec_path" ]] && is_our_wrapper "$exec_path"; then say "o restaurado ainda é um wrapper desta instalação (reinstalação): desfazendo a anterior"; continue; fi
      break
    done
    say "executor anterior restaurado ($undone instalação(ões) desfeita(s); sha256 $(sha_of "$exec_path" 2>/dev/null || echo 'arquivo removido')); releases e $DEST_ENV mantidos (remoção manual)"
    exit 0
    ;;
esac

# dry-run / apply
say "ambiente:  $ENV_NAME"
say "versão:    $VERSION"
say "release:   $RELEASE"
say "executor:  $EXECUTOR_PATH (vira wrapper)"
say "ambiente:  $DEST_ENV"
if grep -qE '^[^#]*A_COLETAR' "$SRC_ENV"; then
  say "PENDENTE: $SRC_ENV tem valores A_COLETAR — o executor recusará rodar até preenchê-los (infra/deploy/COLETA.md):"
  grep -nE '^[^#]*A_COLETAR' "$SRC_ENV" | sed 's/^/[install]   /'
  [[ "$MODE" == apply ]] && { say "instalação recusada"; exit 3; }
fi
[[ "$EXECUTOR_PATH" == /* ]] || { say "EXECUTOR_PATH inválido: '$EXECUTOR_PATH'"; exit 3; }
if [[ -L "$EXECUTOR_PATH" ]]; then say "RECUSADO: $EXECUTOR_PATH é um link simbólico para $(readlink -f "$EXECUTOR_PATH"); EXECUTOR_PATH precisa ser o arquivo real"; exit 3; fi
# Fim de linha CRLF (cópia feita no Windows) quebra o bash no servidor e diverge do repositório: recusado.
crlf=()
for f in "${FILES[@]/#/$REPO_DEPLOY/}" "$SRC_ENV"; do
  if has_cr "$f"; then crlf+=("$f"); fi
done
if (( ${#crlf[@]} > 0 )); then
  say "RECUSADO: arquivo(s) com fim de linha CRLF (use um checkout git com .gitattributes, que entrega LF):"
  printf '%s\n' "${crlf[@]}" | sed 's/^/[install]   /'
  exit 3
fi
for f in "${FILES[@]}"; do bash -n "$REPO_DEPLOY/$f"; done
check_old_executor || exit 3
check_legacy_wrapper || exit 3
if maintenance_or_lock_busy; then exit 3; fi
if legacy_executor_running; then say "RECUSADO: há um deploy do executor atual em andamento; instalar só depois que terminar"; exit 3; fi
if [[ -f "$DEST_ENV" ]] && ! cmp -s "$SRC_ENV" "$DEST_ENV" && [[ "$REPLACE_ENV" != 1 ]]; then
  say "$DEST_ENV existe e difere do repositório; conferir e repetir com --replace-env:"
  diff "$DEST_ENV" "$SRC_ENV" | sed 's/^/[install]   /' || true
  exit 3
fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$ROOT/backups/$(basename "$EXECUTOR_PATH").$TS"
PREV_CURRENT="$(cat "$CURRENT" 2>/dev/null || true)"

do_or_show mkdir -p "$RELEASE" "$ROOT/backups" "$ETC"
# Mesma versão já instalada e íntegra (reinstalação): a release é reutilizada; senão os arquivos (0555) são refeitos.
if [[ -f "$RELEASE/MANIFEST.sha256" ]] && (cd "$RELEASE" && sha256sum -c --quiet --strict MANIFEST.sha256 >/dev/null 2>&1); then
  say "release $RELEASE já instalada e íntegra: reutilizada"
  REUSE_RELEASE=1
else
  REUSE_RELEASE=0
  for f in "${FILES[@]}"; do do_or_show rm -f "$RELEASE/$f" "$RELEASE/MANIFEST.sha256"; do_or_show cp "$REPO_DEPLOY/$f" "$RELEASE/$f"; done
fi
if [[ "$MODE" == apply ]]; then
  chmod 0700 "$ROOT/backups"
  if [[ "$REUSE_RELEASE" == 0 ]]; then
    (cd "$RELEASE" && sha256sum "${FILES[@]}" > MANIFEST.sha256)
    chmod 0555 "$RELEASE/induscost-deploy-executor.sh" "$RELEASE/induscost-deploy-safety.sh"
    chmod 0444 "$RELEASE/MANIFEST.sha256"
  fi
  # O arquivo de ambiente anterior (se diferente) fica guardado: --replace-env nunca perde configuração.
  if [[ -f "$DEST_ENV" ]] && ! cmp -s "$SRC_ENV" "$DEST_ENV"; then cp -p "$DEST_ENV" "$ROOT/backups/$(basename "$DEST_ENV").$TS" && chmod 0400 "$ROOT/backups/$(basename "$DEST_ENV").$TS"; say "ambiente anterior guardado em $ROOT/backups/$(basename "$DEST_ENV").$TS"; fi
  cp "$SRC_ENV" "$DEST_ENV.ids-tmp.$$" && chmod 0600 "$DEST_ENV.ids-tmp.$$" && mv -f "$DEST_ENV.ids-tmp.$$" "$DEST_ENV"
  # Executor antigo guardado só para o root (pode conter credenciais), com modo/dono e sha256 registrados para a volta.
  OLD_MODE=""; OLD_SHA=""
  if [[ -f "$EXECUTOR_PATH" ]]; then
    OLD_MODE="$(stat -c '%a:%U:%G' "$EXECUTOR_PATH" 2>/dev/null || echo '')"
    OLD_SHA="$(sha_of "$EXECUTOR_PATH")"
    cp -p "$EXECUTOR_PATH" "$BACKUP"
  else
    : > "$BACKUP"
  fi
  chmod 0400 "$BACKUP"
  printf '%s|%s|%s|%s|%s|%s|%s|%s\n' "$TS" "$ENV_NAME" "$VERSION" "$EXECUTOR_PATH" "$BACKUP" "$PREV_CURRENT" "$OLD_MODE" "$OLD_SHA" >> "$HISTORY"
  wrapper_content > "$EXECUTOR_PATH.ids-tmp.$$"
  chmod 0700 "$EXECUTOR_PATH.ids-tmp.$$"
  mv -f "$EXECUTOR_PATH.ids-tmp.$$" "$EXECUTOR_PATH"
  printf '%s\n' "$RELEASE" > "$CURRENT"
  say "instalado; executor anterior guardado em $BACKUP"
  verify
else
  say "(simulação) gravaria MANIFEST.sha256, $DEST_ENV (0600), backup $BACKUP e o wrapper:"
  wrapper_content | sed 's/^/[install]   /'
  say "nada foi alterado (use --apply)"
fi
