/**
 * Formulário e validação de almoxarifado — frontend puro.
 */
import type { InventoryWarehouseRow, InventoryWarehouseStatus } from "@/src/types/inventory";

export type InventoryWarehouseFormState = {
  code: string;
  name: string;
  description: string;
  status: InventoryWarehouseStatus;
  allowsMovements: boolean;
};

export type InventoryWarehouseFormErrors = Partial<Record<keyof InventoryWarehouseFormState, string>>;

export function createEmptyInventoryWarehouseForm(
  defaults?: Partial<InventoryWarehouseFormState>
): InventoryWarehouseFormState {
  return {
    code: "",
    name: "",
    description: "",
    status: "ACTIVE",
    allowsMovements: true,
    ...defaults,
  };
}

export function inventoryWarehouseFormFromRow(row: InventoryWarehouseRow): InventoryWarehouseFormState {
  return {
    code: row.code,
    name: row.name,
    description: row.description ?? "",
    status: row.status,
    allowsMovements: row.allowsMovements,
  };
}

export function validateInventoryWarehouseForm(
  form: InventoryWarehouseFormState
): InventoryWarehouseFormErrors {
  const errors: InventoryWarehouseFormErrors = {};
  if (!form.code.trim()) errors.code = "Código é obrigatório.";
  if (!form.name.trim()) errors.name = "Nome é obrigatório.";
  return errors;
}

export function isInventoryWarehouseFormValid(form: InventoryWarehouseFormState): boolean {
  return Object.keys(validateInventoryWarehouseForm(form)).length === 0;
}

export function inventoryWarehouseFormToPayload(form: InventoryWarehouseFormState) {
  return {
    code: form.code.trim(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    status: form.status,
    allowsMovements: form.allowsMovements,
  };
}
