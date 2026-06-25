/**
 * Dashboard do módulo Estoque — server-only.
 */
import { prisma } from "@/src/lib/prisma.js";
import { calculateInventoryStatus } from "./inventoryStatus.js";
import {
  inventoryDec,
  inventoryDecOrNull,
  serializeInventoryMovement,
} from "./inventorySerialization.server.js";
import type { InventoryItemType } from "./inventoryTypes.js";

export type InventoryDashboardCriticalItem = {
  itemId: string;
  code: string;
  description: string;
  itemType: InventoryItemType;
  availableQuantity: number;
  minimumStock: number | null;
  reorderPoint: number | null;
  operationalStatus: string;
};

export type InventoryDashboardPayload = {
  totalInventoryValue: number;
  itemsCount: number;
  belowMinimumCount: number;
  belowReorderPointCount: number;
  negativeStockCount: number;
  blockedItemsCount: number;
  reservedItemsCount: number;
  quarantineItemsCount: number;
  recentMovements: ReturnType<typeof serializeInventoryMovement>[];
  criticalRawMaterials: InventoryDashboardCriticalItem[];
  criticalSupplies: InventoryDashboardCriticalItem[];
  finishedProductsAvailable: InventoryDashboardCriticalItem[];
};

const SUPPLY_ITEM_TYPES: InventoryItemType[] = [
  "ADMINISTRATIVE_SUPPLY",
  "MAINTENANCE",
  "PPE",
  "PRODUCTION_SUPPLY",
];

function aggregateAvailableByItem(
  balances: Array<{ itemId: string; availableQuantity: unknown }>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const b of balances) {
    const prev = map.get(b.itemId) ?? 0;
    map.set(b.itemId, prev + inventoryDec(b.availableQuantity));
  }
  return map;
}

function buildCriticalItem(
  item: {
    id: string;
    code: string;
    description: string;
    itemType: InventoryItemType;
    status: string;
    minimumStock: unknown;
    reorderPoint: unknown;
  },
  available: number
): InventoryDashboardCriticalItem {
  const minimumStock = inventoryDecOrNull(item.minimumStock);
  const reorderPoint = inventoryDecOrNull(item.reorderPoint);
  const operationalStatus = calculateInventoryStatus(
    {
      physicalQuantity: available,
      reservedQuantity: 0,
      blockedQuantity: 0,
      quarantineQuantity: 0,
      availableQuantity: available,
    },
    { status: item.status as "ACTIVE" | "INACTIVE", minimumStock, reorderPoint }
  );
  return {
    itemId: item.id,
    code: item.code,
    description: item.description,
    itemType: item.itemType,
    availableQuantity: available,
    minimumStock,
    reorderPoint,
    operationalStatus,
  };
}

export async function buildInventoryDashboard(): Promise<InventoryDashboardPayload> {
  const [items, balances, recentMovements, valueAgg] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        code: true,
        description: true,
        itemType: true,
        status: true,
        minimumStock: true,
        reorderPoint: true,
      },
    }),
    prisma.inventoryBalance.findMany({
      select: {
        itemId: true,
        availableQuantity: true,
        physicalQuantity: true,
        reservedQuantity: true,
        blockedQuantity: true,
        quarantineQuantity: true,
        totalValue: true,
      },
    }),
    prisma.inventoryMovement.findMany({
      orderBy: { movementDate: "desc" },
      take: 10,
    }),
    prisma.inventoryBalance.aggregate({
      _sum: { totalValue: true },
    }),
  ]);

  const availableByItem = aggregateAvailableByItem(balances);

  let belowMinimumCount = 0;
  let belowReorderPointCount = 0;

  for (const item of items) {
    const available = availableByItem.get(item.id) ?? 0;
    const minimum = inventoryDecOrNull(item.minimumStock);
    const reorder = inventoryDecOrNull(item.reorderPoint);
    if (minimum != null && available < minimum) belowMinimumCount += 1;
    else if (reorder != null && available < reorder) belowReorderPointCount += 1;
  }

  const negativeStockCount = balances.filter(
    (b) => inventoryDec(b.physicalQuantity) < 0 || inventoryDec(b.availableQuantity) < 0
  ).length;

  const blockedItemsCount = balances.filter((b) => inventoryDec(b.blockedQuantity) > 0).length;
  const reservedItemsCount = balances.filter((b) => inventoryDec(b.reservedQuantity) > 0).length;
  const quarantineItemsCount = balances.filter((b) => inventoryDec(b.quarantineQuantity) > 0).length;

  const criticalRawMaterials: InventoryDashboardCriticalItem[] = [];
  const criticalSupplies: InventoryDashboardCriticalItem[] = [];
  const finishedProductsAvailable: InventoryDashboardCriticalItem[] = [];

  for (const item of items) {
    const available = availableByItem.get(item.id) ?? 0;
    const critical = buildCriticalItem(item, available);
    const isCritical =
      critical.operationalStatus === "CRITICAL" ||
      critical.operationalStatus === "OUT_OF_STOCK" ||
      critical.operationalStatus === "NEGATIVE";

    if (item.itemType === "RAW_MATERIAL" && isCritical) {
      criticalRawMaterials.push(critical);
    }
    if (SUPPLY_ITEM_TYPES.includes(item.itemType) && isCritical) {
      criticalSupplies.push(critical);
    }
    if (item.itemType === "FINISHED_PRODUCT" && available > 0) {
      finishedProductsAvailable.push(critical);
    }
  }

  criticalRawMaterials.sort((a, b) => a.availableQuantity - b.availableQuantity);
  criticalSupplies.sort((a, b) => a.availableQuantity - b.availableQuantity);
  finishedProductsAvailable.sort((a, b) => b.availableQuantity - a.availableQuantity);

  const totalInventoryValue = inventoryDec(valueAgg._sum.totalValue);

  return {
    totalInventoryValue,
    itemsCount: items.length,
    belowMinimumCount,
    belowReorderPointCount,
    negativeStockCount,
    blockedItemsCount,
    reservedItemsCount,
    quarantineItemsCount,
    recentMovements: recentMovements.map(serializeInventoryMovement),
    criticalRawMaterials: criticalRawMaterials.slice(0, 20),
    criticalSupplies: criticalSupplies.slice(0, 20),
    finishedProductsAvailable: finishedProductsAvailable.slice(0, 20),
  };
}

/** Estrutura vazia segura quando o dashboard não puder ser calculado. */
export function emptyInventoryDashboard(): InventoryDashboardPayload {
  return {
    totalInventoryValue: 0,
    itemsCount: 0,
    belowMinimumCount: 0,
    belowReorderPointCount: 0,
    negativeStockCount: 0,
    blockedItemsCount: 0,
    reservedItemsCount: 0,
    quarantineItemsCount: 0,
    recentMovements: [],
    criticalRawMaterials: [],
    criticalSupplies: [],
    finishedProductsAvailable: [],
  };
}

export const INVENTORY_DASHBOARD_KEYS = [
  "totalInventoryValue",
  "itemsCount",
  "belowMinimumCount",
  "belowReorderPointCount",
  "negativeStockCount",
  "blockedItemsCount",
  "reservedItemsCount",
  "quarantineItemsCount",
  "recentMovements",
  "criticalRawMaterials",
  "criticalSupplies",
  "finishedProductsAvailable",
] as const;
