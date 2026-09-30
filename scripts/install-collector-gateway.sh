#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# IndusCost — instala/atualiza o gateway HTTPS do Stock Collector no host:
#   · vhost Nginx renderizado de infra/collector-gateway/nginx/*.template
#   · drop-in do nginx.service que espera o Tailscale (infra/collector-gateway/systemd)
#   · /usr/local/lib/induscost/wait-for-tailscale.sh
#   · /etc/induscost/collector-gateway.env (cópia do env do ambiente)
#
# Uso (no host, dentro do checkout do repositório):
#   sudo bash scripts/install-collector-gateway.sh --env production
#   sudo bash scripts/install-collector-gateway.sh --env homolog
#   sudo bash scripts/install-collector-gateway.sh --env production --dry-run
#   sudo bash scripts/install-collector-gateway.sh --rollback
#
# Idempotente e fail-fast: valida tudo ANTES de escrever; faz backup do que
# substitui; roda `nginx -t` ANTES de reload/restart; não toca na app Node, no
# banco, no firewall, no Tailscale, no DNS nem nos certificados.
# É um comando explícito pós-deploy — não faz parte do deploy da aplicação.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INFRA_DIR="$REPO_DIR/infra/collector-gateway"

ETC_DIR=/etc/induscost
ENV_TARGET="$ETC_DIR/collector-gateway.env"
LIB_DIR=/usr/local/lib/induscost
WAIT_TARGET="$LIB_DIR/wait-for-tailscale.sh"
DROPIN_DIR=/etc/systemd/system/nginx.service.d
DROPIN_TARGET="$DROPIN_DIR/induscost-tailscale.conf"
BACKUP_ROOT=/var/backups/induscost/collector-gateway

ENV_NAME=""
DRY_RUN=0
ROLLBACK=0

usage() {
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_NAME="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --rollback) ROLLBACK=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "argumento desconhecido: $1" >&2; usage; exit 2 ;;
  esac
done

ok()   { echo "[OK]   $*"; }
info() { echo "[..]   $*"; }
warn() { echo "[WARN] $*"; }
die()  { echo "[FAIL] $*" >&2; exit 1; }

require_root() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || die "execute como root (sudo)."
}

# ── rollback ────────────────────────────────────────────────────────────────
if (( ROLLBACK )); then
  require_root
  latest="$(ls -1d "$BACKUP_ROOT"/*/ 2>/dev/null | sort | tail -1 || true)"
  [[ -n "$latest" ]] || die "nenhum backup em $BACKUP_ROOT — nada para restaurar."
  info "restaurando a partir de $latest"
  if [[ -f "$latest/site.conf" && -f "$latest/site.path" ]]; then
    site_path="$(cat "$latest/site.path")"
    cp -a "$latest/site.conf" "$site_path"
    ok "vhost restaurado: $site_path"
  fi
  if [[ -f "$latest/induscost-tailscale.conf" ]]; then
    cp -a "$latest/induscost-tailscale.conf" "$DROPIN_TARGET"
    ok "drop-in restaurado (versão anterior)"
  else
    rm -f "$DROPIN_TARGET"
    ok "drop-in removido (não existia antes)"
  fi
  if [[ -f "$latest/collector-gateway.env" ]]; then
    cp -a "$latest/collector-gateway.env" "$ENV_TARGET"
  else
    rm -f "$ENV_TARGET"
  fi
  systemctl daemon-reload
  nginx -t
  systemctl restart nginx
  systemctl --no-pager --lines=5 status nginx || true
  ok "rollback concluído. O wait-for-tailscale.sh em $LIB_DIR foi mantido (inofensivo sem o drop-in)."
  exit 0
fi

# ── ambiente ────────────────────────────────────────────────────────────────
[[ -n "$ENV_NAME" ]] || die "informe --env production|homolog (ou --rollback)."
ENV_FILE="$INFRA_DIR/env/$ENV_NAME.env"
[[ -f "$ENV_FILE" ]] || die "ambiente desconhecido: $ENV_FILE não existe."

# Carrega só KEY=valor simples (sem executar nada do arquivo).
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || die "linha inválida em $ENV_FILE: $key"
  export "$key=$value"
done < <(grep -v '^[[:space:]]*$' "$ENV_FILE")

for var in COLLECTOR_ENV COLLECTOR_TAILSCALE_HOSTNAME COLLECTOR_TAILSCALE_IP COLLECTOR_APP_PORT COLLECTOR_HTTPS_PORT COLLECTOR_TLS_DIR COLLECTOR_NGINX_SITE COLLECTOR_TAILSCALE_WAIT_TIMEOUT; do
  [[ -n "${!var:-}" ]] || die "$var ausente em $ENV_FILE."
done
[[ "$COLLECTOR_TAILSCALE_IP" =~ ^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+$ ]] || die "COLLECTOR_TAILSCALE_IP fora da faixa Tailscale (100.64.0.0/10): $COLLECTOR_TAILSCALE_IP"
[[ "$COLLECTOR_TAILSCALE_HOSTNAME" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || die "COLLECTOR_TAILSCALE_HOSTNAME inválido: $COLLECTOR_TAILSCALE_HOSTNAME"
[[ "$COLLECTOR_APP_PORT" =~ ^[0-9]+$ && "$COLLECTOR_HTTPS_PORT" =~ ^[0-9]+$ ]] || die "portas inválidas."
[[ "$COLLECTOR_NGINX_SITE" =~ ^[a-z0-9-]+$ ]] || die "COLLECTOR_NGINX_SITE inválido."

SITE_AVAILABLE="/etc/nginx/sites-available/$COLLECTOR_NGINX_SITE"
SITE_ENABLED="/etc/nginx/sites-enabled/$COLLECTOR_NGINX_SITE"
CRT="$COLLECTOR_TLS_DIR/$COLLECTOR_TAILSCALE_HOSTNAME.crt"
KEY="$COLLECTOR_TLS_DIR/$COLLECTOR_TAILSCALE_HOSTNAME.key"

echo "=== IndusCost · gateway do Collector · ambiente: $COLLECTOR_ENV$( (( DRY_RUN )) && echo ' (DRY-RUN)') ==="
echo "    hostname  $COLLECTOR_TAILSCALE_HOSTNAME"
echo "    bind      $COLLECTOR_TAILSCALE_IP:$COLLECTOR_HTTPS_PORT → 127.0.0.1:$COLLECTOR_APP_PORT"
echo "    vhost     $SITE_AVAILABLE"
echo "    TLS       $CRT"

# ── pré-requisitos ──────────────────────────────────────────────────────────
require_root
command -v nginx >/dev/null 2>&1 || die "nginx não instalado."
command -v tailscale >/dev/null 2>&1 || die "tailscale não instalado."
command -v systemctl >/dev/null 2>&1 || die "systemd não disponível."
[[ -f /usr/lib/systemd/system/nginx.service || -f /lib/systemd/system/nginx.service ]] || die "nginx.service do pacote não encontrado."
systemctl cat tailscaled.service >/dev/null 2>&1 || die "tailscaled.service não existe neste host."
ok "nginx, tailscale, systemd e tailscaled.service presentes"

[[ -f "$CRT" ]] || die "certificado ausente: $CRT (emita com: tailscale cert $COLLECTOR_TAILSCALE_HOSTNAME — fora deste script)."
[[ -f "$KEY" ]] || die "chave ausente: $KEY"
if command -v openssl >/dev/null 2>&1; then
  cert_host="$(openssl x509 -in "$CRT" -noout -subject 2>/dev/null | sed -n 's/.*CN *= *\([^,/]*\).*/\1/p')"
  [[ -z "$cert_host" || "$cert_host" == "$COLLECTOR_TAILSCALE_HOSTNAME" ]] || warn "CN do certificado ($cert_host) difere do hostname configurado."
  if ! openssl x509 -in "$CRT" -noout -checkend 0 >/dev/null 2>&1; then
    die "certificado EXPIRADO: $CRT. Renove com tailscale cert antes de instalar."
  fi
  if ! openssl x509 -in "$CRT" -noout -checkend $((14*24*3600)) >/dev/null 2>&1; then
    warn "certificado expira em menos de 14 dias: $(openssl x509 -in "$CRT" -noout -enddate)"
  fi
fi
ok "certificado e chave presentes"

if tailscale ip -4 2>/dev/null | grep -qx "$COLLECTOR_TAILSCALE_IP"; then
  ok "tailscale ip -4 confirma $COLLECTOR_TAILSCALE_IP neste host"
else
  warn "tailscale ip -4 NÃO devolveu $COLLECTOR_TAILSCALE_IP (saída: $(tailscale ip -4 2>/dev/null | tr '\n' ' ')). Confira o env do ambiente. Continuando só em dry-run."
  (( DRY_RUN )) || die "o IP configurado não é deste host — abortando para não instalar um bind impossível."
fi

# Outro vhost já responde por este hostname? Instalar um segundo arquivo criaria
# "conflicting server name" — o operador precisa apontar COLLECTOR_NGINX_SITE
# para o arquivo existente (ele será substituído com backup).
conflict="$(grep -Rls "server_name[[:space:]]\+$COLLECTOR_TAILSCALE_HOSTNAME" /etc/nginx/sites-enabled/ 2>/dev/null | grep -v "/$COLLECTOR_NGINX_SITE$" || true)"
[[ -z "$conflict" ]] || die "o hostname já é servido por outro vhost: $conflict. Ajuste COLLECTOR_NGINX_SITE no env para esse nome (ou remova o vhost antigo) antes de instalar."

# ── render ──────────────────────────────────────────────────────────────────
render_site() {
  sed \
    -e "s|__COLLECTOR_ENV__|$COLLECTOR_ENV|g" \
    -e "s|__COLLECTOR_TAILSCALE_HOSTNAME__|$COLLECTOR_TAILSCALE_HOSTNAME|g" \
    -e "s|__COLLECTOR_TAILSCALE_IP__|$COLLECTOR_TAILSCALE_IP|g" \
    -e "s|__COLLECTOR_APP_PORT__|$COLLECTOR_APP_PORT|g" \
    -e "s|__COLLECTOR_HTTPS_PORT__|$COLLECTOR_HTTPS_PORT|g" \
    -e "s|__COLLECTOR_TLS_DIR__|$COLLECTOR_TLS_DIR|g" \
    "$INFRA_DIR/nginx/induscost-collector.conf.template"
}
RENDERED="$(mktemp)"
trap 'rm -f "$RENDERED"' EXIT
render_site > "$RENDERED"
grep -q "__COLLECTOR_" "$RENDERED" && die "placeholder não substituído no template."
grep -q "X-IndusCost-Tailscale-Peer \$remote_addr" "$RENDERED" || die "template sem o header X-IndusCost-Tailscale-Peer — recusando."
grep -Eq "listen +$COLLECTOR_TAILSCALE_IP:$COLLECTOR_HTTPS_PORT +ssl;" "$RENDERED" || die "template sem bind exclusivo no IP Tailscale — recusando."
grep -q "deny all;" "$RENDERED" || die "template sem 'deny all' — recusando."
ok "vhost renderizado e verificado (bind exclusivo, header dedicado, deny all)"

if (( DRY_RUN )); then
  echo "----- vhost que seria instalado em $SITE_AVAILABLE -----"
  cat "$RENDERED"
  echo "----- drop-in que seria instalado em $DROPIN_TARGET -----"
  cat "$INFRA_DIR/systemd/nginx.service.d/induscost-tailscale.conf"
  echo "----- env que seria gravado em $ENV_TARGET -----"
  grep -v '^#' "$ENV_FILE" | grep -v '^[[:space:]]*$'
  ok "dry-run: nada foi alterado."
  exit 0
fi

# ── backup ──────────────────────────────────────────────────────────────────
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
mkdir -p "$BACKUP_DIR"
if [[ -f "$SITE_AVAILABLE" ]]; then
  cp -a "$SITE_AVAILABLE" "$BACKUP_DIR/site.conf"
  echo "$SITE_AVAILABLE" > "$BACKUP_DIR/site.path"
fi
[[ -f "$DROPIN_TARGET" ]] && cp -a "$DROPIN_TARGET" "$BACKUP_DIR/induscost-tailscale.conf"
[[ -f "$ENV_TARGET" ]] && cp -a "$ENV_TARGET" "$BACKUP_DIR/collector-gateway.env"
ok "backup em $BACKUP_DIR"

# ── instalação ──────────────────────────────────────────────────────────────
mkdir -p "$ETC_DIR" "$LIB_DIR" "$DROPIN_DIR" /etc/nginx/sites-available /etc/nginx/sites-enabled

grep -v '^#' "$ENV_FILE" | grep -v '^[[:space:]]*$' > "$ENV_TARGET"
chmod 0644 "$ENV_TARGET"
ok "env gravado: $ENV_TARGET"

install -m 0755 "$INFRA_DIR/bin/wait-for-tailscale.sh" "$WAIT_TARGET"
bash -n "$WAIT_TARGET"
ok "wait script instalado: $WAIT_TARGET"

install -m 0644 "$INFRA_DIR/systemd/nginx.service.d/induscost-tailscale.conf" "$DROPIN_TARGET"
ok "drop-in instalado: $DROPIN_TARGET"

if [[ -f "$SITE_AVAILABLE" ]] && cmp -s "$RENDERED" "$SITE_AVAILABLE"; then
  ok "vhost já estava idêntico: $SITE_AVAILABLE"
else
  install -m 0644 "$RENDERED" "$SITE_AVAILABLE"
  ok "vhost instalado: $SITE_AVAILABLE"
fi
if [[ ! -L "$SITE_ENABLED" ]]; then
  [[ -e "$SITE_ENABLED" ]] && die "$SITE_ENABLED existe e não é symlink — resolva manualmente."
  ln -s "$SITE_AVAILABLE" "$SITE_ENABLED"
  ok "vhost habilitado: $SITE_ENABLED"
fi

# ── validação antes de aplicar ──────────────────────────────────────────────
systemctl daemon-reload
ok "systemd daemon-reload"
if ! nginx -t; then
  warn "nginx -t FALHOU. Restaurando o vhost anterior e o drop-in anterior."
  bash "${BASH_SOURCE[0]}" --rollback || true
  die "instalação abortada: configuração inválida (nada ficou aplicado)."
fi
ok "nginx -t"

# Aplicar: reload se o Nginx já está de pé (mantém conexões), restart se não.
# Nos dois casos o bind exige o IP presente — o wait garante isso no restart.
if systemctl is-active --quiet nginx; then
  if ! "$WAIT_TARGET"; then
    die "o IP Tailscale não está disponível agora; não vou recarregar o Nginx com um bind impossível."
  fi
  systemctl reload nginx
  ok "nginx recarregado"
else
  systemctl restart nginx
  ok "nginx iniciado"
fi
systemctl enable nginx >/dev/null 2>&1 || true

# ── resumo ──────────────────────────────────────────────────────────────────
echo
echo "=== Resumo ($COLLECTOR_ENV) ==="
systemctl --no-pager --lines=0 status nginx | sed -n '1,4p' || true
echo "Drop-in ativo:"
systemctl show nginx -p After -p Wants -p Restart -p TimeoutStartUSec --no-pager 2>/dev/null | sed 's/^/    /'
echo "Escuta:"
ss -lntp 2>/dev/null | grep -E "$COLLECTOR_TAILSCALE_IP:$COLLECTOR_HTTPS_PORT " | sed 's/^/    /' || warn "porta $COLLECTOR_TAILSCALE_IP:$COLLECTOR_HTTPS_PORT ainda não aparece em LISTEN"
echo
echo "Próximo passo: sudo bash scripts/check-collector-gateway.sh"
echo "Rollback:      sudo bash scripts/install-collector-gateway.sh --rollback   (backup: $BACKUP_DIR)"
