/**
 * Rotas do Stock Collector (server-only).
 *
 * Autenticação: Tailscale identity + Device Registry (fail-closed). Sem login
 * humano neste namespace.
 *
 * Legado (item QR / contagem por etiqueta): context, count-sessions list,
 * resolve-qr, PATCH lines.
 * Autônomo (setor): create/start sessão, lista cega, finalize, apply-adjustments.
 *
 * Contagem sempre via recordInventoryCount (1 motor, 2 atores).
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
  applyCollectorSessionAdjustments,
  COLLECTOR_NO_WAREHOUSE_FOR_SECTOR,
  createAndStartCollectorSectorSession,
  finalizeCollectorSession,
  findActiveCountingSession,
  listCollectorSessionItemsBlind,
  resolveCollectorSectorContextPayload,
  resolveWarehousesForSector,
  summarizeActiveSession,
} from "./collectorAutonomousSession.server.js";
import {
  getCollectorDeviceContext,
  requireInventoryCollectorDevice,
} from "./collectorDeviceAuth.server.js";
import { parseCollectorCountBody, COLLECTOR_FORBIDDEN_IDENTITY_FIELDS, COLLECTOR_IDENTITY_FIELD_REJECTED } from "./collectorCountContract.js";
import { parseCollectorQrText } from "./collectorQrContract.js";
import {
  parseCollectorSector,
  collectorSectorLabel,
} from "./collectorSectorContract.js";
import {
  createTailscaleLocalApiTransport,
  createTailscalePeerIdentityResolver,
  type TailscalePeerIdentityResolver,
} from "./tailscaleIdentity.server.js";
import { resolveInventoryCollectorPeerIdentity } from "./collectorPeerIdentity.server.js";
import {
  assertNoIdentityFieldsInBody,
  getCollectorDeviceEnrollmentStatus,
  requestCollectorDeviceEnrollment,
} from "./collectorDeviceEnrollment.server.js";
import {
  COLLECTOR_ITEM_NOT_ELIGIBLE,
  listCollectorWithdrawItems,
  withdrawCollectorMaterial,
} from "./collectorWithdrawal.server.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const QR_TARGET_NOT_FOUND = "QR_TARGET_NOT_FOUND";
export const QR_WRONG_WAREHOUSE = "QR_WRONG_WAREHOUSE";
export const QR_LINE_NOT_FOUND = "QR_LINE_NOT_FOUND";
export const QR_AMBIGUOUS = "QR_AMBIGUOUS";
export const COLLECTOR_CAPABILITY_DENIED = "COLLECTOR_CAPABILITY_DENIED";

function respondCollectorValidationError(
  res: express.Response,
  error: InventoryValidationError
) {
  const status =
    error.code === "SESSION_NOT_FOUND" ||
    error.code === "LINE_NOT_FOUND" ||
    error.code === QR_TARGET_NOT_FOUND ||
    error.code === QR_LINE_NOT_FOUND ||
    error.code === COLLECTOR_ITEM_NOT_ELIGIBLE
      ? 404
      : error.code === "NOT_AUTHORIZED" || error.code === COLLECTOR_CAPABILITY_DENIED
        ? 403
        : error.code === COUNT_LINE_VERSION_CONFLICT ||
            error.code === COUNT_OPERATION_IDEMPOTENCY_CONFLICT ||
            error.code === QR_AMBIGUOUS
          ? 409
          : 400;
  return res.status(status).json({ error: error.message, code: error.code });
}

function rejectIdentityFields(body: unknown): void {
  const data = (body ?? {}) as Record<string, unknown>;
  for (const field of COLLECTOR_FORBIDDEN_IDENTITY_FIELDS) {
    if (field in data) {
      throw new InventoryValidationError(
        "Identidade do dispositivo não pode vir no corpo da requisição.",
        COLLECTOR_IDENTITY_FIELD_REJECTED
      );
    }
  }
}

async function loadDeviceCaps(
  prisma: PrismaClient,
  deviceId: string
): Promise<{
  id: string;
  name: string;
  canManageCountSessions: boolean;
  canApplyCountAdjustments: boolean;
} | null> {
  return prisma.inventoryCollectorDevice.findUnique({
    where: { id: deviceId },
    select: {
      id: true,
      name: true,
      canManageCountSessions: true,
      canApplyCountAdjustments: true,
    },
  });
}

export type InventoryCollectorRoutesDeps = {
  prisma?: PrismaClient;
  identityResolver?: TailscalePeerIdentityResolver;
  /** Override para testes; em produção vem da env no momento do registro. */
  trustLocalProxy?: boolean;
};

export const COLLECTOR_TRUST_LOCAL_PROXY_ENV = "INVENTORY_COLLECTOR_TRUST_LOCAL_PROXY";

function trustLocalProxyFromEnv(): boolean {
  return process.env[COLLECTOR_TRUST_LOCAL_PROXY_ENV] === "1";
}

export function registerInventoryCollectorRoutes(
  app: Pick<express.Express, "get" | "post" | "patch">,
  deps: InventoryCollectorRoutesDeps = {}
): void {
  const prisma = deps.prisma ?? defaultPrisma;
  const identityResolver =
    deps.identityResolver ??
    createTailscalePeerIdentityResolver(createTailscaleLocalApiTransport());

  const trustLocalProxy = deps.trustLocalProxy ?? trustLocalProxyFromEnv();
  const deviceAuth = requireInventoryCollectorDevice({
    prisma,
    identityResolver,
    trustLocalProxy,
  });

  // -------------------------------------------------------------------------
  // Enrollment — ÚNICAS rotas do Collector fora do deviceAuth.
  //
  // Precisam existir sem Device Registry porque servem justamente o aparelho
  // que ainda NÃO está cadastrado. Mesmo assim exigem identidade Tailscale
  // confirmada server-side (peer → WhoIs → stable id): sem isso, 403 igual ao
  // deviceAuth. Solicitar não autoriza nada — as demais rotas continuam
  // negando até um humano aprovar.
  // -------------------------------------------------------------------------

  const denyEnrollment = (res: express.Response) =>
    res
      .status(403)
      .json({ error: "Dispositivo não autorizado.", code: "COLLECTOR_DEVICE_UNAUTHORIZED" });

  app.post("/api/inventory/collector/enrollment", async (req, res) => {
    try {
      // Identidade vinda do cliente é recusada explicitamente (contrato claro).
      assertNoIdentityFieldsInBody(req.body);

      const identity = await resolveInventoryCollectorPeerIdentity(req, {
        identityResolver,
        trustLocalProxy,
      });
      if (!identity) return denyEnrollment(res);

      const body = (req.body ?? {}) as Record<string, unknown>;
      // Setor é só uma dica de contexto para o admin: qualquer coisa que não
      // seja string vira null em vez de virar erro na cara do operador.
      const rawSector = body.sector ?? body.requestedSectorSlug;
      const result = await requestCollectorDeviceEnrollment(prisma, identity, {
        requestedSectorSlug: typeof rawSector === "string" ? rawSector : null,
      });
      // 202: pedido aceito e registrado — NÃO é autorização.
      const status = result.status === "AUTHORIZED" ? 200 : 202;
      return res.status(status).json(result);
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) {
        return respondCollectorValidationError(res, e);
      }
      console.error("POST /api/inventory/collector/enrollment", e);
      return res.status(500).json({ error: "Erro ao solicitar autorização." });
    }
  });

  app.get("/api/inventory/collector/enrollment", async (req, res) => {
    try {
      const identity = await resolveInventoryCollectorPeerIdentity(req, {
        identityResolver,
        trustLocalProxy,
      });
      if (!identity) return denyEnrollment(res);

      const result = await getCollectorDeviceEnrollmentStatus(prisma, identity);
      return res.json(result);
    } catch (e: unknown) {
      // Polling não pode inundar o log: erro inesperado é raro e vai uma vez.
      console.error("GET /api/inventory/collector/enrollment", e);
      return res.status(500).json({ error: "Erro ao consultar autorização." });
    }
  });

  // -------------------------------------------------------------------------
  // Context — legado + setor opcional
  // -------------------------------------------------------------------------

  app.get("/api/inventory/collector/context", deviceAuth, async (req, res) => {
    try {
      const device = getCollectorDeviceContext(res);
      if (!device) {
        return res
          .status(403)
          .json({ error: "Dispositivo não autorizado.", code: "COLLECTOR_DEVICE_UNAUTHORIZED" });
      }
      const row = await loadDeviceCaps(prisma, device.deviceId);
      const sectorRaw = req.query.sector;
      if (sectorRaw == null || String(sectorRaw).trim() === "") {
        return res.json({
          device: row
            ? {
                id: row.id,
                name: row.name,
                canManageCountSessions: row.canManageCountSessions,
                canApplyCountAdjustments: row.canApplyCountAdjustments,
              }
            : null,
        });
      }

      const sector = parseCollectorSector(sectorRaw);
      const resolved = await resolveCollectorSectorContextPayload(prisma, sector);
      const warehouses = resolved.warehouses;
      let activeSession = null;
      const warehouseIdQ = String(req.query.warehouseId ?? "").trim();
      if (UUID_RE.test(warehouseIdQ)) {
        activeSession = summarizeActiveSession(
          await findActiveCountingSession(prisma, warehouseIdQ)
        );
      } else if (warehouses.length === 1) {
        activeSession = summarizeActiveSession(
          await findActiveCountingSession(prisma, warehouses[0].id)
        );
      }

      // Device autorizado: sempre 200 com estado operacional (config ≠ auth).
      let operationalState = resolved.operationalState;
      if (activeSession) {
        operationalState = "READY";
      }

      res.json({
        device: row
          ? {
              id: row.id,
              name: row.name,
              canManageCountSessions: row.canManageCountSessions,
              canApplyCountAdjustments: row.canApplyCountAdjustments,
            }
          : null,
        sector: { code: sector, label: collectorSectorLabel(sector) },
        warehouses,
        activeSession,
        operationalState,
        diagnostics: resolved.diagnostics,
      });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) {
        return respondCollectorValidationError(res, e);
      }
      console.error("GET /api/inventory/collector/context", e);
      res.status(500).json({ error: "Erro ao carregar contexto." });
    }
  });

  app.get("/api/inventory/collector/count-sessions", deviceAuth, async (_req, res) => {
    try {
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

  app.get("/api/inventory/collector/count-sessions/active", deviceAuth, async (req, res) => {
    try {
      const device = getCollectorDeviceContext(res);
      if (!device) {
        return res
          .status(403)
          .json({ error: "Dispositivo não autorizado.", code: "COLLECTOR_DEVICE_UNAUTHORIZED" });
      }
      const sector = parseCollectorSector(req.query.sector);
      const warehouseId = String(req.query.warehouseId ?? "").trim();
      if (!UUID_RE.test(warehouseId)) {
        return res.status(400).json({ error: "Almoxarifado inválido.", code: "INVALID_ID" });
      }
      const warehouses = await resolveWarehousesForSector(prisma, sector, {
        requireNonEmpty: false,
      });
      if (warehouses.length === 0) {
        throw new InventoryValidationError(
          "Nenhum almoxarifado ativo disponível para contagem. Configure um almoxarifado ACTIVE.",
          COLLECTOR_NO_WAREHOUSE_FOR_SECTOR
        );
      }
      if (!warehouses.some((w) => w.id === warehouseId)) {
        // Warehouse ACTIVE explícito ainda é válido (cold-start).
        const wh = await prisma.inventoryWarehouse.findUnique({
          where: { id: warehouseId },
          select: { id: true, status: true },
        });
        if (!wh || wh.status !== "ACTIVE") {
          throw new InventoryValidationError(
            "Almoxarifado não elegível para este setor.",
            "WAREHOUSE_NOT_ELIGIBLE"
          );
        }
      }
      const session = await findActiveCountingSession(prisma, warehouseId);
      res.json({ activeSession: summarizeActiveSession(session) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) {
        return respondCollectorValidationError(res, e);
      }
      console.error("GET /api/inventory/collector/count-sessions/active", e);
      res.status(500).json({ error: "Erro ao buscar conferência ativa." });
    }
  });

  app.post("/api/inventory/collector/count-sessions", deviceAuth, async (req, res) => {
    try {
      const device = getCollectorDeviceContext(res);
      if (!device) {
        return res
          .status(403)
          .json({ error: "Dispositivo não autorizado.", code: "COLLECTOR_DEVICE_UNAUTHORIZED" });
      }
      rejectIdentityFields(req.body);
      const caps = await loadDeviceCaps(prisma, device.deviceId);
      if (!caps?.canManageCountSessions) {
        throw new InventoryValidationError(
          "Dispositivo sem permissão para gerenciar conferências.",
          COLLECTOR_CAPABILITY_DENIED
        );
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const sector = parseCollectorSector(body.sector);
      let warehouseId = typeof body.warehouseId === "string" ? body.warehouseId.trim() : "";
      const operationId =
        typeof body.operationId === "string" ? body.operationId.trim() : null;

      if (!warehouseId) {
        const warehouses = await resolveWarehousesForSector(prisma, sector, {
          requireNonEmpty: true,
        });
        if (warehouses.length !== 1) {
          return res.status(400).json({
            error: "Informe o almoxarifado (há mais de um elegível).",
            code: "WAREHOUSE_REQUIRED",
            warehouses,
          });
        }
        warehouseId = warehouses[0].id;
      }
      if (!UUID_RE.test(warehouseId)) {
        return res.status(400).json({ error: "Almoxarifado inválido.", code: "INVALID_ID" });
      }

      const result = await createAndStartCollectorSectorSession(prisma, {
        sector,
        warehouseId,
        deviceId: device.deviceId,
        deviceName: caps?.name ?? null,
        operationId,
      });
      res.status(result.reused ? 200 : 201).json(result);
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) {
        return respondCollectorValidationError(res, e);
      }
      console.error("POST /api/inventory/collector/count-sessions", e);
      res.status(500).json({ error: "Erro ao criar conferência." });
    }
  });

  app.get(
    "/api/inventory/collector/count-sessions/:id/items",
    deviceAuth,
    async (req, res) => {
      try {
        const device = getCollectorDeviceContext(res);
        if (!device) {
          return res
            .status(403)
            .json({ error: "Dispositivo não autorizado.", code: "COLLECTOR_DEVICE_UNAUTHORIZED" });
        }
        const sessionId = req.params.id;
        if (!UUID_RE.test(sessionId)) {
          return res.status(400).json({ error: "ID inválido.", code: "INVALID_ID" });
        }
        const filterRaw = String(req.query.filter ?? "all").toLowerCase();
        const filter =
          filterRaw === "pending" || filterRaw === "counted" ? filterRaw : "all";
        const result = await listCollectorSessionItemsBlind(prisma, sessionId, {
          q: String(req.query.q ?? ""),
          filter,
        });
        // Blind: nunca incluir systemQuantity no JSON
        res.json(result);
      } catch (e: unknown) {
        if (e instanceof InventoryValidationError) {
          return respondCollectorValidationError(res, e);
        }
        console.error("GET /api/inventory/collector/count-sessions/:id/items", e);
        res.status(500).json({ error: "Erro ao listar itens." });
      }
    }
  );

  app.post("/api/inventory/collector/count", deviceAuth, async (req, res) => {
    try {
      const device = getCollectorDeviceContext(res);
      if (!device) {
        return res
          .status(403)
          .json({ error: "Dispositivo não autorizado.", code: "COLLECTOR_DEVICE_UNAUTHORIZED" });
      }
      rejectIdentityFields(req.body);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      const lineId = typeof body.lineId === "string" ? body.lineId : "";
      if (!UUID_RE.test(sessionId) || !UUID_RE.test(lineId)) {
        return res.status(400).json({ error: "ID inválido.", code: "INVALID_ID" });
      }
      const input = parseCollectorCountBody(req.body);
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
      console.error("POST /api/inventory/collector/count", e);
      res.status(500).json({ error: "Erro ao registrar contagem." });
    }
  });

  app.post(
    "/api/inventory/collector/count-sessions/:id/finalize",
    deviceAuth,
    async (req, res) => {
      try {
        const device = getCollectorDeviceContext(res);
        if (!device) {
          return res
            .status(403)
            .json({ error: "Dispositivo não autorizado.", code: "COLLECTOR_DEVICE_UNAUTHORIZED" });
        }
        rejectIdentityFields(req.body);
        const caps = await loadDeviceCaps(prisma, device.deviceId);
        if (!caps?.canManageCountSessions) {
          throw new InventoryValidationError(
            "Dispositivo sem permissão para finalizar conferências.",
            COLLECTOR_CAPABILITY_DENIED
          );
        }
        const sessionId = req.params.id;
        if (!UUID_RE.test(sessionId)) {
          return res.status(400).json({ error: "ID inválido.", code: "INVALID_ID" });
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        const summary = await finalizeCollectorSession(prisma, {
          sessionId,
          deviceId: device.deviceId,
          allowUncounted: body.allowUncounted === true,
        });
        res.json(summary);
      } catch (e: unknown) {
        if (e instanceof InventoryValidationError) {
          return respondCollectorValidationError(res, e);
        }
        console.error("POST /api/inventory/collector/count-sessions/:id/finalize", e);
        res.status(500).json({ error: "Erro ao finalizar conferência." });
      }
    }
  );

  app.post(
    "/api/inventory/collector/count-sessions/:id/apply-adjustments",
    deviceAuth,
    async (req, res) => {
      try {
        const device = getCollectorDeviceContext(res);
        if (!device) {
          return res
            .status(403)
            .json({ error: "Dispositivo não autorizado.", code: "COLLECTOR_DEVICE_UNAUTHORIZED" });
        }
        rejectIdentityFields(req.body);
        const caps = await loadDeviceCaps(prisma, device.deviceId);
        if (!caps?.canApplyCountAdjustments) {
          throw new InventoryValidationError(
            "Dispositivo sem permissão para aplicar ajustes.",
            COLLECTOR_CAPABILITY_DENIED
          );
        }
        const sessionId = req.params.id;
        if (!UUID_RE.test(sessionId)) {
          return res.status(400).json({ error: "ID inválido.", code: "INVALID_ID" });
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        if (body.confirm !== true) {
          return res.status(400).json({
            error: "Confirmação obrigatória (confirm: true).",
            code: "CONFIRM_REQUIRED",
          });
        }
        const operationId =
          typeof body.operationId === "string" ? body.operationId.trim() : null;
        if (!operationId) {
          return res.status(400).json({
            error: "operationId é obrigatório.",
            code: "COLLECTOR_OPERATION_ID_REQUIRED",
          });
        }
        const result = await applyCollectorSessionAdjustments(prisma, {
          sessionId,
          deviceId: device.deviceId,
          operationId,
        });
        res.json(result);
      } catch (e: unknown) {
        if (e instanceof InventoryValidationError) {
          return respondCollectorValidationError(res, e);
        }
        console.error(
          "POST /api/inventory/collector/count-sessions/:id/apply-adjustments",
          e
        );
        res.status(500).json({ error: "Erro ao aplicar ajustes." });
      }
    }
  );

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
        throw new InventoryValidationError(
          "Etiqueta ambígua nesta conferência — acione o supervisor.",
          QR_AMBIGUOUS
        );
      }
      const line = lines[0];
      if (line.generatedMovementId) {
        throw new InventoryValidationError("Linha já possui ajuste gerado.", "ADJUSTMENT_EXISTS");
      }

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

  // -------------------------------------------------------------------
  // Retirada de material (saída de estoque pelo tablet).
  //
  // Mesmo guard das demais rotas DEVICE. O bloqueio por saldo insuficiente
  // NÃO é implementado aqui: vem do motor de movimentação, porque o
  // contexto do dispositivo não carrega permissão de override.
  // -------------------------------------------------------------------

  app.get("/api/inventory/collector/withdraw/items", deviceAuth, async (req, res) => {
    try {
      const device = getCollectorDeviceContext(res);
      if (!device) {
        return res
          .status(403)
          .json({ error: "Dispositivo não autorizado.", code: "COLLECTOR_DEVICE_UNAUTHORIZED" });
      }
      const sector = parseCollectorSector(req.query.sector ?? "raw-material");
      const warehouseId = String(req.query.warehouseId ?? "").trim();
      if (!UUID_RE.test(warehouseId)) {
        return res.status(400).json({ error: "Almoxarifado inválido.", code: "INVALID_ID" });
      }
      const q = typeof req.query.q === "string" ? req.query.q : null;
      const items = await listCollectorWithdrawItems(prisma, { warehouseId, sector, q });
      res.json({ items });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) {
        return respondCollectorValidationError(res, e);
      }
      console.error("GET /api/inventory/collector/withdraw/items", e);
      res.status(500).json({ error: "Erro ao listar materiais." });
    }
  });

  app.post("/api/inventory/collector/withdraw", deviceAuth, async (req, res) => {
    try {
      const device = getCollectorDeviceContext(res);
      if (!device) {
        return res
          .status(403)
          .json({ error: "Dispositivo não autorizado.", code: "COLLECTOR_DEVICE_UNAUTHORIZED" });
      }
      rejectIdentityFields(req.body);

      const body = (req.body ?? {}) as Record<string, unknown>;
      const sector = parseCollectorSector(body.sector ?? "raw-material");
      const itemId = String(body.itemId ?? "").trim();
      const warehouseId = String(body.warehouseId ?? "").trim();
      if (!UUID_RE.test(itemId) || !UUID_RE.test(warehouseId)) {
        return res.status(400).json({ error: "Identificador inválido.", code: "INVALID_ID" });
      }
      const rawLocation = String(body.locationId ?? "").trim();
      if (rawLocation && !UUID_RE.test(rawLocation)) {
        return res.status(400).json({ error: "Endereço inválido.", code: "INVALID_ID" });
      }

      // movementType NUNCA vem do corpo: é constante no serviço.
      const result = await withdrawCollectorMaterial(
        prisma,
        {
          operationId: String(body.operationId ?? ""),
          itemId,
          warehouseId,
          locationId: rawLocation || null,
          quantity: body.quantity as number,
          person: body.person as string,
          sector,
        },
        { id: device.deviceId }
      );
      res.json(result);
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) {
        return respondCollectorValidationError(res, e);
      }
      console.error("POST /api/inventory/collector/withdraw", e);
      res.status(500).json({ error: "Erro ao registrar retirada." });
    }
  });
}
