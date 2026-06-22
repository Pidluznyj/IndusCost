/** Permissões UI — Financeiro > Centros de Custo. */

export type FinanceCostCentersPermissionCheck = {
  hasPermission: (key: string) => boolean;
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
    auth.hasPermission("finance.cost_centers.view")
  );
}
