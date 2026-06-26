/**
 * Contrato conceitual de demanda / projeção futura de estoque — sem Prisma.
 *
 * Não existe tabela `InventoryDemand` no schema atual (Fase MVP).
 * Este arquivo prepara tipos para reservas planejadas, PV, OP e inteligência de MP.
 */
import type { InventoryIntegrationOriginType } from "./inventoryIntegrationTypes.js";

export const INVENTORY_DEMAND_TYPES = [
  "SALES_ORDER_DEMAND",
  "PRODUCTION_DEMAND",
  "INTERNAL_REQUISITION",
  "MAINTENANCE_DEMAND",
  "SAFETY_STOCK",
  "MANUAL_FORECAST",
] as const;

export type InventoryDemandType = (typeof INVENTORY_DEMAND_TYPES)[number];

export const INVENTORY_DEMAND_STATUSES = [
  "PLANNED",
  "RESERVED",
  "CONSUMED",
  "CANCELED",
] as const;

export type InventoryDemandStatus = (typeof INVENTORY_DEMAND_STATUSES)[number];

/**
 * Registro conceitual de demanda futura (não persistido nesta fase).
 * Quando implementado, poderá virar tabela ou view materializada.
 */
export type InventoryDemandProjection = {
  itemId: string;
  warehouseId: string;
  requiredDate: string;
  quantity: number;
  demandType: InventoryDemandType;
  originType: InventoryIntegrationOriginType;
  originId: string;
  priority: number;
  status: InventoryDemandStatus;
  notes: string | null;
};

export type InventoryDemandProjectionInput = Omit<InventoryDemandProjection, "status"> & {
  status?: InventoryDemandStatus;
};

export function emptyDemandProjection(
  partial?: Partial<InventoryDemandProjection>
): InventoryDemandProjection {
  return {
    itemId: "",
    warehouseId: "",
    requiredDate: new Date().toISOString(),
    quantity: 0,
    demandType: "MANUAL_FORECAST",
    originType: "MANUAL",
    originId: "",
    priority: 0,
    status: "PLANNED",
    notes: null,
    ...partial,
  };
}

/** Validação pura — útil para testes e formulários futuros. */
export function validateDemandProjectionInput(
  input: InventoryDemandProjectionInput
): { ok: true } | { ok: false; code: string; message: string } {
  if (!input.itemId?.trim()) {
    return { ok: false, code: "ITEM_REQUIRED", message: "Item é obrigatório." };
  }
  if (!input.warehouseId?.trim()) {
    return { ok: false, code: "WAREHOUSE_REQUIRED", message: "Almoxarifado é obrigatório." };
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return { ok: false, code: "INVALID_QUANTITY", message: "Quantidade deve ser > 0." };
  }
  if (!input.originId?.trim()) {
    return { ok: false, code: "ORIGIN_REQUIRED", message: "Origem da demanda é obrigatória." };
  }
  if (!INVENTORY_DEMAND_TYPES.includes(input.demandType)) {
    return { ok: false, code: "INVALID_DEMAND_TYPE", message: "Tipo de demanda inválido." };
  }
  return { ok: true };
}

/**
 * Saldo projetado conceitual = disponível atual − demandas planejadas/reservadas.
 * Não consulta banco — apenas contrato para inteligência de MP futura.
 */
export function computeProjectedAvailable(
  availableQuantity: number,
  openDemands: ReadonlyArray<Pick<InventoryDemandProjection, "quantity" | "status">>
): number {
  let committed = 0;
  for (const d of openDemands) {
    if (d.status === "PLANNED" || d.status === "RESERVED") {
      committed += d.quantity;
    }
  }
  return availableQuantity - committed;
}
