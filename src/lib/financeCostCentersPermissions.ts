/** Permissões UI — Financeiro > Centros de Custo. */

export type FinanceCostCentersPermissionCheck = {
  hasPermission: (key: string) => boolean;
  role?: string;
  isSuperAdmin?: () => boolean;
};

export function canViewFinanceCostCenters(auth: FinanceCostCentersPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.cost_centers.view") ||
    auth.hasPermission("finance.view")
  );
}

export function canManageFinanceCostCenters(auth: FinanceCostCentersPermissionCheck): boolean {
  return auth.hasPermission("finance.cost_centers.manage");
}

export function canViewFinanceCostCenterRules(auth: FinanceCostCentersPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.cost_center_rules.view") ||
    auth.hasPermission("finance.cost_centers.view") ||
    auth.hasPermission("finance.view")
  );
}

export function canManageFinanceCostCenterRules(auth: FinanceCostCentersPermissionCheck): boolean {
  return auth.hasPermission("finance.cost_center_rules.manage");
}

export function canViewFinanceSuppliers(auth: FinanceCostCentersPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.suppliers.view") ||
    auth.hasPermission("finance.cost_centers.view") ||
    auth.hasPermission("finance.view")
  );
}

export function canManageFinanceSuppliers(auth: FinanceCostCentersPermissionCheck): boolean {
  return auth.hasPermission("finance.suppliers.manage");
}

export function canDeleteFinanceSupplier(auth: FinanceCostCentersPermissionCheck): boolean {
  if (auth.isSuperAdmin?.()) return true;
  return auth.role === "SUPER_ADMIN";
}

export function canViewFinanceApAllocations(auth: FinanceCostCentersPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.ap_allocations.view") ||
    auth.hasPermission("finance.cost_centers.view") ||
    auth.hasPermission("finance.view")
  );
}

export function canApplyFinanceApAllocationsBatch(auth: FinanceCostCentersPermissionCheck): boolean {
  return auth.hasPermission("finance.ap_allocations.apply_batch");
}

export function canViewFinanceCostCenterAudit(auth: FinanceCostCentersPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.cost_center_audit.view") ||
    auth.hasPermission("finance.ap_allocations.view") ||
    auth.hasPermission("finance.view")
  );
}

export function canManageFinanceApAllocations(auth: FinanceCostCentersPermissionCheck): boolean {
  return auth.hasPermission("finance.ap_allocations.manage");
}

export function canReallocateFinanceCostCenterAllocations(
  auth: FinanceCostCentersPermissionCheck & { role?: string }
): boolean {
  if (auth.role === "SUPER_ADMIN" || auth.role === "ADMIN") return true;
  return canManageFinanceCostCenters(auth) || canApplyFinanceApAllocationsBatch(auth);
}
