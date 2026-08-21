/**
 * População em lote das linhas de conferência do setor RAW_MATERIAL.
 *
 * Fonte oficial: Materials ACTIVE + InventoryItems ACTIVE (materialId +
 * RAW_MATERIAL). Saldo sistêmico vem de InventoryBalance.physicalQuantity —
 * nunca atualiza Material.quantity nem InventoryBalance diretamente.
 */
import type { PrismaClient } from "@prisma/client";
import { InventoryValidationError } from "./../inventoryTypes.js";
import type { CollectorSectorCode } from "./collectorSectorContract.js";

export type CollectorSectorPopulationDiagnostics = {
  materialsTotal: number;
  materialsLinked: number;
  materialsMissingInventoryItem: number;
  inventoryItemsWithoutBalance: number;
  linesCreated: number;
  skippedExistingLines: boolean;
};

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

function decimalQty(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Cria InventoryCountLine para o warehouse da sessão.
 * Idempotente: se a sessão já tem linhas, não duplica.
 */
export async function populateRawMaterialCountLines(
  tx: Tx,
  input: {
    sessionId: string;
    warehouseId: string;
    sector: CollectorSectorCode;
  }
): Promise<CollectorSectorPopulationDiagnostics> {
  if (input.sector !== "RAW_MATERIAL") {
    throw new InventoryValidationError(
      "Setor de população não suportado.",
      "COLLECTOR_INVALID_SECTOR"
    );
  }

  const existingCount = await tx.inventoryCountLine.count({
    where: { sessionId: input.sessionId },
  });
  if (existingCount > 0) {
    return {
      materialsTotal: 0,
      materialsLinked: 0,
      materialsMissingInventoryItem: 0,
      inventoryItemsWithoutBalance: 0,
      linesCreated: 0,
      skippedExistingLines: true,
    };
  }

  const [materials, balanceRows, defaultItems] = await Promise.all([
    tx.material.findMany({
      where: { status: "ACTIVE" },
      select: { id: true },
    }),
    tx.inventoryBalance.findMany({
      where: {
        warehouseId: input.warehouseId,
        item: {
          status: "ACTIVE",
          itemType: "RAW_MATERIAL",
          materialId: { not: null },
        },
      },
      select: {
        itemId: true,
        locationId: true,
        physicalQuantity: true,
        item: { select: { materialId: true, status: true } },
      },
    }),
    tx.inventoryItem.findMany({
      where: {
        status: "ACTIVE",
        itemType: "RAW_MATERIAL",
        materialId: { not: null },
        defaultWarehouseId: input.warehouseId,
      },
      select: { id: true, materialId: true },
    }),
  ]);

  const materialsTotal = materials.length;
  const materialIds = new Set(materials.map((m) => m.id));

  const linkedMaterialIds = new Set<string>();
  const itemIdsInWarehouse = new Set<string>();

  type LineSeed = {
    itemId: string;
    locationId: string | null;
    systemQuantity: number;
    materialId: string | null;
  };
  const seeds: LineSeed[] = [];
  const seedKeys = new Set<string>();

  const pushSeed = (seed: LineSeed) => {
    const key = `${seed.itemId}|${seed.locationId ?? ""}`;
    if (seedKeys.has(key)) return;
    seedKeys.add(key);
    seeds.push(seed);
    itemIdsInWarehouse.add(seed.itemId);
    if (seed.materialId) linkedMaterialIds.add(seed.materialId);
  };

  for (const balance of balanceRows) {
    pushSeed({
      itemId: balance.itemId,
      locationId: balance.locationId,
      systemQuantity: decimalQty(balance.physicalQuantity),
      materialId: balance.item.materialId,
    });
  }

  const itemsWithBalance = new Set(balanceRows.map((b) => b.itemId));
  let inventoryItemsWithoutBalance = 0;

  for (const item of defaultItems) {
    if (item.materialId) linkedMaterialIds.add(item.materialId);
    if (itemsWithBalance.has(item.id)) continue;
    inventoryItemsWithoutBalance += 1;
    pushSeed({
      itemId: item.id,
      locationId: null,
      systemQuantity: 0,
      materialId: item.materialId,
    });
  }

  // Materiais ACTIVE com InventoryItem global (diagnóstico), mesmo fora do warehouse.
  const allLinkedItems = await tx.inventoryItem.findMany({
    where: {
      status: "ACTIVE",
      itemType: "RAW_MATERIAL",
      materialId: { not: null },
    },
    select: { materialId: true },
  });
  const globallyLinked = new Set<string>();
  for (const row of allLinkedItems) {
    if (row.materialId && materialIds.has(row.materialId)) {
      globallyLinked.add(row.materialId);
    }
  }

  const materialsLinked = globallyLinked.size;
  const materialsMissingInventoryItem = materialsTotal - materialsLinked;

  if (seeds.length > 0) {
    await tx.inventoryCountLine.createMany({
      data: seeds.map((seed) => ({
        sessionId: input.sessionId,
        itemId: seed.itemId,
        warehouseId: input.warehouseId,
        locationId: seed.locationId,
        systemQuantity: seed.systemQuantity,
      })),
    });
  }

  return {
    materialsTotal,
    materialsLinked,
    materialsMissingInventoryItem,
    inventoryItemsWithoutBalance,
    linesCreated: seeds.length,
    skippedExistingLines: false,
  };
}
