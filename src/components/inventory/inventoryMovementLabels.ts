/**
 * Labels e opções de formulário de movimentações — frontend puro.
 */
import type { InventoryMovementOriginType, InventoryMovementType } from "@/src/types/inventory";

export type FormMovementTypeOption = {
  value: InventoryMovementType;
  label: string;
  enabled: boolean;
  hint?: string;
};

/** Tipos disponíveis no formulário; integrações futuras aparecem desabilitadas. */
export const INVENTORY_FORM_MOVEMENT_TYPES: FormMovementTypeOption[] = [
  { value: "MANUAL_ENTRY", label: "Entrada manual", enabled: true },
  { value: "MANUAL_EXIT", label: "Saída manual", enabled: true },
  { value: "TRANSFER", label: "Transferência", enabled: true },
  { value: "POSITIVE_ADJUSTMENT", label: "Ajuste positivo", enabled: true },
  { value: "NEGATIVE_ADJUSTMENT", label: "Ajuste negativo", enabled: true },
  { value: "BLOCK", label: "Bloqueio", enabled: true },
  { value: "UNBLOCK", label: "Desbloqueio", enabled: true },
  { value: "RESERVE", label: "Reserva", enabled: true },
  { value: "CANCEL_RESERVATION", label: "Cancelamento de reserva", enabled: true },
  { value: "LOSS", label: "Perda", enabled: true },
  { value: "SCRAP", label: "Refugo", enabled: true },
  { value: "RETURN", label: "Devolução", enabled: true },
  {
    value: "PURCHASE_ENTRY",
    label: "Entrada compra",
    enabled: false,
    hint: "Integração futura",
  },
  {
    value: "PRODUCTION_ENTRY",
    label: "Entrada produção",
    enabled: false,
    hint: "Integração futura",
  },
  {
    value: "PRODUCTION_EXIT",
    label: "Saída produção",
    enabled: false,
    hint: "Integração futura",
  },
  {
    value: "REVERSAL",
    label: "Estorno",
    enabled: false,
    hint: "Disponível quando o backend suportar estorno",
  },
];

export const INVENTORY_RESERVATION_TYPE_OPTIONS: Array<{
  value: string;
  label: string;
}> = [
  { value: "MANUAL", label: "Manual" },
  { value: "SALES_ORDER", label: "Pedido de venda" },
  { value: "PRODUCTION_ORDER", label: "Ordem de produção" },
  { value: "INTERNAL_REQUISITION", label: "Requisição interna" },
  { value: "MAINTENANCE", label: "Manutenção" },
  { value: "QUALITY", label: "Qualidade" },
];

export const INVENTORY_ORIGIN_TYPE_OPTIONS: Array<{
  value: InventoryMovementOriginType;
  label: string;
}> = [
  { value: "MANUAL", label: "Manual" },
  { value: "PURCHASE", label: "Compra" },
  { value: "SALES_ORDER", label: "Pedido de venda" },
  { value: "PRODUCTION_ORDER", label: "Ordem de produção" },
  { value: "COUNT_SESSION", label: "Conferência" },
  { value: "REVERSAL", label: "Estorno" },
  { value: "INTEGRATION", label: "Integração" },
  { value: "OTHER", label: "Outro" },
];

export type MovementFormField =
  | "item"
  | "sourceWarehouse"
  | "destinationWarehouse"
  | "quantity"
  | "reason"
  | "notes"
  | "documentNumber"
  | "costCenter"
  | "reservationType"
  | "reservationId";

const ENTRY_TYPES = new Set<InventoryMovementType>([
  "MANUAL_ENTRY",
  "PURCHASE_ENTRY",
  "PRODUCTION_ENTRY",
  "RETURN",
  "POSITIVE_ADJUSTMENT",
]);

const EXIT_TYPES = new Set<InventoryMovementType>([
  "MANUAL_EXIT",
  "REQUISITION_EXIT",
  "PRODUCTION_EXIT",
  "LOSS",
  "SCRAP",
  "NEGATIVE_ADJUSTMENT",
]);

export function getMovementFormFields(type: InventoryMovementType): Set<MovementFormField> {
  const fields = new Set<MovementFormField>(["item", "quantity"]);

  if (type === "CANCEL_RESERVATION") {
    return new Set<MovementFormField>(["reservationId", "reason"]);
  }

  fields.add("reason");

  if (ENTRY_TYPES.has(type)) {
    fields.add("destinationWarehouse");
    if (type === "MANUAL_ENTRY") {
      fields.add("documentNumber");
      fields.add("notes");
    }
  } else if (EXIT_TYPES.has(type)) {
    fields.add("sourceWarehouse");
    fields.add("costCenter");
    fields.add("notes");
  } else if (type === "TRANSFER") {
    fields.add("sourceWarehouse");
    fields.add("destinationWarehouse");
  } else if (type === "POSITIVE_ADJUSTMENT" || type === "NEGATIVE_ADJUSTMENT") {
    fields.add(type === "POSITIVE_ADJUSTMENT" ? "destinationWarehouse" : "sourceWarehouse");
    fields.add("notes");
  } else if (type === "BLOCK" || type === "UNBLOCK") {
    fields.add("sourceWarehouse");
  } else if (type === "RESERVE") {
    fields.add("sourceWarehouse");
    fields.add("reservationType");
    fields.add("notes");
  }

  return fields;
}

export function movementUsesDestinationWarehouse(type: InventoryMovementType): boolean {
  return (
    ENTRY_TYPES.has(type) ||
    type === "POSITIVE_ADJUSTMENT" ||
    (type !== "TRANSFER" && type !== "CANCEL_RESERVATION" && !EXIT_TYPES.has(type) && false)
  );
}

export function movementUsesSourceWarehouse(type: InventoryMovementType): boolean {
  return (
    EXIT_TYPES.has(type) ||
    type === "TRANSFER" ||
    type === "NEGATIVE_ADJUSTMENT" ||
    type === "BLOCK" ||
    type === "UNBLOCK" ||
    type === "RESERVE"
  );
}
