/**
 * Contratos de integração futura do módulo Estoque — tipos puros, sem Prisma.
 *
 * NÃO ativa integração real. Use `INVENTORY_INTEGRATIONS_ENABLED` como feature flag
 * (sempre false nesta fase) antes de qualquer orquestração cross-módulo.
 */
import type { InventoryMovementOriginType } from "@/src/types/inventory.js";

/** Feature flag global — integrações cross-módulo permanecem desligadas. */
export const INVENTORY_INTEGRATIONS_ENABLED = false as const;

/**
 * Origem conceitual de negócio para integrações futuras.
 * Mais granular que `InventoryMovementOriginType` (enum persistido hoje).
 */
export const INVENTORY_INTEGRATION_ORIGIN_TYPES = [
  "MANUAL",
  "PURCHASE_ORDER",
  "SALES_ORDER",
  "PRODUCTION_ORDER",
  "BOM",
  "NFE",
  "QUALITY",
  "INTERNAL_REQUISITION",
  "MAINTENANCE",
  "FINANCE",
  "COST_CENTER",
] as const;

export type InventoryIntegrationOriginType = (typeof INVENTORY_INTEGRATION_ORIGIN_TYPES)[number];

/** Campos de `InventoryMovement` já existentes no schema para vínculo futuro. */
export const INVENTORY_MOVEMENT_INTEGRATION_FIELD_KEYS = [
  "originType",
  "originId",
  "documentNumber",
  "costCenterId",
  "financialCostCenterId",
  "purchaseOrderId",
  "purchaseOrderCode",
  "salesOrderId",
  "salesOrderCode",
  "productionOrderId",
  "productionOrderCode",
  "bomId",
  "productId",
  "nfeId",
  "nfeNumber",
  "reservationId",
] as const;

export type InventoryMovementIntegrationFieldKey =
  (typeof INVENTORY_MOVEMENT_INTEGRATION_FIELD_KEYS)[number];

/** Payload conceitual que módulos externos enviarão no futuro (não implementado). */
export type FutureInventoryMovementRequest = {
  itemId: string;
  movementType: string;
  quantity: number;
  unit: string;
  reason: string;
  integrationOrigin: InventoryIntegrationOriginType;
  originId: string;
  warehouseId?: string | null;
  locationId?: string | null;
  costCenterId?: string | null;
  financialCostCenterId?: string | null;
  purchaseOrderId?: string | null;
  salesOrderId?: string | null;
  productionOrderId?: string | null;
  bomId?: string | null;
  productId?: string | null;
  nfeId?: string | null;
  nfeNumber?: string | null;
  documentNumber?: string | null;
  notes?: string | null;
};

/**
 * Mapeia origem conceitual → enum persistido em `InventoryMovement.originType`.
 * Integrações futuras devem usar este mapa ao chamar `createInventoryMovement`.
 */
export function mapIntegrationOriginToMovementOrigin(
  origin: InventoryIntegrationOriginType
): InventoryMovementOriginType {
  switch (origin) {
    case "MANUAL":
      return "MANUAL";
    case "PURCHASE_ORDER":
    case "NFE":
      return "PURCHASE";
    case "SALES_ORDER":
      return "SALES_ORDER";
    case "PRODUCTION_ORDER":
    case "BOM":
      return "PRODUCTION_ORDER";
    case "QUALITY":
    case "FINANCE":
      return "INTEGRATION";
    case "INTERNAL_REQUISITION":
    case "MAINTENANCE":
    case "COST_CENTER":
      return "OTHER";
    default: {
      const _exhaustive: never = origin;
      return _exhaustive;
    }
  }
}

/** Indica se a origem depende de módulo externo (não manual). */
export function isExternalIntegrationOrigin(origin: InventoryIntegrationOriginType): boolean {
  return origin !== "MANUAL";
}

/** Guard explícito — integrações reais devem checar antes de orquestrar. */
export function assertInventoryIntegrationsDisabled(): void {
  if (INVENTORY_INTEGRATIONS_ENABLED) return;
  throw new Error("INVENTORY_INTEGRATIONS_DISABLED");
}
