/**
 * Cold-start do setor RAW_MATERIAL para o Collector (DEVICE).
 *
 * - Não cria InventoryWarehouse.
 * - Não inventa InventoryBalance (ausência = sem saldo oficial projetado;
 *   o motor canônico trata missing balance como physicalQuantity 0 em
 *   getOrCreate / INITIAL_BALANCE / ajustes de conferência — ver relatório).
 * - Não escreve Material.quantity.
 * - Material → InventoryItem via núcleo OP-08 (idempotente, unique ACTIVE).
 */
import type { InventoryItem, PrismaClient } from "@prisma/client";
import { writeInventoryAuditLog } from "./../inventoryAudit.server.js";
import {
  assertOfficialMaterialEligibleForStock,
  buildMaterialSnapshots,
} from "./../inventoryMaterialLinkRules.js";
import { InventoryValidationError } from "./../inventoryTypes.js";
import type { CollectorSectorCode } from "./collectorSectorContract.js";
import {
  ACTIVE_MATERIAL_WHERE,
  isOfficialMaterialEligibleForStockLink,
  RAW_MATERIAL_STOCK_CONTROLLED_ITEM_WHERE,
} from "./collectorSectorEligibility.js";

export type CollectorOperationalState =
  | "READY"
  | "NEEDS_WAREHOUSE_SELECTION"
  | "CONFIGURATION_REQUIRED"
  | "NO_ELIGIBLE_ITEMS";

export type CollectorWarehouseSummary = {
  id: string;
  code: string;
  name: string;
};

export type CollectorSectorPrepareDiagnostics = {
  materialsTotal: number;
  materialsEligible: number;
  materialsAlreadyLinked: number;
  materialsMissingInventoryItem: number;
  itemsEnsured: number;
  itemsSkipped: number;
  itemsReactivated: number;
  warehouseId: string;
};

export type CollectorSectorContextResolution = {
  warehouses: CollectorWarehouseSummary[];
  operationalState: CollectorOperationalState;
  diagnostics: {
    activeWarehouses: number;
    warehousesWithRawMaterialPresence: number;
    eligibleMaterials: number;
    linkedRawMaterialItems: number;
  };
};

function sortWarehouses(list: CollectorWarehouseSummary[]): CollectorWarehouseSummary[] {
  return [...list].sort((a, b) => a.code.localeCompare(b.code, "pt-BR"));
}

/**
 * Resolve almoxarifados sem inventar código "MP".
 * Prioridade: presença RM (balances/default) → senão todos ACTIVE;
 * 0 ACTIVE → CONFIGURATION_REQUIRED; 1 → READY; N → seleção.
 */
export async function resolveCollectorSectorOperationalContext(
  prisma: PrismaClient,
  sector: CollectorSectorCode
): Promise<CollectorSectorContextResolution> {
  if (sector !== "RAW_MATERIAL") {
    throw new InventoryValidationError(
      "Setor de contagem não suportado.",
      "COLLECTOR_INVALID_SECTOR"
    );
  }

  const [activeWarehouses, balanceWhRows, defaultWhRows, eligibleMaterials, linkedItems] =
    await Promise.all([
      prisma.inventoryWarehouse.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, code: true, name: true },
        orderBy: { code: "asc" },
      }),
      prisma.inventoryBalance.findMany({
        where: {
          item: RAW_MATERIAL_STOCK_CONTROLLED_ITEM_WHERE,
          warehouse: { status: "ACTIVE" },
        },
        select: {
          warehouse: { select: { id: true, code: true, name: true } },
        },
        distinct: ["warehouseId"],
      }),
      prisma.inventoryItem.findMany({
        where: {
          ...RAW_MATERIAL_STOCK_CONTROLLED_ITEM_WHERE,
          defaultWarehouseId: { not: null },
          defaultWarehouse: { status: "ACTIVE" },
        },
        select: {
          defaultWarehouse: { select: { id: true, code: true, name: true } },
        },
      }),
      prisma.material.findMany({
        where: ACTIVE_MATERIAL_WHERE,
        select: { id: true, code: true, description: true, unit: true, status: true },
      }),
      prisma.inventoryItem.count({
        where: RAW_MATERIAL_STOCK_CONTROLLED_ITEM_WHERE,
      }),
    ]);

  const presenceById = new Map<string, CollectorWarehouseSummary>();
  for (const row of balanceWhRows) {
    if (row.warehouse) presenceById.set(row.warehouse.id, row.warehouse);
  }
  for (const row of defaultWhRows) {
    if (row.defaultWarehouse) {
      presenceById.set(row.defaultWarehouse.id, row.defaultWarehouse);
    }
  }

  const eligibleCount = eligibleMaterials.filter(isOfficialMaterialEligibleForStockLink).length;

  if (activeWarehouses.length === 0) {
    return {
      warehouses: [],
      operationalState: "CONFIGURATION_REQUIRED",
      diagnostics: {
        activeWarehouses: 0,
        warehousesWithRawMaterialPresence: 0,
        eligibleMaterials: eligibleCount,
        linkedRawMaterialItems: linkedItems,
      },
    };
  }

  const preferred =
    presenceById.size > 0
      ? sortWarehouses([...presenceById.values()])
      : sortWarehouses(activeWarehouses);

  let operationalState: CollectorOperationalState;
  if (preferred.length === 1) {
    operationalState = "READY";
  } else {
    operationalState = "NEEDS_WAREHOUSE_SELECTION";
  }

  // Sem itens vinculados e sem materiais elegíveis → operador vê config/itens.
  if (linkedItems === 0 && eligibleCount === 0) {
    operationalState = "NO_ELIGIBLE_ITEMS";
  }

  return {
    warehouses: preferred,
    operationalState,
    diagnostics: {
      activeWarehouses: activeWarehouses.length,
      warehousesWithRawMaterialPresence: presenceById.size,
      eligibleMaterials: eligibleCount,
      linkedRawMaterialItems: linkedItems,
    },
  };
}

/**
 * Garante InventoryItem ACTIVE para cada Material elegível faltante.
 * Batch reads; writes só nos missing (create/reactivate). Sem InventoryBalance.
 */
export async function prepareRawMaterialSectorForCounting(
  prisma: PrismaClient,
  input: {
    warehouseId: string;
    deviceId: string;
    deviceName?: string | null;
    sector?: CollectorSectorCode;
  }
): Promise<CollectorSectorPrepareDiagnostics> {
  const sector = input.sector ?? "RAW_MATERIAL";
  if (sector !== "RAW_MATERIAL") {
    throw new InventoryValidationError(
      "Setor de preparação não suportado.",
      "COLLECTOR_INVALID_SECTOR"
    );
  }

  const warehouse = await prisma.inventoryWarehouse.findUnique({
    where: { id: input.warehouseId },
    select: { id: true, status: true, code: true, name: true },
  });
  if (!warehouse) {
    throw new InventoryValidationError("Almoxarifado não encontrado.", "WAREHOUSE_NOT_FOUND");
  }
  if (warehouse.status !== "ACTIVE") {
    throw new InventoryValidationError(
      "Almoxarifado precisa estar ativo.",
      "WAREHOUSE_INACTIVE"
    );
  }

  const materials = await prisma.material.findMany({
    where: ACTIVE_MATERIAL_WHERE,
    select: {
      id: true,
      code: true,
      description: true,
      unit: true,
      status: true,
      category: true,
    },
  });

  const materialsTotal = materials.length;
  const eligible = materials.filter(isOfficialMaterialEligibleForStockLink);
  const materialsEligible = eligible.length;
  const eligibleIds = eligible.map((m) => m.id);

  if (eligibleIds.length === 0) {
    return {
      materialsTotal,
      materialsEligible: 0,
      materialsAlreadyLinked: 0,
      materialsMissingInventoryItem: 0,
      itemsEnsured: 0,
      itemsSkipped: 0,
      itemsReactivated: 0,
      warehouseId: input.warehouseId,
    };
  }

  const [activeLinks, inactiveLinks] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: {
        materialId: { in: eligibleIds },
        status: "ACTIVE",
      },
      select: { id: true, materialId: true, defaultWarehouseId: true },
    }),
    prisma.inventoryItem.findMany({
      where: {
        materialId: { in: eligibleIds },
        status: "INACTIVE",
      },
      select: { id: true, materialId: true, preferredSupplierName: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const linkedMaterialIds = new Set(
    activeLinks.map((r) => r.materialId).filter((id): id is string => Boolean(id))
  );
  const materialsAlreadyLinked = linkedMaterialIds.size;

  // Último INACTIVE por material (já ordenado desc).
  const inactiveByMaterial = new Map<string, (typeof inactiveLinks)[0]>();
  for (const row of inactiveLinks) {
    if (!row.materialId || inactiveByMaterial.has(row.materialId)) continue;
    inactiveByMaterial.set(row.materialId, row);
  }

  const missing = eligible.filter((m) => !linkedMaterialIds.has(m.id));
  const materialsMissingInventoryItem = missing.length;

  let itemsEnsured = 0;
  let itemsReactivated = 0;
  const ensured: InventoryItem[] = [];

  // Códigos já usados por itens não vinculados a estes materiais (evitar conflict).
  const codes = missing.map((m) => m.code.trim());
  const codeConflicts =
    codes.length > 0
      ? await prisma.inventoryItem.findMany({
          where: {
            OR: codes.map((code) => ({
              code: { equals: code, mode: "insensitive" as const },
              OR: [{ materialId: null }, { materialId: { notIn: eligibleIds } }],
            })),
          },
          select: { id: true, code: true },
        })
      : [];
  const conflictCodes = new Set(codeConflicts.map((c) => c.code.trim().toUpperCase()));

  for (const materialRow of missing) {
    const material = assertOfficialMaterialEligibleForStock({
      id: materialRow.id,
      code: materialRow.code,
      description: materialRow.description,
      unit: materialRow.unit,
      category: materialRow.category,
      status: materialRow.status,
    });
    const snapshots = buildMaterialSnapshots(material);
    if (conflictCodes.has(snapshots.code.toUpperCase())) {
      // Não bloqueia o prepare inteiro — pula e registra no diagnóstico via skip.
      continue;
    }

    const inactiveSame = inactiveByMaterial.get(material.id) ?? null;
    const data = {
      code: snapshots.code,
      description: snapshots.description,
      itemType: "RAW_MATERIAL" as const,
      unit: snapshots.unit,
      status: "ACTIVE" as const,
      family: snapshots.materialCategorySnapshot,
      group: null as string | null,
      controlsLot: false,
      controlsExpiration: false,
      controlsLocation: false,
      controlsQuality: false,
      controlsStock: true,
      allowsReservation: true,
      allowsBlock: true,
      minimumStock: null as number | null,
      safetyStock: null as number | null,
      maximumStock: null as number | null,
      reorderPoint: null as number | null,
      materialId: snapshots.materialId,
      materialCodeSnapshot: snapshots.materialCodeSnapshot,
      materialDescriptionSnapshot: snapshots.materialDescriptionSnapshot,
      materialUnitSnapshot: snapshots.materialUnitSnapshot,
      materialCategorySnapshot: snapshots.materialCategorySnapshot,
      defaultWarehouseId: input.warehouseId,
      defaultLocationId: null as string | null,
      notes: "Collector cold-start link",
      updatedByUserId: null as string | null,
    };

    const item = inactiveSame
      ? await prisma.inventoryItem.update({
          where: { id: inactiveSame.id },
          data: {
            ...data,
            preferredSupplierName: inactiveSame.preferredSupplierName,
          },
        })
      : await prisma.inventoryItem.create({
          data: {
            ...data,
            createdByUserId: null,
          },
        });

    if (inactiveSame) itemsReactivated += 1;
    itemsEnsured += 1;
    ensured.push(item);

    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryItem",
      entityId: item.id,
      action: inactiveSame ? "RELINK_OFFICIAL_MATERIAL" : "LINK_OFFICIAL_MATERIAL",
      afterJson: {
        materialId: item.materialId,
        materialCodeSnapshot: item.materialCodeSnapshot,
        defaultWarehouseId: item.defaultWarehouseId,
        controlsStock: item.controlsStock,
        source: "COLLECTOR_COLD_START",
        deviceId: input.deviceId,
      },
      userId: null,
      userName: input.deviceName ?? null,
    });
  }

  // Itens já ACTIVE sem defaultWarehouse no warehouse da sessão → aponta default
  // (não move saldo; só escopo de população defaultItems).
  const toPointWarehouse = activeLinks.filter((row) => row.defaultWarehouseId == null);
  if (toPointWarehouse.length > 0) {
    await prisma.inventoryItem.updateMany({
      where: { id: { in: toPointWarehouse.map((r) => r.id) } },
      data: { defaultWarehouseId: input.warehouseId, updatedByUserId: null },
    });
  }

  const itemsSkipped = materialsMissingInventoryItem - itemsEnsured;

  await writeInventoryAuditLog(prisma, {
    entityType: "InventoryWarehouse",
    entityId: input.warehouseId,
    action: "COLLECTOR_SECTOR_PREPARED",
    afterJson: {
      sector,
      warehouseId: input.warehouseId,
      warehouseCode: warehouse.code,
      materialsTotal,
      materialsEligible,
      materialsAlreadyLinked,
      materialsMissingInventoryItem,
      itemsEnsured,
      itemsSkipped,
      itemsReactivated,
      deviceId: input.deviceId,
    },
    userId: null,
    userName: input.deviceName ?? null,
  });

  return {
    materialsTotal,
    materialsEligible,
    materialsAlreadyLinked,
    materialsMissingInventoryItem,
    itemsEnsured,
    itemsSkipped,
    itemsReactivated,
    warehouseId: input.warehouseId,
  };
}

/**
 * Diagnóstico read-only do cold-start (sem writes).
 */
export async function diagnoseRawMaterialCollectorColdStart(prisma: PrismaClient) {
  const [
    materialsTotal,
    materialsActive,
    inventoryItemsTotal,
    rawActive,
    rawWithMaterial,
    rawWithoutMaterial,
    withDefaultWh,
    withoutDefaultWh,
    warehousesActive,
    balancesRaw,
  ] = await Promise.all([
    prisma.material.count(),
    prisma.material.count({ where: ACTIVE_MATERIAL_WHERE }),
    prisma.inventoryItem.count(),
    prisma.inventoryItem.count({
      where: { status: "ACTIVE", itemType: "RAW_MATERIAL" },
    }),
    prisma.inventoryItem.count({
      where: {
        status: "ACTIVE",
        itemType: "RAW_MATERIAL",
        materialId: { not: null },
      },
    }),
    prisma.inventoryItem.count({
      where: { status: "ACTIVE", itemType: "RAW_MATERIAL", materialId: null },
    }),
    prisma.inventoryItem.count({
      where: {
        ...RAW_MATERIAL_STOCK_CONTROLLED_ITEM_WHERE,
        defaultWarehouseId: { not: null },
      },
    }),
    prisma.inventoryItem.count({
      where: {
        ...RAW_MATERIAL_STOCK_CONTROLLED_ITEM_WHERE,
        defaultWarehouseId: null,
      },
    }),
    prisma.inventoryWarehouse.count({ where: { status: "ACTIVE" } }),
    prisma.inventoryBalance.count({
      where: { item: RAW_MATERIAL_STOCK_CONTROLLED_ITEM_WHERE },
    }),
  ]);

  const materials = await prisma.material.findMany({
    where: ACTIVE_MATERIAL_WHERE,
    select: { id: true, code: true, description: true, unit: true, status: true },
  });
  const eligible = materials.filter(isOfficialMaterialEligibleForStockLink);
  const linkedIds = new Set(
    (
      await prisma.inventoryItem.findMany({
        where: {
          status: "ACTIVE",
          itemType: "RAW_MATERIAL",
          materialId: { not: null },
        },
        select: { materialId: true },
      })
    )
      .map((r) => r.materialId)
      .filter((id): id is string => Boolean(id))
  );

  const duplicateGroups = await prisma.inventoryItem.groupBy({
    by: ["materialId"],
    where: {
      status: "ACTIVE",
      materialId: { not: null },
    },
    _count: { materialId: true },
    having: { materialId: { _count: { gt: 1 } } },
  });

  return {
    materialsTotal,
    materialsActive,
    materialsEligibleForInventory: eligible.length,
    materialsWithoutInventoryItem: eligible.filter((m) => !linkedIds.has(m.id)).length,
    inventoryItemsTotal,
    inventoryItemRawMaterialActive: rawActive,
    rawMaterialWithMaterialId: rawWithMaterial,
    rawMaterialWithoutMaterialId: rawWithoutMaterial,
    withDefaultWarehouse: withDefaultWh,
    withoutDefaultWarehouse: withoutDefaultWh,
    inventoryWarehouseActive: warehousesActive,
    inventoryBalanceRawMaterial: balancesRaw,
    duplicateActiveMaterialLinks: duplicateGroups.length,
  };
}
