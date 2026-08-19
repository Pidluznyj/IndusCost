/**
 * FASE 2C — autorização fail-closed do dispositivo Collector (server-only).
 *
 *   TAILSCALE IDENTITY + DEVICE REGISTRY = DEVICE AUTORIZADO
 *
 * Nada isolado autoriza: nem IP, nem hostname, nem QR, nem cookie, nem body,
 * nem header. A identidade nasce SERVER-SIDE: socket real → WhoIs no LocalAPI
 * → stable node id → registro ativo no Device Registry.
 *
 * Nunca existe fallback: sem peer, sem WhoIs, sem stable id, sem cadastro ou
 * com cadastro inativo → 403. Não há modo desenvolvimento em runtime — testes
 * injetam transporte/resolver mockado por parâmetro, jamais por env de bypass.
 *
 * Esta fase cria a infraestrutura; NENHUMA rota de contagem usa este contexto
 * ainda (a escrita DEVICE em recordInventoryCount é a próxima fase).
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { resolveCollectorPeerAddress } from "./collectorPeerAddress.js";
import type { TailscalePeerIdentityResolver } from "./tailscaleIdentity.server.js";

export const COLLECTOR_DEVICE_UNAUTHORIZED = "COLLECTOR_DEVICE_UNAUTHORIZED";

/** Chave única do contexto em res.locals — o futuro endpoint lê daqui. */
export const COLLECTOR_DEVICE_CONTEXT_KEY = "inventoryCollectorDevice";

/**
 * Contexto canônico DEVICE. userId é null por definição: dispositivo não é
 * usuário humano falso. deviceId é o id INTERNO do Device Registry — nunca o
 * stable node id, nunca nada vindo da requisição.
 */
export type CollectorDeviceContext = {
  actorType: "DEVICE";
  deviceId: string;
  userId: null;
};

export type CollectorDeviceAuthDeps = {
  prisma: Pick<PrismaClient, "inventoryCollectorDevice">;
  identityResolver: TailscalePeerIdentityResolver;
  /** Injetável só para teste de lastSeen determinístico. */
  now?: () => Date;
};

function deny(res: Response): void {
  // Mensagem única para todos os modos de falha: quem está de fora não recebe
  // pista de qual etapa barrou (peer, WhoIs, cadastro ou status).
  res.status(403).json({
    error: "Dispositivo não autorizado.",
    code: COLLECTOR_DEVICE_UNAUTHORIZED,
  });
}

/** Lê o contexto DEVICE anexado pelo middleware (null se não autorizado). */
export function getCollectorDeviceContext(res: Response): CollectorDeviceContext | null {
  const context = res.locals[COLLECTOR_DEVICE_CONTEXT_KEY] as
    | CollectorDeviceContext
    | undefined;
  return context ?? null;
}

/**
 * Middleware fail-closed. Ordem:
 *  1. peer real do socket (headers nunca);
 *  2. WhoIs no Tailscale → identidade;
 *  3. stable node id obrigatório;
 *  4. lookup no Device Registry PELO stable id;
 *  5. active=true obrigatório;
 *  6. lastSeen best-effort (falha não muda a decisão já tomada);
 *  7. contexto DEVICE server-side em res.locals;
 *  8. next().
 */
export function requireInventoryCollectorDevice(
  deps: CollectorDeviceAuthDeps
): RequestHandler {
  const now = deps.now ?? (() => new Date());

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const peerAddress = resolveCollectorPeerAddress(req);
      if (!peerAddress) return deny(res);

      const identity = await deps.identityResolver.resolve(peerAddress);
      if (!identity?.stableNodeId) return deny(res);

      const device = await deps.prisma.inventoryCollectorDevice.findUnique({
        where: { tailscaleStableNodeId: identity.stableNodeId },
      });
      if (!device || !device.active) return deny(res);

      // Snapshot operacional: informativo, nunca autoridade. Se falhar, o
      // dispositivo continua autorizado — a decisão já foi tomada acima.
      try {
        await deps.prisma.inventoryCollectorDevice.update({
          where: { id: device.id },
          data: {
            lastSeenIp: peerAddress,
            lastSeenAt: now(),
            tailscaleNodeName: identity.nodeName ?? device.tailscaleNodeName,
            tailscaleLoginName: identity.loginName ?? device.tailscaleLoginName,
          },
        });
      } catch {
        // best-effort
      }

      const context: CollectorDeviceContext = Object.freeze({
        actorType: "DEVICE",
        deviceId: device.id,
        userId: null,
      });
      res.locals[COLLECTOR_DEVICE_CONTEXT_KEY] = context;
      next();
    } catch {
      // Qualquer exceção inesperada também nega — nunca 500 permissivo.
      deny(res);
    }
  };
}
