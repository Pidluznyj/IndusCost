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
  QR_INVALID,
  QR_VERSION_UNSUPPORTED,
  parseCollectorQrText,
} from "./collectorQrContract.js";
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
export const QR_TARGET_NOT_FOUND = "QR_TARGET_NOT_FOUND";
export const QR_WRONG_WAREHOUSE = "QR_WRONG_WAREHOUSE";
export const QR_LINE_NOT_FOUND = "QR_LINE_NOT_FOUND";
export const QR_AMBIGUOUS = "QR_AMBIGUOUS";

function respondCollectorValidationError(
  res: express.Response,
  error: InventoryValidationError
) {
  const status =
    error.code === "SESSION_NOT_FOUND" ||
    error.code === "LINE_NOT_FOUND" ||
    error.code === QR_TARGET_NOT_FOUND ||
    error.code === QR_LINE_NOT_FOUND
      ? 404
      : error.code === "NOT_AUTHORIZED"
        ? 403
        : error.code === COUNT_LINE_VERSION_CONFLICT ||
            error.code === COUNT_OPERATION_IDEMPOTENCY_CONFLICT ||
            error.code === QR_AMBIGUOUS
          ? 409
          : 400;
  return res.status(status).json({ error: error.message, code: error.code });
}

export type InventoryCollectorRoutesDeps = {
  prisma?: PrismaClient;
  identityResolver?: TailscalePeerIdentityResolver;
};

export function registerInventoryCollectorRoutes(
  app: Pick<express.Express, "get" | "post" | "patch">,
  deps: InventoryCollectorRoutesDeps = {}
): void {
  const prisma = deps.prisma ?? defaultPrisma;
  const identityResolver =
    deps.identityResolver ??
    createTailscalePeerIdentityResolver(createTailscaleLocalApiTransport());

  const deviceAuth = requireInventoryCollectorDevice({ prisma, identityResolver });

  // -------------------------------------------------------------------------
  // FASE 3 — leituras mínimas para a UI do Collector. Mesmo deviceAuth
  // fail-closed; NENHUM guard humano. Só o necessário para operar: nada de
  // custo, financeiro, Nomus, StableID ou dados administrativos do registry.
  // -------------------------------------------------------------------------

  app.get("/api/inventory/collector/context", deviceAuth, async (_req, res) => {
    try {
      const device = getCollectorDeviceContext(res);
      if (!device) {
        return res
          .status(403)
          .json({ error: "Dispositivo não autorizado.", code: "COLLECTOR_DEVICE_UNAUTHORIZED" });
      }
      const row = await prisma.inventoryCollectorDevice.findUnique({
        where: { id: device.deviceId },
        select: { id: true, name: true },
      });
      res.json({ device: row ? { id: row.id, name: row.name } : null });
    } catch (e: unknown) {
      console.error("GET /api/inventory/collector/context", e);
      res.status(500).json({ error: "Erro ao carregar contexto." });
    }
  });

  app.get("/api/inventory/collector/count-sessions", deviceAuth, async (_req, res) => {
    try {
      // Collector só enxerga sessões em COUNTING — o restante do workflow é
      // exclusivamente humano/supervisor.
      const sessions = await prisma.inventoryCountSession.findMany({
        where: { status: "COUNTING" },
        select: {
          id: true,
          code: true,
          startedAt: true,
          warehouse: { select: { code: true, name: true } },
          lines: { select: { countedQuantity: true } },
        },
        orderBy: { startedAt: "desc" },
      });
      res.json({
        sessions: sessions.map((session) => ({
          id: session.id,
          code: session.code,
          startedAt: session.startedAt?.toISOString() ?? null,
          warehouseCode: session.warehouse?.code ?? null,
          warehouseName: session.warehouse?.name ?? null,
          totalLines: session.lines.length,
          countedLines: session.lines.filter((l) => l.countedQuantity != null).length,
        })),
      });
    } catch (e: unknown) {
      console.error("GET /api/inventory/collector/count-sessions", e);
      res.status(500).json({ error: "Erro ao listar conferências." });
    }
  });

  app.post("/api/inventory/collector/resolve-qr", deviceAuth, async (req, res) => {
    try {
      const device = getCollectorDeviceContext(res);
      if (!device) {
        return res
          .status(403)
          .json({ error: "Dispositivo não autorizado.", code: "COLLECTOR_DEVICE_UNAUTHORIZED" });
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      if (!UUID_RE.test(sessionId)) {
        return res.status(400).json({ error: "Sessão inválida.", code: "INVALID_ID" });
      }

      // O conteúdo do QR NUNCA é confiado: parse estrito + revalidação de cada
      // entidade no banco, e a linha só vale dentro da sessão COUNTING.
      const qr = parseCollectorQrText(body.qr);

      const session = await prisma.inventoryCountSession.findUnique({
        where: { id: sessionId },
        select: { id: true, status: true, warehouseId: true },
      });
      if (!session) {
        throw new InventoryValidationError("Conferência não encontrada.", "SESSION_NOT_FOUND");
      }
      if (session.status !== "COUNTING") {
        throw new InventoryValidationError(
          "Conferência não está em contagem.",
          "SESSION_LOCKED"
        );
      }
      if (qr.warehouseId !== session.warehouseId) {
        throw new InventoryValidationError(
          "Etiqueta pertence a outro almoxarifado.",
          QR_WRONG_WAREHOUSE
        );
      }

      const [item, warehouse, location] = await Promise.all([
        prisma.inventoryItem.findUnique({
          where: { id: qr.itemId },
          select: { id: true, status: true, code: true, description: true, unit: true },
        }),
        prisma.inventoryWarehouse.findUnique({
          where: { id: qr.warehouseId },
          select: { id: true, status: true, code: true, name: true },
        }),
        qr.locationId
          ? prisma.inventoryLocation.findUnique({
              where: { id: qr.locationId },
              select: { id: true, status: true, code: true, name: true, warehouseId: true },
            })
          : Promise.resolve(null),
      ]);

      if (!item || item.status !== "ACTIVE" || !warehouse || warehouse.status !== "ACTIVE") {
        throw new InventoryValidationError(
          "Etiqueta aponta para item ou almoxarifado inexistente/inativo.",
          QR_TARGET_NOT_FOUND
        );
      }
      if (qr.locationId) {
        if (!location || location.warehouseId !== qr.warehouseId || location.status !== "ACTIVE") {
          throw new InventoryValidationError(
            "Etiqueta aponta para endereço inexistente, inativo ou de outro almoxarifado.",
            QR_TARGET_NOT_FOUND
          );
        }
      }

      const lines = await prisma.inventoryCountLine.findMany({
        where: {
          sessionId,
          itemId: qr.itemId,
          warehouseId: qr.warehouseId,
          locationId: qr.locationId,
        },
        select: {
          id: true,
          version: true,
          countedQuantity: true,
          generatedMovementId: true,
        },
      });
      if (lines.length === 0) {
        throw new InventoryValidationError(
          "Este item/endereço não faz parte desta conferência.",
          QR_LINE_NOT_FOUND
        );
      }
      if (lines.length > 1) {
        // D15: não deveria existir (linha nasce de saldo com UNIQUE item ×
        // balanceKey). Se existir, é dado inconsistente — bloquear explícito,
        // nunca escolher heuristicamente.
        throw new InventoryValidationError(
          "Etiqueta ambígua nesta conferência — acione o supervisor.",
          QR_AMBIGUOUS
        );
      }
      const line = lines[0];
      if (line.generatedMovementId) {
        throw new InventoryValidationError("Linha já possui ajuste gerado.", "ADJUSTMENT_EXISTS");
      }

      // CONTAGEM CEGA: nada de systemQuantity/countedQuantity na resposta — o
      // operador informa o que encontrou sem ver o saldo do sistema.
      res.json({
        line: {
          lineId: line.id,
          expectedVersion: line.version,
          alreadyCounted: line.countedQuantity != null,
          itemCode: item.code,
          itemDescription: item.description,
          itemUnit: item.unit,
          warehouseCode: warehouse.code,
          warehouseName: warehouse.name,
          locationCode: location?.code ?? null,
          locationName: location?.name ?? null,
        },
      });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) {
        return respondCollectorValidationError(res, e);
      }
      console.error("POST /api/inventory/collector/resolve-qr", e);
      res.status(500).json({ error: "Erro ao identificar etiqueta." });
    }
  });

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
