/**
 * Tipos básicos do módulo Estoque / Almoxarifado (espelham enums/campos do schema).
 * Sem dependência de runtime Prisma — seguro para frontend e testes.
 */

export type InventoryItemType =
  | "FINISHED_PRODUCT"
  | "SEMI_FINISHED"
  | "COMPONENT"
  | "RAW_MATERIAL"
  | "PACKAGING"
  | "PRODUCTION_SUPPLY"
  | "ADMINISTRATIVE_SUPPLY"
  | "MAINTENANCE"
  | "PPE"
  | "TOOLING"
  | "OTHER";

export type InventoryItemStatus = "ACTIVE" | "INACTIVE";

export type InventoryWarehouseStatus = "ACTIVE" | "INACTIVE";

export type InventoryLocationStatus = "ACTIVE" | "INACTIVE";

export type InventoryMovementType =
  | "MANUAL_ENTRY"
  | "PURCHASE_ENTRY"
  | "PRODUCTION_ENTRY"
  | "MANUAL_EXIT"
  | "REQUISITION_EXIT"
  | "PRODUCTION_EXIT"
  | "TRANSFER"
  | "POSITIVE_ADJUSTMENT"
  | "NEGATIVE_ADJUSTMENT"
  | "BLOCK"
  | "UNBLOCK"
  | "RESERVE"
  | "CANCEL_RESERVATION"
  | "LOSS"
  | "SCRAP"
  | "RETURN"
  | "REVERSAL";

export type InventoryMovementOriginType =
  | "MANUAL"
  | "PURCHASE"
  | "SALES_ORDER"
  | "PRODUCTION_ORDER"
  | "COUNT_SESSION"
  | "REVERSAL"
  | "INTEGRATION"
  | "OTHER";

export type InventoryReservationType =
  | "SALES_ORDER"
  | "PRODUCTION_ORDER"
  | "INTERNAL_REQUISITION"
  | "MAINTENANCE"
  | "QUALITY"
  | "MANUAL";

export type InventoryReservationStatus = "ACTIVE" | "CANCELED" | "CONSUMED";

export type InventoryCountSessionStatus =
  | "OPEN"
  | "COUNTING"
  | "WAITING_APPROVAL"
  | "APPROVED"
  | "ADJUSTED"
  | "CANCELED";

export type InventoryItemRow = {
  id: string;
  code: string;
  description: string;
  itemType: InventoryItemType;
  unit: string;
  family: string | null;
  group: string | null;
  status: InventoryItemStatus;
  controlsLot: boolean;
  controlsExpiration: boolean;
  controlsLocation: boolean;
  controlsQuality: boolean;
  minimumStock: number | null;
  maximumStock: number | null;
  reorderPoint: number | null;
  preferredSupplierName: string | null;
  averageCost: number | null;
  lastKnownCost: number | null;
  productId: string | null;
  nomusProductCode: string | null;
  nomusProductId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
};

export type InventoryWarehouseRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: InventoryWarehouseStatus;
  allowsMovements: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InventoryBalanceRow = {
  id: string;
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  balanceKey: string;
  physicalQuantity: number;
  reservedQuantity: number;
  blockedQuantity: number;
  quarantineQuantity: number;
  availableQuantity: number;
  averageCost: number | null;
  totalValue: number | null;
  lastMovementAt: string | null;
  updatedAt: string;
};

/** Almoxarifados padrão sugeridos — seed futuro, não criados automaticamente. */
export const INVENTORY_DEFAULT_WAREHOUSE_CODES = [
  "MP",
  "COMPONENTES",
  "PA",
  "EMBALAGEM",
  "PRODUCAO",
  "QUALIDADE",
  "MANUTENCAO",
  "ADMINISTRATIVO",
  "EXPEDICAO",
  "SUCATA",
] as const;

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

export type InventoryDashboardRecentMovement = {
  id: string;
  itemId: string;
  itemCode: string | null;
  itemDescription: string | null;
  movementType: InventoryMovementType;
  quantity: number;
  unit: string;
  movementDate: string;
  warehouseCode: string | null;
  warehouseName: string | null;
  responsibleUserId: string | null;
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
  recentMovements: InventoryDashboardRecentMovement[];
  criticalRawMaterials: InventoryDashboardCriticalItem[];
  criticalSupplies: InventoryDashboardCriticalItem[];
  finishedProductsAvailable: InventoryDashboardCriticalItem[];
};
