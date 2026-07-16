/**
 * Rotas internas do módulo Estoque / Almoxarifado.
 * Saldo e movimentações imutáveis — alteração de saldo somente via POST /movements.
 */
import type express from "express";
import type { RequestHandler } from "express";
import { Prisma, type InventoryMovement, type InventoryMovementType } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess.js";
import { writeInventoryAuditLog } from "@/src/lib/inventory/inventoryAudit.server.js";
import {
  parseCreateCountSessionBody,
  parseUpdateCountLineBody,
} from "@/src/lib/inventory/inventoryCountValidation.js";
import {
  approveInventoryCountSession,
  cancelInventoryCountSession,
  createInventoryCountSession,
  finalizeInventoryCountSession,
  generateInventoryCountAdjustments,
  startInventoryCountSession,
  updateInventoryCountLine,
} from "@/src/lib/inventory/inventoryCountService.server.js";
import { calculateInventoryStatus } from "@/src/lib/inventory/inventoryStatus.js";
import { buildInventoryDashboard } from "@/src/lib/inventory/inventoryDashboard.server.js";
import {
  parseInventoryBalancesListQuery,
  parseInventoryItemsListQuery,
  parseInventoryMovementsListQuery,
  type InventoryMovementsListQuery,
} from "@/src/lib/inventory/inventoryListQuery.js";
import {
  inventoryDec,
  inventoryDecOrNull,
  serializeInventoryBalance,
  serializeInventoryBalanceWithRelations,
  serializeInventoryCountLine,
  serializeInventoryCountSession,
  serializeInventoryCountSessionListRow,
  serializeInventoryItem,
  serializeInventoryMovement,
  serializeInventoryMovementEnriched,
  serializeInventoryWarehouse,
} from "@/src/lib/inventory/inventorySerialization.server.js";
import {
  cancelInventoryReservation,
  createInventoryMovement,
} from "@/src/lib/inventory/inventoryService.server.js";
import { InventoryValidationError } from "@/src/lib/inventory/inventoryTypes.js";
import {
  parseCancelReservationBody,
  parseCreateInventoryItemBody,
  parseCreateInventoryMovementBody,
  parseCreateInventoryReservationBody,
  parseCreateInventoryWarehouseBody,
  parseStatusPatchBody,
  parseUpdateInventoryItemBody,
  parseUpdateInventoryWarehouseBody,
} from "@/src/lib/inventory/inventoryValidation.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function inventoryApiError(userMessage: string): { error: string } {
  return { error: userMessage };
}

function handleInventoryValidation(res: express.Response, error: InventoryValidationError) {
  const status =
    error.code === "ITEM_NOT_FOUND" ||
    error.code === "WAREHOUSE_NOT_FOUND" ||
    error.code === "RESERVATION_NOT_FOUND" ||
    error.code === "SESSION_NOT_FOUND" ||
    error.code === "LINE_NOT_FOUND"
      ? 404
      : error.code === "NOT_AUTHORIZED"
        ? 403
        : 400;
  return res.status(status).json({ error: error.message, code: error.code });
}

function decimalOrNull(value: number | null | undefined): Prisma.Decimal | null {
  if (value == null) return null;
  return new Prisma.Decimal(value);
}

const MOVEMENT_LIST_INCLUDES = {
  item: { select: { code: true, description: true } },
  sourceWarehouse: { select: { code: true, name: true } },
  destinationWarehouse: { select: { code: true, name: true } },
} as const;

function buildInventoryMovementsWhere(
  q: InventoryMovementsListQuery,
  fixedItemId?: string
): Prisma.InventoryMovementWhereInput {
  return {
    ...(fixedItemId ? { itemId: fixedItemId } : q.itemId ? { itemId: q.itemId } : {}),
    ...(q.movementType ? { movementType: q.movementType as InventoryMovementType } : {}),
    ...(q.warehouseId
      ? {
          OR: [{ sourceWarehouseId: q.warehouseId }, { destinationWarehouseId: q.warehouseId }],
        }
      : {}),
    ...(q.responsibleUserId ? { responsibleUserId: q.responsibleUserId } : {}),
    ...(q.originType ? { originType: q.originType as InventoryMovement["originType"] } : {}),
    ...(q.documentNumber
      ? { documentNumber: { contains: q.documentNumber, mode: "insensitive" } }
      : {}),
    ...(q.costCenterId ? { costCenterId: q.costCenterId } : {}),
    ...(q.startDate || q.endDate
      ? {
          movementDate: {
            ...(q.startDate ? { gte: q.startDate } : {}),
            ...(q.endDate ? { lte: q.endDate } : {}),
          },
        }
      : {}),
  };
}

async function sumAvailableForItem(itemId: string): Promise<number> {
  const agg = await prisma.inventoryBalance.aggregate({
    where: { itemId },
    _sum: { availableQuantity: true },
  });
  return inventoryDec(agg._sum.availableQuantity);
}

function itemMatchesStockFilters(
  available: number,
  minimum: number | null,
  reorder: number | null,
  belowMinimum: boolean,
  belowReorderPoint: boolean
): boolean {
  if (belowMinimum) {
    if (minimum == null || available >= minimum) return false;
  }
  if (belowReorderPoint) {
    if (reorder == null || available >= reorder) return false;
  }
  return true;
}

function buildBalancesListSummary(
  rows: Array<{
    itemId: string;
    physicalQuantity: unknown;
    reservedQuantity: unknown;
    blockedQuantity: unknown;
    quarantineQuantity: unknown;
    availableQuantity: unknown;
    totalValue: unknown;
    item: {
      minimumStock: unknown;
      reorderPoint: unknown;
      status: string;
    };
  }>
) {
  const itemIds = new Set<string>();
  let totalValue = 0;
  let criticalCount = 0;
  let belowMinimumCount = 0;
  let negativeCount = 0;

  for (const row of rows) {
    itemIds.add(row.itemId);
    totalValue += inventoryDec(row.totalValue);

    const physical = inventoryDec(row.physicalQuantity);
    const available = inventoryDec(row.availableQuantity);
    const minimum = inventoryDecOrNull(row.item.minimumStock);
    const reorder = inventoryDecOrNull(row.item.reorderPoint);

    if (physical < 0 || available < 0) negativeCount += 1;
    if (minimum != null && available < minimum) belowMinimumCount += 1;

    const status = calculateInventoryStatus(
      {
        physicalQuantity: physical,
        reservedQuantity: inventoryDec(row.reservedQuantity),
        blockedQuantity: inventoryDec(row.blockedQuantity),
        quarantineQuantity: inventoryDec(row.quarantineQuantity),
        availableQuantity: available,
      },
      {
        status: row.item.status as "ACTIVE" | "INACTIVE",
        minimumStock: minimum,
        reorderPoint: reorder,
      }
    );
    if (status === "CRITICAL" || status === "OUT_OF_STOCK" || status === "NEGATIVE") {
      criticalCount += 1;
    }
  }

  return {
    filteredItemsCount: itemIds.size,
    filteredRowsCount: rows.length,
    totalInventoryValue: totalValue,
    criticalCount,
    belowMinimumCount,
    negativeCount,
  };
}

export function registerInventoryRoutes(app: express.Express, auth: AuthGuards) {
  const view = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.inventory, OPERATIONS_ACTIONS.view),
  ] as const;
  const itemManage = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.inventoryItems, OPERATIONS_ACTIONS.manage),
  ] as const;
  const warehouseManage = [
    auth.requireAppAuth,
    auth.requireResource(
      OPERATIONS_RESOURCE_KEYS.inventoryWarehouses,
      OPERATIONS_ACTIONS.manage
    ),
  ] as const;
  const manage = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.inventory, OPERATIONS_ACTIONS.manage),
  ] as const;
  const moveCreate = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.inventoryMovements, OPERATIONS_ACTIONS.create),
  ] as const;
  const reserveManage = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.inventory, OPERATIONS_ACTIONS.manage),
  ] as const;
  const countApprove = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.inventoryCounts, OPERATIONS_ACTIONS.approve),
  ] as const;
  const countManage = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.inventoryCounts, OPERATIONS_ACTIONS.manage),
  ] as const;

  app.get("/api/inventory/dashboard", ...view, async (_req, res) => {
    try {
      res.json(await buildInventoryDashboard());
    } catch (e: unknown) {
      console.error("GET /api/inventory/dashboard", e);
      res.status(500).json(inventoryApiError("Erro ao carregar dashboard de estoque."));
    }
  });

  app.get("/api/inventory/items", ...view, async (req, res) => {
    try {
      const q = parseInventoryItemsListQuery(req.query as Record<string, unknown>);
      const where: Prisma.InventoryItemWhereInput = {
        ...(q.itemType ? { itemType: q.itemType } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.activeOnly ? { status: "ACTIVE" } : {}),
        ...(q.family ? { family: { equals: q.family, mode: "insensitive" } } : {}),
        ...(q.group ? { group: { equals: q.group, mode: "insensitive" } } : {}),
        ...(q.search
          ? {
              OR: [
                { code: { contains: q.search, mode: "insensitive" } },
                { description: { contains: q.search, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const needsStockFilter = q.belowMinimum || q.belowReorderPoint;

      if (!needsStockFilter) {
        const [rows, total] = await Promise.all([
          prisma.inventoryItem.findMany({
            where,
            orderBy: { code: "asc" },
            skip: q.skip,
            take: q.pageSize,
          }),
          prisma.inventoryItem.count({ where }),
        ]);
        return res.json({
          rows: rows.map(serializeInventoryItem),
          total,
          page: q.page,
          pageSize: q.pageSize,
          totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
        });
      }

      const all = await prisma.inventoryItem.findMany({ where, orderBy: { code: "asc" } });
      const filtered = [];
      for (const item of all) {
        const available = await sumAvailableForItem(item.id);
        const minimum = inventoryDecOrNull(item.minimumStock);
        const reorder = inventoryDecOrNull(item.reorderPoint);
        if (
          itemMatchesStockFilters(available, minimum, reorder, q.belowMinimum, q.belowReorderPoint)
        ) {
          filtered.push(item);
        }
      }
      const total = filtered.length;
      const pageRows = filtered.slice(q.skip, q.skip + q.pageSize);
      return res.json({
        rows: pageRows.map(serializeInventoryItem),
        total,
        page: q.page,
        pageSize: q.pageSize,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      });
    } catch (e: unknown) {
      console.error("GET /api/inventory/items", e);
      res.status(500).json(inventoryApiError("Erro ao listar itens de estoque."));
    }
  });

  app.post("/api/inventory/items", ...itemManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const input = parseCreateInventoryItemBody(req.body);
      const created = await prisma.inventoryItem.create({
        data: {
          code: input.code,
          description: input.description,
          itemType: input.itemType,
          unit: input.unit,
          status: input.status,
          family: input.family,
          group: input.group,
          controlsLot: input.controlsLot,
          controlsExpiration: input.controlsExpiration,
          controlsLocation: input.controlsLocation,
          controlsQuality: input.controlsQuality,
          minimumStock: decimalOrNull(input.minimumStock),
          maximumStock: decimalOrNull(input.maximumStock),
          reorderPoint: decimalOrNull(input.reorderPoint),
          preferredSupplierName: input.preferredSupplierName,
          averageCost: decimalOrNull(input.averageCost),
          lastKnownCost: decimalOrNull(input.lastKnownCost),
          productId: input.productId,
          nomusProductCode: input.nomusProductCode,
          nomusProductId: input.nomusProductId,
          notes: input.notes,
          createdByUserId: user.id,
          updatedByUserId: user.id,
        },
      });

      await writeInventoryAuditLog(prisma, {
        entityType: "InventoryItem",
        entityId: created.id,
        action: "CREATE",
        afterJson: serializeInventoryItem(created),
        userId: user.id,
        userName: user.name,
      });

      res.status(201).json({ item: serializeInventoryItem(created) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return res.status(409).json(inventoryApiError("Código de item já cadastrado."));
      }
      console.error("POST /api/inventory/items", e);
      res.status(500).json(inventoryApiError("Erro ao criar item de estoque."));
    }
  });

  app.get("/api/inventory/items/:id", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const item = await prisma.inventoryItem.findUnique({ where: { id } });
      if (!item) return res.status(404).json(inventoryApiError("Item não encontrado."));

      res.json({ item: serializeInventoryItem(item) });
    } catch (e: unknown) {
      console.error("GET /api/inventory/items/:id", e);
      res.status(500).json(inventoryApiError("Erro ao carregar item de estoque."));
    }
  });

  app.put("/api/inventory/items/:id", ...itemManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const existing = await prisma.inventoryItem.findUnique({ where: { id } });
      if (!existing) return res.status(404).json(inventoryApiError("Item não encontrado."));

      const patch = parseUpdateInventoryItemBody(req.body);
      const updated = await prisma.inventoryItem.update({
        where: { id },
        data: {
          ...(patch.code !== undefined ? { code: patch.code } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.itemType !== undefined ? { itemType: patch.itemType } : {}),
          ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.family !== undefined ? { family: patch.family } : {}),
          ...(patch.group !== undefined ? { group: patch.group } : {}),
          ...(patch.minimumStock !== undefined
            ? { minimumStock: decimalOrNull(patch.minimumStock) }
            : {}),
          ...(patch.maximumStock !== undefined
            ? { maximumStock: decimalOrNull(patch.maximumStock) }
            : {}),
          ...(patch.reorderPoint !== undefined
            ? { reorderPoint: decimalOrNull(patch.reorderPoint) }
            : {}),
          ...(patch.averageCost !== undefined
            ? { averageCost: decimalOrNull(patch.averageCost) }
            : {}),
          ...(patch.lastKnownCost !== undefined
            ? { lastKnownCost: decimalOrNull(patch.lastKnownCost) }
            : {}),
          ...(patch.preferredSupplierName !== undefined
            ? { preferredSupplierName: patch.preferredSupplierName }
            : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.productId !== undefined ? { productId: patch.productId } : {}),
          ...(patch.nomusProductCode !== undefined
            ? { nomusProductCode: patch.nomusProductCode }
            : {}),
          ...(patch.nomusProductId !== undefined ? { nomusProductId: patch.nomusProductId } : {}),
          updatedByUserId: user.id,
        },
      });

      await writeInventoryAuditLog(prisma, {
        entityType: "InventoryItem",
        entityId: id,
        action: "UPDATE",
        beforeJson: serializeInventoryItem(existing),
        afterJson: serializeInventoryItem(updated),
        userId: user.id,
        userName: user.name,
      });

      res.json({ item: serializeInventoryItem(updated) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("PUT /api/inventory/items/:id", e);
      res.status(500).json(inventoryApiError("Erro ao atualizar item de estoque."));
    }
  });

  app.patch("/api/inventory/items/:id/status", ...itemManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const existing = await prisma.inventoryItem.findUnique({ where: { id } });
      if (!existing) return res.status(404).json(inventoryApiError("Item não encontrado."));

      const status = parseStatusPatchBody(req.body);
      const updated = await prisma.inventoryItem.update({
        where: { id },
        data: { status, updatedByUserId: user.id },
      });

      await writeInventoryAuditLog(prisma, {
        entityType: "InventoryItem",
        entityId: id,
        action: "STATUS_CHANGE",
        beforeJson: { status: existing.status },
        afterJson: { status: updated.status },
        userId: user.id,
        userName: user.name,
        reason: `Status alterado para ${status}`,
      });

      res.json({ item: serializeInventoryItem(updated) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("PATCH /api/inventory/items/:id/status", e);
      res.status(500).json(inventoryApiError("Erro ao alterar status do item."));
    }
  });

  app.get("/api/inventory/warehouses", ...view, async (req, res) => {
    try {
      const search = String(req.query.search ?? "").trim();
      const statusQ = String(req.query.status ?? "").trim();
      const allowsMovementsQ = String(req.query.allowsMovements ?? "").trim();
      const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
      const pageSize = Math.min(200, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "50"), 10) || 50));
      const skip = (page - 1) * pageSize;

      const where: Prisma.InventoryWarehouseWhereInput = {
        ...(statusQ === "ACTIVE" || statusQ === "INACTIVE" ? { status: statusQ } : {}),
        ...(allowsMovementsQ === "true" ? { allowsMovements: true } : {}),
        ...(allowsMovementsQ === "false" ? { allowsMovements: false } : {}),
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: "insensitive" } },
                { name: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        prisma.inventoryWarehouse.findMany({
          where,
          orderBy: { code: "asc" },
          skip,
          take: pageSize,
        }),
        prisma.inventoryWarehouse.count({ where }),
      ]);

      res.json({
        rows: rows.map(serializeInventoryWarehouse),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (e: unknown) {
      console.error("GET /api/inventory/warehouses", e);
      res.status(500).json(inventoryApiError("Erro ao listar almoxarifados."));
    }
  });

  app.post("/api/inventory/warehouses", ...warehouseManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const input = parseCreateInventoryWarehouseBody(req.body);
      const created = await prisma.inventoryWarehouse.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description,
          status: input.status,
          allowsMovements: input.allowsMovements,
        },
      });

      await writeInventoryAuditLog(prisma, {
        entityType: "InventoryWarehouse",
        entityId: created.id,
        action: "CREATE",
        afterJson: serializeInventoryWarehouse(created),
        userId: user.id,
        userName: user.name,
      });

      res.status(201).json({ warehouse: serializeInventoryWarehouse(created) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return res.status(409).json(inventoryApiError("Código de almoxarifado já cadastrado."));
      }
      console.error("POST /api/inventory/warehouses", e);
      res.status(500).json(inventoryApiError("Erro ao criar almoxarifado."));
    }
  });

  app.get("/api/inventory/warehouses/:id", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const warehouse = await prisma.inventoryWarehouse.findUnique({ where: { id } });
      if (!warehouse) return res.status(404).json(inventoryApiError("Almoxarifado não encontrado."));

      res.json({ warehouse: serializeInventoryWarehouse(warehouse) });
    } catch (e: unknown) {
      console.error("GET /api/inventory/warehouses/:id", e);
      res.status(500).json(inventoryApiError("Erro ao carregar almoxarifado."));
    }
  });

  app.put("/api/inventory/warehouses/:id", ...warehouseManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const existing = await prisma.inventoryWarehouse.findUnique({ where: { id } });
      if (!existing) return res.status(404).json(inventoryApiError("Almoxarifado não encontrado."));

      const patch = parseUpdateInventoryWarehouseBody(req.body);
      const updated = await prisma.inventoryWarehouse.update({
        where: { id },
        data: {
          ...(patch.code !== undefined ? { code: patch.code } : {}),
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.allowsMovements !== undefined
            ? { allowsMovements: patch.allowsMovements }
            : {}),
        },
      });

      await writeInventoryAuditLog(prisma, {
        entityType: "InventoryWarehouse",
        entityId: id,
        action: "UPDATE",
        beforeJson: serializeInventoryWarehouse(existing),
        afterJson: serializeInventoryWarehouse(updated),
        userId: user.id,
        userName: user.name,
      });

      res.json({ warehouse: serializeInventoryWarehouse(updated) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("PUT /api/inventory/warehouses/:id", e);
      res.status(500).json(inventoryApiError("Erro ao atualizar almoxarifado."));
    }
  });

  app.patch("/api/inventory/warehouses/:id/status", ...warehouseManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const existing = await prisma.inventoryWarehouse.findUnique({ where: { id } });
      if (!existing) return res.status(404).json(inventoryApiError("Almoxarifado não encontrado."));

      const status = parseStatusPatchBody(req.body);
      const updated = await prisma.inventoryWarehouse.update({
        where: { id },
        data: { status },
      });

      await writeInventoryAuditLog(prisma, {
        entityType: "InventoryWarehouse",
        entityId: id,
        action: "STATUS_CHANGE",
        beforeJson: { status: existing.status },
        afterJson: { status: updated.status },
        userId: user.id,
        userName: user.name,
      });

      res.json({ warehouse: serializeInventoryWarehouse(updated) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("PATCH /api/inventory/warehouses/:id/status", e);
      res.status(500).json(inventoryApiError("Erro ao alterar status do almoxarifado."));
    }
  });

  app.get("/api/inventory/balances", ...view, async (req, res) => {
    try {
      const q = parseInventoryBalancesListQuery(req.query as Record<string, unknown>);

      const itemWhere: Prisma.InventoryItemWhereInput = {
        ...(q.itemType ? { itemType: q.itemType } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.family ? { family: { contains: q.family, mode: "insensitive" } } : {}),
        ...(q.group ? { group: { contains: q.group, mode: "insensitive" } } : {}),
        ...(q.search
          ? {
              OR: [
                { code: { contains: q.search, mode: "insensitive" } },
                { description: { contains: q.search, mode: "insensitive" } },
              ],
            }
          : {}),
      };

      const where: Prisma.InventoryBalanceWhereInput = {
        ...(q.itemId ? { itemId: q.itemId } : {}),
        ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
        ...(q.hasReservation ? { reservedQuantity: { gt: 0 } } : {}),
        ...(q.hasBlocked ? { blockedQuantity: { gt: 0 } } : {}),
        ...(q.hasQuarantine ? { quarantineQuantity: { gt: 0 } } : {}),
        ...(q.negativeStock
          ? {
              OR: [{ physicalQuantity: { lt: 0 } }, { availableQuantity: { lt: 0 } }],
            }
          : {}),
        ...(Object.keys(itemWhere).length ? { item: itemWhere } : {}),
      };

      const rows = await prisma.inventoryBalance.findMany({
        where,
        include: {
          item: {
            select: {
              code: true,
              description: true,
              itemType: true,
              status: true,
              minimumStock: true,
              reorderPoint: true,
              unit: true,
              family: true,
              group: true,
            },
          },
          warehouse: { select: { code: true, name: true, status: true } },
        },
        orderBy: [{ item: { code: "asc" } }, { warehouse: { code: "asc" } }],
      });

      let filtered = rows;
      if (q.belowMinimum || q.belowReorderPoint) {
        filtered = rows.filter((row) => {
          const available = inventoryDec(row.availableQuantity);
          const minimum = inventoryDecOrNull(row.item.minimumStock);
          const reorder = inventoryDecOrNull(row.item.reorderPoint);
          return itemMatchesStockFilters(
            available,
            minimum,
            reorder,
            q.belowMinimum,
            q.belowReorderPoint
          );
        });
      }

      const total = filtered.length;
      const pageRows = filtered.slice(q.skip, q.skip + q.pageSize);
      const summary = buildBalancesListSummary(filtered);

      res.json({
        rows: pageRows.map(serializeInventoryBalanceWithRelations),
        total,
        page: q.page,
        pageSize: q.pageSize,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
        summary,
      });
    } catch (e: unknown) {
      console.error("GET /api/inventory/balances", e);
      res.status(500).json(inventoryApiError("Erro ao consultar saldos."));
    }
  });

  app.get("/api/inventory/items/:id/balances", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const item = await prisma.inventoryItem.findUnique({ where: { id }, select: { id: true } });
      if (!item) return res.status(404).json(inventoryApiError("Item não encontrado."));

      const rows = await prisma.inventoryBalance.findMany({
        where: { itemId: id },
        orderBy: { updatedAt: "desc" },
      });

      res.json({ rows: rows.map(serializeInventoryBalance) });
    } catch (e: unknown) {
      console.error("GET /api/inventory/items/:id/balances", e);
      res.status(500).json(inventoryApiError("Erro ao consultar saldos do item."));
    }
  });

  app.get("/api/inventory/items/:id/movements", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const item = await prisma.inventoryItem.findUnique({ where: { id }, select: { id: true } });
      if (!item) return res.status(404).json(inventoryApiError("Item não encontrado."));

      const q = parseInventoryMovementsListQuery(req.query as Record<string, unknown>);
      const where = buildInventoryMovementsWhere(q, id);

      const [rows, total] = await Promise.all([
        prisma.inventoryMovement.findMany({
          where,
          include: MOVEMENT_LIST_INCLUDES,
          orderBy: { movementDate: "desc" },
          skip: q.skip,
          take: q.pageSize,
        }),
        prisma.inventoryMovement.count({ where }),
      ]);

      res.json({
        rows: rows.map(serializeInventoryMovementEnriched),
        total,
        page: q.page,
        pageSize: q.pageSize,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      });
    } catch (e: unknown) {
      console.error("GET /api/inventory/items/:id/movements", e);
      res.status(500).json(inventoryApiError("Erro ao listar movimentações do item."));
    }
  });

  app.get("/api/inventory/movements", ...view, async (req, res) => {
    try {
      const q = parseInventoryMovementsListQuery(req.query as Record<string, unknown>);
      const where = buildInventoryMovementsWhere(q);

      const [rows, total] = await Promise.all([
        prisma.inventoryMovement.findMany({
          where,
          include: MOVEMENT_LIST_INCLUDES,
          orderBy: { movementDate: "desc" },
          skip: q.skip,
          take: q.pageSize,
        }),
        prisma.inventoryMovement.count({ where }),
      ]);

      res.json({
        rows: rows.map(serializeInventoryMovementEnriched),
        total,
        page: q.page,
        pageSize: q.pageSize,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      });
    } catch (e: unknown) {
      console.error("GET /api/inventory/movements", e);
      res.status(500).json(inventoryApiError("Erro ao listar movimentações."));
    }
  });

  app.get("/api/inventory/movements/:id", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const movement = await prisma.inventoryMovement.findUnique({
        where: { id },
        include: MOVEMENT_LIST_INCLUDES,
      });
      if (!movement) return res.status(404).json(inventoryApiError("Movimentação não encontrada."));

      res.json({ movement: serializeInventoryMovementEnriched(movement) });
    } catch (e: unknown) {
      console.error("GET /api/inventory/movements/:id", e);
      res.status(500).json(inventoryApiError("Erro ao carregar movimentação."));
    }
  });

  app.post("/api/inventory/movements", ...moveCreate, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const body = parseCreateInventoryMovementBody(req.body);

      const item = await prisma.inventoryItem.findUnique({
        where: { id: body.itemId },
        select: { unit: true },
      });
      if (!item) {
        return res.status(404).json(inventoryApiError("Item não encontrado."));
      }

      const result = await createInventoryMovement(
        prisma,
        {
          itemId: body.itemId,
          movementType: body.movementType,
          quantity: body.quantity,
          unit: body.unit ?? item.unit,
          reason: body.reason,
          notes: body.notes,
          sourceWarehouseId: body.sourceWarehouseId,
          destinationWarehouseId: body.destinationWarehouseId,
          sourceLocationId: body.sourceLocationId,
          destinationLocationId: body.destinationLocationId,
          costCenterId: body.costCenterId,
          financialCostCenterId: body.financialCostCenterId,
          documentNumber: body.documentNumber,
          movementDate: body.movementDate ?? undefined,
        },
        {
          userId: user.id,
          permissions: user.effectivePermissions,
        }
      );

      res.status(201).json({
        movement: serializeInventoryMovement(result.movement),
        balance: result.balance ? serializeInventoryBalanceFromSnapshot(result.balance) : undefined,
        reservationId: "reservationId" in result ? result.reservationId : undefined,
      });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/movements", e);
      res.status(500).json(inventoryApiError("Erro ao registrar movimentação."));
    }
  });

  app.post("/api/inventory/reservations", ...reserveManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const body = parseCreateInventoryReservationBody(req.body);
      const item = await prisma.inventoryItem.findUnique({
        where: { id: body.itemId },
        select: { unit: true },
      });
      if (!item) return res.status(404).json(inventoryApiError("Item não encontrado."));

      const result = await createInventoryMovement(
        prisma,
        {
          itemId: body.itemId,
          sourceWarehouseId: body.warehouseId,
          sourceLocationId: body.locationId,
          movementType: "RESERVE",
          quantity: body.quantity,
          unit: item.unit,
          reason: body.reason,
          notes: body.notes,
          originType: "MANUAL",
        },
        {
          userId: user.id,
          permissions: user.effectivePermissions,
        }
      );

      res.status(201).json({
        movement: serializeInventoryMovement(result.movement),
        reservationId: result.reservationId,
        balance: result.balance ? serializeInventoryBalanceFromSnapshot(result.balance) : undefined,
      });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/reservations", e);
      res.status(500).json(inventoryApiError("Erro ao criar reserva."));
    }
  });

  app.post("/api/inventory/reservations/:id/cancel", ...reserveManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const reason = parseCancelReservationBody(req.body);
      const result = await cancelInventoryReservation(prisma, id, {
        userId: user.id,
        permissions: user.effectivePermissions,
      }, reason);

      res.json({
        movement: serializeInventoryMovement(result.movement),
        balance: result.balance ? serializeInventoryBalanceFromSnapshot(result.balance) : undefined,
      });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/reservations/:id/cancel", e);
      res.status(500).json(inventoryApiError("Erro ao cancelar reserva."));
    }
  });

  app.get("/api/inventory/count-sessions", ...view, async (req, res) => {
    try {
      const statusQ = String(req.query.status ?? "").trim();
      const warehouseId = String(req.query.warehouseId ?? "").trim();
      const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
      const pageSize = Math.min(200, Math.max(1, Number.parseInt(String(req.query.pageSize ?? "50"), 10) || 50));
      const skip = (page - 1) * pageSize;

      const where: Prisma.InventoryCountSessionWhereInput = {
        ...(statusQ ? { status: statusQ as Prisma.InventoryCountSessionWhereInput["status"] } : {}),
        ...(warehouseId && isUuid(warehouseId) ? { warehouseId } : {}),
      };

      const [sessions, total] = await Promise.all([
        prisma.inventoryCountSession.findMany({
          where,
          include: {
            warehouse: { select: { code: true, name: true } },
            lines: { select: { differenceQuantity: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: pageSize,
        }),
        prisma.inventoryCountSession.count({ where }),
      ]);

      res.json({
        rows: sessions.map((s) => serializeInventoryCountSessionListRow(s)),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (e: unknown) {
      console.error("GET /api/inventory/count-sessions", e);
      res.status(500).json(inventoryApiError("Erro ao listar conferências."));
    }
  });

  app.get("/api/inventory/count-sessions/:id", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const session = await prisma.inventoryCountSession.findUnique({
        where: { id },
        include: {
          warehouse: { select: { code: true, name: true } },
          lines: {
            include: { item: { select: { code: true, description: true, unit: true } } },
            orderBy: { item: { code: "asc" } },
          },
        },
      });
      if (!session) return res.status(404).json(inventoryApiError("Conferência não encontrada."));

      res.json({
        session: serializeInventoryCountSessionListRow(session),
        lines: session.lines.map(serializeInventoryCountLine),
      });
    } catch (e: unknown) {
      console.error("GET /api/inventory/count-sessions/:id", e);
      res.status(500).json(inventoryApiError("Erro ao carregar conferência."));
    }
  });

  app.post("/api/inventory/count-sessions", ...countManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const input = parseCreateCountSessionBody(req.body);
      const session = await createInventoryCountSession(
        prisma,
        input,
        { userId: user.id, permissions: user.effectivePermissions }
      );

      res.status(201).json({ session: serializeInventoryCountSession(session) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/count-sessions", e);
      res.status(500).json(inventoryApiError("Erro ao criar conferência."));
    }
  });

  app.post("/api/inventory/count-sessions/:id/start", ...countManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const session = await startInventoryCountSession(prisma, id, {
        userId: user.id,
        permissions: user.effectivePermissions,
      });

      res.json({ session: serializeInventoryCountSession(session) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/count-sessions/:id/start", e);
      res.status(500).json(inventoryApiError("Erro ao iniciar contagem."));
    }
  });

  app.patch("/api/inventory/count-sessions/:id/lines/:lineId", ...countManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const { id, lineId } = req.params;
      if (!isUuid(id) || !isUuid(lineId)) {
        return res.status(400).json(inventoryApiError("ID inválido."));
      }

      const input = parseUpdateCountLineBody(req.body);
      const line = await updateInventoryCountLine(prisma, id, lineId, input, {
        userId: user.id,
        permissions: user.effectivePermissions,
      });

      res.json({ line: serializeInventoryCountLine(line) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("PATCH /api/inventory/count-sessions/:id/lines/:lineId", e);
      res.status(500).json(inventoryApiError("Erro ao atualizar linha da conferência."));
    }
  });

  app.post("/api/inventory/count-sessions/:id/finalize", ...countManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const session = await finalizeInventoryCountSession(prisma, id, {
        userId: user.id,
        permissions: user.effectivePermissions,
      });

      res.json({ session: serializeInventoryCountSession(session) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/count-sessions/:id/finalize", e);
      res.status(500).json(inventoryApiError("Erro ao finalizar conferência."));
    }
  });

  app.post("/api/inventory/count-sessions/:id/approve", ...countApprove, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const session = await approveInventoryCountSession(prisma, id, {
        userId: user.id,
        permissions: user.effectivePermissions,
      });

      res.json({ session: serializeInventoryCountSession(session) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/count-sessions/:id/approve", e);
      res.status(500).json(inventoryApiError("Erro ao aprovar conferência."));
    }
  });

  app.post("/api/inventory/count-sessions/:id/generate-adjustments", ...countManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const result = await generateInventoryCountAdjustments(prisma, id, {
        userId: user.id,
        permissions: user.effectivePermissions,
      });

      res.json({
        session: serializeInventoryCountSession(result.session),
        movementsCreated: result.movementsCreated,
      });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/count-sessions/:id/generate-adjustments", e);
      res.status(500).json(inventoryApiError("Erro ao gerar ajustes da conferência."));
    }
  });

  app.post("/api/inventory/count-sessions/:id/cancel", ...countManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const session = await cancelInventoryCountSession(prisma, id, {
        userId: user.id,
        permissions: user.effectivePermissions,
      });

      res.json({ session: serializeInventoryCountSession(session) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/count-sessions/:id/cancel", e);
      res.status(500).json(inventoryApiError("Erro ao cancelar conferência."));
    }
  });
}

function serializeInventoryBalanceFromSnapshot(snapshot: {
  physicalQuantity: number;
  reservedQuantity: number;
  blockedQuantity: number;
  quarantineQuantity: number;
  availableQuantity: number;
}) {
  return {
    physicalQuantity: snapshot.physicalQuantity,
    reservedQuantity: snapshot.reservedQuantity,
    blockedQuantity: snapshot.blockedQuantity,
    quarantineQuantity: snapshot.quarantineQuantity,
    availableQuantity: snapshot.availableQuantity,
  };
}
