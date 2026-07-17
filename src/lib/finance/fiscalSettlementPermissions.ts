/** Permissões — apuração / guias / alocação fiscal (camadas B–D). */

export type FiscalSettlementPermissionCheck = {
  hasPermission: (key: string) => boolean;
};

export const FISCAL_SETTLEMENT_VIEW_PERMISSIONS = [
  "finance.tax_apuration.view",
  "taxes.view",
] as const;

export const FISCAL_SETTLEMENT_MANAGE_PERMISSIONS = [
  "finance.tax_apuration.manage",
] as const;

export const FISCAL_ALLOCATION_MANAGE_PERMISSIONS = [
  "finance.tax_allocation.manage",
  "finance.tax_apuration.manage",
] as const;

export function canViewFiscalSettlements(
  auth: FiscalSettlementPermissionCheck
): boolean {
  return FISCAL_SETTLEMENT_VIEW_PERMISSIONS.some((k) => auth.hasPermission(k));
}

export function canManageFiscalSettlements(
  auth: FiscalSettlementPermissionCheck
): boolean {
  return FISCAL_SETTLEMENT_MANAGE_PERMISSIONS.some((k) => auth.hasPermission(k));
}

export function canManageFiscalAllocations(
  auth: FiscalSettlementPermissionCheck
): boolean {
  return FISCAL_ALLOCATION_MANAGE_PERMISSIONS.some((k) => auth.hasPermission(k));
}

export function canViewFiscalSettlementsFromPermissions(
  permissions: readonly string[] | null | undefined
): boolean {
  // Fail-closed: bag vazia/ausente não libera apuração fiscal.
  if (!permissions || permissions.length === 0) return false;
  return FISCAL_SETTLEMENT_VIEW_PERMISSIONS.some((k) => permissions.includes(k));
}
