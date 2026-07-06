/**
 * Formulário e validação de movimentações — frontend puro.
 */
import {
  getMovementFormFields,
  movementUsesDestinationWarehouse,
  movementUsesSourceWarehouse,
} from "@/src/components/inventory/inventoryMovementLabels";
import { requiresMovementCostCenter } from "@/src/components/inventory/inventoryMovementClientRules";
import type { InventoryItemType, InventoryMovementType } from "@/src/types/inventory";

export type InventoryMovementFormState = {
  movementType: InventoryMovementType;
  itemId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  quantity: string;
  reason: string;
  notes: string;
  documentNumber: string;
  costCenterId: string;
  reservationType: string;
  reservationId: string;
};

export type InventoryMovementFormErrors = Partial<Record<keyof InventoryMovementFormState, string>>;

export function createEmptyInventoryMovementForm(
  defaults?: Partial<InventoryMovementFormState>
): InventoryMovementFormState {
  return {
    movementType: "MANUAL_ENTRY",
    itemId: "",
    sourceWarehouseId: "",
    destinationWarehouseId: "",
    quantity: "",
    reason: "",
    notes: "",
    documentNumber: "",
    costCenterId: "",
    reservationType: "MANUAL",
    reservationId: "",
    ...defaults,
  };
}

export function validateInventoryMovementForm(
  form: InventoryMovementFormState,
  itemType?: InventoryItemType | null
): InventoryMovementFormErrors {
  const errors: InventoryMovementFormErrors = {};
  const fields = getMovementFormFields(form.movementType);

  if (form.movementType === "CANCEL_RESERVATION") {
    if (!form.reservationId.trim()) errors.reservationId = "Reserva é obrigatória.";
    if (!form.reason.trim()) errors.reason = "Motivo é obrigatório.";
    return errors;
  }

  if (fields.has("item") && !form.itemId.trim()) errors.itemId = "Item é obrigatório.";

  const qty = Number(form.quantity.replace(",", "."));
  if (!form.quantity.trim() || !Number.isFinite(qty) || qty <= 0) {
    errors.quantity = "Quantidade deve ser maior que zero.";
  }

  if (fields.has("reason") && !form.reason.trim()) {
    errors.reason = "Motivo é obrigatório.";
  }

  if (movementUsesSourceWarehouse(form.movementType) && !form.sourceWarehouseId.trim()) {
    errors.sourceWarehouseId = "Almoxarifado de origem é obrigatório.";
  }

  if (movementUsesDestinationWarehouse(form.movementType) && !form.destinationWarehouseId.trim()) {
    errors.destinationWarehouseId = "Almoxarifado de destino é obrigatório.";
  }

  if (
    form.movementType === "TRANSFER" &&
    form.sourceWarehouseId.trim() &&
    form.destinationWarehouseId.trim() &&
    form.sourceWarehouseId === form.destinationWarehouseId
  ) {
    errors.destinationWarehouseId = "Origem e destino devem ser diferentes.";
  }

  if (
    requiresMovementCostCenter(form.movementType, itemType ?? null) &&
    !form.costCenterId.trim()
  ) {
    errors.costCenterId = "Centro de custo é obrigatório para saída deste tipo de item.";
  }

  return errors;
}

export function isInventoryMovementFormValid(
  form: InventoryMovementFormState,
  itemType?: InventoryItemType | null
): boolean {
  return Object.keys(validateInventoryMovementForm(form, itemType)).length === 0;
}

export function inventoryMovementFormToMovementPayload(form: InventoryMovementFormState) {
  const quantity = Number(form.quantity.replace(",", "."));
  return {
    itemId: form.itemId.trim(),
    movementType: form.movementType,
    quantity,
    reason: form.reason.trim(),
    notes: form.notes.trim() || null,
    documentNumber: form.documentNumber.trim() || null,
    costCenterId: form.costCenterId.trim() || null,
    sourceWarehouseId: form.sourceWarehouseId.trim() || null,
    destinationWarehouseId: form.destinationWarehouseId.trim() || null,
  };
}

export function inventoryMovementFormToReservationPayload(form: InventoryMovementFormState) {
  const quantity = Number(form.quantity.replace(",", "."));
  return {
    itemId: form.itemId.trim(),
    warehouseId: form.sourceWarehouseId.trim(),
    quantity,
    reason: form.reason.trim(),
    notes: form.notes.trim() || null,
    reservationType: form.reservationType.trim() || "MANUAL",
  };
}

/** Garante que payload de movimentação não inclui campos de saldo editável. */
export function assertNoBalanceFieldsInMovementPayload(payload: Record<string, unknown>): void {
  for (const key of [
    "physicalQuantity",
    "availableQuantity",
    "reservedQuantity",
    "blockedQuantity",
    "previousPhysicalBalance",
    "nextPhysicalBalance",
  ]) {
    if (key in payload) {
      throw new Error(`Payload de movimentação não deve incluir ${key}.`);
    }
  }
}
