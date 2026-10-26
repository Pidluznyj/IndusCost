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
do_or_show() {
  if [[ "$MODE" == apply ]]; then "$@"; else say "(simulação) $*"; fi
}

# shellcheck disable=SC1090
EXECUTOR_PATH="$(set +u; source "$SRC_ENV" >/dev/null 2>&1; printf '%s' "${EXECUTOR_PATH:-}")"
VERSION="$(cat "${FILES[@]/#/$REPO_DEPLOY/}" "$SRC_ENV" | sha256sum | cut -c1-16)"
RELEASE="$ROOT/releases/$VERSION"

wrapper_content() {
  printf '#!/usr/bin/env bash\n# Gerado por infra/deploy/install-induscost-deploy.sh (versão %s, ambiente %s). Não editar.\nexec "%s/induscost-deploy-executor.sh" --env-file "%s" "$@"\n' "$VERSION" "$ENV_NAME" "$RELEASE" "$DEST_ENV"
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
  if [[ "$(uname -s)" == Linux ]]; then
    if [[ -f "$DEST_ENV" && "$(stat -c %a "$DEST_ENV")" != 600 ]]; then say "FALHA $DEST_ENV deveria ter permissão 600"; ok=1; fi
  else
    say "AVISO permissões de arquivo não conferidas fora do Linux"
  fi
  if bash -n "$release/induscost-deploy-executor.sh" && bash -n "$release/induscost-deploy-safety.sh"; then say "OK    sintaxe"; else ok=1; fi
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
    # Última instalação deste ambiente ainda não desfeita.
    last="$(awk -F'|' -v e="$ENV_NAME" '$2 == e && $3 == "uninstall" { u[$4] = 1 } $2 == e && $3 != "uninstall" { l[++n] = $0; t[n] = $1 } END { for (i = n; i >= 1; i--) if (!(t[i] in u)) { print l[i]; exit } }' "$HISTORY" 2>/dev/null)" || true
    [[ -n "$last" ]] || { say "nada a desinstalar para $ENV_NAME"; exit 1; }
    IFS='|' read -r ts _ version exec_path backup prev_current <<< "$last"
    say "restaurando $exec_path a partir de $backup (instalação $ts, versão $version)"
    tmp="$exec_path.ids-tmp.$$"
    cp -p "$backup" "$tmp"
    mv -f "$tmp" "$exec_path"
    if [[ -n "$prev_current" ]]; then printf '%s\n' "$prev_current" > "$CURRENT"; else rm -f "$CURRENT"; fi
    printf '%s|%s|uninstall|%s|%s\n' "$(date -u +%Y%m%dT%H%M%SZ)" "$ENV_NAME" "$ts" "$exec_path" >> "$HISTORY"
    say "executor anterior restaurado; releases e $DEST_ENV mantidos (remoção manual)"
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
for f in "${FILES[@]}"; do bash -n "$REPO_DEPLOY/$f"; done
if maintenance_or_lock_busy; then exit 3; fi
if [[ -f "$DEST_ENV" ]] && ! cmp -s "$SRC_ENV" "$DEST_ENV" && [[ "$REPLACE_ENV" != 1 ]]; then
  say "$DEST_ENV existe e difere do repositório; conferir e repetir com --replace-env:"
  diff "$DEST_ENV" "$SRC_ENV" | sed 's/^/[install]   /' || true
  exit 3
fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$ROOT/backups/$(basename "$EXECUTOR_PATH").$TS"
PREV_CURRENT="$(cat "$CURRENT" 2>/dev/null || true)"

do_or_show mkdir -p "$RELEASE" "$ROOT/backups" "$ETC"
for f in "${FILES[@]}"; do do_or_show cp "$REPO_DEPLOY/$f" "$RELEASE/$f"; done
if [[ "$MODE" == apply ]]; then
  (cd "$RELEASE" && sha256sum "${FILES[@]}" > MANIFEST.sha256)
  chmod 0555 "$RELEASE/induscost-deploy-executor.sh" "$RELEASE/induscost-deploy-safety.sh"
  chmod 0444 "$RELEASE/MANIFEST.sha256"
  cp "$SRC_ENV" "$DEST_ENV.ids-tmp.$$" && chmod 0600 "$DEST_ENV.ids-tmp.$$" && mv -f "$DEST_ENV.ids-tmp.$$" "$DEST_ENV"
  if [[ -f "$EXECUTOR_PATH" ]]; then cp -p "$EXECUTOR_PATH" "$BACKUP"; else : > "$BACKUP"; fi
  printf '%s|%s|%s|%s|%s|%s\n' "$TS" "$ENV_NAME" "$VERSION" "$EXECUTOR_PATH" "$BACKUP" "$PREV_CURRENT" >> "$HISTORY"
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
