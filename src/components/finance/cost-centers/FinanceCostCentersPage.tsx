import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceCostCenterDashboardPayload } from "@/src/lib/financeCostCenterDashboard";
import {
  buildFinanceCostCentersDashboardQuery,
  buildFinanceCostCentersYearOptions,
  createDefaultFinanceCostCentersUiFilters,
  FINANCE_COST_CENTERS_CLASSIFICATION_OPTIONS,
  FINANCE_COST_CENTERS_EXECUTIVE_SUBTITLE,
  FINANCE_COST_CENTERS_MONTH_OPTIONS,
  FINANCE_COST_CENTERS_STATUS_OPTIONS,
  FINANCE_COST_CENTERS_TABS,
  type FinanceCostCentersTabId,
  type FinanceCostCentersUiFilters,
} from "@/src/lib/financeCostCentersPageTypes";
import {
  canApplyFinanceApAllocationsBatch,
  canManageFinanceCostCenterRules,
  canManageFinanceCostCenters,
  canViewFinanceApAllocations,
  canViewFinanceCostCenterAudit,
  canViewFinanceCostCenterRules,
  canViewFinanceSuppliers,
} from "@/src/lib/financeCostCentersPermissions";
import {
  buildFinanceModuleEyebrow,
  FINANCE_FILTER_PANEL_TITLE,
  FINANCE_HEADER_ACTION_REFRESH,
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import { FinanceDataAuditButton } from "@/src/components/finance/shared/FinanceDataAuditButton";
import { FinanceDataAuditDrawer } from "@/src/components/finance/shared/FinanceDataAuditDrawer";
import { FinanceDetailTabs } from "@/src/components/finance/shared/FinanceDetailTabs";
import {
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import type { FinanceDataAuditSection } from "@/src/lib/financeDataAudit";
import { FinanceCostCenterOverviewTab } from "@/src/components/finance/cost-centers/FinanceCostCenterOverviewTab";
import { FinanceCostCentersCrudTab } from "@/src/components/finance/cost-centers/FinanceCostCentersCrudTab";
import { FinanceSuppliersTab } from "@/src/components/finance/cost-centers/FinanceSuppliersTab";
import { FinanceSupplierRulesTab } from "@/src/components/finance/cost-centers/FinanceSupplierRulesTab";
import { FinanceUnclassifiedPayablesTab } from "@/src/components/finance/cost-centers/FinanceUnclassifiedPayablesTab";
import { FinanceCostCenterAuditTab } from "@/src/components/finance/cost-centers/FinanceCostCenterAuditTab";

function buildAuditSections(data: FinanceCostCenterDashboardPayload | null): FinanceDataAuditSection[] {
  if (!data) return [];
  return [
    {
      kind: "list",
      id: "sources",
      title: "Fontes de dados",
      items: data.audit.dataSources.map((source) => ({ label: "Fonte", value: source })),
    },
    {
      kind: "list",
      id: "counts",
      title: "Cobertura",
      items: [
        { label: "Títulos considerados", value: String(data.audit.titlesConsidered) },
        { label: "Alocações consideradas", value: String(data.audit.allocationsConsidered) },
        {
          label: "Última sync AP",
          value: data.audit.lastApSyncAt ? formatFinanceDateTime(data.audit.lastApSyncAt) : "—",
        },
      ],
    },
  ];
}

export function FinanceCostCentersPage() {
  const auth = useAuth();
  const abortRef = useRef<AbortController | null>(null);
  const [activeTab, setActiveTab] = useState<FinanceCostCentersTabId>("overview");
  const [draftFilters, setDraftFilters] = useState<FinanceCostCentersUiFilters>(
    createDefaultFinanceCostCentersUiFilters
  );
  const [appliedFilters, setAppliedFilters] = useState<FinanceCostCentersUiFilters>(
    createDefaultFinanceCostCentersUiFilters
  );
  const [data, setData] = useState<FinanceCostCenterDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(true);

  const canManageCenters = canManageFinanceCostCenters(auth);
  const canViewSuppliers = canViewFinanceSuppliers(auth);
  const canManageRules = canManageFinanceCostCenterRules(auth);
  const canViewRules = canViewFinanceCostCenterRules(auth);
  const canApplyBatch = canApplyFinanceApAllocationsBatch(auth);
  const canViewAllocations = canViewFinanceApAllocations(auth);
  const canViewAudit = canViewFinanceCostCenterAudit(auth);

  const queryString = useMemo(
    () => buildFinanceCostCentersDashboardQuery(appliedFilters),
    [appliedFilters]
  );

  const filterStatus = useMemo(() => {
    const filtersActive =
      appliedFilters.status !== "all" ||
      appliedFilters.classification !== "all" ||
      Boolean(appliedFilters.companyName.trim()) ||
      appliedFilters.month != null;
    const hasPendingChanges = JSON.stringify(draftFilters) !== JSON.stringify(appliedFilters);
    return resolveFinanceBiFilterStatus(filtersActive, hasPendingChanges);
  }, [draftFilters, appliedFilters]);

  const load = useCallback(async () => {
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
      setData(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(buildFinanceTabLoadError("Não foi possível carregar Centros de Custo.", e));
      setData(null);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const yearOptions = useMemo(() => buildFinanceCostCentersYearOptions(), []);

  return (
    <FinanceBiDashboardShell data-testid="finance-cost-centers-page">
      <FinanceExecutivePageHeader
        eyebrow={buildFinanceModuleEyebrow("cost-centers")}
        title="Centros de Custo"
        subtitle={FINANCE_COST_CENTERS_EXECUTIVE_SUBTITLE}
        updatedAt={data?.audit.lastApSyncAt ?? undefined}
        actions={[
          {
            id: "refresh",
            label: FINANCE_HEADER_ACTION_REFRESH,
            onClick: () => void load(),
            icon: <RefreshCw className="h-4 w-4" />,
          },
        ]}
        extraActions={<FinanceDataAuditButton onClick={() => setAuditOpen(true)} />}
      />

      <FinanceBiFilterPanel
        title={FINANCE_FILTER_PANEL_TITLE}
        expanded={filtersExpanded}
        onToggle={() => setFiltersExpanded((value) => !value)}
        filterStatus={filterStatus}
        onApply={() => setAppliedFilters({ ...draftFilters })}
        onClear={() => {
          const defaults = createDefaultFinanceCostCentersUiFilters();
          setDraftFilters(defaults);
          setAppliedFilters(defaults);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Ano</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={draftFilters.year ?? ""}
              onChange={(e) =>
                setDraftFilters((f) => ({
                  ...f,
                  year: e.target.value ? Number(e.target.value) : undefined,
                }))
              }
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Mês</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={draftFilters.month ?? ""}
              onChange={(e) =>
                setDraftFilters((f) => ({
                  ...f,
                  month: e.target.value ? Number(e.target.value) : undefined,
                }))
              }
            >
              {FINANCE_COST_CENTERS_MONTH_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Status</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={draftFilters.status}
              onChange={(e) => setDraftFilters((f) => ({ ...f, status: e.target.value }))}
            >
              {FINANCE_COST_CENTERS_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Classificação</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={draftFilters.classification}
              onChange={(e) => setDraftFilters((f) => ({ ...f, classification: e.target.value }))}
            >
              {FINANCE_COST_CENTERS_CLASSIFICATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className={financeModuleFilterLabelClass()}>Empresa</span>
            <input
              className={financeModuleFilterFieldClass()}
              value={draftFilters.companyName}
              onChange={(e) => setDraftFilters((f) => ({ ...f, companyName: e.target.value }))}
              placeholder="Filtrar por empresa"
            />
          </label>
        </div>
      </FinanceBiFilterPanel>

      {error ? (
        <FinanceModuleErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} />
      ) : null}

      <FinanceDetailTabs
        tabs={FINANCE_COST_CENTERS_TABS}
        activeId={activeTab}
        onChange={setActiveTab}
      />

      {loading && activeTab === "overview" ? (
        <FinanceModuleLoadingBlock label="Carregando visão gerencial…" />
      ) : null}

      {activeTab === "overview" ? (
        <FinanceCostCenterOverviewTab data={data} loading={loading} />
      ) : null}
      {activeTab === "centers" ? (
        <FinanceCostCentersCrudTab canManage={canManageCenters} onChanged={() => void load()} />
      ) : null}
      {activeTab === "suppliers" ? (
        <FinanceSuppliersTab
          dashboard={data}
          canViewSuppliers={canViewSuppliers}
          onNavigateTab={setActiveTab}
        />
      ) : null}
      {activeTab === "rules" && (canViewRules || canManageRules) ? (
        <FinanceSupplierRulesTab canManage={canManageRules} />
      ) : activeTab === "rules" ? (
        <FinanceModuleErrorBanner message="Sem permissão para regras de classificação." />
      ) : null}
      {activeTab === "unclassified" && canViewAllocations ? (
        <FinanceUnclassifiedPayablesTab
          dashboard={data}
          canApplyBatch={canApplyBatch}
          onNavigateTab={setActiveTab}
          onApplied={() => void load()}
        />
      ) : activeTab === "unclassified" ? (
        <FinanceModuleErrorBanner message="Sem permissão para classificação de títulos." />
      ) : null}
      {activeTab === "audit" ? (
        <FinanceCostCenterAuditTab
          canView={canViewAudit}
          canManage={canManageRules || canManageCenters}
        />
      ) : null}

      <FinanceDataAuditDrawer
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        title="Auditoria técnica — Centros de Custo"
        sections={buildAuditSections(data)}
      />
    </FinanceBiDashboardShell>
  );
}
