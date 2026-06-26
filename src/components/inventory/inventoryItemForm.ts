/**
 * Formulário e validação de item — frontend puro (sem Prisma).
 */
import type { InventoryItemRow, InventoryItemStatus, InventoryItemType } from "@/src/types/inventory";

export type InventoryItemFormState = {
  code: string;
  description: string;
  itemType: InventoryItemType | "";
  unit: string;
  status: InventoryItemStatus;
  family: string;
  group: string;
  controlsLot: boolean;
  controlsExpiration: boolean;
  controlsLocation: boolean;
  controlsQuality: boolean;
  minimumStock: string;
  maximumStock: string;
  reorderPoint: string;
  preferredSupplierName: string;
  averageCost: string;
  lastKnownCost: string;
  nomusProductCode: string;
  notes: string;
};

export type InventoryItemFormErrors = Partial<Record<keyof InventoryItemFormState, string>>;

export function createEmptyInventoryItemForm(
  defaults?: Partial<InventoryItemFormState>
): InventoryItemFormState {
  return {
    code: "",
    description: "",
    itemType: "",
    unit: "UN",
    status: "ACTIVE",
    family: "",
    group: "",
    controlsLot: false,
    controlsExpiration: false,
    controlsLocation: false,
    controlsQuality: false,
    minimumStock: "",
    maximumStock: "",
    reorderPoint: "",
    preferredSupplierName: "",
    averageCost: "",
    lastKnownCost: "",
    nomusProductCode: "",
    notes: "",
    ...defaults,
  };
}

export function inventoryItemFormFromRow(row: InventoryItemRow): InventoryItemFormState {
  return {
    code: row.code,
    description: row.description,
    itemType: row.itemType,
    unit: row.unit,
    status: row.status,
    family: row.family ?? "",
    group: row.group ?? "",
    controlsLot: row.controlsLot,
    controlsExpiration: row.controlsExpiration,
    controlsLocation: row.controlsLocation,
    controlsQuality: row.controlsQuality,
    minimumStock: row.minimumStock != null ? String(row.minimumStock) : "",
    maximumStock: row.maximumStock != null ? String(row.maximumStock) : "",
    reorderPoint: row.reorderPoint != null ? String(row.reorderPoint) : "",
    preferredSupplierName: row.preferredSupplierName ?? "",
    averageCost: row.averageCost != null ? String(row.averageCost) : "",
    lastKnownCost: row.lastKnownCost != null ? String(row.lastKnownCost) : "",
    nomusProductCode: row.nomusProductCode ?? "",
    notes: row.notes ?? "",
  };
}

function parseOptionalNonNegative(value: string, field: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  if (n < 0) throw new Error(`${field} deve ser maior ou igual a zero.`);
  return n;
}

export function validateInventoryItemForm(form: InventoryItemFormState): InventoryItemFormErrors {
  const errors: InventoryItemFormErrors = {};
  if (!form.code.trim()) errors.code = "Código é obrigatório.";
  if (!form.description.trim()) errors.description = "Descrição é obrigatória.";
  if (!form.itemType) errors.itemType = "Tipo do item é obrigatório.";
  if (!form.unit.trim()) errors.unit = "Unidade é obrigatória.";

  try {
    parseOptionalNonNegative(form.minimumStock, "Estoque mínimo");
    parseOptionalNonNegative(form.maximumStock, "Estoque máximo");
    parseOptionalNonNegative(form.reorderPoint, "Ponto de reposição");
    parseOptionalNonNegative(form.averageCost, "Custo médio");
    parseOptionalNonNegative(form.lastKnownCost, "Último custo");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Valor numérico inválido.";
    if (msg.includes("mínimo")) errors.minimumStock = msg;
    else if (msg.includes("máximo")) errors.maximumStock = msg;
    else if (msg.includes("reposição")) errors.reorderPoint = msg;
    else if (msg.includes("médio")) errors.averageCost = msg;
    else if (msg.includes("Último")) errors.lastKnownCost = msg;
  }

  return errors;
}

export function isInventoryItemFormValid(form: InventoryItemFormState): boolean {
  return Object.keys(validateInventoryItemForm(form)).length === 0;
}

export function inventoryItemFormToPayload(form: InventoryItemFormState) {
  const minimumStock = parseOptionalNonNegative(form.minimumStock, "Estoque mínimo");
  const maximumStock = parseOptionalNonNegative(form.maximumStock, "Estoque máximo");
  const reorderPoint = parseOptionalNonNegative(form.reorderPoint, "Ponto de reposição");
  const averageCost = parseOptionalNonNegative(form.averageCost, "Custo médio");
  const lastKnownCost = parseOptionalNonNegative(form.lastKnownCost, "Último custo");

  return {
    code: form.code.trim(),
    description: form.description.trim(),
    itemType: form.itemType as InventoryItemType,
    unit: form.unit.trim(),
    status: form.status,
    family: form.family.trim() || null,
    group: form.group.trim() || null,
    controlsLot: form.controlsLot,
    controlsExpiration: form.controlsExpiration,
    controlsLocation: form.controlsLocation,
    controlsQuality: form.controlsQuality,
    minimumStock,
    maximumStock,
    reorderPoint,
    preferredSupplierName: form.preferredSupplierName.trim() || null,
    averageCost,
    lastKnownCost,
    nomusProductCode: form.nomusProductCode.trim() || null,
    notes: form.notes.trim() || null,
  };
}

/** Garante que payload de item nunca inclui campos de saldo. */
export const INVENTORY_BALANCE_FIELD_KEYS = [
  "physicalQuantity",
  "reservedQuantity",
  "blockedQuantity",
  "quarantineQuantity",
  "availableQuantity",
  "balance",
  "saldo",
] as const;

export function assertNoBalanceFieldsInPayload(payload: Record<string, unknown>): void {
  for (const key of INVENTORY_BALANCE_FIELD_KEYS) {
    if (key in payload) {
      throw new Error(`Campo de saldo não permitido no cadastro: ${key}`);
    }
  }
}
