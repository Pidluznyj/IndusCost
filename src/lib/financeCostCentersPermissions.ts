/** Permissões UI — Financeiro > Centros de Custo / Fornecedores (PERM-41: DTO-first). */

import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";

export type FinanceCostCentersPermissionCheck = {
  hasPermission: (key: string) => boolean;
  role?: string;
  isSuperAdmin?: () => boolean;
};

export type FinanceCostCentersActionCheck = FinanceCostCentersPermissionCheck & {
  canPerformAction?: (resourceKey: string, action: string) => boolean;
};

const CC = FINANCE_MODULE_RESOURCE_KEYS.costCenters;
const SUPPLIERS = FINANCE_MODULE_RESOURCE_KEYS.suppliers;
const SUPPLIERS_ST = FINANCE_MODULE_RESOURCE_KEYS.suppliersServiceTermination;

/**
 * Com `canPerformAction` (DTO), a decisão é autoritativa — sem OR legado
 * que misture Centros de Custo ↔ Fornecedores ↔ finance.view.
 */
function dtoOrLegacy(
  auth: FinanceCostCentersActionCheck,
  resourceKey: string,
  action: string,
  legacy: () => boolean
): boolean {
  if (typeof auth.canPerformAction === "function") {
    return auth.canPerformAction(resourceKey, action);
  }
  return legacy();
}

export function canViewFinanceCostCenters(auth: FinanceCostCentersActionCheck): boolean {
  return dtoOrLegacy(auth, CC, "view", () =>
    auth.hasPermission("finance.cost_centers.view") || auth.hasPermission("finance.view")
  );
}

export function canManageFinanceCostCenters(auth: FinanceCostCentersActionCheck): boolean {
  return dtoOrLegacy(auth, CC, "manage", () =>
    auth.hasPermission("finance.cost_centers.manage")
  );
}

export function canViewFinanceCostCenterRules(auth: FinanceCostCentersActionCheck): boolean {
  return dtoOrLegacy(auth, CC, "view", () =>
    auth.hasPermission("finance.cost_center_rules.view") ||
    auth.hasPermission("finance.cost_centers.view") ||
    auth.hasPermission("finance.view")
  );
}

export function canManageFinanceCostCenterRules(auth: FinanceCostCentersActionCheck): boolean {
  return dtoOrLegacy(auth, CC, "manage", () =>
    auth.hasPermission("finance.cost_center_rules.manage")
  );
}

/** Fornecedores — isolado de Centros de Custo (PERM-41). */
export function canViewFinanceSuppliers(auth: FinanceCostCentersActionCheck): boolean {
  return dtoOrLegacy(auth, SUPPLIERS, "view", () =>
    auth.hasPermission("finance.suppliers.view")
  );
}

export function canManageFinanceSuppliers(auth: FinanceCostCentersActionCheck): boolean {
  if (typeof auth.canPerformAction === "function") {
    return (
      auth.canPerformAction(SUPPLIERS, "manage") ||
      auth.canPerformAction(SUPPLIERS, "configure")
    );
  }
  return auth.hasPermission("finance.suppliers.manage");
}

export function canViewSupplierServiceTermination(
  auth: FinanceCostCentersActionCheck
): boolean {
  if (typeof auth.canPerformAction === "function") {
    return (
      auth.canPerformAction(SUPPLIERS_ST, "view") ||
      canManageFinanceSuppliers(auth) ||
      canViewFinanceSuppliers(auth)
    );
  }
  return (
    auth.hasPermission("finance.suppliers.service_termination.view") ||
    auth.hasPermission("suppliers.serviceTermination.view") ||
    canManageFinanceSuppliers(auth) ||
    canViewFinanceSuppliers(auth)
  );
}

export function canCreateSupplierServiceTermination(
  auth: FinanceCostCentersActionCheck
): boolean {
  if (typeof auth.canPerformAction === "function") {
    return (
      auth.canPerformAction(SUPPLIERS_ST, "create") || canManageFinanceSuppliers(auth)
    );
  }
  return (
    auth.hasPermission("finance.suppliers.service_termination.create") ||
    auth.hasPermission("suppliers.serviceTermination.create") ||
    canManageFinanceSuppliers(auth)
  );
}

export function canFinalizeSupplierServiceTermination(
  auth: FinanceCostCentersActionCheck
): boolean {
  if (typeof auth.canPerformAction === "function") {
    return (
      auth.canPerformAction(SUPPLIERS_ST, "execute") || canManageFinanceSuppliers(auth)
    );
  }
  return (
    auth.hasPermission("finance.suppliers.service_termination.finalize") ||
    auth.hasPermission("suppliers.serviceTermination.finalize") ||
    canManageFinanceSuppliers(auth)
  );
}

export function canExportSupplierServiceTermination(
  auth: FinanceCostCentersActionCheck
): boolean {
  if (typeof auth.canPerformAction === "function") {
    return (
      auth.canPerformAction(SUPPLIERS_ST, "export") ||
      canManageFinanceSuppliers(auth) ||
      canViewSupplierServiceTermination(auth)
    );
  }
  return (
    auth.hasPermission("finance.suppliers.service_termination.export") ||
    auth.hasPermission("suppliers.serviceTermination.export") ||
    canManageFinanceSuppliers(auth) ||
    canViewSupplierServiceTermination(auth)
  );
}

export function canDeleteFinanceSupplier(auth: FinanceCostCentersPermissionCheck): boolean {
  if (auth.isSuperAdmin?.()) return true;
  return auth.role === "SUPER_ADMIN";
}

export function canViewFinanceApAllocations(auth: FinanceCostCentersActionCheck): boolean {
  return dtoOrLegacy(auth, CC, "view", () =>
    auth.hasPermission("finance.ap_allocations.view") ||
    auth.hasPermission("finance.cost_centers.view") ||
    auth.hasPermission("finance.view")
  );
}

export function canApplyFinanceApAllocationsBatch(auth: FinanceCostCentersActionCheck): boolean {
  return dtoOrLegacy(auth, CC, "manage", () =>
    auth.hasPermission("finance.ap_allocations.apply_batch")
  );
}

export function canViewFinanceCostCenterAudit(auth: FinanceCostCentersActionCheck): boolean {
  return dtoOrLegacy(auth, CC, "view", () =>
    auth.hasPermission("finance.cost_center_audit.view") ||
    auth.hasPermission("finance.ap_allocations.view") ||
    auth.hasPermission("finance.view")
  );
}

export function canManageFinanceApAllocations(auth: FinanceCostCentersActionCheck): boolean {
  return dtoOrLegacy(auth, CC, "manage", () =>
    auth.hasPermission("finance.ap_allocations.manage") ||
    auth.hasPermission("finance.ap_allocations.apply_batch")
  );
}

export function canReallocateFinanceCostCenterAllocations(
  auth: FinanceCostCentersActionCheck & { role?: string }
): boolean {
  if (auth.role === "SUPER_ADMIN" || auth.role === "ADMIN") return true;
  return canManageFinanceCostCenters(auth) || canApplyFinanceApAllocationsBatch(auth);
}
