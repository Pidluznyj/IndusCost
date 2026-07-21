/**
 * Formulário e validação de local interno — frontend puro (OP-07).
 */
import type {
  InventoryLocationRow,
  InventoryLocationStatus,
  InventoryLocationType,
} from "@/src/types/inventory";
import {
  assertValidLocationCode,
  assertValidLocationName,
  formatLocationAddress,
  INVENTORY_LOCATION_TYPES,
} from "@/src/lib/inventory/inventoryLocationRules";
import { InventoryValidationError } from "@/src/lib/inventory/inventoryTypes";

export type InventoryLocationFormState = {
  code: string;
  name: string;
  status: InventoryLocationStatus;
  locationType: InventoryLocationType;
  isDefault: boolean;
  parentLocationId: string;
  aisle: string;
  shelf: string;
  position: string;
  notes: string;
};

export type InventoryLocationFormErrors = Partial<Record<keyof InventoryLocationFormState, string>>;

export function createEmptyInventoryLocationForm(
  defaults?: Partial<InventoryLocationFormState>
): InventoryLocationFormState {
  return {
    code: "",
    name: "",
    status: "ACTIVE",
    locationType: "PHYSICAL",
    isDefault: false,
    parentLocationId: "",
    aisle: "",
    shelf: "",
    position: "",
    notes: "",
    ...defaults,
  };
}

export function inventoryLocationFormFromRow(row: InventoryLocationRow): InventoryLocationFormState {
  return {
    code: row.code,
    name: row.name,
    status: row.status,
    locationType: row.locationType,
    isDefault: row.isDefault,
    parentLocationId: row.parentLocationId ?? "",
    aisle: row.aisle ?? "",
    shelf: row.shelf ?? "",
    position: row.position ?? "",
    notes: row.notes ?? "",
  };
}

export function validateInventoryLocationForm(
  form: InventoryLocationFormState
): InventoryLocationFormErrors {
  const errors: InventoryLocationFormErrors = {};
  try {
    assertValidLocationCode(form.code);
  } catch (e) {
    errors.code =
      e instanceof InventoryValidationError ? e.message : "Código inválido.";
  }
  try {
    assertValidLocationName(form.name);
  } catch (e) {
    errors.name =
      e instanceof InventoryValidationError ? e.message : "Nome inválido.";
  }
  if (!INVENTORY_LOCATION_TYPES.includes(form.locationType)) {
    errors.locationType = "Tipo de local inválido.";
  }
  return errors;
}

export function isInventoryLocationFormValid(form: InventoryLocationFormState): boolean {
  return Object.keys(validateInventoryLocationForm(form)).length === 0;
}

export function inventoryLocationFormToPayload(form: InventoryLocationFormState) {
  return {
    code: form.code.trim(),
    name: form.name.trim(),
    status: form.status,
    locationType: form.locationType,
    isDefault: form.isDefault,
    parentLocationId: form.parentLocationId.trim() || null,
    aisle: form.aisle.trim() || null,
    shelf: form.shelf.trim() || null,
    position: form.position.trim() || null,
    notes: form.notes.trim() || null,
  };
}

export function formatInventoryLocationType(type: InventoryLocationType): string {
  switch (type) {
    case "PHYSICAL":
      return "Físico";
    case "QUARANTINE":
      return "Quarentena";
    case "PRODUCTION":
      return "Produção";
    default:
      return type;
  }
}

export function formatInventoryLocationAddress(row: Pick<
  InventoryLocationRow,
  "aisle" | "shelf" | "position" | "addressLabel"
>): string {
  return row.addressLabel ?? formatLocationAddress(row) ?? "—";
}

export function normalizeInventoryLocationRow(raw: unknown): InventoryLocationRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.warehouseId !== "string") return null;
  const locationType = String(r.locationType ?? "PHYSICAL") as InventoryLocationType;
  return {
    id: r.id,
    warehouseId: r.warehouseId,
    code: String(r.code ?? ""),
    name: String(r.name ?? ""),
    status: (r.status === "INACTIVE" ? "INACTIVE" : "ACTIVE") as InventoryLocationStatus,
    locationType: INVENTORY_LOCATION_TYPES.includes(locationType) ? locationType : "PHYSICAL",
    isDefault: r.isDefault === true,
    parentLocationId: typeof r.parentLocationId === "string" ? r.parentLocationId : null,
    aisle: typeof r.aisle === "string" ? r.aisle : null,
    shelf: typeof r.shelf === "string" ? r.shelf : null,
    position: typeof r.position === "string" ? r.position : null,
    addressLabel: typeof r.addressLabel === "string" ? r.addressLabel : null,
    notes: typeof r.notes === "string" ? r.notes : null,
    createdAt: String(r.createdAt ?? ""),
    updatedAt: String(r.updatedAt ?? ""),
    createdByUserId: typeof r.createdByUserId === "string" ? r.createdByUserId : null,
    updatedByUserId: typeof r.updatedByUserId === "string" ? r.updatedByUserId : null,
  };
}

export function normalizeInventoryLocationListResponse(raw: unknown): {
  rows: InventoryLocationRow[];
  total: number;
} {
  const data = (raw ?? {}) as { rows?: unknown[]; total?: number };
  const rows = (data.rows ?? [])
    .map(normalizeInventoryLocationRow)
    .filter((r): r is InventoryLocationRow => r != null);
  return { rows, total: Number(data.total ?? rows.length) || rows.length };
}
