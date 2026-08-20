/**
 * FASE 2C — identidade Tailscale do peer. Parser puro (sem I/O).
 *
 * O IP é apenas o ponto de partida para perguntar ao tailscaled "quem é este
 * peer?". A identidade PERSISTENTE é o `Node.StableID` retornado pelo WhoIs —
 * nunca o IP (realocável), nunca o nome do node (renomeável), nunca qualquer
 * valor enviado pelo cliente.
 *
 * O parser é deliberadamente resiliente à estrutura real da resposta do
 * LocalAPI, mas fail-closed: sem um StableID string não-vazio, não há
 * identidade — e sem identidade não há autorização.
 */

export type TailscalePeerIdentity = {
  /** Identidade canônica e persistente do node no tailnet. */
  stableNodeId: string;
  /** Snapshots informativos — NUNCA usados na decisão de autorização. */
  nodeName: string | null;
  loginName: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Interpreta a resposta do WhoIs (LocalAPI `/localapi/v0/whois`).
 * Estrutura real esperada: `{ Node: { StableID, Name, ComputedName, ... },
 * UserProfile: { LoginName, ... } }`. Qualquer desvio que impeça extrair o
 * StableID → null (o chamador nega o acesso).
 */
export function parseTailscaleWhoIsResponse(payload: unknown): TailscalePeerIdentity | null {
  const root = asRecord(payload);
  if (!root) return null;

  const node = asRecord(root.Node);
  if (!node) return null;

  const stableNodeId = asNonEmptyString(node.StableID);
  if (!stableNodeId) return null;

  const userProfile = asRecord(root.UserProfile);
  return {
    stableNodeId,
    nodeName: asNonEmptyString(node.ComputedName) ?? asNonEmptyString(node.Name),
    loginName: userProfile ? asNonEmptyString(userProfile.LoginName) : null,
  };
}

/** Sanidade mínima do stable node id no cadastro administrativo. */
export function isPlausibleStableNodeId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  // StableID real tem forma compacta (ex.: "nEXAMPLE1CNTRL"); o limite existe
  // só para barrar lixo óbvio, não para adivinhar o formato exato do Tailscale.
  return trimmed.length >= 4 && trimmed.length <= 128 && !/\s/.test(trimmed);
}
