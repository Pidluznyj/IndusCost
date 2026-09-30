#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# IndusCost — diagnóstico do gateway HTTPS do Stock Collector (Tailscale + Nginx).
#
# Uso (no host):
#   sudo bash scripts/check-collector-gateway.sh              # lê /etc/induscost/collector-gateway.env
#   sudo bash scripts/check-collector-gateway.sh --env production
#
# Só lê. Não altera nada. Exit 0 = tudo OK; exit 1 = alguma falha.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE=/etc/induscost/collector-gateway.env

if [[ "${1:-}" == "--env" && -n "${2:-}" ]]; then
  ENV_FILE="$REPO_DIR/infra/collector-gateway/env/$2.env"
fi
[[ -f "$ENV_FILE" ]] || { echo "[FAIL] env não encontrado: $ENV_FILE"; echo "RESULTADO: FAIL"; exit 1; }
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] && export "$key=$value"
done < <(grep -v '^[[:space:]]*$' "$ENV_FILE")

IP="${COLLECTOR_TAILSCALE_IP:-}"
HOST="${COLLECTOR_TAILSCALE_HOSTNAME:-}"
HTTPS_PORT="${COLLECTOR_HTTPS_PORT:-443}"
APP_PORT="${COLLECTOR_APP_PORT:-3000}"
TLS_DIR="${COLLECTOR_TLS_DIR:-/etc/induscost/collector-tls}"
CRT="$TLS_DIR/$HOST.crt"
KEY="$TLS_DIR/$HOST.key"

fails=0
ok()   { echo "[OK]   $*"; }
warn() { echo "[WARN] $*"; }
fail() { echo "[FAIL] $*"; fails=$((fails + 1)); }

echo "=== Collector gateway · ${COLLECTOR_ENV:-?} · $HOST ($IP:$HTTPS_PORT → :$APP_PORT) ==="

# tailscaled
if systemctl is-active --quiet tailscaled; then ok "tailscaled ativo"; else fail "tailscaled não está ativo (systemctl status tailscaled)"; fi
state="$(tailscale status --json 2>/dev/null | sed -n 's/.*"BackendState"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
if [[ "$state" == "Running" ]]; then ok "tailscale BackendState=Running"; else fail "tailscale BackendState=${state:-desconhecido} (tailscale status)"; fi
if ip -4 addr show dev tailscale0 2>/dev/null | grep -q "inet ${IP}/"; then ok "IP Tailscale $IP presente em tailscale0"; else fail "IP Tailscale $IP ausente em tailscale0 (ip -4 addr show dev tailscale0)"; fi

# nginx
if systemctl is-active --quiet nginx; then ok "nginx ativo"; else fail "nginx não está ativo (journalctl -u nginx -n 50)"; fi
if nginx -t >/dev/null 2>&1; then ok "nginx config válida (nginx -t)"; else fail "nginx -t reprovou a configuração"; fi
if [[ -f /etc/systemd/system/nginx.service.d/induscost-tailscale.conf ]]; then ok "drop-in induscost-tailscale.conf instalado"; else warn "drop-in induscost-tailscale.conf ausente: o Nginx não espera o Tailscale no boot"; fi
if systemctl show nginx -p After --no-pager 2>/dev/null | grep -q tailscaled.service; then ok "nginx ordenado após tailscaled.service"; else warn "nginx não declara After=tailscaled.service"; fi
if ss -lntp 2>/dev/null | grep -q "$IP:$HTTPS_PORT "; then ok "$IP:$HTTPS_PORT LISTEN (nginx)"; else fail "nginx não está escutando em $IP:$HTTPS_PORT (ss -lntp)"; fi
if ss -lntp 2>/dev/null | grep -Eq "(0\.0\.0\.0|127\.0\.0\.1|\*|\[::\]):$APP_PORT "; then ok "app :$APP_PORT LISTEN"; else fail "aplicação não está escutando em :$APP_PORT"; fi
if ss -lntp 2>/dev/null | grep -Eq "(0\.0\.0\.0|\*|\[::\]):$HTTPS_PORT "; then fail "há listener em 0.0.0.0/[::]:$HTTPS_PORT — o gateway deve escutar só no IP Tailscale"; else ok "nenhum listener público em :$HTTPS_PORT"; fi
if ss -lntp 2>/dev/null | grep -Eq "(0\.0\.0\.0|\*|\[::\]):$APP_PORT "; then warn "app :$APP_PORT escuta em todas as interfaces (estado atual; só reportado, não alterado)"; fi

# certificado
if [[ -f "$CRT" && -f "$KEY" ]]; then
  ok "certificado e chave presentes em $TLS_DIR"
  if command -v openssl >/dev/null 2>&1; then
    enddate="$(openssl x509 -in "$CRT" -noout -enddate 2>/dev/null | cut -d= -f2)"
    issuer="$(openssl x509 -in "$CRT" -noout -issuer 2>/dev/null | sed 's/^issuer=//')"
    if openssl x509 -in "$CRT" -noout -checkend 0 >/dev/null 2>&1; then
      if openssl x509 -in "$CRT" -noout -checkend $((14*24*3600)) >/dev/null 2>&1; then
        ok "certificado válido até $enddate ($issuer)"
      else
        warn "certificado expira em menos de 14 dias: $enddate — renovar com: tailscale cert $HOST"
      fi
    else
      fail "certificado EXPIRADO em $enddate — renovar com: tailscale cert $HOST"
    fi
  fi
else
  fail "certificado/chave ausentes: $CRT / $KEY"
fi

# HTTPS local com SNI e resolução forçada para o IP Tailscale
if command -v curl >/dev/null 2>&1; then
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$HOST:$HTTPS_PORT:$IP" "https://$HOST:$HTTPS_PORT/collector" 2>/dev/null || echo "000")"
  case "$code" in
    200|301|302) ok "HTTPS Collector respondeu $code em https://$HOST/collector" ;;
    000) fail "HTTPS Collector não respondeu (conexão recusada/TLS) em https://$HOST:$HTTPS_PORT via $IP" ;;
    *) fail "HTTPS Collector respondeu $code (esperado 200/301/302)" ;;
  esac
  app_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$APP_PORT/api/health" 2>/dev/null || echo "000")"
  if [[ "$app_code" == "200" ]]; then ok "app /api/health respondeu 200 em 127.0.0.1:$APP_PORT"; else fail "app /api/health respondeu $app_code em 127.0.0.1:$APP_PORT"; fi
else
  warn "curl não instalado: teste HTTPS pulado"
fi

echo
if (( fails == 0 )); then
  echo "RESULTADO: OK"
  exit 0
fi
echo "RESULTADO: FAIL ($fails falha(s))"
exit 1
