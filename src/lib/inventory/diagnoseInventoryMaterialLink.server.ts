/**
 * Diagnóstico read-only: InventoryItem (código exato) × candidatos Material.
 * Não escreve. Não escolhe vínculo. Não adivinha identidade.
 */
import type { PrismaClient } from "@prisma/client";
import { sumCanonicalPhysicalQuantity, toInventoryDecimal } from "./materialInventoryProjection.server.js";
import { unitsCompatible } from "./materialInventoryBalanceDiagnostic.js";

export type DiagnoseInventoryMaterialLinkQuery = {
  itemCode: string;
  relatedToken?: string | null;
  aroundDate?: string | null;
};

export type DiagnoseMaterialCandidate = {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: string;
  status: string | null;
  quantity: string;
  supplier: string | null;
  isPlanningMonitored: boolean;
  bomLineCount: number;
  matchReasons: string[];
  unitCompatibleWithItem: boolean | null;
};

function argDateRange(aroundDate: string | null | undefined): { start: Date; end: Date } | null {
  const day = aroundDate?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return {
    start: new Date(`${day}T00:00:00.000-03:00`),
    end: new Date(`${day}T23:59:59.999-03:00`),
  };
}

function pushCandidate(
  map: Map<string, DiagnoseMaterialCandidate>,
  row: Omit<DiagnoseMaterialCandidate, "matchReasons" | "unitCompatibleWithItem"> & {
    matchReason: string;
  },
  itemUnit: string | null
): void {
  const existing = map.get(row.id);
  const unitCompatibleWithItem = itemUnit ? unitsCompatible(itemUnit, row.unit) : null;
  if (existing) {
    if (!existing.matchReasons.includes(row.matchReason)) existing.matchReasons.push(row.matchReason);
    return;
  }
  map.set(row.id, {
    id: row.id,
    code: row.code,
    description: row.description,
    unit: row.unit,
    category: row.category,
    status: row.status,
    quantity: row.quantity,
    supplier: row.supplier,
    isPlanningMonitored: row.isPlanningMonitored,
    bomLineCount: row.bomLineCount,
    matchReasons: [row.matchReason],
    unitCompatibleWithItem,
  });
}

function mapMaterialRow(
  row: {
    id: string;
    code: string;
    description: string;
    unit: string;
    category: string;
    status: string | null;
    quantity: unknown;
    supplier: string | null;
    isPlanningMonitored: boolean;
  },
  matchReason: string,
  bomCounts: Map<string, number>
) {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    unit: row.unit,
    category: row.category,
    status: row.status,
    quantity: toInventoryDecimal(row.quantity).toString(),
    supplier: row.supplier,
    isPlanningMonitored: row.isPlanningMonitored === true,
    bomLineCount: bomCounts.get(row.id) ?? 0,
    matchReason,
  };
}

export async function diagnoseInventoryMaterialLink(
  db: PrismaClient,
  query: DiagnoseInventoryMaterialLinkQuery
): Promise<Record<string, unknown>> {
  const itemCode = query.itemCode.trim();
  if (!itemCode) {
    return { error: "itemCode obrigatório (código exato do InventoryItem)." };
  }

  let item = await db.inventoryItem.findUnique({
    where: { code: itemCode },
    include: {
      defaultWarehouse: { select: { id: true, code: true, name: true } },
      defaultLocation: { select: { id: true, code: true, name: true } },
    },
  });
  let codeMatch: "EXACT" | "CASE_INSENSITIVE" | "NOT_FOUND" = item ? "EXACT" : "NOT_FOUND";
  if (!item) {
    item = await db.inventoryItem.findFirst({
      where: { code: { equals: itemCode, mode: "insensitive" } },
      include: {
        defaultWarehouse: { select: { id: true, code: true, name: true } },
        defaultLocation: { select: { id: true, code: true, name: true } },
      },
    });
    if (item) codeMatch = "CASE_INSENSITIVE";
  }

  if (!item) {
    return {
      readOnly: true,
      writes: 0,
      itemCode,
      codeMatch,
      inventoryItem: null,
      message: "Nenhum InventoryItem com este código.",
    };
  }

  const balances = await db.inventoryBalance.findMany({
    where: { itemId: item.id },
    include: {
      warehouse: { select: { id: true, code: true, name: true } },
      location: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ warehouseId: "asc" }, { locationId: "asc" }],
  });

  const canonicalPhysical = sumCanonicalPhysicalQuantity(
    balances.map((b) => ({ locationId: b.locationId, physicalQuantity: b.physicalQuantity })),
    item.controlsLocation === true
  );

  const movementInclude = {
    sourceWarehouse: { select: { id: true, code: true, name: true } },
    destinationWarehouse: { select: { id: true, code: true, name: true } },
    sourceLocation: { select: { id: true, code: true, name: true } },
    destinationLocation: { select: { id: true, code: true, name: true } },
  } as const;

  const around = argDateRange(query.aroundDate);
  const [movementCount, lastMovements, aroundMovements] = await Promise.all([
    db.inventoryMovement.count({ where: { itemId: item.id } }),
    db.inventoryMovement.findMany({
      where: { itemId: item.id },
      include: movementInclude,
      orderBy: [{ movementDate: "desc" }, { createdAt: "desc" }],
      take: 20,
    }),
    around
      ? db.inventoryMovement.findMany({
          where: {
            itemId: item.id,
            movementDate: { gte: around.start, lte: around.end },
          },
          include: movementInclude,
          orderBy: { movementDate: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const mapMovement = (m: (typeof lastMovements)[number], aroundTargetDate: boolean) => ({
    id: m.id,
    movementType: m.movementType,
    quantity: toInventoryDecimal(m.quantity).toString(),
    unit: m.unit,
    movementDate: m.movementDate.toISOString(),
    createdAt: m.createdAt.toISOString(),
    sourceWarehouseId: m.sourceWarehouseId,
    destinationWarehouseId: m.destinationWarehouseId,
    sourceLocationId: m.sourceLocationId,
    destinationLocationId: m.destinationLocationId,
    sourceWarehouse: m.sourceWarehouse
      ? { id: m.sourceWarehouse.id, code: m.sourceWarehouse.code, name: m.sourceWarehouse.name }
      : null,
    destinationWarehouse: m.destinationWarehouse
      ? {
          id: m.destinationWarehouse.id,
          code: m.destinationWarehouse.code,
          name: m.destinationWarehouse.name,
        }
      : null,
    sourceLocation: m.sourceLocation
      ? { id: m.sourceLocation.id, code: m.sourceLocation.code, name: m.sourceLocation.name }
      : null,
    destinationLocation: m.destinationLocation
      ? {
          id: m.destinationLocation.id,
          code: m.destinationLocation.code,
          name: m.destinationLocation.name,
        }
      : null,
    reason: m.reason,
    originType: m.originType,
    originId: m.originId,
    reversalOfMovementId: m.reversedMovementId,
    aroundTargetDate,
  });

  const movementRows = lastMovements.map((m) =>
    mapMovement(
      m,
      around ? m.movementDate >= around.start && m.movementDate <= around.end : false
    )
  );
  const movementsAroundTargetDate = aroundMovements.map((m) => mapMovement(m, true));

  const relatedToken = query.relatedToken?.trim() || null;
  const materialSelect = {
    id: true,
    code: true,
    description: true,
    unit: true,
    category: true,
    status: true,
    quantity: true,
    supplier: true,
    isPlanningMonitored: true,
  } as const;

  const [exactCodeMaterials, descriptionMaterials, relatedMaterials, linkedMaterial, snapshotMaterial] =
    await Promise.all([
      db.material.findMany({
        where: {
          OR: [{ code: item.code }, { code: itemCode }],
        },
        select: materialSelect,
      }),
      db.material.findMany({
        where: { description: { contains: itemCode, mode: "insensitive" } },
        select: materialSelect,
        take: 40,
      }),
      relatedToken
        ? db.material.findMany({
            where: {
              OR: [
                { code: { contains: relatedToken, mode: "insensitive" } },
                { description: { contains: relatedToken, mode: "insensitive" } },
              ],
            },
            select: materialSelect,
            take: 40,
            orderBy: { code: "asc" },
          })
        : Promise.resolve([]),
      item.materialId
        ? db.material.findUnique({ where: { id: item.materialId }, select: materialSelect })
        : Promise.resolve(null),
      item.materialCodeSnapshot
        ? db.material.findMany({
            where: { code: item.materialCodeSnapshot },
            select: materialSelect,
          })
        : Promise.resolve([]),
    ]);

  const candidateIds = [
    ...exactCodeMaterials,
    ...descriptionMaterials,
    ...relatedMaterials,
    ...(linkedMaterial ? [linkedMaterial] : []),
    ...snapshotMaterial,
  ].map((m) => m.id);

  const bomCounts = new Map<string, number>();
  if (candidateIds.length) {
    const grouped = await db.productBOM.groupBy({
      by: ["materialId"],
      where: { materialId: { in: [...new Set(candidateIds)] } },
      _count: { _all: true },
    });
    for (const row of grouped) {
      if (row.materialId) bomCounts.set(row.materialId, row._count._all);
    }
  }

  const candidates = new Map<string, DiagnoseMaterialCandidate>();
  for (const row of exactCodeMaterials) {
    pushCandidate(candidates, mapMaterialRow(row, "EXACT_CODE", bomCounts), item.unit);
  }
  for (const row of snapshotMaterial) {
    pushCandidate(candidates, mapMaterialRow(row, "ITEM_SNAPSHOT_CODE", bomCounts), item.unit);
  }
  if (linkedMaterial) {
    pushCandidate(candidates, mapMaterialRow(linkedMaterial, "EXISTING_MATERIAL_ID", bomCounts), item.unit);
  }
  for (const row of descriptionMaterials) {
    pushCandidate(candidates, mapMaterialRow(row, "DESCRIPTION_CONTAINS_ITEM_CODE", bomCounts), item.unit);
  }
  for (const row of relatedMaterials) {
    pushCandidate(candidates, mapMaterialRow(row, "RELATED_TOKEN", bomCounts), item.unit);
  }

  const exactCodeOnes = [...candidates.values()].filter((c) => c.matchReasons.includes("EXACT_CODE"));
  let classification = "AMBIGUOUS";
  if (item.materialId) classification = "ALREADY_LINKED";
  else if (exactCodeOnes.length === 1 && exactCodeOnes[0]!.unitCompatibleWithItem) {
    const othersActive = await db.inventoryItem.findFirst({
      where: { materialId: exactCodeOnes[0]!.id, status: "ACTIVE", id: { not: item.id } },
      select: { id: true },
    });
    classification = othersActive ? "EXACT_CODE_BUT_MATERIAL_ALREADY_LINKED_ACTIVE" : "EXACT_CODE_1_TO_1";
  } else if (exactCodeOnes.length === 1 && exactCodeOnes[0]!.unitCompatibleWithItem === false) {
    classification = "EXACT_CODE_UNIT_MISMATCH";
  } else if (exactCodeOnes.length > 1) {
    classification = "AMBIGUOUS";
  } else if (candidates.size === 0) {
    classification = "NO_MATERIAL_CANDIDATE";
  } else {
    classification = "CODES_DIFFER_NEEDS_EXPLICIT_UUID";
  }

  return {
    readOnly: true,
    writes: 0,
    itemCodeRequested: itemCode,
    codeMatch,
    classification,
    note: "Este relatório lista candidatos. Não escolhe vínculo. Identidade oficial é InventoryItem.materialId.",
    inventoryItem: {
      id: item.id,
      code: item.code,
      description: item.description,
      itemType: item.itemType,
      unit: item.unit,
      status: item.status,
      materialId: item.materialId,
      materialCodeSnapshot: item.materialCodeSnapshot,
      materialDescriptionSnapshot: item.materialDescriptionSnapshot,
      materialUnitSnapshot: item.materialUnitSnapshot,
      materialCategorySnapshot: item.materialCategorySnapshot,
      controlsStock: item.controlsStock,
      controlsLocation: item.controlsLocation,
      defaultWarehouseId: item.defaultWarehouseId,
      defaultLocationId: item.defaultLocationId,
      defaultWarehouse: item.defaultWarehouse,
      defaultLocation: item.defaultLocation,
    },
    canonicalPhysicalQuantity: canonicalPhysical.toString(),
    balances: balances.map((b) => ({
      warehouseId: b.warehouseId,
      warehouse: b.warehouse ? { code: b.warehouse.code, name: b.warehouse.name } : null,
      locationId: b.locationId,
      location: b.location ? { code: b.location.code, name: b.location.name } : null,
      physicalQuantity: toInventoryDecimal(b.physicalQuantity).toString(),
      reservedQuantity: toInventoryDecimal(b.reservedQuantity).toString(),
      blockedQuantity: toInventoryDecimal(b.blockedQuantity).toString(),
      quarantineQuantity: toInventoryDecimal(b.quarantineQuantity).toString(),
      availableQuantity: toInventoryDecimal(b.availableQuantity).toString(),
      lastMovementAt: b.lastMovementAt?.toISOString() ?? null,
      lastMovementId: b.lastMovementId,
    })),
    movementCount,
    lastMovements: movementRows,
    movementsAroundTargetDate,
    aroundDate: query.aroundDate ?? null,
    materialCandidates: [...candidates.values()],
    decisionHint: {
      CASE_A_EXACT_CODE_1_TO_1: classification === "EXACT_CODE_1_TO_1",
      CASE_B_CODES_DIFFER: classification === "CODES_DIFFER_NEEDS_EXPLICIT_UUID",
      CASE_C_AMBIGUOUS: classification === "AMBIGUOUS",
    },
  };
}
