import React from "react";
import type { FinanceCostCenterDashboardPayload } from "@/src/lib/financeCostCenterDashboard";
import type { FinanceCostCentersTabId } from "@/src/lib/financeCostCentersPageTypes";
import type { FinanceCostCentersUiFilters } from "@/src/lib/financeCostCentersPageTypes";
import { SuppliersManagementView } from "@/src/components/finance/cost-centers/SuppliersManagementView";

type Props = {
  dashboard: FinanceCostCenterDashboardPayload | null;
  appliedFilters: FinanceCostCentersUiFilters;
  canViewSuppliers: boolean;
  canManageSuppliers: boolean;
  canDeleteSupplier: boolean;
  canReclassifyTitles: boolean;
  onNavigateTab: (tab: FinanceCostCentersTabId) => void;
  onSuppliersChanged?: () => void;
};

/** Aba Centro de Custos > Fornecedores — reutiliza a view compartilhada. */
export function FinanceSuppliersTab(props: Props) {
  return <SuppliersManagementView {...props} context="cost-center-tab" />;
}
