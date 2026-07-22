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
  serializeInventoryBlock,
  serializeInventoryCountLine,
  serializeInventoryCountSession,
  serializeInventoryCountSessionListRow,
  serializeInventoryItem,
  serializeInventoryLocation,
  serializeInventoryMovement,
  serializeInventoryMovementEnriched,
  serializeInventoryReservation,
  serializeInventoryWarehouse,
} from "@/src/lib/inventory/inventorySerialization.server.js";
import {
  linkOfficialMaterialToStockControl,
  searchOfficialMaterialsForInventory,
  updateOfficialMaterialStockLink,
} from "@/src/lib/inventory/inventoryMaterialLinkService.server.js";
import {
  assertWarehouseCanBeDeactivated,
  createInventoryLocation,
  setInventoryLocationStatus,
  updateInventoryLocation,
} from "@/src/lib/inventory/inventoryLocationService.server.js";
import {
  cancelInventoryReservation,
  createInitialInventoryBalance,
  createInventoryMovement,
  releaseInventoryBlock,
  reverseInventoryMovement,
  transferBetweenPhysicalAndQuarantine,
  type CreateInventoryMovementInput,
} from "@/src/lib/inventory/inventoryService.server.js";
import { rebuildInventoryBalancesFromLedger } from "@/src/lib/inventory/inventoryBalanceRebuild.server.js";
import {
  buildBalancesReportCsv,
  buildInitialBalanceReportCsv,
} from "@/src/lib/inventory/inventoryInitialBalance.js";
import { InventoryValidationError } from "@/src/lib/inventory/inventoryTypes.js";
import {
  parseCancelReservationBody,
  parseCreateInitialBalanceBody,
  parseCreateInventoryBlockBody,
  parseCreateInventoryItemBody,
  parseCreateInventoryLocationBody,
  parseCreateInventoryMovementBody,
  parseCreateInventoryReservationBody,
  parseCreateInventoryWarehouseBody,
  parseLinkOfficialMaterialBody,
  parseQuarantineTransferBody,
  parseReleaseBlockBody,
  parseReverseMovementBody,
  parseStatusPatchBody,
  parseUpdateInventoryItemBody,
  parseUpdateInventoryLocationBody,
  parseUpdateInventoryWarehouseBody,
  parseUpdateMaterialStockLinkBody,
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
    error.code === "LOCATION_NOT_FOUND" ||
    error.code === "LOCATION_PARENT_NOT_FOUND" ||
    error.code === "OFFICIAL_MATERIAL_NOT_FOUND" ||
    error.code === "MOVEMENT_NOT_FOUND" ||
    error.code === "RESERVATION_NOT_FOUND" ||
    error.code === "BLOCK_NOT_FOUND" ||
    error.code === "SESSION_NOT_FOUND" ||
    error.code === "LINE_NOT_FOUND"
      ? 404
      : error.code === "NOT_AUTHORIZED"
        ? 403
        : error.code === "LOCATION_CODE_DUPLICATE" ||
            error.code === "MATERIAL_ALREADY_LINKED_ACTIVE" ||
            error.code === "INVENTORY_CODE_CONFLICT" ||
            error.code === "ALREADY_REVERSED" ||
            error.code === "INITIAL_BALANCE_DUPLICATE" ||
            error.code === "INITIAL_BALANCE_SCOPE_NOT_EMPTY" ||
            error.code === "RESERVATION_NOT_ACTIVE" ||
            error.code === "BLOCK_NOT_ACTIVE"
          ? 409
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
      const linkedOnly = String(req.query.linkedMaterials ?? "").trim() === "true";
      const materialIdQ = String(req.query.materialId ?? "").trim();
      const where: Prisma.InventoryItemWhereInput = {
        ...(q.itemType ? { itemType: q.itemType } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.activeOnly ? { status: "ACTIVE" } : {}),
        ...(q.family ? { family: { equals: q.family, mode: "insensitive" } } : {}),
        ...(q.group ? { group: { equals: q.group, mode: "insensitive" } } : {}),
        ...(linkedOnly ? { materialId: { not: null } } : {}),
        ...(materialIdQ ? { materialId: materialIdQ } : {}),
        ...(q.search
          ? {
              OR: [
                { code: { contains: q.search, mode: "insensitive" } },
                { description: { contains: q.search, mode: "insensitive" } },
                { materialCodeSnapshot: { contains: q.search, mode: "insensitive" } },
                { materialDescriptionSnapshot: { contains: q.search, mode: "insensitive" } },
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

  app.get("/api/inventory/official-materials", ...view, async (req, res) => {
    try {
      const q = String(req.query.q ?? req.query.search ?? "").trim();
      const limit = Math.min(
        100,
        Math.max(1, Number.parseInt(String(req.query.limit ?? "30"), 10) || 30)
      );
      const rows = await searchOfficialMaterialsForInventory(prisma, { q, limit });
      res.json({ rows, total: rows.length });
    } catch (e: unknown) {
      console.error("GET /api/inventory/official-materials", e);
      res.status(500).json(inventoryApiError("Erro ao pesquisar matérias-primas oficiais."));
    }
  });

  app.post("/api/inventory/items/link-material", ...itemManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const input = parseLinkOfficialMaterialBody(req.body);
      const item = await linkOfficialMaterialToStockControl(prisma, input, {
        id: user.id,
        name: user.name,
      });
      res.status(201).json({ item: serializeInventoryItem(item) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return res
          .status(409)
          .json(inventoryApiError("Matéria-prima já vinculada ativamente ao estoque."));
      }
      console.error("POST /api/inventory/items/link-material", e);
      res.status(500).json(inventoryApiError("Erro ao vincular matéria-prima ao estoque."));
    }
  });

  app.put("/api/inventory/items/:id/material-link", ...itemManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const patch = parseUpdateMaterialStockLinkBody(req.body);
      const item = await updateOfficialMaterialStockLink(prisma, id, patch, {
        id: user.id,
        name: user.name,
      });
      res.json({ item: serializeInventoryItem(item) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return res
          .status(409)
          .json(inventoryApiError("Matéria-prima já vinculada ativamente ao estoque."));
      }
      console.error("PUT /api/inventory/items/:id/material-link", e);
      res.status(500).json(inventoryApiError("Erro ao atualizar vínculo logístico."));
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
      if (existing.materialId) {
        if (
          patch.code !== undefined ||
          patch.description !== undefined ||
          patch.unit !== undefined ||
          patch.itemType !== undefined
        ) {
          throw new InventoryValidationError(
            "Item vinculado à MP oficial: use o endpoint de vínculo logístico. Cadastro oficial é somente leitura.",
            "OFFICIAL_MATERIAL_FIELDS_READONLY"
          );
        }
      }
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
          createdByUserId: user.id,
          updatedByUserId: user.id,
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
      if (patch.status === "INACTIVE" && existing.status === "ACTIVE") {
        await assertWarehouseCanBeDeactivated(prisma, id);
      }
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
          updatedByUserId: user.id,
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
      if (status === "INACTIVE" && existing.status === "ACTIVE") {
        await assertWarehouseCanBeDeactivated(prisma, id);
      }

      const updated = await prisma.inventoryWarehouse.update({
        where: { id },
        data: {
          status,
          updatedByUserId: user.id,
        },
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

  app.get("/api/inventory/warehouses/:warehouseId/locations", ...view, async (req, res) => {
    try {
      const { warehouseId } = req.params;
      if (!isUuid(warehouseId)) return res.status(400).json(inventoryApiError("ID inválido."));

      const warehouse = await prisma.inventoryWarehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse) return res.status(404).json(inventoryApiError("Almoxarifado não encontrado."));

      const statusQ = String(req.query.status ?? "").trim();
      const typeQ = String(req.query.locationType ?? "").trim();
      const search = String(req.query.search ?? "").trim();

      const rows = await prisma.inventoryLocation.findMany({
        where: {
          warehouseId,
          ...(statusQ === "ACTIVE" || statusQ === "INACTIVE" ? { status: statusQ } : {}),
          ...(typeQ === "PHYSICAL" || typeQ === "QUARANTINE" || typeQ === "PRODUCTION"
            ? { locationType: typeQ }
            : {}),
          ...(search
            ? {
                OR: [
                  { code: { contains: search, mode: "insensitive" } },
                  { name: { contains: search, mode: "insensitive" } },
                  { aisle: { contains: search, mode: "insensitive" } },
                  { shelf: { contains: search, mode: "insensitive" } },
                  { position: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: [{ isDefault: "desc" }, { code: "asc" }],
      });

      res.json({
        warehouseId,
        rows: rows.map(serializeInventoryLocation),
        total: rows.length,
      });
    } catch (e: unknown) {
      console.error("GET /api/inventory/warehouses/:warehouseId/locations", e);
      res.status(500).json(inventoryApiError("Erro ao listar locais."));
    }
  });

  app.post("/api/inventory/warehouses/:warehouseId/locations", ...warehouseManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const { warehouseId } = req.params;
      if (!isUuid(warehouseId)) return res.status(400).json(inventoryApiError("ID inválido."));

      const input = parseCreateInventoryLocationBody(req.body);
      const created = await createInventoryLocation(prisma, warehouseId, input, {
        id: user.id,
        name: user.name,
      });

      res.status(201).json({ location: serializeInventoryLocation(created) });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return res.status(409).json(inventoryApiError("Código de local já cadastrado neste almoxarifado."));
      }
      console.error("POST /api/inventory/warehouses/:warehouseId/locations", e);
      res.status(500).json(inventoryApiError("Erro ao criar local."));
    }
  });

  app.get(
    "/api/inventory/warehouses/:warehouseId/locations/:locationId",
    ...view,
    async (req, res) => {
      try {
        const { warehouseId, locationId } = req.params;
        if (!isUuid(warehouseId) || !isUuid(locationId)) {
          return res.status(400).json(inventoryApiError("ID inválido."));
        }

        const location = await prisma.inventoryLocation.findFirst({
          where: { id: locationId, warehouseId },
        });
        if (!location) return res.status(404).json(inventoryApiError("Local não encontrado."));

        res.json({ location: serializeInventoryLocation(location) });
      } catch (e: unknown) {
        console.error("GET /api/inventory/warehouses/:warehouseId/locations/:locationId", e);
        res.status(500).json(inventoryApiError("Erro ao carregar local."));
      }
    }
  );

  app.put(
    "/api/inventory/warehouses/:warehouseId/locations/:locationId",
    ...warehouseManage,
    async (req, res) => {
      try {
        const user = await auth.getCurrentAppUser(req);
        if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

        const { warehouseId, locationId } = req.params;
        if (!isUuid(warehouseId) || !isUuid(locationId)) {
          return res.status(400).json(inventoryApiError("ID inválido."));
        }

        const patch = parseUpdateInventoryLocationBody(req.body);
        const updated = await updateInventoryLocation(prisma, warehouseId, locationId, patch, {
          id: user.id,
          name: user.name,
        });

        res.json({ location: serializeInventoryLocation(updated) });
      } catch (e: unknown) {
        if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          return res
            .status(409)
            .json(inventoryApiError("Código de local já cadastrado neste almoxarifado."));
        }
        console.error("PUT /api/inventory/warehouses/:warehouseId/locations/:locationId", e);
        res.status(500).json(inventoryApiError("Erro ao atualizar local."));
      }
    }
  );

  app.patch(
    "/api/inventory/warehouses/:warehouseId/locations/:locationId/status",
    ...warehouseManage,
    async (req, res) => {
      try {
        const user = await auth.getCurrentAppUser(req);
        if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

        const { warehouseId, locationId } = req.params;
        if (!isUuid(warehouseId) || !isUuid(locationId)) {
          return res.status(400).json(inventoryApiError("ID inválido."));
        }

        const status = parseStatusPatchBody(req.body);
        const updated = await setInventoryLocationStatus(
          prisma,
          warehouseId,
          locationId,
          status,
          { id: user.id, name: user.name }
        );

        res.json({ location: serializeInventoryLocation(updated) });
      } catch (e: unknown) {
        if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
        console.error(
          "PATCH /api/inventory/warehouses/:warehouseId/locations/:locationId/status",
          e
        );
        res.status(500).json(inventoryApiError("Erro ao alterar status do local."));
      }
    }
  );

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
        ...(q.locationId ? { locationId: q.locationId } : {}),
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
          location: { select: { code: true, name: true, status: true } },
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

  app.get("/api/inventory/balances/export", ...view, async (req, res) => {
    try {
      const q = parseInventoryBalancesListQuery(req.query as Record<string, unknown>);
      const where: Prisma.InventoryBalanceWhereInput = {
        ...(q.itemId ? { itemId: q.itemId } : {}),
        ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
        ...(q.locationId ? { locationId: q.locationId } : {}),
      };
      const rows = await prisma.inventoryBalance.findMany({
        where,
        include: {
          item: { select: { code: true, description: true, unit: true } },
          warehouse: { select: { code: true, name: true } },
          location: { select: { code: true } },
        },
        orderBy: [{ item: { code: "asc" } }, { warehouse: { code: "asc" } }],
        take: 10_000,
      });
      const csv = buildBalancesReportCsv(
        rows.map((row) => ({
          itemCode: row.item.code,
          itemDescription: row.item.description,
          warehouseCode: row.warehouse.code,
          warehouseName: row.warehouse.name,
          locationCode: row.location?.code ?? null,
          physicalQuantity: inventoryDec(row.physicalQuantity),
          reservedQuantity: inventoryDec(row.reservedQuantity),
          blockedQuantity: inventoryDec(row.blockedQuantity),
          quarantineQuantity: inventoryDec(row.quarantineQuantity),
          availableQuantity: inventoryDec(row.availableQuantity),
          unit: row.item.unit,
        }))
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="inventory-balances.csv"');
      res.send(csv);
    } catch (e: unknown) {
      console.error("GET /api/inventory/balances/export", e);
      res.status(500).json(inventoryApiError("Erro ao exportar saldos."));
    }
  });

  app.post("/api/inventory/balances/rebuild", ...manage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await rebuildInventoryBalancesFromLedger(
        prisma,
        {
          itemId: typeof body.itemId === "string" ? body.itemId : null,
          warehouseId: typeof body.warehouseId === "string" ? body.warehouseId : null,
          dryRun: body.dryRun === true || body.dryRun === "true",
          reason: typeof body.reason === "string" ? body.reason : null,
        },
        { userId: user.id, userName: user.name ?? null }
      );
      res.json(result);
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/balances/rebuild", e);
      res.status(500).json(inventoryApiError("Erro ao reconstruir saldos."));
    }
  });

  app.get("/api/inventory/initial-balances", ...view, async (req, res) => {
    try {
      const q = parseInventoryMovementsListQuery(req.query as Record<string, unknown>);
      const where: Prisma.InventoryMovementWhereInput = {
        movementType: "INITIAL_BALANCE",
        ...(q.itemId ? { itemId: q.itemId } : {}),
        ...(q.warehouseId
          ? {
              OR: [
                { sourceWarehouseId: q.warehouseId },
                { destinationWarehouseId: q.warehouseId },
              ],
            }
          : {}),
        ...(q.startDate || q.endDate
          ? {
              movementDate: {
                ...(q.startDate ? { gte: q.startDate } : {}),
                ...(q.endDate ? { lte: q.endDate } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.inventoryMovement.findMany({
          where,
          include: {
            ...MOVEMENT_LIST_INCLUDES,
            destinationLocation: { select: { code: true, name: true } },
          },
          orderBy: { movementDate: "desc" },
          skip: q.skip,
          take: q.pageSize,
        }),
        prisma.inventoryMovement.count({ where }),
      ]);
      res.json({
        rows: rows.map((row) => ({
          ...serializeInventoryMovementEnriched(row),
          destinationLocationCode: row.destinationLocation?.code ?? null,
          evidenceRef: row.evidenceRef,
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      });
    } catch (e: unknown) {
      console.error("GET /api/inventory/initial-balances", e);
      res.status(500).json(inventoryApiError("Erro ao listar implantações."));
    }
  });

  app.get("/api/inventory/initial-balances/report", ...view, async (req, res) => {
    try {
      const rows = await prisma.inventoryMovement.findMany({
        where: { movementType: "INITIAL_BALANCE" },
        include: {
          item: { select: { code: true, description: true } },
          destinationWarehouse: { select: { code: true, name: true } },
          destinationLocation: { select: { code: true } },
        },
        orderBy: { movementDate: "desc" },
        take: 10_000,
      });
      const csv = buildInitialBalanceReportCsv(
        rows.map((row) => ({
          movementId: row.id,
          movementDate: row.movementDate.toISOString(),
          itemCode: row.item?.code ?? "",
          itemDescription: row.item?.description ?? "",
          warehouseCode: row.destinationWarehouse?.code ?? "",
          warehouseName: row.destinationWarehouse?.name ?? "",
          locationCode: row.destinationLocation?.code ?? null,
          quantity: inventoryDec(row.quantity),
          unit: row.unit,
          responsibleUserId: row.responsibleUserId,
          reason: row.reason,
          evidenceRef: row.evidenceRef,
          documentNumber: row.documentNumber,
        }))
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="inventory-initial-balance-report.csv"'
      );
      res.send(csv);
    } catch (e: unknown) {
      console.error("GET /api/inventory/initial-balances/report", e);
      res.status(500).json(inventoryApiError("Erro ao gerar relatório de implantação."));
    }
  });

  app.post("/api/inventory/initial-balances", ...moveCreate, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const body = parseCreateInitialBalanceBody(req.body);
      const result = await createInitialInventoryBalance(
        prisma,
        {
          itemId: body.itemId,
          warehouseId: body.warehouseId,
          locationId: body.locationId,
          quantity: body.quantity,
          countDate: body.countDate,
          responsibleUserId: body.responsibleUserId || user.id,
          justification: body.justification,
          evidenceRef: body.evidenceRef,
          documentNumber: body.documentNumber,
          notes: body.notes,
          unitCost: body.unitCost,
          requireEvidence: body.requireEvidence,
        },
        {
          userId: user.id,
          permissions: user.effectivePermissions,
        }
      );

      res.status(result.idempotent ? 200 : 201).json({
        movement: serializeInventoryMovement(result.movement),
        balance: result.balance ? serializeInventoryBalanceFromSnapshot(result.balance) : undefined,
        idempotent: result.idempotent === true,
      });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/initial-balances", e);
      res.status(500).json(inventoryApiError("Erro ao registrar saldo inicial."));
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
          originType: (body.originType as CreateInventoryMovementInput["originType"]) ?? undefined,
          originId: body.originId,
          idempotencyKey: body.idempotencyKey,
          unitCost: body.unitCost,
          lotNumber: body.lotNumber,
        },
        {
          userId: user.id,
          permissions: user.effectivePermissions,
        }
      );

      res.status(result.idempotent ? 200 : 201).json({
        movement: serializeInventoryMovement(result.movement),
        balance: result.balance ? serializeInventoryBalanceFromSnapshot(result.balance) : undefined,
        reservationId: "reservationId" in result ? result.reservationId : undefined,
        idempotent: result.idempotent === true,
      });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/movements", e);
      res.status(500).json(inventoryApiError("Erro ao registrar movimentação."));
    }
  });

  app.post("/api/inventory/movements/:id/reverse", ...moveCreate, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const reason = parseReverseMovementBody(req.body);
      const result = await reverseInventoryMovement(prisma, id, {
        userId: user.id,
        permissions: user.effectivePermissions,
      }, reason);

      res.status(201).json({
        movement: serializeInventoryMovement(result.movement),
        balance: result.balance ? serializeInventoryBalanceFromSnapshot(result.balance) : undefined,
        sourceBalance: result.sourceBalance
          ? serializeInventoryBalanceFromSnapshot(result.sourceBalance)
          : undefined,
        destinationBalance: result.destinationBalance
          ? serializeInventoryBalanceFromSnapshot(result.destinationBalance)
          : undefined,
      });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/movements/:id/reverse", e);
      res.status(500).json(inventoryApiError("Erro ao estornar movimentação."));
    }
  });

  app.get("/api/inventory/reservations", ...view, async (req, res) => {
    try {
      const statusQ = String(req.query.status ?? "").trim();
      const itemId = String(req.query.itemId ?? "").trim();
      const warehouseId = String(req.query.warehouseId ?? "").trim();
      const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
      const pageSize = Math.min(
        200,
        Math.max(1, Number.parseInt(String(req.query.pageSize ?? "50"), 10) || 50)
      );
      const skip = (page - 1) * pageSize;
      const where: Prisma.InventoryReservationWhereInput = {
        ...(statusQ ? { status: statusQ as Prisma.EnumInventoryReservationStatusFilter } : {}),
        ...(itemId && isUuid(itemId) ? { itemId } : {}),
        ...(warehouseId && isUuid(warehouseId) ? { warehouseId } : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.inventoryReservation.findMany({
          where,
          include: {
            item: { select: { code: true, description: true, unit: true } },
            warehouse: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: pageSize,
        }),
        prisma.inventoryReservation.count({ where }),
      ]);
      res.json({
        rows: rows.map(serializeInventoryReservation),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (e: unknown) {
      console.error("GET /api/inventory/reservations", e);
      res.status(500).json(inventoryApiError("Erro ao listar reservas."));
    }
  });

  app.get("/api/inventory/reservations/:id", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));
      const row = await prisma.inventoryReservation.findUnique({
        where: { id },
        include: {
          item: { select: { code: true, description: true, unit: true } },
          warehouse: { select: { code: true, name: true } },
        },
      });
      if (!row) return res.status(404).json(inventoryApiError("Reserva não encontrada."));
      res.json({ reservation: serializeInventoryReservation(row) });
    } catch (e: unknown) {
      console.error("GET /api/inventory/reservations/:id", e);
      res.status(500).json(inventoryApiError("Erro ao carregar reserva."));
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
          originType: (body.originType as CreateInventoryMovementInput["originType"]) ?? "MANUAL",
          originId: body.originId,
          reservationType: body.reservationType as CreateInventoryMovementInput["reservationType"],
          responsibleUserId: body.responsibleUserId || user.id,
          expiresAt: body.expiresAt,
        },
        {
          userId: user.id,
          permissions: user.effectivePermissions,
          allowOverReservation: body.allowOverReservation,
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

  app.get("/api/inventory/blocks", ...view, async (req, res) => {
    try {
      const statusQ = String(req.query.status ?? "").trim();
      const itemId = String(req.query.itemId ?? "").trim();
      const warehouseId = String(req.query.warehouseId ?? "").trim();
      const page = Math.max(1, Number.parseInt(String(req.query.page ?? "1"), 10) || 1);
      const pageSize = Math.min(
        200,
        Math.max(1, Number.parseInt(String(req.query.pageSize ?? "50"), 10) || 50)
      );
      const skip = (page - 1) * pageSize;
      const where: Prisma.InventoryBlockWhereInput = {
        ...(statusQ ? { status: statusQ as Prisma.EnumInventoryBlockStatusFilter } : {}),
        ...(itemId && isUuid(itemId) ? { itemId } : {}),
        ...(warehouseId && isUuid(warehouseId) ? { warehouseId } : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.inventoryBlock.findMany({
          where,
          include: {
            item: { select: { code: true, description: true, unit: true } },
            warehouse: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: pageSize,
        }),
        prisma.inventoryBlock.count({ where }),
      ]);
      res.json({
        rows: rows.map(serializeInventoryBlock),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (e: unknown) {
      console.error("GET /api/inventory/blocks", e);
      res.status(500).json(inventoryApiError("Erro ao listar bloqueios."));
    }
  });

  app.get("/api/inventory/blocks/:id", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));
      const row = await prisma.inventoryBlock.findUnique({
        where: { id },
        include: {
          item: { select: { code: true, description: true, unit: true } },
          warehouse: { select: { code: true, name: true } },
        },
      });
      if (!row) return res.status(404).json(inventoryApiError("Bloqueio não encontrado."));
      res.json({ block: serializeInventoryBlock(row) });
    } catch (e: unknown) {
      console.error("GET /api/inventory/blocks/:id", e);
      res.status(500).json(inventoryApiError("Erro ao carregar bloqueio."));
    }
  });

  app.post("/api/inventory/blocks", ...reserveManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const body = parseCreateInventoryBlockBody(req.body);
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
          movementType: "BLOCK",
          quantity: body.quantity,
          unit: item.unit,
          reason: body.reason,
          notes: body.notes,
          originType: (body.originType as CreateInventoryMovementInput["originType"]) ?? "MANUAL",
          originId: body.originId,
          blockReasonType: body.reasonType as CreateInventoryMovementInput["blockReasonType"],
          responsibleUserId: body.responsibleUserId || user.id,
        },
        {
          userId: user.id,
          permissions: user.effectivePermissions,
        }
      );

      res.status(201).json({
        movement: serializeInventoryMovement(result.movement),
        blockId: result.blockId,
        balance: result.balance ? serializeInventoryBalanceFromSnapshot(result.balance) : undefined,
      });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/blocks", e);
      res.status(500).json(inventoryApiError("Erro ao criar bloqueio."));
    }
  });

  app.post("/api/inventory/blocks/:id/release", ...reserveManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json(inventoryApiError("ID inválido."));

      const reason = parseReleaseBlockBody(req.body);
      const result = await releaseInventoryBlock(prisma, id, {
        userId: user.id,
        permissions: user.effectivePermissions,
      }, reason);

      res.json({
        movement: serializeInventoryMovement(result.movement),
        blockId: result.blockId,
        balance: result.balance ? serializeInventoryBalanceFromSnapshot(result.balance) : undefined,
      });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/blocks/:id/release", e);
      res.status(500).json(inventoryApiError("Erro ao liberar bloqueio."));
    }
  });

  app.post("/api/inventory/quarantine/transfer", ...reserveManage, async (req, res) => {
    try {
      const user = await auth.getCurrentAppUser(req);
      if (!user) return res.status(401).json(inventoryApiError("Autenticação necessária."));

      const body = parseQuarantineTransferBody(req.body);
      const result = await transferBetweenPhysicalAndQuarantine(
        prisma,
        {
          itemId: body.itemId,
          quantity: body.quantity,
          reason: body.reason,
          sourceWarehouseId: body.sourceWarehouseId,
          sourceLocationId: body.sourceLocationId,
          destinationWarehouseId: body.destinationWarehouseId,
          destinationLocationId: body.destinationLocationId,
          toQuarantine: body.toQuarantine,
          notes: body.notes,
          responsibleUserId: body.responsibleUserId || user.id,
        },
        {
          userId: user.id,
          permissions: user.effectivePermissions,
        }
      );

      res.status(201).json({
        movement: serializeInventoryMovement(result.movement),
        sourceBalance: result.sourceBalance
          ? serializeInventoryBalanceFromSnapshot(result.sourceBalance)
          : undefined,
        destinationBalance: result.destinationBalance
          ? serializeInventoryBalanceFromSnapshot(result.destinationBalance)
          : undefined,
      });
    } catch (e: unknown) {
      if (e instanceof InventoryValidationError) return handleInventoryValidation(res, e);
      console.error("POST /api/inventory/quarantine/transfer", e);
      res.status(500).json(inventoryApiError("Erro na transferência de quarentena."));
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
