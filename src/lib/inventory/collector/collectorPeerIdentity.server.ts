/**
 * Identidade Tailscale do peer — etapa COMUM a deviceAuth e a enrollment.
 *
 *   socket real → peer → WhoIs → stable node id
 *
 * É deliberadamente a PRIMEIRA METADE da cadeia de autorização: para aqui, sem
 * consultar o Device Registry. `requireInventoryCollectorDevice` continua sendo
 * o único caminho que autoriza, acrescentando a consulta ao Registry.
 *
 * Existe para que o enrollment (primeiro acesso de um tablet ainda não
 * cadastrado) reutilize EXATAMENTE a mesma cadeia de confiança, em vez de
 * reimplementar parsing de peer ou WhoIs. Nada aqui autoriza coisa alguma.
 *
 * Fail-closed em todas as etapas: sem peer, WhoIs nulo, WhoIs sem stable id ou
 * stable id implausível → null. Nunca há fallback para IP, hostname, header
 * genérico ou qualquer dado vindo do cliente.
 */
import type { Request } from "express";
import { resolveCollectorPeerFromRequest } from "./collectorProxyPeer.js";
import { isPlausibleStableNodeId } from "./tailscaleIdentity.js";
import type { TailscalePeerIdentity } from "./tailscaleIdentity.js";
import type { TailscalePeerIdentityResolver } from "./tailscaleIdentity.server.js";

/** Identidade confirmada server-side + o endereço que a originou. */
export type CollectorPeerIdentity = TailscalePeerIdentity & {
  /** Endereço real do peer, para snapshot informativo (nunca autoridade). */
  peerAddress: string;
};

export type CollectorPeerIdentityDeps = {
  identityResolver: TailscalePeerIdentityResolver;
  /** Mesma semântica de collectorProxyPeer: header só sob proxy local. */
  trustLocalProxy?: boolean;
};

/**
 * Resolve a identidade do peer ou devolve null (negado).
 *
 * Não lança: qualquer exceção do transporte WhoIs vira null, para o chamador
 * negar de forma uniforme e não vazar a etapa que falhou.
 */
export async function resolveInventoryCollectorPeerIdentity(
  req: Request,
  deps: CollectorPeerIdentityDeps
): Promise<CollectorPeerIdentity | null> {
  try {
    const peerAddress = resolveCollectorPeerFromRequest(req, {
      trustLocalProxy: deps.trustLocalProxy === true,
    });
    if (!peerAddress) return null;

    const identity = await deps.identityResolver.resolve(peerAddress);
    if (!identity) return null;
    // Blinda contra WhoIs devolvendo stable id vazio/estranho.
    if (!isPlausibleStableNodeId(identity.stableNodeId)) return null;

    return {
      stableNodeId: identity.stableNodeId,
      nodeName: identity.nodeName ?? null,
      loginName: identity.loginName ?? null,
      peerAddress,
    };
  } catch {
    return null;
  }
}
