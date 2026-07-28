/**
 * Tipos puros do módulo Estoque / Almoxarifado.
 * Sem Prisma — seguro para testes e importação indireta no frontend (apenas tipos).
 */

export const INVENTORY_ITEM_TYPES = [
  "FINISHED_PRODUCT",
  "SEMI_FINISHED",
  "COMPONENT",
  "RAW_MATERIAL",
  "PACKAGING",
  "PRODUCTION_SUPPLY",
  "ADMINISTRATIVE_SUPPLY",
  "MAINTENANCE",
  "PPE",
  "TOOLING",
  "OTHER",
] as const;

export type InventoryItemType = (typeof INVENTORY_ITEM_TYPES)[number];

export const INVENTORY_MOVEMENT_TYPES = [
  "MANUAL_ENTRY",
  "PURCHASE_ENTRY",
  "PURCHASE_RECEIPT",
  "PRODUCTION_ENTRY",
  "MANUAL_EXIT",
  "REQUISITION_EXIT",
  "PRODUCTION_EXIT",
  "TRANSFER",
  "POSITIVE_ADJUSTMENT",
  "NEGATIVE_ADJUSTMENT",
  "BLOCK",
  "UNBLOCK",
  "RESERVE",
  "CANCEL_RESERVATION",
  "LOSS",
  "SCRAP",
  "RETURN",
  "REVERSAL",
  "INITIAL_BALANCE",
  "QUARANTINE_IN",
  "QUARANTINE_OUT",
] as const;

export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

export const INVENTORY_OPERATIONAL_STATUSES = [
  "OK",
  "ATTENTION",
  "CRITICAL",
  "OUT_OF_STOCK",
  "NEGATIVE",
  "BLOCKED",
  "QUARANTINE",
  "INACTIVE",
] as const;

export type InventoryOperationalStatus = (typeof INVENTORY_OPERATIONAL_STATUSES)[number];

/** Tipos de item que exigem centro de custo em saídas/requisições. */
export const INVENTORY_COST_CENTER_REQUIRED_ITEM_TYPES: ReadonlySet<InventoryItemType> = new Set([
  "ADMINISTRATIVE_SUPPLY",
  "MAINTENANCE",
  "PPE",
  "PRODUCTION_SUPPLY",
  "OTHER",
]);

export type InventoryBalanceSnapshot = {
  physicalQuantity: number;
  reservedQuantity: number;
  blockedQuantity: number;
  quarantineQuantity: number;
  availableQuantity: number;
};

export type InventoryItemParameters = {
  status?: "ACTIVE" | "INACTIVE";
  minimumStock?: number | null;
  reorderPoint?: number | null;
};

export type InventoryMovementRequest = {
  movementType: InventoryMovementType;
  quantity: number;
  reason?: string | null;
  costCenterId?: string | null;
  sourceWarehouseId?: string | null;
  destinationWarehouseId?: string | null;
  sourceLocationId?: string | null;
  destinationLocationId?: string | null;
  itemType?: InventoryItemType | null;
};

export type InventoryMovementValidationContext = {
  allowNegativeStock?: boolean;
  allowNegativeAvailable?: boolean;
  requireReason?: boolean;
};

export class InventoryValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = "INVENTORY_VALIDATION") {
    super(message);
    this.name = "InventoryValidationError";
    this.code = code;
  }
}

export function buildInventoryBalanceKey(
  warehouseId: string,
  locationId?: string | null
): string {
  const wh = warehouseId.trim();
  if (!wh) throw new InventoryValidationError("Almoxarifado inválido.");
  const loc = locationId?.trim();
  return loc ? `${wh}:${loc}` : wh;
}

export function roundInventoryQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function safeInventoryNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function emptyInventoryBalance(): InventoryBalanceSnapshot {
  return {
    physicalQuantity: 0,
    reservedQuantity: 0,
    blockedQuantity: 0,
    quarantineQuantity: 0,
    availableQuantity: 0,
  };
}

export function snapshotFromBalance(input: Partial<InventoryBalanceSnapshot>): InventoryBalanceSnapshot {
  const physicalQuantity = roundInventoryQuantity(safeInventoryNumber(input.physicalQuantity) ?? 0);
  const reservedQuantity = roundInventoryQuantity(safeInventoryNumber(input.reservedQuantity) ?? 0);
  const blockedQuantity = roundInventoryQuantity(safeInventoryNumber(input.blockedQuantity) ?? 0);
  const quarantineQuantity = roundInventoryQuantity(safeInventoryNumber(input.quarantineQuantity) ?? 0);
  return normalizeInventoryBalance({
    physicalQuantity,
    reservedQuantity,
    blockedQuantity,
    quarantineQuantity,
    availableQuantity: calculateAvailableBalance({
      physicalQuantity,
      reservedQuantity,
      blockedQuantity,
      quarantineQuantity,
    }),
  });
}

export function calculateAvailableBalance(
  balance: Pick<
    InventoryBalanceSnapshot,
    "physicalQuantity" | "reservedQuantity" | "blockedQuantity" | "quarantineQuantity"
  >
): number {
  const available =
    balance.physicalQuantity -
    balance.reservedQuantity -
    balance.blockedQuantity -
    balance.quarantineQuantity;
  return roundInventoryQuantity(available);
}

export function normalizeInventoryBalance(
  balance: InventoryBalanceSnapshot
): InventoryBalanceSnapshot {
  const availableQuantity = calculateAvailableBalance(balance);
  return {
    physicalQuantity: roundInventoryQuantity(balance.physicalQuantity),
    reservedQuantity: roundInventoryQuantity(balance.reservedQuantity),
    blockedQuantity: roundInventoryQuantity(balance.blockedQuantity),
    quarantineQuantity: roundInventoryQuantity(balance.quarantineQuantity),
    availableQuantity,
  };
}
