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
#
# Saída:
#   0  → pronto: o IP está em uma interface local E o tailscaled está ativo
#   1  → prazo expirou; o motivo vai para o journal
#   2  → configuração ausente/inválida ou ferramentas ausentes
#
# CRITÉRIO DE SUCESSO (o que o bind() do Nginx precisa de fato):
#   1. o IP esperado existe no kernel, em qualquer interface local
#      (`ip -4 -o addr show` — na prática a tailscale0);
#   2. o tailscaled está funcional (`systemctl is-active tailscaled`).
# `tailscale status --json` (BackendState) e `tailscale ip -4` são usados
# SÓ como diagnóstico nas mensagens: se a CLI se comportar diferente mas o
# IP já estiver no kernel, não geramos falso negativo.
# Não há comando oficial "wait until ready" na CLI; `tailscale up` não é usado
# aqui porque pode alterar a configuração do nó. Polling curto, prazo finito.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

log() { echo "wait-for-tailscale: $*" >&2; }

IP="${COLLECTOR_TAILSCALE_IP:-}"
TIMEOUT="${COLLECTOR_TAILSCALE_WAIT_TIMEOUT:-120}"
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
for tool in ip systemctl; do
  command -v "$tool" >/dev/null 2>&1 || { log "ferramenta ausente: $tool"; exit 2; }
done

# Interface local que já tem o IP (vazio = nenhuma).
iface_with_ip() {
  ip -4 -o addr show 2>/dev/null | awk -v ip="$IP" '$4 ~ "^" ip "/" { print $2; exit }'
}

tailscaled_active() {
  systemctl is-active --quiet tailscaled
}

# Só diagnóstico; nunca decide.
diagnostic() {
  local state ips
  if command -v tailscale >/dev/null 2>&1; then
    state="$(tailscale status --json 2>/dev/null | sed -n 's/.*"BackendState"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
    ips="$(tailscale ip -4 2>/dev/null | tr '\n' ' ')"
    echo "BackendState=${state:-desconhecido}; tailscale ip -4: ${ips:-nenhum}"
  else
    echo "CLI tailscale ausente"
  fi
}

deadline=$(( $(date +%s) + TIMEOUT ))
attempt=0
last_reason="ainda não verificado"
while :; do
  attempt=$(( attempt + 1 ))
  iface="$(iface_with_ip || true)"
  if [[ -z "$iface" ]]; then
    last_reason="${IP} ainda não existe em nenhuma interface local ($(diagnostic))"
  elif ! tailscaled_active; then
    last_reason="${IP} está em ${iface}, mas tailscaled não está ativo ($(diagnostic))"
  else
    log "pronto: ${IP} presente em ${iface} e tailscaled ativo (tentativa ${attempt}; $(diagnostic))."
    exit 0
  fi
  now=$(date +%s)
  if (( now >= deadline )); then
    log "TIMEOUT após ${TIMEOUT}s: ${last_reason}."
    log "O Nginx não pode fazer bind em ${IP} sem esse endereço. Verifique: systemctl status tailscaled; tailscale status; ip -4 addr show."
    exit 1
  fi
  if (( attempt == 1 || attempt % 10 == 0 )); then
    log "aguardando (${last_reason}); restam $(( deadline - now ))s."
  fi
  sleep "$INTERVAL"
done
