#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# IndusCost — instala/atualiza o gateway HTTPS do Stock Collector no host:
#   · vhost Nginx renderizado de infra/collector-gateway/nginx/*.template,
#     gravado NO MESMO caminho do arquivo real (COLLECTOR_NGINX_CONFIG_PATH)
#   · drop-in do nginx.service que espera o Tailscale (infra/collector-gateway/systemd)
#   · /usr/local/lib/induscost/wait-for-tailscale.sh
#   · /etc/induscost/collector-gateway.env (cópia do env do ambiente)
#
# Uso (no host, dentro do checkout do repositório):
#   sudo bash scripts/install-collector-gateway.sh --env production --dry-run
#   sudo bash scripts/install-collector-gateway.sh --env production
#   sudo bash scripts/install-collector-gateway.sh --env homolog
#   sudo bash scripts/install-collector-gateway.sh --rollback
#   (avançado) --env-file <caminho>  usa um env fora de infra/collector-gateway/env
#
# Ordem: validar env → ferramentas → certificado → template → renderizar em
# arquivo temporário → validar o renderizado → backup → instalar wait, env,
# drop-in e vhost → daemon-reload → nginx -t → (falhou? restaura o backup
# automaticamente) → reload/restart → health check → resumo.
# Idempotente e fail-fast. --dry-run NÃO escreve em /etc, /usr/local, systemd,
# Nginx nem backup: só valida, renderiza em temporário e mostra os destinos.
# Não toca na app Node, no banco, no firewall, no Tailscale, no DNS nem nos
# certificados. É um comando explícito pós-deploy, fora do deploy da aplicação.
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
# Raiz do Nginx; só muda em testes locais com shims (COLLECTOR_NGINX_ROOT no env).
NGINX_ROOT=/etc/nginx

ENV_NAME=""
ENV_FILE=""
DRY_RUN=0
ROLLBACK=0

usage() { sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_NAME="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
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

is_root() { [[ "${EUID:-$(id -u)}" -eq 0 ]]; }

# ── restauração de um backup (usada pelo --rollback e pelo trap) ─────────────
restore_from() {
  local dir="$1"
  [[ -d "$dir" ]] || die "backup não encontrado: $dir"
  local site_path=""
  [[ -f "$dir/site.path" ]] && site_path="$(cat "$dir/site.path")"
  if [[ -n "$site_path" ]]; then
    if [[ -f "$dir/site.conf" ]]; then
      cp -a "$dir/site.conf" "$site_path"
      info "vhost restaurado: $site_path"
    else
      rm -f "$site_path"
      info "vhost removido (não existia antes): $site_path"
    fi
  fi
  if [[ -f "$dir/induscost-tailscale.conf" ]]; then
    cp -a "$dir/induscost-tailscale.conf" "$DROPIN_TARGET"
    info "drop-in restaurado (versão anterior)"
  else
    rm -f "$DROPIN_TARGET"
    info "drop-in removido (não existia antes)"
  fi
  if [[ -f "$dir/collector-gateway.env" ]]; then
    cp -a "$dir/collector-gateway.env" "$ENV_TARGET"
  else
    rm -f "$ENV_TARGET"
  fi
  systemctl daemon-reload
}

if (( ROLLBACK )); then
  is_root || die "execute como root (sudo)."
  latest="$(ls -1d "$BACKUP_ROOT"/*/ 2>/dev/null | sort | tail -1 || true)"
  [[ -n "$latest" ]] || die "nenhum backup em $BACKUP_ROOT — nada para restaurar."
  latest="${latest%/}"
  info "restaurando a partir de $latest"
  restore_from "$latest"
  nginx -t
  systemctl restart nginx
  systemctl --no-pager --lines=5 status nginx || true
  ok "rollback concluído. O wait-for-tailscale.sh em $LIB_DIR foi mantido (inofensivo sem o drop-in)."
  exit 0
fi

# ── 1. env ──────────────────────────────────────────────────────────────────
if [[ -z "$ENV_FILE" ]]; then
  [[ -n "$ENV_NAME" ]] || die "informe --env production|homolog (ou --rollback)."
  ENV_FILE="$INFRA_DIR/env/$ENV_NAME.env"
fi
[[ -f "$ENV_FILE" ]] || die "env não encontrado: $ENV_FILE"

# Carrega só KEY=valor simples (nada do arquivo é executado).
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || die "linha inválida em $ENV_FILE: $key"
  export "$key=$value"
done < <(grep -v '^[[:space:]]*$' "$ENV_FILE")
NGINX_ROOT="${COLLECTOR_NGINX_ROOT:-$NGINX_ROOT}"

for var in COLLECTOR_ENV COLLECTOR_TAILSCALE_HOSTNAME COLLECTOR_TAILSCALE_IP COLLECTOR_APP_PORT COLLECTOR_HTTPS_PORT COLLECTOR_TLS_DIR COLLECTOR_NGINX_CONFIG_PATH COLLECTOR_TAILSCALE_WAIT_TIMEOUT; do
  [[ -n "${!var:-}" ]] || die "$var ausente em $ENV_FILE."
  [[ "${!var}" != *CONFIGURE_ME* ]] || die "$var ainda está como CONFIGURE_ME em $ENV_FILE — confirme o valor no host e ajuste o arquivo antes de instalar."
done
[[ "$COLLECTOR_TAILSCALE_IP" =~ ^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+$ ]] || die "COLLECTOR_TAILSCALE_IP fora da faixa Tailscale (100.64.0.0/10): $COLLECTOR_TAILSCALE_IP"
[[ "$COLLECTOR_TAILSCALE_HOSTNAME" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || die "COLLECTOR_TAILSCALE_HOSTNAME inválido: $COLLECTOR_TAILSCALE_HOSTNAME"
[[ "$COLLECTOR_APP_PORT" =~ ^[0-9]+$ && "$COLLECTOR_HTTPS_PORT" =~ ^[0-9]+$ ]] || die "portas inválidas."
[[ "$COLLECTOR_TAILSCALE_WAIT_TIMEOUT" =~ ^[0-9]+$ ]] || die "COLLECTOR_TAILSCALE_WAIT_TIMEOUT inválido."
[[ "$COLLECTOR_NGINX_CONFIG_PATH" == "$NGINX_ROOT"/* && "$COLLECTOR_NGINX_CONFIG_PATH" != */ ]] || die "COLLECTOR_NGINX_CONFIG_PATH precisa ser um arquivo dentro de $NGINX_ROOT: $COLLECTOR_NGINX_CONFIG_PATH"
if [[ "$COLLECTOR_ENV" == "homolog" && "$COLLECTOR_APP_PORT" == "3000" ]]; then
  die "homologação com COLLECTOR_APP_PORT=3000: a :3000 do servidor-01 é o gateway de PRODUÇÃO. Use 3001."
fi

SITE_PATH="$COLLECTOR_NGINX_CONFIG_PATH"
CRT="$COLLECTOR_TLS_DIR/$COLLECTOR_TAILSCALE_HOSTNAME.crt"
KEY="$COLLECTOR_TLS_DIR/$COLLECTOR_TAILSCALE_HOSTNAME.key"

echo "=== IndusCost · gateway do Collector · ambiente: $COLLECTOR_ENV$( (( DRY_RUN )) && echo ' (DRY-RUN: nada será escrito)') ==="
echo "    hostname  $COLLECTOR_TAILSCALE_HOSTNAME"
echo "    bind      $COLLECTOR_TAILSCALE_IP:$COLLECTOR_HTTPS_PORT → 127.0.0.1:$COLLECTOR_APP_PORT"
echo "    vhost     $SITE_PATH$( [[ -f "$SITE_PATH" ]] && echo ' (existe: será substituído com backup)' || echo ' (não existe: será criado)')"
echo "    TLS       $CRT"
echo "    drop-in   $DROPIN_TARGET"
echo "    wait      $WAIT_TARGET"
echo "    env       $ENV_TARGET"
ok "env válido: $ENV_FILE"

# ── 2. ferramentas ──────────────────────────────────────────────────────────
if (( DRY_RUN )); then
  is_root || warn "sem root: no dry-run alguns arquivos podem não ser legíveis (certificado/chave)."
else
  is_root || die "execute como root (sudo)."
fi
for tool in nginx tailscale systemctl ip ss openssl; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool não instalado."
done
systemctl cat nginx.service >/dev/null 2>&1 || die "nginx.service não encontrado no systemd."
systemctl cat tailscaled.service >/dev/null 2>&1 || die "tailscaled.service não existe neste host."
[[ -d "$NGINX_ROOT" ]] || die "$NGINX_ROOT não existe."
ok "nginx, tailscale, systemd, tailscaled.service e ferramentas presentes"

# ── 3. certificado ──────────────────────────────────────────────────────────
[[ -f "$CRT" ]] || die "certificado ausente: $CRT (emita com: tailscale cert $COLLECTOR_TAILSCALE_HOSTNAME — fora deste script)."
[[ -f "$KEY" ]] || die "chave ausente: $KEY"
if [[ -r "$CRT" ]]; then
  cert_cn="$(openssl x509 -in "$CRT" -noout -subject 2>/dev/null | sed -n 's/.*CN *= *\([^,/]*\).*/\1/p')"
  [[ -z "$cert_cn" || "$cert_cn" == "$COLLECTOR_TAILSCALE_HOSTNAME" ]] || warn "CN do certificado ($cert_cn) difere do hostname configurado."
  openssl x509 -in "$CRT" -noout -checkend 0 >/dev/null 2>&1 || die "certificado EXPIRADO: $CRT ($(openssl x509 -in "$CRT" -noout -enddate)). Renove com tailscale cert antes de instalar."
  openssl x509 -in "$CRT" -noout -checkend $((14*24*3600)) >/dev/null 2>&1 || warn "certificado expira em menos de 14 dias: $(openssl x509 -in "$CRT" -noout -enddate)"
  ok "certificado válido ($(openssl x509 -in "$CRT" -noout -enddate | cut -d= -f2))"
else
  warn "certificado presente mas não legível sem root; validade não conferida neste dry-run."
fi

if tailscale ip -4 2>/dev/null | grep -qx "$COLLECTOR_TAILSCALE_IP"; then
  ok "tailscale ip -4 confirma $COLLECTOR_TAILSCALE_IP neste host"
else
  msg="tailscale ip -4 NÃO devolveu $COLLECTOR_TAILSCALE_IP (saída: $(tailscale ip -4 2>/dev/null | tr '\n' ' ')). Este env é de OUTRO host?"
  (( DRY_RUN )) && warn "$msg" || die "$msg Abortando para não instalar um bind impossível."
fi

# ── 4. template e duplicidade de server block ───────────────────────────────
TEMPLATE="$INFRA_DIR/nginx/induscost-collector.conf.template"
[[ -f "$TEMPLATE" ]] || die "template ausente: $TEMPLATE"
# Qualquer OUTRO arquivo do Nginx que já sirva este hostname ou este listen
# criaria dois server blocks equivalentes (conf.d + sites-enabled, por ex.).
dupes="$(grep -RlsE "server_name[[:space:]]+$COLLECTOR_TAILSCALE_HOSTNAME|listen[[:space:]]+$COLLECTOR_TAILSCALE_IP:$COLLECTOR_HTTPS_PORT" "$NGINX_ROOT" 2>/dev/null | grep -v "^$SITE_PATH$" || true)"
if [[ -n "$dupes" ]]; then
  # Um symlink em sites-enabled apontando para o próprio SITE_PATH não é duplicidade.
  real_dupes=""
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if [[ "$(readlink -f "$f" 2>/dev/null || echo "$f")" != "$(readlink -f "$SITE_PATH" 2>/dev/null || echo "$SITE_PATH")" ]]; then
      real_dupes+="$f"$'\n'
    fi
  done <<< "$dupes"
  [[ -z "$real_dupes" ]] || die "outro arquivo do Nginx já declara este hostname/listen — haveria dois server blocks equivalentes:"$'\n'"$real_dupes""Aponte COLLECTOR_NGINX_CONFIG_PATH para o arquivo real ou remova o duplicado antes de instalar."
fi
ok "nenhum outro server block para $COLLECTOR_TAILSCALE_HOSTNAME / $COLLECTOR_TAILSCALE_IP:$COLLECTOR_HTTPS_PORT"

# ── 5–6. render em temporário e validação do conteúdo ───────────────────────
TMP_DIR="$(mktemp -d)"
RENDERED="$TMP_DIR/site.conf"
sed \
  -e "s|__COLLECTOR_ENV__|$COLLECTOR_ENV|g" \
  -e "s|__COLLECTOR_TAILSCALE_HOSTNAME__|$COLLECTOR_TAILSCALE_HOSTNAME|g" \
  -e "s|__COLLECTOR_TAILSCALE_IP__|$COLLECTOR_TAILSCALE_IP|g" \
  -e "s|__COLLECTOR_APP_PORT__|$COLLECTOR_APP_PORT|g" \
  -e "s|__COLLECTOR_HTTPS_PORT__|$COLLECTOR_HTTPS_PORT|g" \
  -e "s|__COLLECTOR_TLS_DIR__|$COLLECTOR_TLS_DIR|g" \
  "$TEMPLATE" > "$RENDERED"
! grep -q "__COLLECTOR_" "$RENDERED" || die "placeholder não substituído no template."
grep -q 'X-IndusCost-Tailscale-Peer $remote_addr' "$RENDERED" || die "template sem o header X-IndusCost-Tailscale-Peer — recusando."
grep -Eq "listen +$COLLECTOR_TAILSCALE_IP:$COLLECTOR_HTTPS_PORT +ssl;" "$RENDERED" || die "template sem bind exclusivo no IP Tailscale — recusando."
! grep -Eq 'listen +(0\.0\.0\.0|\[::\]|443 )' "$RENDERED" || die "template com listen público — recusando."
grep -q "deny all;" "$RENDERED" || die "template sem 'deny all' — recusando."
grep -q "proxy_pass http://127.0.0.1:$COLLECTOR_APP_PORT;" "$RENDERED" || die "template sem proxy_pass para a porta configurada — recusando."
bash -n "$INFRA_DIR/bin/wait-for-tailscale.sh" || die "wait-for-tailscale.sh com erro de sintaxe."
ok "vhost renderizado e verificado (bind exclusivo, header dedicado, deny all, upstream :$COLLECTOR_APP_PORT)"

if (( DRY_RUN )); then
  echo
  echo "----- vhost que seria gravado em $SITE_PATH -----"
  cat "$RENDERED"
  echo "----- drop-in que seria gravado em $DROPIN_TARGET -----"
  cat "$INFRA_DIR/systemd/nginx.service.d/induscost-tailscale.conf"
  echo "----- env que seria gravado em $ENV_TARGET -----"
  grep -v '^#' "$ENV_FILE" | grep -v '^[[:space:]]*$'
  echo "----- wait script que seria gravado em $WAIT_TARGET: $INFRA_DIR/bin/wait-for-tailscale.sh -----"
  echo "----- backup que seria criado em $BACKUP_ROOT/<data>/ -----"
  echo "----- depois: systemctl daemon-reload; nginx -t; $( systemctl is-active --quiet nginx 2>/dev/null && echo 'systemctl reload nginx' || echo 'systemctl restart nginx' ); health check -----"
  rm -rf "$TMP_DIR"
  ok "dry-run: nada foi alterado."
  exit 0
fi

# ── 7. backup ───────────────────────────────────────────────────────────────
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
mkdir -p "$BACKUP_DIR"
echo "$SITE_PATH" > "$BACKUP_DIR/site.path"
[[ -f "$SITE_PATH" ]] && cp -a "$SITE_PATH" "$BACKUP_DIR/site.conf"
[[ -f "$DROPIN_TARGET" ]] && cp -a "$DROPIN_TARGET" "$BACKUP_DIR/induscost-tailscale.conf"
[[ -f "$ENV_TARGET" ]] && cp -a "$ENV_TARGET" "$BACKUP_DIR/collector-gateway.env"
ok "backup em $BACKUP_DIR"

# A partir daqui qualquer falha restaura o backup automaticamente.
INSTALLED=0
on_error() {
  local rc=$?
  trap - ERR EXIT
  if (( INSTALLED == 0 )); then
    warn "falha (exit $rc) após a substituição — restaurando o backup $BACKUP_DIR"
    restore_from "$BACKUP_DIR" || warn "restauração automática falhou; restaure manualmente a partir de $BACKUP_DIR"
    if nginx -t >/dev/null 2>&1; then
      systemctl is-active --quiet nginx && systemctl reload nginx || true
      warn "estado anterior restaurado; nginx -t OK."
    else
      warn "nginx -t ainda falha após a restauração — intervenção manual necessária (backup em $BACKUP_DIR)."
    fi
  fi
  rm -rf "$TMP_DIR"
  exit "$rc"
}
# -E: o trap ERR também dispara dentro de funções e subshells (restore, wait).
set -E
trap on_error ERR
trap 'rm -rf "$TMP_DIR"' EXIT

# ── 8–11. instalação ────────────────────────────────────────────────────────
mkdir -p "$ETC_DIR" "$LIB_DIR" "$DROPIN_DIR" "$(dirname "$SITE_PATH")"
install -m 0755 "$INFRA_DIR/bin/wait-for-tailscale.sh" "$WAIT_TARGET"
ok "wait script instalado: $WAIT_TARGET"
grep -v '^#' "$ENV_FILE" | grep -v '^[[:space:]]*$' > "$TMP_DIR/env"
install -m 0644 "$TMP_DIR/env" "$ENV_TARGET"
ok "env gravado: $ENV_TARGET"
install -m 0644 "$INFRA_DIR/systemd/nginx.service.d/induscost-tailscale.conf" "$DROPIN_TARGET"
ok "drop-in instalado: $DROPIN_TARGET"
if [[ -f "$SITE_PATH" ]] && cmp -s "$RENDERED" "$SITE_PATH"; then
  ok "vhost já estava idêntico: $SITE_PATH"
else
  install -m 0644 "$RENDERED" "$SITE_PATH"
  ok "vhost gravado: $SITE_PATH"
fi

# ── 12–14. daemon-reload e nginx -t (falha = restauração automática pelo trap) ─
systemctl daemon-reload
ok "systemd daemon-reload"
nginx -t
ok "nginx -t"

# ── 15. aplicar ─────────────────────────────────────────────────────────────
if systemctl is-active --quiet nginx; then
  "$WAIT_TARGET"
  systemctl reload nginx
  ok "nginx recarregado (conexões mantidas)"
else
  systemctl restart nginx
  ok "nginx iniciado"
fi
systemctl enable nginx >/dev/null 2>&1 || true
INSTALLED=1
trap - ERR

# ── 16. health check ────────────────────────────────────────────────────────
echo
if bash "$SCRIPT_DIR/check-collector-gateway.sh"; then
  ok "health check OK"
else
  warn "health check reportou falhas (instalação mantida; veja acima). Para voltar: sudo bash scripts/install-collector-gateway.sh --rollback"
fi

# ── 17. resumo ──────────────────────────────────────────────────────────────
echo
echo "=== Resumo ($COLLECTOR_ENV) ==="
echo "    vhost     $SITE_PATH"
echo "    drop-in   $DROPIN_TARGET"
echo "    wait      $WAIT_TARGET"
echo "    env       $ENV_TARGET"
echo "    backup    $BACKUP_DIR"
systemctl show nginx -p After -p Wants -p Restart -p TimeoutStartUSec --no-pager 2>/dev/null | sed 's/^/    /'
echo "Rollback: sudo bash scripts/install-collector-gateway.sh --rollback"
