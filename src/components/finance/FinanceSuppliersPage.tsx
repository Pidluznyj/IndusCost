import React, { useCallback, useMemo, useState } from "react";
import { Building2, Gauge, RefreshCw } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { createDefaultFinanceCostCentersUiFilters } from "@/src/lib/financeCostCentersPageTypes";
import {
  canCreateSupplierServiceTermination,
  canDeleteFinanceSupplier,
  canExportSupplierServiceTermination,
  canFinalizeSupplierServiceTermination,
  canManageFinanceApAllocations,
  canManageFinanceSuppliers,
  canViewFinanceSuppliers,
  canViewSupplierServiceTermination,
} from "@/src/lib/financeCostCentersPermissions";
import {
  FINANCE_HEADER_ACTION_REFRESH,
  buildFinanceModuleEyebrow,
} from "@/src/lib/financeModuleUiStandards";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { FinanceModuleEmptyState } from "@/src/components/finance/shared/FinanceModuleStates";
import { SuppliersManagementView } from "@/src/components/finance/cost-centers/SuppliersManagementView";
import { useNavigate } from "react-router-dom";
import { getFinanceSectionPath } from "@/src/lib/financeNavigation";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess";
import { useSupplierPerformanceFeatureEnabled } from "@/src/lib/purchasing/supplierPerformanceClient";

/**
 * Financeiro > Fornecedores — cadastro via APIs `finance.suppliers` (PERM-41).
 * Não depende de Centros de Custo / dashboard CC.
 */
export function FinanceSuppliersPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const [reloadToken, setReloadToken] = useState(0);

  const appliedFilters = useMemo(() => createDefaultFinanceCostCentersUiFilters(), []);

  const supplierCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canViewSuppliers = canViewFinanceSuppliers(supplierCheck);
  const canManageSuppliers = canManageFinanceSuppliers(supplierCheck);
  const canDeleteSupplier = canDeleteFinanceSupplier(auth);
  const canReclassifyTitles = canManageFinanceApAllocations(supplierCheck);

  const bumpReload = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  // OP-26 — entrada do relatório: flag off = ação ausente (fail closed).
  const supplierPerformanceEnabled = useSupplierPerformanceFeatureEnabled();
  const canViewPurchases =
    auth.hasPermission("purchases.view") ||
    permissions.canPerformAction(
      OPERATIONS_RESOURCE_KEYS.purchases,
      OPERATIONS_ACTIONS.view
    );
  const showPerformanceAction =
    supplierPerformanceEnabled === true && canViewPurchases;

  if (!canViewSuppliers) {
    return (
      <FinanceModuleEmptyState
        title="Sem permissão para fornecedores"
        description="Solicite acesso a fornecedores financeiros para gerenciar esta área."
      />
    );
  }

  return (
    <div data-testid="finance-suppliers-page">
      <FinanceBiDashboardShell>
      <FinanceExecutivePageHeader
        eyebrow={buildFinanceModuleEyebrow("suppliers")}
        title="Fornecedores"
        subtitle="Cadastro de fornecedores para padronização de nomes, documentos e vínculo operacional."
        actions={[
          ...(showPerformanceAction
            ? [
                {
                  id: "supplier-performance",
                  label: "Desempenho dos fornecedores",
                  onClick: () => navigate("/finance/suppliers/performance"),
                  icon: <Gauge className="h-4 w-4" />,
                },
              ]
            : []),
          {
            id: "refresh",
            label: FINANCE_HEADER_ACTION_REFRESH,
            onClick: bumpReload,
            icon: <RefreshCw className="h-4 w-4" />,
          },
        ]}
      />

      <div
        className="mb-4 flex items-start gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        data-testid="finance-suppliers-shared-base-notice"
      >
        <Building2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Esta é a mesma base utilizada em Centro de Custos &gt; Fornecedores.
          O acesso a fornecedores é independente de Centros de Custo.
        </p>
      </div>

      <SuppliersManagementView
        key={reloadToken}
        context="finance-menu"
        dashboard={null}
        appliedFilters={appliedFilters}
        canViewSuppliers={canViewSuppliers}
        canManageSuppliers={canManageSuppliers}
        canDeleteSupplier={canDeleteSupplier}
        canReclassifyTitles={canReclassifyTitles}
        canViewServiceTermination={canViewSupplierServiceTermination(supplierCheck)}
        canCreateServiceTermination={canCreateSupplierServiceTermination(supplierCheck)}
        canFinalizeServiceTermination={canFinalizeSupplierServiceTermination(supplierCheck)}
        canExportServiceTermination={canExportSupplierServiceTermination(supplierCheck)}
        onNavigateTab={(tab) => {
          navigate(`${getFinanceSectionPath("cost-centers")}?tab=${tab}`);
        }}
        onSuppliersChanged={bumpReload}
      />
      </FinanceBiDashboardShell>
    </div>
  );
}
