#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# IndusCost — diagnóstico do gateway HTTPS do Stock Collector (Tailscale + Nginx).
#
# Uso (no host):
#   sudo bash scripts/check-collector-gateway.sh              # lê /etc/induscost/collector-gateway.env
#   sudo bash scripts/check-collector-gateway.sh --env production
#   sudo bash scripts/check-collector-gateway.sh --env-file <caminho>
#
# Só lê. Não altera nada. Exit 0 = RESULTADO: OK; exit 1 = RESULTADO: FAIL.
# O teste HTTPS usa o certificado de verdade (SNI + validação da cadeia);
# não usa `curl -k`. Um resultado em modo inseguro aparece só como informação.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE=/etc/induscost/collector-gateway.env

case "${1:-}" in
  --env) ENV_FILE="$REPO_DIR/infra/collector-gateway/env/${2:-}.env" ;;
  --env-file) ENV_FILE="${2:-}" ;;
esac
[[ -f "$ENV_FILE" ]] || { echo "[FAIL] env não encontrado: $ENV_FILE"; echo "RESULTADO: FAIL"; exit 1; }
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] && export "$key=$value"
done < <(grep -v '^[[:space:]]*$' "$ENV_FILE")

IP="${COLLECTOR_TAILSCALE_IP:-}"
HOST="${COLLECTOR_TAILSCALE_HOSTNAME:-}"
HTTPS_PORT="${COLLECTOR_HTTPS_PORT:-443}"
APP_PORT="${COLLECTOR_APP_PORT:-}"
TLS_DIR="${COLLECTOR_TLS_DIR:-}"
SITE_PATH="${COLLECTOR_NGINX_CONFIG_PATH:-}"
CRT="$TLS_DIR/$HOST.crt"
KEY="$TLS_DIR/$HOST.key"

fails=0
ok()   { echo "[OK]   $*"; }
warn() { echo "[WARN] $*"; }
fail() { echo "[FAIL] $*"; fails=$((fails + 1)); }

echo "=== Collector gateway · ${COLLECTOR_ENV:-?} · $HOST ($IP:$HTTPS_PORT → 127.0.0.1:$APP_PORT) ==="
for var in IP HOST APP_PORT TLS_DIR SITE_PATH; do
  [[ -n "${!var}" && "${!var}" != *CONFIGURE_ME* ]] || fail "variável $var ausente ou CONFIGURE_ME em $ENV_FILE"
done

# ── Tailscale ──────────────────────────────────────────────────────────────
if systemctl is-active --quiet tailscaled; then ok "tailscaled ativo"; else fail "tailscaled não está ativo (systemctl status tailscaled)"; fi
state="$(tailscale status --json 2>/dev/null | sed -n 's/.*"BackendState"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
if [[ "$state" == "Running" ]]; then ok "tailscale BackendState=Running"; else warn "tailscale BackendState=${state:-desconhecido} (diagnóstico; o bind depende do IP no kernel)"; fi
iface="$(ip -4 -o addr show 2>/dev/null | awk -v ip="$IP" '$4 ~ "^" ip "/" { print $2; exit }')"
if [[ -n "$iface" ]]; then ok "IP Tailscale $IP presente em $iface"; else fail "IP Tailscale $IP ausente nas interfaces locais (ip -4 addr show)"; fi

# ── Nginx ──────────────────────────────────────────────────────────────────
if systemctl is-active --quiet nginx; then ok "nginx ativo"; else fail "nginx não está ativo (journalctl -u nginx -n 50)"; fi
if nginx -t >/dev/null 2>&1; then ok "nginx config válida (nginx -t)"; else fail "nginx -t reprovou a configuração (nginx -t para detalhes)"; fi
if [[ -f "$SITE_PATH" ]]; then ok "vhost presente: $SITE_PATH"; else fail "vhost ausente: $SITE_PATH"; fi
if [[ -f "$SITE_PATH" ]] && grep -q 'X-IndusCost-Tailscale-Peer $remote_addr' "$SITE_PATH"; then ok "header X-IndusCost-Tailscale-Peer sobrescrito com \$remote_addr"; else fail "vhost sem 'X-IndusCost-Tailscale-Peer \$remote_addr'"; fi
dupes="$(grep -RlsE "server_name[[:space:]]+$HOST|listen[[:space:]]+$IP:$HTTPS_PORT" /etc/nginx 2>/dev/null | while IFS= read -r f; do [[ "$(readlink -f "$f")" != "$(readlink -f "$SITE_PATH")" ]] && echo "$f"; done)"
if [[ -z "$dupes" ]]; then ok "nenhum outro arquivo do Nginx declara este hostname/listen"; else fail "server block duplicado em: $(echo "$dupes" | tr '\n' ' ')"; fi
if [[ -f /etc/systemd/system/nginx.service.d/induscost-tailscale.conf ]]; then ok "drop-in induscost-tailscale.conf instalado"; else warn "drop-in induscost-tailscale.conf ausente: o Nginx não espera o Tailscale no boot"; fi
if systemctl show nginx -p After --no-pager 2>/dev/null | grep -q tailscaled.service; then ok "nginx ordenado após tailscaled.service"; else warn "nginx não declara After=tailscaled.service"; fi
if systemctl show nginx -p ExecStartPre --no-pager 2>/dev/null | grep -q wait-for-tailscale; then ok "ExecStartPre inclui wait-for-tailscale.sh"; else warn "ExecStartPre não inclui wait-for-tailscale.sh (daemon-reload feito?)"; fi
if ss -lntp 2>/dev/null | grep -q "$IP:$HTTPS_PORT "; then ok "$IP:$HTTPS_PORT LISTEN"; else fail "nginx não está escutando em $IP:$HTTPS_PORT (ss -lntp)"; fi
if ss -lntp 2>/dev/null | grep -Eq "(0\.0\.0\.0|\*|\[::\]):$HTTPS_PORT "; then fail "há listener em 0.0.0.0/[::]:$HTTPS_PORT — o gateway deve escutar só no IP Tailscale"; else ok "nenhum listener público em :$HTTPS_PORT"; fi

# ── Aplicação ──────────────────────────────────────────────────────────────
if ss -lntp 2>/dev/null | grep -Eq "(0\.0\.0\.0|127\.0\.0\.1|\*|\[::\]|\[::1\]):$APP_PORT "; then ok "app :$APP_PORT LISTEN"; else fail "aplicação não está escutando em :$APP_PORT"; fi
if ss -lntp 2>/dev/null | grep -Eq "(0\.0\.0\.0|\*|\[::\]):$APP_PORT "; then warn "app :$APP_PORT escuta em todas as interfaces (estado atual; só reportado, não alterado)"; fi
if command -v curl >/dev/null 2>&1; then
  app_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$APP_PORT/api/health" 2>/dev/null || echo "000")"
  if [[ "$app_code" == "200" ]]; then ok "app /api/health → HTTP $app_code em 127.0.0.1:$APP_PORT"; else fail "app /api/health → HTTP $app_code em 127.0.0.1:$APP_PORT"; fi
fi

# ── Certificado ────────────────────────────────────────────────────────────
if [[ -f "$CRT" ]]; then ok "certificado presente: $CRT"; else fail "certificado ausente: $CRT"; fi
if [[ -f "$KEY" ]]; then ok "chave presente: $KEY"; else fail "chave ausente: $KEY"; fi
if [[ -r "$CRT" ]] && command -v openssl >/dev/null 2>&1; then
  subject="$(openssl x509 -in "$CRT" -noout -subject 2>/dev/null | sed 's/^subject=//')"
  issuer="$(openssl x509 -in "$CRT" -noout -issuer 2>/dev/null | sed 's/^issuer=//')"
  not_before="$(openssl x509 -in "$CRT" -noout -startdate 2>/dev/null | cut -d= -f2)"
  not_after="$(openssl x509 -in "$CRT" -noout -enddate 2>/dev/null | cut -d= -f2)"
  echo "       subject:   $subject"
  echo "       issuer:    $issuer"
  echo "       notBefore: $not_before"
  echo "       notAfter:  $not_after"
  end_epoch="$(date -d "$not_after" +%s 2>/dev/null || echo "")"
  if [[ -n "$end_epoch" ]]; then
    days=$(( (end_epoch - $(date +%s)) / 86400 ))
    if (( days < 0 )); then fail "certificado EXPIRADO há $(( -days )) dia(s) — renovar com: tailscale cert $HOST"
    elif (( days <= 14 )); then warn "certificado expira em $days dia(s) — renovar com: tailscale cert $HOST"
    else ok "certificado válido por mais $days dia(s)"; fi
  elif openssl x509 -in "$CRT" -noout -checkend 0 >/dev/null 2>&1; then ok "certificado dentro da validade"
  else fail "certificado EXPIRADO — renovar com: tailscale cert $HOST"; fi
  if openssl x509 -in "$CRT" -noout -ext subjectAltName 2>/dev/null | grep -q "DNS:$HOST"; then ok "certificado cobre $HOST (SAN)"; else warn "SAN do certificado não lista $HOST"; fi
elif [[ -f "$CRT" ]]; then
  warn "certificado não legível sem root; subject/validade não conferidos"
fi

# ── HTTPS real (SNI + cadeia válida; sem -k) ────────────────────────────────
if command -v curl >/dev/null 2>&1; then
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$HOST:$HTTPS_PORT:$IP" "https://$HOST:$HTTPS_PORT/collector" 2>/dev/null || echo "000")"
  case "$code" in
    200|301|302|303|307|308) ok "HTTPS https://$HOST/collector (via $IP, SNI $HOST) → HTTP $code" ;;
    000)
      fail "HTTPS https://$HOST:$HTTPS_PORT via $IP não respondeu com certificado válido (conexão recusada ou TLS/cadeia inválida)"
      insecure="$(curl -sSk -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$HOST:$HTTPS_PORT:$IP" "https://$HOST:$HTTPS_PORT/collector" 2>/dev/null || echo "000")"
      [[ "$insecure" != "000" ]] && echo "       (informativo: sem validar o certificado o Nginx responde HTTP $insecure — o problema está no certificado/cadeia)"
      ;;
    *) fail "HTTPS https://$HOST/collector → HTTP $code (esperado 200/301/302/303/307/308)" ;;
  esac
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
