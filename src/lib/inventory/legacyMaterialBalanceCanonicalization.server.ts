/**
 * Preview/apply de saldo legado via motor canônico INITIAL_BALANCE.
 *
 * Dry-run por padrão. Nunca atualiza InventoryBalance ou Material.quantity
 * diretamente — só createInitialInventoryBalance.
 */
import type { PrismaClient } from "@prisma/client";
import { createInitialInventoryBalance } from "./inventoryService.server.js";
import { INVENTORY_PERMISSION_KEYS } from "./inventoryPermissionChecks.js";
import { InventoryValidationError } from "./inventoryTypes.js";
import { toInventoryDecimal } from "./materialInventoryProjection.server.js";
import {
  classifyLegacyMaterialBalance,
  isLegacyMaterialBalanceEligible,
  LEGACY_MATERIAL_INITIAL_BALANCE_CONFIRM,
  LEGACY_MATERIAL_INITIAL_BALANCE_REASON,
  summarizeLegacyMaterialBalanceClassifications,
  type LegacyMaterialBalanceClassificationResult,
  type LegacyMaterialBalanceConferenceSnapshot,
  type LegacyMaterialBalanceItemSnapshot,
  type LegacyMaterialBalancePreviewSummary,
} from "./legacyMaterialBalanceCanonicalization.js";

export const LEGACY_MATERIAL_BALANCE_APPLY_CONFIRM = LEGACY_MATERIAL_INITIAL_BALANCE_CONFIRM;

const APPLY_PERMISSIONS = [
  INVENTORY_PERMISSION_KEYS.manageLegacy,
  INVENTORY_PERMISSION_KEYS.adjustmentCreate,
] as const;

export type LegacyMaterialBalancePreview = {
  summary: LegacyMaterialBalancePreviewSummary;
  rows: LegacyMaterialBalanceClassificationResult[];
  manualReview: LegacyMaterialBalanceClassificationResult[];
  eligible: LegacyMaterialBalanceClassificationResult[];
};

export type LegacyMaterialBalanceApplyResult = {
  preview: LegacyMaterialBalancePreview;
  applied: number;
  skipped: number;
  idempotent: number;
  failed: Array<{ materialId: string; code: string; error: string; codeName?: string }>;
};

function numberQty(value: unknown): number {
  return Number(toInventoryDecimal(value).toString());
}

export async function previewLegacyMaterialBalances(
  prisma: PrismaClient,
  options?: { materialCode?: string; materialId?: string }
): Promise<LegacyMaterialBalancePreview> {
  const materialWhere = {
    status: "ACTIVE" as const,
    ...(options?.materialId ? { id: options.materialId } : {}),
    ...(options?.materialCode
      ? { code: { equals: options.materialCode, mode: "insensitive" as const } }
      : {}),
  };

  const materials = await prisma.material.findMany({
    where: materialWhere,
    select: {
      id: true,
      code: true,
      description: true,
      status: true,
      quantity: true,
      unit: true,
    },
    orderBy: { code: "asc" },
  });

  const materialIds = materials.map((m) => m.id);
  if (materialIds.length === 0) {
    return {
      summary: summarizeLegacyMaterialBalanceClassifications([]),
      rows: [],
      manualReview: [],
      eligible: [],
    };
  }

  const items = await prisma.inventoryItem.findMany({
    where: { materialId: { in: materialIds } },
    select: {
      id: true,
      status: true,
      materialId: true,
      controlsStock: true,
      controlsLocation: true,
      unit: true,
      defaultWarehouseId: true,
      defaultLocationId: true,
      createdAt: true,
      notes: true,
    },
  });

  const itemsByMaterial = new Map<string, LegacyMaterialBalanceItemSnapshot[]>();
  const itemIds: string[] = [];
  const warehouseIds = new Set<string>();
  for (const item of items) {
    if (!item.materialId) continue;
    itemIds.push(item.id);
    if (item.defaultWarehouseId) warehouseIds.add(item.defaultWarehouseId);
    const list = itemsByMaterial.get(item.materialId) ?? [];
    list.push(item);
    itemsByMaterial.set(item.materialId, list);
  }

  const [warehouses, balances, movements, initialBalances, conferences, countedLines] =
    await Promise.all([
      warehouseIds.size
        ? prisma.inventoryWarehouse.findMany({
            where: { id: { in: [...warehouseIds] } },
            select: { id: true, status: true, allowsMovements: true },
          })
        : Promise.resolve([]),
      itemIds.length
        ? prisma.inventoryBalance.findMany({
            where: { itemId: { in: itemIds } },
            select: { itemId: true, physicalQuantity: true },
          })
        : Promise.resolve([]),
      itemIds.length
        ? prisma.inventoryMovement.groupBy({
            by: ["itemId"],
            where: { itemId: { in: itemIds } },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      itemIds.length
        ? prisma.inventoryMovement.findMany({
            where: {
              itemId: { in: itemIds },
              movementType: "INITIAL_BALANCE",
            },
            select: { id: true, itemId: true },
          })
        : Promise.resolve([]),
      prisma.materialStockConference.findMany({
        where: { materialId: { in: materialIds } },
        orderBy: { recordedAt: "desc" },
        select: {
          id: true,
          materialId: true,
          reportedQuantity: true,
          recordedAt: true,
          userId: true,
        },
      }),
      itemIds.length
        ? prisma.inventoryCountLine.findMany({
            where: {
              itemId: { in: itemIds },
              countedQuantity: { not: null },
            },
            select: { itemId: true, countedQuantity: true },
          })
        : Promise.resolve([]),
    ]);

  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));
  const physicalByItem = new Map<string, number>();
  for (const row of balances) {
    physicalByItem.set(
      row.itemId,
      (physicalByItem.get(row.itemId) ?? 0) + numberQty(row.physicalQuantity)
    );
  }
  const movementCountByItem = new Map<string, number>();
  for (const row of movements) {
    movementCountByItem.set(row.itemId, row._count._all);
  }

  const initialIds = initialBalances.map((row) => row.id);
  const reversedInitials = initialIds.length
    ? await prisma.inventoryMovement.findMany({
        where: {
          movementType: "REVERSAL",
          reversedMovementId: { in: initialIds },
        },
        select: { reversedMovementId: true },
      })
    : [];
  const reversedInitialSet = new Set(
    reversedInitials.map((row) => row.reversedMovementId).filter((id): id is string => Boolean(id))
  );
  const activeInitialByItem = new Set<string>();
  for (const row of initialBalances) {
    if (!reversedInitialSet.has(row.id)) activeInitialByItem.add(row.itemId);
  }

  const latestConferenceByMaterial = new Map<string, LegacyMaterialBalanceConferenceSnapshot>();
  for (const row of conferences) {
    if (latestConferenceByMaterial.has(row.materialId)) continue;
    latestConferenceByMaterial.set(row.materialId, {
      id: row.id,
      reportedQuantity: numberQty(row.reportedQuantity),
      recordedAt: row.recordedAt,
      userId: row.userId,
    });
  }

  const countedItemIds = new Set(countedLines.map((row) => row.itemId));

  const rows: LegacyMaterialBalanceClassificationResult[] = [];
  for (const material of materials) {
    try {
      const linked = itemsByMaterial.get(material.id) ?? [];
      const active = linked.filter((item) => item.status === "ACTIVE");
      const primary = active[0] ?? null;
      const warehouse = primary?.defaultWarehouseId
        ? warehouseById.get(primary.defaultWarehouseId) ?? null
        : null;
      rows.push(
        classifyLegacyMaterialBalance({
          materialId: material.id,
          materialCode: material.code,
          materialDescription: material.description,
          materialStatus: material.status,
          materialQuantity: numberQty(material.quantity),
          materialUnit: material.unit,
          items: linked,
          warehouse,
          physicalQuantity: primary ? (physicalByItem.get(primary.id) ?? 0) : 0,
          movementCount: primary ? (movementCountByItem.get(primary.id) ?? 0) : 0,
          hasActiveInitialBalance: primary ? activeInitialByItem.has(primary.id) : false,
          latestConference: latestConferenceByMaterial.get(material.id) ?? null,
          laterCountedEvidence: primary ? countedItemIds.has(primary.id) : false,
        })
      );
    } catch (error) {
      rows.push({
        materialId: material.id,
        code: material.code,
        description: material.description,
        classification: "FAILED",
        reason: null,
        legacyQuantity: numberQty(material.quantity),
        inventoryPhysicalQuantity: 0,
        movementCount: 0,
        latestLegacyConferenceId: null,
        latestReportedQuantity: null,
        inventoryItemId: null,
        warehouseId: null,
        locationId: null,
        conferenceRecordedAt: null,
        conferenceUserId: null,
        evidenceRef: null,
      });
      void error;
    }
  }

  const summary = summarizeLegacyMaterialBalanceClassifications(rows);
  return {
    summary,
    rows,
    manualReview: rows.filter(
      (row) =>
        row.classification === "MANUAL_REVIEW" ||
        row.classification === "CONFLICTING_EVIDENCE" ||
        row.classification === "HAS_CANONICAL_MOVEMENT"
    ),
    eligible: rows.filter(isLegacyMaterialBalanceEligible),
  };
}

export async function applyEligibleLegacyMaterialBalances(
  prisma: PrismaClient,
  input: {
    confirm: string;
    actorUserId: string;
    materialCode?: string;
    materialId?: string;
  }
): Promise<LegacyMaterialBalanceApplyResult> {
  if (input.confirm !== LEGACY_MATERIAL_BALANCE_APPLY_CONFIRM) {
    throw new InventoryValidationError(
      "Apply exige --confirm=LEGACY_MATERIAL_INITIAL_BALANCE.",
      "CONFIRM_REQUIRED"
    );
  }
  if (!input.actorUserId.trim()) {
    throw new InventoryValidationError("Responsável do apply é obrigatório.", "FIELD_REQUIRED");
  }

  const preview = await previewLegacyMaterialBalances(prisma, {
    materialCode: input.materialCode,
    materialId: input.materialId,
  });

  const userIds = [
    ...new Set(
      preview.eligible
        .map((row) => row.conferenceUserId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const users = userIds.length
    ? await prisma.appUser.findMany({
        where: { id: { in: userIds }, isActive: true },
        select: { id: true },
      })
    : [];
  const validUsers = new Set(users.map((u) => u.id));

  let applied = 0;
  let skipped = 0;
  let idempotent = 0;
  const failed: LegacyMaterialBalanceApplyResult["failed"] = [];

  for (const row of preview.eligible) {
    if (!row.inventoryItemId || !row.warehouseId || !row.conferenceRecordedAt) {
      skipped += 1;
      continue;
    }
    const responsibleUserId = validUsers.has(row.conferenceUserId ?? "")
      ? (row.conferenceUserId as string)
      : input.actorUserId;
    try {
      const result = await createInitialInventoryBalance(
        prisma,
        {
          itemId: row.inventoryItemId,
          warehouseId: row.warehouseId,
          locationId: row.locationId,
          quantity: row.legacyQuantity,
          countDate: new Date(row.conferenceRecordedAt),
          responsibleUserId,
          justification: LEGACY_MATERIAL_INITIAL_BALANCE_REASON,
          evidenceRef: row.evidenceRef,
          documentNumber: null,
          notes: LEGACY_MATERIAL_INITIAL_BALANCE_REASON,
        },
        {
          userId: input.actorUserId,
          permissions: APPLY_PERMISSIONS,
        }
      );
      if (result.idempotent) idempotent += 1;
      else applied += 1;
    } catch (error) {
      const codeName =
        error instanceof InventoryValidationError ? error.code : undefined;
      if (codeName === "INITIAL_BALANCE_DUPLICATE") {
        idempotent += 1;
        continue;
      }
      failed.push({
        materialId: row.materialId,
        code: row.code,
        error: error instanceof Error ? error.message : String(error),
        codeName,
      });
    }
  }

  return { preview, applied, skipped, idempotent, failed };
}
