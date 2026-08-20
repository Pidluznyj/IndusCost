/**
 * FASE 3A — origem do peer com reverse proxy LOCAL opt-in. Motor puro.
 *
 * A câmera exige HTTPS; o TLS é terminado por um Nginx local escutando SOMENTE
 * no endereço Tailscale do host. Esse proxy encaminha para o IndusCost em
 * loopback e carimba o peer REAL no header dedicado:
 *
 *   X-IndusCost-Tailscale-Peer: $remote_addr
 *
 * REGRAS (fail-closed, sem exceção):
 *  - flag desligada (default): peer = socket.remoteAddress, header IGNORADO —
 *    comportamento 2C intacto;
 *  - flag ligada + socket NÃO-loopback: peer = socket, header IGNORADO
 *    (conexão direta do tailnet continua funcionando);
 *  - flag ligada + socket loopback + header com EXATAMENTE UM endereço válido:
 *    peer = header;
 *  - flag ligada + socket loopback + header ausente/malformado/múltiplo:
 *    peer = null → NEGADO. Nunca cair para o loopback como "peer".
 *
 * O header NUNCA autoriza sozinho: o endereço resolvido segue obrigatoriamente
 * para o WhoIs do Tailscale e depois para o Device Registry. X-Forwarded-For,
 * X-Real-IP e CF-Connecting-IP não participam em NENHUM modo — só o header
 * dedicado, e só sob as condições acima.
 */
import { normalizePeerAddress } from "./collectorPeerAddress.js";

/** Header dedicado — o Nginx local SEMPRE o sobrescreve (nunca passa o do cliente). */
export const COLLECTOR_PEER_HEADER = "x-induscost-tailscale-peer";

/** Somente loopback é proxy local confiável — nada de faixas privadas amplas. */
export function isTrustedLocalProxyAddress(remoteAddress: unknown): boolean {
  const addr = normalizePeerAddress(remoteAddress);
  if (!addr) return false;
  return addr === "::1" || addr === "127.0.0.1" || addr.startsWith("127.");
}

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV6_RE = /^[0-9a-f:]+$/;

/** O valor do header precisa ser UM endereço IP — nada de listas ou lixo. */
function parseSinglePeerHeaderValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(",") || /\s/.test(trimmed)) return null;
  const normalized = normalizePeerAddress(trimmed);
  if (!normalized) return null;
  if (!IPV4_RE.test(normalized) && !(normalized.includes(":") && IPV6_RE.test(normalized))) {
    return null;
  }
  // O peer não pode ser o próprio loopback: seria o proxy falando de si mesmo.
  if (isTrustedLocalProxyAddress(normalized)) return null;
  return normalized;
}

export type CollectorPeerRequest = {
  socket?: { remoteAddress?: string | null } | null;
  headers?: Record<string, string | string[] | undefined>;
};

/**
 * Resolve o peer do Collector conforme as regras acima. Retornar null significa
 * NEGADO — o middleware nunca converte null em fallback.
 */
export function resolveCollectorPeerFromRequest(
  request: CollectorPeerRequest,
  options: { trustLocalProxy: boolean }
): string | null {
  const socketAddress = normalizePeerAddress(request.socket?.remoteAddress ?? null);

  if (!options.trustLocalProxy) {
    return socketAddress;
  }
  if (!isTrustedLocalProxyAddress(socketAddress)) {
    // Conexão direta (ex.: peer Tailscale sem proxy): o header não participa.
    return socketAddress;
  }

  // Socket é o proxy local: a identidade TEM de vir do header dedicado.
  const raw = request.headers?.[COLLECTOR_PEER_HEADER];
  if (Array.isArray(raw)) {
    // Header repetido = tentativa de confusão → NEGADO.
    return null;
  }
  return parseSinglePeerHeaderValue(raw);
}
