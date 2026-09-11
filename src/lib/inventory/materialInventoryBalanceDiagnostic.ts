/**
 * Classificação pura de divergência Material.quantity × saldo físico do Inventory.
 */
export const MATERIAL_INVENTORY_BALANCE_STATUSES = [
  "MATCH",
  "QUANTITY_DIVERGENCE",
  "NO_INVENTORY_LINK",
  "NO_MATERIAL",
  "UNIT_MISMATCH",
  "MULTIPLE_ACTIVE_LINKS",
  "NO_BALANCE",
  "LEGACY_QUANTITY_WITHOUT_CANONICAL_BALANCE",
  "OTHER_INCONSISTENCY",
] as const;

export type MaterialInventoryBalanceStatus =
  (typeof MATERIAL_INVENTORY_BALANCE_STATUSES)[number];

export type MaterialInventoryBalanceClassifyInput = {
  materialId: string | null;
  activeLinkCount: number;
  materialUnit: string | null;
  itemUnit: string | null;
  hasBalanceRow: boolean;
  materialQuantity: { eq: (other: { valueOf?: unknown } | string | number) => boolean; toString: () => string } | string | number | null;
  canonicalPhysical: { eq: (other: unknown) => boolean; toString: () => string } | string | number | null;
};

function asComparableString(value: unknown): string {
  if (value == null) return "0";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value.toString();
  if (typeof value === "object" && value !== null && "toString" in value) {
    return String((value as { toString: () => string }).toString());
  }
  return String(value);
}

export function unitsCompatible(
  materialUnit: string | null | undefined,
  itemUnit: string | null | undefined
): boolean {
  const a = materialUnit?.trim().toUpperCase() ?? "";
  const b = itemUnit?.trim().toUpperCase() ?? "";
  if (!a || !b) return false;
  return a === b;
}

export function classifyMaterialInventoryBalance(input: {
  materialId: string | null;
  activeLinkCount: number;
  materialUnit?: string | null;
  itemUnit?: string | null;
  hasBalanceRow: boolean;
  /** Ledger canônico materializado (InventoryBalance existente). Default = hasBalanceRow. */
  hasCanonicalLedger?: boolean;
  quantityEqualsCanonical: boolean;
}): MaterialInventoryBalanceStatus {
  if (!input.materialId) return "NO_MATERIAL";
  if (input.activeLinkCount > 1) return "MULTIPLE_ACTIVE_LINKS";
  if (input.activeLinkCount === 0) return "NO_INVENTORY_LINK";
  if (
    input.materialUnit != null &&
    input.itemUnit != null &&
    !unitsCompatible(input.materialUnit, input.itemUnit)
  ) {
    return "UNIT_MISMATCH";
  }
  const hasCanonicalLedger = input.hasCanonicalLedger ?? input.hasBalanceRow;
  if (!hasCanonicalLedger && input.quantityEqualsCanonical) return "NO_BALANCE";
  if (!hasCanonicalLedger && !input.quantityEqualsCanonical) {
    return "LEGACY_QUANTITY_WITHOUT_CANONICAL_BALANCE";
  }
  if (!input.quantityEqualsCanonical) return "QUANTITY_DIVERGENCE";
  return "MATCH";
}

/** Repair global só quando a divergência está no domínio canônico (há InventoryBalance). */
export function isCanonicalQuantityRepairEligible(input: {
  status: MaterialInventoryBalanceStatus;
  hasCanonicalLedger?: boolean;
  hasInventoryBalance?: boolean;
}): boolean {
  if (input.status !== "QUANTITY_DIVERGENCE") return false;
  return (input.hasCanonicalLedger ?? input.hasInventoryBalance) === true;
}

export function formatQuantityForReport(value: unknown): string {
  return asComparableString(value);
}
