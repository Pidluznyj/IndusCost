/**
 * Status operacional de item/saldo — motor puro.
 */
import type { InventoryBalanceSnapshot, InventoryItemParameters, InventoryOperationalStatus } from "./inventoryTypes.js";

export function calculateInventoryStatus(
  balance: InventoryBalanceSnapshot,
  item: InventoryItemParameters = {}
): InventoryOperationalStatus {
  if (item.status === "INACTIVE") return "INACTIVE";

  if (balance.physicalQuantity < 0 || balance.availableQuantity < 0) return "NEGATIVE";
  if (balance.availableQuantity === 0) return "OUT_OF_STOCK";

  const minimum = item.minimumStock;
  if (minimum != null && Number.isFinite(minimum) && balance.availableQuantity < minimum) {
    return "CRITICAL";
  }

  const reorder = item.reorderPoint;
  if (reorder != null && Number.isFinite(reorder) && balance.availableQuantity < reorder) {
    return "ATTENTION";
  }

  if (balance.quarantineQuantity > 0) return "QUARANTINE";
  if (balance.blockedQuantity > 0) return "BLOCKED";

  return "OK";
}

export const INVENTORY_STATUS_LABELS: Record<InventoryOperationalStatus, string> = {
  OK: "Normal",
  ATTENTION: "Atenção",
  CRITICAL: "Crítico",
  OUT_OF_STOCK: "Sem estoque",
  NEGATIVE: "Saldo negativo",
  BLOCKED: "Com bloqueio",
  QUARANTINE: "Em quarentena",
  INACTIVE: "Inativo",
};

export function formatInventoryStatusLabel(status: InventoryOperationalStatus): string {
  return INVENTORY_STATUS_LABELS[status] ?? status;
}
