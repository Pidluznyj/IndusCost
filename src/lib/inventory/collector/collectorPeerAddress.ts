/**
 * FASE 2C — origem do peer do Stock Collector. Motor puro (sem Prisma/Express).
 *
 * PREMISSA DE SEGURANÇA (documentada de propósito):
 * o servidor NÃO usa `trust proxy` (verificado em server.ts) e o Collector
 * exige peer Tailscale DIRETO nesta versão — a conexão chega pelo endereço do
 * tailnet, sem proxy no caminho. Portanto a ÚNICA fonte de endereço é
 * `socket.remoteAddress`, a conexão real observada pelo kernel.
 *
 * X-Forwarded-For, Forwarded, X-Real-IP e afins são dados escolhidos pelo
 * cliente: nenhum deles é consultado, em nenhuma circunstância. Se um dia o
 * Collector precisar atravessar proxy, isso exigirá trust explícito e limitado
 * em fase própria — na dúvida, FAIL CLOSED.
 */

export type CollectorPeerSource = {
  socket?: { remoteAddress?: string | null } | null;
};

/**
 * Normaliza o endereço observado no socket:
 *  - IPv4 puro           → como veio ("100.64.1.5")
 *  - IPv4-mapped IPv6    → IPv4 embutido ("::ffff:100.64.1.5" → "100.64.1.5")
 *  - IPv6                → minúsculas, sem zone id ("FE80::1%eth0" → "fe80::1")
 * Qualquer coisa vazia/não-string → null (fail closed no chamador).
 */
export function normalizePeerAddress(remoteAddress: unknown): string | null {
  if (typeof remoteAddress !== "string") return null;
  let addr = remoteAddress.trim().toLowerCase();
  if (!addr) return null;

  // Zone id de link-local não faz parte da identidade.
  const zoneIndex = addr.indexOf("%");
  if (zoneIndex >= 0) addr = addr.slice(0, zoneIndex);
  if (!addr) return null;

  // IPv4-mapped IPv6: ::ffff:a.b.c.d
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return mapped[1];

  return addr;
}

/**
 * Endereço do peer a partir da conexão REAL. Headers nunca participam — a
 * assinatura sequer recebe headers, para que não exista como "esquecer" isso.
 */
export function resolveCollectorPeerAddress(source: CollectorPeerSource): string | null {
  return normalizePeerAddress(source.socket?.remoteAddress ?? null);
}
