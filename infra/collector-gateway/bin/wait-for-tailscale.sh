#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# IndusCost — espera o Tailscale disponibilizar o IP em que o gateway do
# Collector faz bind. Usado como ExecStartPre do nginx.service.
#
# Instalado em /usr/local/lib/induscost/wait-for-tailscale.sh a partir de
# infra/collector-gateway/bin/wait-for-tailscale.sh (não edite no host).
#
# Entrada (ambiente, normalmente via /etc/induscost/collector-gateway.env):
#   COLLECTOR_TAILSCALE_IP            IPv4 esperado (obrigatório)
#   COLLECTOR_TAILSCALE_WAIT_TIMEOUT  segundos até desistir (padrão 120)
#   COLLECTOR_TAILSCALE_IFACE         interface (padrão tailscale0)
#
# Saída:
#   0  → o IP está na interface (e o tailscaled o reconhece)
#   1  → prazo expirou; o motivo vai para o journal
#   2  → configuração ausente/inválida ou tailscale não instalado
#
# Estratégia (na ordem que o Tailscale oferece nesta versão do Ubuntu 24.04):
#   1. `tailscale status --json` → BackendState == "Running" (estado oficial);
#   2. `tailscale ip -4`         → o daemon já atribuiu o IP esperado;
#   3. `ip -4 addr show dev tailscale0` → o kernel já tem o endereço (é isto
#      que o bind() do Nginx precisa; 1 e 2 sozinhos não bastam).
# Não há comando oficial "wait until ready" na CLI; `tailscale up` não é usado
# aqui porque pode alterar a configuração do nó. Polling curto, prazo finito.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

log() { echo "wait-for-tailscale: $*" >&2; }

IP="${COLLECTOR_TAILSCALE_IP:-}"
TIMEOUT="${COLLECTOR_TAILSCALE_WAIT_TIMEOUT:-120}"
IFACE="${COLLECTOR_TAILSCALE_IFACE:-tailscale0}"
INTERVAL=2

if [[ -z "$IP" ]]; then
  log "COLLECTOR_TAILSCALE_IP não definido (esperado em /etc/induscost/collector-gateway.env)."
  exit 2
fi
if ! [[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  log "COLLECTOR_TAILSCALE_IP inválido: '$IP'."
  exit 2
fi
if ! [[ "$TIMEOUT" =~ ^[0-9]+$ ]] || (( TIMEOUT < 1 )); then
  log "COLLECTOR_TAILSCALE_WAIT_TIMEOUT inválido: '$TIMEOUT'."
  exit 2
fi
if ! command -v tailscale >/dev/null 2>&1; then
  log "tailscale não está instalado neste host."
  exit 2
fi

backend_state() {
  # Sem jq no caminho crítico do boot: extrai "BackendState":"..." por sed.
  tailscale status --json 2>/dev/null | sed -n 's/.*"BackendState"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
}

daemon_has_ip() {
  tailscale ip -4 2>/dev/null | grep -qx "$IP"
}

kernel_has_ip() {
  ip -4 addr show dev "$IFACE" 2>/dev/null | grep -q "inet ${IP}/"
}

deadline=$(( $(date +%s) + TIMEOUT ))
attempt=0
last_reason="ainda não verificado"
while :; do
  attempt=$(( attempt + 1 ))
  state="$(backend_state || true)"
  if [[ "$state" != "Running" ]]; then
    last_reason="tailscaled ainda não está Running (estado: ${state:-desconhecido})"
  elif ! daemon_has_ip; then
    last_reason="tailscaled Running, mas ainda não atribuiu ${IP} (tailscale ip -4: $(tailscale ip -4 2>/dev/null | tr '\n' ' '))"
  elif ! kernel_has_ip; then
    last_reason="${IP} atribuído pelo tailscaled, mas ainda ausente em ${IFACE}"
  else
    log "pronto: ${IP} presente em ${IFACE} (tentativa ${attempt})."
    exit 0
  fi
  now=$(date +%s)
  if (( now >= deadline )); then
    log "TIMEOUT após ${TIMEOUT}s: ${last_reason}."
    log "O Nginx não pode fazer bind em ${IP}:443 sem esse endereço. Verifique: systemctl status tailscaled; tailscale status; ip -4 addr show dev ${IFACE}."
    exit 1
  fi
  if (( attempt == 1 || attempt % 10 == 0 )); then
    log "aguardando (${last_reason}); restam $(( deadline - now ))s."
  fi
  sleep "$INTERVAL"
done
