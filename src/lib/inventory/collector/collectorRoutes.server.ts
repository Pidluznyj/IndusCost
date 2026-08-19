/**
 * FASE 2D — rotas do Stock Collector (server-only).
 *
 * A rota DEVICE é apenas uma nova PORTA DE ENTRADA para o motor canônico
 * recordInventoryCount: nenhuma transação própria, nenhum CAS próprio, nenhuma
 * idempotência própria, nenhum cálculo temporal fora dele. 1 motor, 2 atores.
 *
 * Separação deliberada de autenticação:
 *   ROTA HUMANA    → login humano + requireResource (inventoryRoutes.ts)
 *   ROTA COLLECTOR → identidade Tailscale + Device Registry (2C), fail-closed
 * Uma não substitui a outra: aqui NÃO existe requireAppAuth/requireResource, e
 * login humano algum autoriza este namespace.
 *
 * O Collector só REGISTRA contagem. start/finalize/approve/generate-adjustments/
 * cancel continuam exclusivos do fluxo supervisor humano — este módulo registra
 * UMA rota e nada mais.
 */
import type express from "express";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/src/lib/prisma.js";
import {
  COUNT_LINE_VERSION_CONFLICT,
  COUNT_OPERATION_IDEMPOTENCY_CONFLICT,
  recordInventoryCount,
} from "./../inventoryCountApplicationService.server.js";
import { serializeInventoryCountLine } from "./../inventorySerialization.server.js";
import { InventoryValidationError } from "./../inventoryTypes.js";
import {
  getCollectorDeviceContext,
  requireInventoryCollectorDevice,
} from "./collectorDeviceAuth.server.js";
import { parseCollectorCountBody } from "./collectorCountContract.js";
import {
  createTailscaleLocalApiTransport,
  createTailscalePeerIdentityResolver,
  type TailscalePeerIdentityResolver,
} from "./tailscaleIdentity.server.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Mapeamento HTTP dos códigos canônicos — MESMOS status da rota humana
 * (handleInventoryValidation em inventoryRoutes.ts; paridade garantida por
 * teste estrutural). Só contrato HTTP: nenhuma regra de negócio vive aqui.
 * Nenhum erro público carrega StableID, IP ou detalhe interno.
 */
function respondCollectorValidationError(
  res: express.Response,
  error: InventoryValidationError
) {
  const status =
    error.code === "SESSION_NOT_FOUND" || error.code === "LINE_NOT_FOUND"
      ? 404
      : error.code === "NOT_AUTHORIZED"
        ? 403
        : error.code === COUNT_LINE_VERSION_CONFLICT ||
            error.code === COUNT_OPERATION_IDEMPOTENCY_CONFLICT
          ? 409
          : 400;
  return res.status(status).json({ error: error.message, code: error.code });
}

export type InventoryCollectorRoutesDeps = {
  prisma?: PrismaClient;
  identityResolver?: TailscalePeerIdentityResolver;
};

export function registerInventoryCollectorRoutes(
  app: Pick<express.Express, "patch">,
  deps: InventoryCollectorRoutesDeps = {}
): void {
  const prisma = deps.prisma ?? defaultPrisma;
  const identityResolver =
    deps.identityResolver ??
    createTailscalePeerIdentityResolver(createTailscaleLocalApiTransport());

  const deviceAuth = requireInventoryCollectorDevice({ prisma, identityResolver });

  app.patch(
    "/api/inventory/collector/count-sessions/:sessionId/lines/:lineId",
    deviceAuth,
    async (req, res) => {
      try {
        // Defensivo: sem contexto DEVICE não há operação, mesmo que alguém
        // registre o handler sem o middleware por engano.
        const device = getCollectorDeviceContext(res);
        if (!device) {
          return res
            .status(403)
            .json({ error: "Dispositivo não autorizado.", code: "COLLECTOR_DEVICE_UNAUTHORIZED" });
        }

        const { sessionId, lineId } = req.params;
        if (!UUID_RE.test(sessionId) || !UUID_RE.test(lineId)) {
          return res.status(400).json({ error: "ID inválido.", code: "INVALID_ID" });
        }

        const input = parseCollectorCountBody(req.body);

        // Identidade 100% server-side: actorType/deviceId vêm do contexto do
        // middleware (registry), userId é null por definição de DEVICE. Nada
        // do body participa — o parser já rejeitou campos de identidade.
        const result = await recordInventoryCount(
          prisma,
          {
            sessionId,
            lineId,
            countedQuantity: input.countedQuantity,
            justification: input.justification,
            expectedVersion: input.expectedVersion,
            operationId: input.operationId,
            actorType: "DEVICE",
            deviceId: device.deviceId,
          },
          { userId: null }
        );

        if (result.replayed || !result.line) {
          return res.json({ line: null, replayed: true, result: result.snapshot });
        }
        res.json({
          line: serializeInventoryCountLine(result.line),
          replayed: false,
          result: result.snapshot,
        });
      } catch (e: unknown) {
        if (e instanceof InventoryValidationError) {
          return respondCollectorValidationError(res, e);
        }
        console.error("PATCH /api/inventory/collector/count-sessions/:sessionId/lines/:lineId", e);
        res.status(500).json({ error: "Erro ao registrar contagem." });
      }
    }
  );
}
