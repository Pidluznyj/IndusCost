import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, RefreshCw } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceCostCenterDashboardPayload } from "@/src/lib/financeCostCenterDashboard";
import {
  buildFinanceCostCentersDashboardQuery,
  createDefaultFinanceCostCentersUiFilters,
} from "@/src/lib/financeCostCentersPageTypes";
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
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { SuppliersManagementView } from "@/src/components/finance/cost-centers/SuppliersManagementView";
import { useNavigate } from "react-router-dom";
import { getFinanceSectionPath } from "@/src/lib/financeNavigation";

/**
 * Financeiro > Fornecedores — mesmo cadastro/APIs da aba Centro de Custos > Fornecedores.
 */
export function FinanceSuppliersPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const abortRef = useRef<AbortController | null>(null);
  const [dashboard, setDashboard] = useState<FinanceCostCenterDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const appliedFilters = useMemo(() => createDefaultFinanceCostCentersUiFilters(), []);
  const queryString = useMemo(
    () => buildFinanceCostCentersDashboardQuery(appliedFilters),
    [appliedFilters]
  );

  const canViewSuppliers = canViewFinanceSuppliers(auth);
  const canManageSuppliers = canManageFinanceSuppliers(auth);
  const canDeleteSupplier = canDeleteFinanceSupplier(auth);
  const canReclassifyTitles = canManageFinanceApAllocations(auth);

  const load = useCallback(async () => {
    if (!canViewSuppliers) {
      setLoading(false);
      setDashboard(null);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<FinanceCostCenterDashboardPayload>(
        `/api/finance/cost-centers/dashboard?${queryString}`,
        { signal: ac.signal, credentials: "include" }
      );
      setDashboard(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(buildFinanceTabLoadError("Não foi possível carregar fornecedores.", e));
      setDashboard(null);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [canViewSuppliers, queryString]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

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
          {
            id: "refresh",
            label: FINANCE_HEADER_ACTION_REFRESH,
            onClick: () => void load(),
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
        </p>
      </div>

      {error ? (
        <FinanceModuleErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} />
      ) : null}
      {loading && !dashboard ? <FinanceModuleLoadingBlock label="Carregando fornecedores…" /> : null}

      <SuppliersManagementView
        context="finance-menu"
        dashboard={dashboard}
        appliedFilters={appliedFilters}
        canViewSuppliers={canViewSuppliers}
        canManageSuppliers={canManageSuppliers}
        canDeleteSupplier={canDeleteSupplier}
        canReclassifyTitles={canReclassifyTitles}
        canViewServiceTermination={canViewSupplierServiceTermination(auth)}
        canCreateServiceTermination={canCreateSupplierServiceTermination(auth)}
        canFinalizeServiceTermination={canFinalizeSupplierServiceTermination(auth)}
        canExportServiceTermination={canExportSupplierServiceTermination(auth)}
        onNavigateTab={(tab) => {
          navigate(`${getFinanceSectionPath("cost-centers")}?tab=${tab}`);
        }}
        onSuppliersChanged={() => void load()}
      />
      </FinanceBiDashboardShell>
    </div>
  );
}
