/**
 * Serialização de entidades de estoque para resposta JSON — server-only.
 */
import type {
  InventoryBalance,
  InventoryCountLine,
  InventoryCountSession,
  InventoryItem,
  InventoryMovement,
  InventoryWarehouse,
} from "@prisma/client";
import { hasCountDivergence } from "./inventoryCountMath.js";

export function inventoryDec(value: unknown): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function inventoryDecOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function serializeInventoryItem(row: InventoryItem) {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    itemType: row.itemType,
    unit: row.unit,
    family: row.family,
    group: row.group,
    status: row.status,
    controlsLot: row.controlsLot,
    controlsExpiration: row.controlsExpiration,
    controlsLocation: row.controlsLocation,
    controlsQuality: row.controlsQuality,
    minimumStock: inventoryDecOrNull(row.minimumStock),
    maximumStock: inventoryDecOrNull(row.maximumStock),
    reorderPoint: inventoryDecOrNull(row.reorderPoint),
    preferredSupplierName: row.preferredSupplierName,
    averageCost: inventoryDecOrNull(row.averageCost),
    lastKnownCost: inventoryDecOrNull(row.lastKnownCost),
    productId: row.productId,
    nomusProductCode: row.nomusProductCode,
    nomusProductId: row.nomusProductId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
  };
}

export function serializeInventoryWarehouse(row: InventoryWarehouse) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    allowsMovements: row.allowsMovements,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeInventoryBalance(row: InventoryBalance) {
  return {
    id: row.id,
    itemId: row.itemId,
    warehouseId: row.warehouseId,
    locationId: row.locationId,
    balanceKey: row.balanceKey,
    physicalQuantity: inventoryDec(row.physicalQuantity),
    reservedQuantity: inventoryDec(row.reservedQuantity),
    blockedQuantity: inventoryDec(row.blockedQuantity),
    quarantineQuantity: inventoryDec(row.quarantineQuantity),
    availableQuantity: inventoryDec(row.availableQuantity),
    averageCost: inventoryDecOrNull(row.averageCost),
    totalValue: inventoryDecOrNull(row.totalValue),
    lastMovementAt: row.lastMovementAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeInventoryMovement(row: InventoryMovement) {
  return {
    id: row.id,
    itemId: row.itemId,
    sourceWarehouseId: row.sourceWarehouseId,
    destinationWarehouseId: row.destinationWarehouseId,
    sourceLocationId: row.sourceLocationId,
    destinationLocationId: row.destinationLocationId,
    movementType: row.movementType,
    quantity: inventoryDec(row.quantity),
    unit: row.unit,
    reason: row.reason,
    notes: row.notes,
    responsibleUserId: row.responsibleUserId,
    movementDate: row.movementDate.toISOString(),
    originType: row.originType,
    originId: row.originId,
    documentNumber: row.documentNumber,
    costCenterId: row.costCenterId,
    financialCostCenterId: row.financialCostCenterId,
    reservationId: row.reservationId,
    reversedMovementId: row.reversedMovementId,
    previousPhysicalBalance: inventoryDec(row.previousPhysicalBalance),
    nextPhysicalBalance: inventoryDec(row.nextPhysicalBalance),
    previousAvailableBalance: inventoryDec(row.previousAvailableBalance),
    nextAvailableBalance: inventoryDec(row.nextAvailableBalance),
    createdAt: row.createdAt.toISOString(),
  };
}

type MovementWithRelations = InventoryMovement & {
  item?: { code: string; description: string } | null;
  sourceWarehouse?: { code: string; name: string } | null;
  destinationWarehouse?: { code: string; name: string } | null;
};

export function serializeInventoryMovementEnriched(row: MovementWithRelations) {
  const warehouse = row.destinationWarehouse ?? row.sourceWarehouse;
  return {
    ...serializeInventoryMovement(row),
    itemCode: row.item?.code ?? null,
    itemDescription: row.item?.description ?? null,
    sourceWarehouseCode: row.sourceWarehouse?.code ?? null,
    sourceWarehouseName: row.sourceWarehouse?.name ?? null,
    destinationWarehouseCode: row.destinationWarehouse?.code ?? null,
    destinationWarehouseName: row.destinationWarehouse?.name ?? null,
    warehouseCode: warehouse?.code ?? null,
    warehouseName: warehouse?.name ?? null,
  };
}

type DashboardMovementRow = InventoryMovement & {
  item?: { code: string; description: string } | null;
  sourceWarehouse?: { code: string; name: string } | null;
  destinationWarehouse?: { code: string; name: string } | null;
};

/** Movimento enriquecido para o dashboard (item + almoxarifado legíveis). */
export function serializeInventoryDashboardMovement(row: DashboardMovementRow) {
  const warehouse = row.destinationWarehouse ?? row.sourceWarehouse;
  return {
    id: row.id,
    itemId: row.itemId,
    itemCode: row.item?.code ?? null,
    itemDescription: row.item?.description ?? null,
    movementType: row.movementType,
    quantity: inventoryDec(row.quantity),
    unit: row.unit,
    movementDate: row.movementDate.toISOString(),
    warehouseCode: warehouse?.code ?? null,
    warehouseName: warehouse?.name ?? null,
    responsibleUserId: row.responsibleUserId,
  };
}

export type InventoryBalanceWithItem = InventoryBalance & {
  item: Pick<
    InventoryItem,
    | "code"
    | "description"
    | "itemType"
    | "status"
    | "minimumStock"
    | "reorderPoint"
    | "unit"
    | "family"
    | "group"
  >;
  warehouse: Pick<InventoryWarehouse, "code" | "name" | "status">;
};

export function serializeInventoryBalanceWithRelations(row: InventoryBalanceWithItem) {
  return {
    ...serializeInventoryBalance(row),
    item: {
      code: row.item.code,
      description: row.item.description,
      itemType: row.item.itemType,
      status: row.item.status,
      minimumStock: inventoryDecOrNull(row.item.minimumStock),
      reorderPoint: inventoryDecOrNull(row.item.reorderPoint),
      unit: row.item.unit,
      family: row.item.family,
      group: row.item.group,
    },
    warehouse: {
      code: row.warehouse.code,
      name: row.warehouse.name,
      status: row.warehouse.status,
    },
  };
}

export function serializeInventoryCountSession(row: InventoryCountSession) {
  return {
    id: row.id,
    code: row.code,
    warehouseId: row.warehouseId,
    status: row.status,
    responsibleUserId: row.responsibleUserId,
    approvedByUserId: row.approvedByUserId,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type CountLineWithItem = InventoryCountLine & {
  item?: { code: string; description: string; unit: string } | null;
};

export function serializeInventoryCountLine(row: CountLineWithItem) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    itemId: row.itemId,
    itemCode: row.item?.code ?? null,
    itemDescription: row.item?.description ?? null,
    itemUnit: row.item?.unit ?? null,
    warehouseId: row.warehouseId,
    locationId: row.locationId,
    systemQuantity: inventoryDec(row.systemQuantity),
    countedQuantity: inventoryDecOrNull(row.countedQuantity),
    differenceQuantity: inventoryDecOrNull(row.differenceQuantity),
    differencePercent: inventoryDecOrNull(row.differencePercent),
    justification: row.justification,
    generatedMovementId: row.generatedMovementId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type CountSessionWithWarehouse = InventoryCountSession & {
  warehouse?: { code: string; name: string } | null;
  lines?: InventoryCountLine[];
};

export function serializeInventoryCountSessionListRow(
  row: CountSessionWithWarehouse,
  lines?: InventoryCountLine[]
) {
  const sessionLines = lines ?? row.lines ?? [];
  let divergenceCount = 0;
  let impactedQuantity = 0;
  for (const line of sessionLines) {
    const diff = inventoryDecOrNull(line.differenceQuantity);
    if (diff != null && hasCountDivergence(diff)) {
      divergenceCount += 1;
      impactedQuantity += Math.abs(diff);
    }
  }
  return {
    ...serializeInventoryCountSession(row),
    warehouseCode: row.warehouse?.code ?? null,
    warehouseName: row.warehouse?.name ?? null,
    divergenceCount,
    impactedQuantity,
  };
}
