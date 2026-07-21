/**
 * Validação de payloads das APIs de Estoque — sem Prisma.
 */
import { safeTrim } from "@/src/lib/safeTrim.js";
import {
  INVENTORY_ITEM_TYPES,
  INVENTORY_MOVEMENT_TYPES,
  InventoryValidationError,
  safeInventoryNumber,
  type InventoryItemType,
  type InventoryMovementType,
} from "./inventoryTypes.js";

const ITEM_STATUSES = new Set(["ACTIVE", "INACTIVE"]);
const WAREHOUSE_STATUSES = new Set(["ACTIVE", "INACTIVE"]);

const REASON_REQUIRED_MOVEMENT_TYPES = new Set<InventoryMovementType>([
  "MANUAL_ENTRY",
  "MANUAL_EXIT",
  "REQUISITION_EXIT",
  "POSITIVE_ADJUSTMENT",
  "NEGATIVE_ADJUSTMENT",
  "BLOCK",
  "UNBLOCK",
  "RESERVE",
  "CANCEL_RESERVATION",
  "LOSS",
  "SCRAP",
  "RETURN",
  "TRANSFER",
]);

function requireNonEmpty(value: unknown, field: string): string {
  const t = safeTrim(value);
  if (!t) throw new InventoryValidationError(`${field} é obrigatório.`, "FIELD_REQUIRED");
  return t;
}

function parseNonNegative(value: unknown, field: string): number | null {
  if (value == null || value === "") return null;
  const n = safeInventoryNumber(value);
  if (n == null) throw new InventoryValidationError(`${field} inválido.`, "INVALID_NUMBER");
  if (n < 0) throw new InventoryValidationError(`${field} deve ser >= 0.`, "INVALID_NUMBER");
  return n;
}

function parseItemType(value: unknown): InventoryItemType {
  const raw = requireNonEmpty(value, "itemType");
  if (!(INVENTORY_ITEM_TYPES as readonly string[]).includes(raw)) {
    throw new InventoryValidationError("Tipo de item inválido.", "INVALID_ITEM_TYPE");
  }
  return raw as InventoryItemType;
}

function parseMovementType(value: unknown): InventoryMovementType {
  const raw = requireNonEmpty(value, "movementType");
  if (!(INVENTORY_MOVEMENT_TYPES as readonly string[]).includes(raw)) {
    throw new InventoryValidationError("Tipo de movimentação inválido.", "INVALID_MOVEMENT_TYPE");
  }
  return raw as InventoryMovementType;
}

function parseQuantity(value: unknown): number {
  const n = safeInventoryNumber(value);
  if (n == null || n <= 0) {
    throw new InventoryValidationError("Quantidade deve ser maior que zero.", "INVALID_QUANTITY");
  }
  return n;
}

export type CreateInventoryItemInput = {
  code: string;
  description: string;
  itemType: InventoryItemType;
  unit: string;
  status: "ACTIVE" | "INACTIVE";
  family: string | null;
  group: string | null;
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
};

export function parseCreateInventoryItemBody(body: unknown): CreateInventoryItemInput {
  const data = (body ?? {}) as Record<string, unknown>;
  const statusRaw = safeTrim(data.status);
  const status = statusRaw && ITEM_STATUSES.has(statusRaw)
    ? (statusRaw as "ACTIVE" | "INACTIVE")
    : "ACTIVE";

  return {
    code: requireNonEmpty(data.code, "code"),
    description: requireNonEmpty(data.description, "description"),
    itemType: parseItemType(data.itemType),
    unit: requireNonEmpty(data.unit, "unit"),
    status,
    family: safeTrim(data.family) || null,
    group: safeTrim(data.group) || null,
    controlsLot: data.controlsLot === true || data.controlsLot === "true" || data.controlsLot === 1,
    controlsExpiration:
      data.controlsExpiration === true ||
      data.controlsExpiration === "true" ||
      data.controlsExpiration === 1,
    controlsLocation:
      data.controlsLocation === true || data.controlsLocation === "true" || data.controlsLocation === 1,
    controlsQuality:
      data.controlsQuality === true || data.controlsQuality === "true" || data.controlsQuality === 1,
    minimumStock: parseNonNegative(data.minimumStock, "minimumStock"),
    maximumStock: parseNonNegative(data.maximumStock, "maximumStock"),
    reorderPoint: parseNonNegative(data.reorderPoint, "reorderPoint"),
    preferredSupplierName: safeTrim(data.preferredSupplierName) || null,
    averageCost: parseNonNegative(data.averageCost, "averageCost"),
    lastKnownCost: parseNonNegative(data.lastKnownCost, "lastKnownCost"),
    productId: safeTrim(data.productId) || null,
    nomusProductCode: safeTrim(data.nomusProductCode) || null,
    nomusProductId: safeTrim(data.nomusProductId) || null,
    notes: safeTrim(data.notes) || null,
  };
}

export function parseUpdateInventoryItemBody(body: unknown): Partial<CreateInventoryItemInput> {
  const data = (body ?? {}) as Record<string, unknown>;
  const out: Partial<CreateInventoryItemInput> = {};

  if (data.code !== undefined) out.code = requireNonEmpty(data.code, "code");
  if (data.description !== undefined) out.description = requireNonEmpty(data.description, "description");
  if (data.itemType !== undefined) out.itemType = parseItemType(data.itemType);
  if (data.unit !== undefined) out.unit = requireNonEmpty(data.unit, "unit");
  if (data.status !== undefined) {
    const s = requireNonEmpty(data.status, "status");
    if (!ITEM_STATUSES.has(s)) throw new InventoryValidationError("Status inválido.", "INVALID_STATUS");
    out.status = s as "ACTIVE" | "INACTIVE";
  }
  if (data.family !== undefined) out.family = safeTrim(data.family) || null;
  if (data.group !== undefined) out.group = safeTrim(data.group) || null;
  if (data.minimumStock !== undefined) out.minimumStock = parseNonNegative(data.minimumStock, "minimumStock");
  if (data.maximumStock !== undefined) out.maximumStock = parseNonNegative(data.maximumStock, "maximumStock");
  if (data.reorderPoint !== undefined) out.reorderPoint = parseNonNegative(data.reorderPoint, "reorderPoint");
  if (data.averageCost !== undefined) out.averageCost = parseNonNegative(data.averageCost, "averageCost");
  if (data.lastKnownCost !== undefined) out.lastKnownCost = parseNonNegative(data.lastKnownCost, "lastKnownCost");
  if (data.preferredSupplierName !== undefined) {
    out.preferredSupplierName = safeTrim(data.preferredSupplierName) || null;
  }
  if (data.notes !== undefined) out.notes = safeTrim(data.notes) || null;
  if (data.productId !== undefined) out.productId = safeTrim(data.productId) || null;
  if (data.nomusProductCode !== undefined) out.nomusProductCode = safeTrim(data.nomusProductCode) || null;
  if (data.nomusProductId !== undefined) out.nomusProductId = safeTrim(data.nomusProductId) || null;

  return out;
}

export type CreateInventoryWarehouseInput = {
  code: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "INACTIVE";
  allowsMovements: boolean;
};

export function parseCreateInventoryWarehouseBody(body: unknown): CreateInventoryWarehouseInput {
  const data = (body ?? {}) as Record<string, unknown>;
  const statusRaw = safeTrim(data.status);
  const status = statusRaw && WAREHOUSE_STATUSES.has(statusRaw)
    ? (statusRaw as "ACTIVE" | "INACTIVE")
    : "ACTIVE";

  return {
    code: requireNonEmpty(data.code, "code"),
    name: requireNonEmpty(data.name, "name"),
    description: safeTrim(data.description) || null,
    status,
    allowsMovements: data.allowsMovements === false || data.allowsMovements === "false" ? false : true,
  };
}

export function parseUpdateInventoryWarehouseBody(
  body: unknown
): Partial<CreateInventoryWarehouseInput> {
  const data = (body ?? {}) as Record<string, unknown>;
  const out: Partial<CreateInventoryWarehouseInput> = {};

  if (data.code !== undefined) out.code = requireNonEmpty(data.code, "code");
  if (data.name !== undefined) out.name = requireNonEmpty(data.name, "name");
  if (data.description !== undefined) out.description = safeTrim(data.description) || null;
  if (data.status !== undefined) {
    const s = requireNonEmpty(data.status, "status");
    if (!WAREHOUSE_STATUSES.has(s)) throw new InventoryValidationError("Status inválido.", "INVALID_STATUS");
    out.status = s as "ACTIVE" | "INACTIVE";
  }
  if (data.allowsMovements !== undefined) {
    out.allowsMovements = !(data.allowsMovements === false || data.allowsMovements === "false");
  }

  return out;
}

export function parseStatusPatchBody(body: unknown): "ACTIVE" | "INACTIVE" {
  const data = (body ?? {}) as Record<string, unknown>;
  const s = requireNonEmpty(data.status, "status");
  if (!ITEM_STATUSES.has(s)) throw new InventoryValidationError("Status inválido.", "INVALID_STATUS");
  return s as "ACTIVE" | "INACTIVE";
}

export type CreateInventoryMovementBody = {
  itemId: string;
  movementType: InventoryMovementType;
  quantity: number;
  unit?: string;
  reason: string;
  notes: string | null;
  sourceWarehouseId: string | null;
  destinationWarehouseId: string | null;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  costCenterId: string | null;
  financialCostCenterId: string | null;
  documentNumber: string | null;
  movementDate: Date | null;
};

export function parseCreateInventoryMovementBody(body: unknown): CreateInventoryMovementBody {
  const data = (body ?? {}) as Record<string, unknown>;
  const movementType = parseMovementType(data.movementType);
  const quantity = parseQuantity(data.quantity);
  const reason = safeTrim(data.reason);

  if (REASON_REQUIRED_MOVEMENT_TYPES.has(movementType) && !reason) {
    throw new InventoryValidationError(
      "Motivo é obrigatório para esta movimentação.",
      "REASON_REQUIRED"
    );
  }

  let movementDate: Date | null = null;
  if (data.movementDate != null && safeTrim(data.movementDate)) {
    const d = new Date(String(data.movementDate));
    if (Number.isNaN(d.getTime())) {
      throw new InventoryValidationError("Data de movimentação inválida.", "INVALID_DATE");
    }
    movementDate = d;
  }

  return {
    itemId: requireNonEmpty(data.itemId, "itemId"),
    movementType,
    quantity,
    unit: safeTrim(data.unit) || undefined,
    reason,
    notes: safeTrim(data.notes) || null,
    sourceWarehouseId: safeTrim(data.sourceWarehouseId) || null,
    destinationWarehouseId: safeTrim(data.destinationWarehouseId) || null,
    sourceLocationId: safeTrim(data.sourceLocationId) || null,
    destinationLocationId: safeTrim(data.destinationLocationId) || null,
    costCenterId: safeTrim(data.costCenterId) || null,
    financialCostCenterId: safeTrim(data.financialCostCenterId) || null,
    documentNumber: safeTrim(data.documentNumber) || null,
    movementDate,
  };
}

export type CreateInventoryReservationBody = {
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  quantity: number;
  reason: string;
  notes: string | null;
  reservationType: string;
};

export function parseCreateInventoryReservationBody(body: unknown): CreateInventoryReservationBody {
  const data = (body ?? {}) as Record<string, unknown>;
  const reason = requireNonEmpty(data.reason, "reason");
  return {
    itemId: requireNonEmpty(data.itemId, "itemId"),
    warehouseId: requireNonEmpty(data.warehouseId, "warehouseId"),
    locationId: safeTrim(data.locationId) || null,
    quantity: parseQuantity(data.quantity),
    reason,
    notes: safeTrim(data.notes) || null,
    reservationType: safeTrim(data.reservationType) || "MANUAL",
  };
}

export function parseCancelReservationBody(body: unknown): string {
  const data = (body ?? {}) as Record<string, unknown>;
  return requireNonEmpty(data.reason ?? data.motivo, "reason");
}

export type CreateInventoryLocationInput = {
  code: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  locationType: "PHYSICAL" | "QUARANTINE" | "PRODUCTION";
  isDefault: boolean;
  parentLocationId: string | null;
  aisle: string | null;
  shelf: string | null;
  position: string | null;
  notes: string | null;
};

const LOCATION_STATUSES = new Set(["ACTIVE", "INACTIVE"]);
const LOCATION_TYPES = new Set(["PHYSICAL", "QUARANTINE", "PRODUCTION"]);

export function parseCreateInventoryLocationBody(body: unknown): CreateInventoryLocationInput {
  const data = (body ?? {}) as Record<string, unknown>;
  const statusRaw = safeTrim(data.status);
  const status =
    statusRaw && LOCATION_STATUSES.has(statusRaw)
      ? (statusRaw as "ACTIVE" | "INACTIVE")
      : "ACTIVE";
  const typeRaw = safeTrim(data.locationType) || "PHYSICAL";
  if (!LOCATION_TYPES.has(typeRaw)) {
    throw new InventoryValidationError("Tipo de local inválido.", "LOCATION_TYPE_INVALID");
  }

  return {
    code: requireNonEmpty(data.code, "code"),
    name: requireNonEmpty(data.name, "name"),
    status,
    locationType: typeRaw as CreateInventoryLocationInput["locationType"],
    isDefault: data.isDefault === true || data.isDefault === "true",
    parentLocationId: safeTrim(data.parentLocationId) || null,
    aisle: safeTrim(data.aisle) || null,
    shelf: safeTrim(data.shelf) || null,
    position: safeTrim(data.position) || null,
    notes: safeTrim(data.notes) || null,
  };
}

export function parseUpdateInventoryLocationBody(
  body: unknown
): Partial<CreateInventoryLocationInput> {
  const data = (body ?? {}) as Record<string, unknown>;
  const out: Partial<CreateInventoryLocationInput> = {};

  if (data.code !== undefined) out.code = requireNonEmpty(data.code, "code");
  if (data.name !== undefined) out.name = requireNonEmpty(data.name, "name");
  if (data.status !== undefined) {
    const s = requireNonEmpty(data.status, "status");
    if (!LOCATION_STATUSES.has(s)) {
      throw new InventoryValidationError("Status inválido.", "INVALID_STATUS");
    }
    out.status = s as "ACTIVE" | "INACTIVE";
  }
  if (data.locationType !== undefined) {
    const t = requireNonEmpty(data.locationType, "locationType");
    if (!LOCATION_TYPES.has(t)) {
      throw new InventoryValidationError("Tipo de local inválido.", "LOCATION_TYPE_INVALID");
    }
    out.locationType = t as CreateInventoryLocationInput["locationType"];
  }
  if (data.isDefault !== undefined) {
    out.isDefault = data.isDefault === true || data.isDefault === "true";
  }
  if (data.parentLocationId !== undefined) {
    out.parentLocationId = safeTrim(data.parentLocationId) || null;
  }
  if (data.aisle !== undefined) out.aisle = safeTrim(data.aisle) || null;
  if (data.shelf !== undefined) out.shelf = safeTrim(data.shelf) || null;
  if (data.position !== undefined) out.position = safeTrim(data.position) || null;
  if (data.notes !== undefined) out.notes = safeTrim(data.notes) || null;

  return out;
}
