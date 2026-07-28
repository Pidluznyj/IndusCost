import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Loader2,
  RefreshCw,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import {
  buildFinanceBillingYearOptions,
  createDefaultFinanceBillingYear,
  FINANCE_BILLING_ANALYSIS_TABS,
  hasPendingFinanceBillingYearChange,
  type FinanceBillingAnalysisTabId,
  type FinanceBillingDashboardPayload,
} from "@/src/lib/financeBillingDashboardTypes";
import {
  buildFinanceBillingDashboardQuery,
  FINANCE_BILLING_SOURCE_DEFAULT,
  type FinanceBillingDateBase,
} from "@/src/lib/financeBillingSourceTypes";
import {
  buildFinanceBillingExportQuery,
  createDefaultFinanceBillingNfeFilters,
  FINANCE_BILLING_MONTH_OPTIONS,
  hasPendingFinanceBillingNfeFilterChanges,
  type FinanceBillingNfeDraftFilters,
} from "@/src/lib/financeBillingNfeFiltersTypes";
import { financeBillingNfeExportFilename } from "@/src/lib/financeBillingNfeExport";
import { formatExecutiveInteger } from "@/src/lib/executiveDashboardFormatters";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import type { FinanceBillingComparisonPayload } from "@/src/lib/financeBillingNfeComparison";
import { canRunFinanceBillingNfeSync } from "@/src/lib/financeBillingPermissions";
import {
  FinanceApErrorBanner,
  FinanceApLoadingBlock,
} from "@/src/components/finance/FinanceAccountsPayableUiShared";
import { FinanceBillingNfeSyncPanel } from "@/src/components/finance/FinanceBillingNfeSyncPanel";
import {
  FinanceBillingAccumulatedView,
  FinanceBillingMonthlyView,
  FinanceBillingForecastView,
  FinanceBillingOverviewView,
  FinanceBillingProjectionView,
} from "@/src/components/finance/billing/FinanceBillingExecutiveViews";
import { FinanceBillingAuditPanel } from "@/src/components/finance/billing/FinanceBillingAuditPanel";
import { FinanceBillingCustomersTab } from "@/src/components/finance/billing/FinanceBillingCustomersTab";
import { FinanceBillingActionCenter } from "@/src/components/finance/billing/FinanceBillingActionCenter";
import { FinanceDetailTabs } from "@/src/components/finance/shared/FinanceDetailTabs";
import {
  buildBillingAuditQueryString,
  parseBillingAuditFilters,
} from "@/src/lib/financeBillingAuditFilters";
import type { BillingAuditResult } from "@/src/lib/financeBillingAuditTypes";
import { financeBillingAuditExportFilename } from "@/src/lib/financeBillingAuditExport";
import {
  FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE,
  FINANCE_BILLING_NFE_EXPORT_SCOPE,
} from "@/src/lib/financeFilterScope";
import {
  buildFinanceAuditItemsFromChips,
  buildFinanceBillingAuditSections,
} from "@/src/lib/financeDataAudit";
import {
  FINANCE_AUDIT_SECTION_TECHNICAL,
  FINANCE_BILLING_EXECUTIVE_SUBTITLE,
} from "@/src/lib/financeDataAuditCopy";
import {
  buildFinanceModuleEyebrow,
  FINANCE_FILTER_PANEL_TITLE,
  FINANCE_HEADER_ACTION_REFRESH,
} from "@/src/lib/financeModuleUiStandards";
import {
  FINANCE_KPI_BILLING_DELTA_VS_PREV_YEAR,
  FINANCE_KPI_BILLING_FORECAST,
  FINANCE_KPI_BILLING_GROSS_FOUND,
  FINANCE_KPI_BILLING_NET_REVENUE,
  FINANCE_KPI_BILLING_NFE_COUNT,
  FINANCE_KPI_BILLING_SAME_MONTH_PREV_YEAR,
  FINANCE_KPI_BILLING_TICKET_AVG,
  FINANCE_KPI_BILLING_VARIATION_VS_PREV_YEAR,
  FINANCE_KPI_BILLING_YTD_CURRENT,
  FINANCE_KPI_BILLING_YTD_DELTA,
  FINANCE_KPI_BILLING_YTD_PREVIOUS,
  FINANCE_KPI_BILLING_YTD_VARIATION,
} from "@/src/lib/financeKpiTooltips";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { FinanceDataAuditButton } from "@/src/components/finance/shared/FinanceDataAuditButton";
import { FinanceDataAuditDrawer } from "@/src/components/finance/shared/FinanceDataAuditDrawer";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import {
  type FinanceKpiTone,
} from "@/src/components/finance/shared/FinanceKpiCard";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import {
  buildFinanceBillingComparisonPeriodTitle,
  buildFinanceBillingSelectedPeriodTitle,
  computeFinanceBillingComparisonDelta,
  formatFinanceBillingDeltaValue,
  formatFinanceBillingShortMonthYear,
  formatFinanceBillingVariationValue,
} from "@/src/lib/financeBillingExecutiveKpi";
import { buildFinanceBillingFilterChips } from "@/src/lib/financeBiFilterChips";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceFilterScopeBanner } from "@/src/components/finance/FinanceFilterScopeBanner";
import { FinanceHorizonSection } from "@/src/components/finance/shared/FinanceHorizonSection";
import type { FinanceBillingHorizonDrilldownFilters } from "@/src/lib/financeBillingHorizonDrilldownTypes";

export function FinanceBillingPage() {
  const auth = useAuth();
  const canRunSync = canRunFinanceBillingNfeSync(auth);
  const defaultYear = createDefaultFinanceBillingYear();

  const [auditDrawerOpen, setAuditDrawerOpen] = useState(false);
  const [analysisTab, setAnalysisTab] = useState<FinanceBillingAnalysisTabId>("overview");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [auditExporting, setAuditExporting] = useState(false);
  const [auditExportError, setAuditExportError] = useState<string | null>(null);
  const [audit, setAudit] = useState<BillingAuditResult | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [draftYear, setDraftYear] = useState(defaultYear);
  const [appliedYear, setAppliedYear] = useState(defaultYear);
  const [draftDateBase, setDraftDateBase] = useState<FinanceBillingDateBase>("emissao");
  const [appliedDateBase, setAppliedDateBase] = useState<FinanceBillingDateBase>("emissao");
  const [draftNfeFilters, setDraftNfeFilters] = useState(() =>
    createDefaultFinanceBillingNfeFilters(defaultYear)
  );
  const [appliedNfeFilters, setAppliedNfeFilters] = useState(() =>
    createDefaultFinanceBillingNfeFilters(defaultYear)
  );

  const abortRef = useRef<AbortController | null>(null);
  const abortComparisonRef = useRef<AbortController | null>(null);
  const abortAuditRef = useRef<AbortController | null>(null);

  const yearOptions = useMemo(() => buildFinanceBillingYearOptions(), []);
  const hasPendingFilterChanges = useMemo(
    () =>
      hasPendingFinanceBillingYearChange(draftYear, appliedYear) ||
      draftDateBase !== appliedDateBase ||
      hasPendingFinanceBillingNfeFilterChanges(draftNfeFilters, appliedNfeFilters),
    [
      draftYear,
      appliedYear,
      draftDateBase,
      appliedDateBase,
      draftNfeFilters,
      appliedNfeFilters,
    ]
  );

  const queryString = useMemo(
    () =>
      buildFinanceBillingDashboardQuery(appliedYear, {
        billingSource: FINANCE_BILLING_SOURCE_DEFAULT,
        dateBase: appliedDateBase,
      }),
    [appliedYear, appliedDateBase]
  );
  const horizonDrilldownFilters = useMemo<FinanceBillingHorizonDrilldownFilters>(
    () => ({
      customerCnpj: appliedNfeFilters.customerCnpj,
      documentNumber: appliedNfeFilters.documentNumber,
    }),
    [appliedNfeFilters.customerCnpj, appliedNfeFilters.documentNumber]
  );

  const [data, setData] = useState<FinanceBillingDashboardPayload | null>(null);
  const [comparison, setComparison] = useState<FinanceBillingComparisonPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const url = queryString
        ? `/api/finance/billing/dashboard?${queryString}`
        : "/api/finance/billing/dashboard";
      const payload = await fetchJsonOk<FinanceBillingDashboardPayload>(url, {
        signal: controller.signal,
        credentials: "include",
      });
      if (controller.signal.aborted) return;
      setData(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("FinanceBillingPage.loadDashboard", e);
      setError(
        buildFinanceTabLoadError(
          "Não foi possível carregar o faturamento. Tente novamente.",
          e
        )
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [queryString]);

  const loadComparison = useCallback(async () => {
    abortComparisonRef.current?.abort();
    const controller = new AbortController();
    abortComparisonRef.current = controller;
    setLoadingComparison(true);
    setComparisonError(null);
    try {
      const url = `/api/finance/billing/comparison?year=${encodeURIComponent(appliedYear)}`;
      const payload = await fetchJsonOk<FinanceBillingComparisonPayload>(url, {
        signal: controller.signal,
        credentials: "include",
      });
      if (controller.signal.aborted) return;
      setComparison(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("FinanceBillingPage.loadComparison", e);
      setComparison(null);
      setComparisonError(
        buildFinanceTabLoadError(
          "Não foi possível carregar o comparativo SalesOrder × NomusNfe.",
          e
        )
      );
    } finally {
      if (!controller.signal.aborted) setLoadingComparison(false);
    }
  }, [appliedYear]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleApplyFilters = () => {
    setAppliedYear(draftYear.trim());
    setAppliedDateBase(draftDateBase);
    setAppliedNfeFilters({ ...draftNfeFilters, year: draftYear.trim() });
  };

  const handleClearFilters = () => {
    const year = createDefaultFinanceBillingYear();
    setDraftYear(year);
    setAppliedYear(year);
    setDraftDateBase("emissao");
    setAppliedDateBase("emissao");
    const defaults = createDefaultFinanceBillingNfeFilters(year);
    setDraftNfeFilters(defaults);
    setAppliedNfeFilters(defaults);
  };

  const auditQueryString = useMemo(() => {
    const filters = parseBillingAuditFilters({
      year: appliedYear,
      month: appliedNfeFilters.month || undefined,
      customerCnpj: appliedNfeFilters.customerCnpj || undefined,
      classification: appliedNfeFilters.classification,
      status: appliedNfeFilters.status,
      documentNumber: appliedNfeFilters.documentNumber || undefined,
    });
    const base = buildBillingAuditQueryString(filters);
    const params = new URLSearchParams(base);
    params.set("billingSource", FINANCE_BILLING_SOURCE_DEFAULT);
    params.set("dateBase", appliedDateBase);
    return params.toString();
  }, [appliedYear, appliedNfeFilters, appliedDateBase]);

  const loadAudit = useCallback(async () => {
    abortAuditRef.current?.abort();
    const controller = new AbortController();
    abortAuditRef.current = controller;
    setLoadingAudit(true);
    setAuditError(null);
    try {
      const url = `/api/finance/billing/audit?${auditQueryString}`;
      const payload = await fetchJsonOk<BillingAuditResult>(url, {
        signal: controller.signal,
        credentials: "include",
      });
      if (controller.signal.aborted) return;
      setAudit(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("FinanceBillingPage.loadAudit", e);
      setAuditError(
        buildFinanceTabLoadError("Não foi possível carregar a auditoria do faturamento.", e)
      );
    } finally {
      if (!controller.signal.aborted) setLoadingAudit(false);
    }
  }, [auditQueryString]);

  /** Comparativo e auditoria alimentam o Centro de Ações (sem grid de detalhamento). */
  useEffect(() => {
    setComparison(null);
    setComparisonError(null);
  }, [appliedYear]);

  useEffect(() => {
    setAudit(null);
    setAuditError(null);
  }, [auditQueryString]);

  useEffect(() => {
    if (comparison != null) return;
    void loadComparison();
  }, [loadComparison, comparison]);

  useEffect(() => {
    if (audit != null) return;
    void loadAudit();
  }, [loadAudit, audit]);

  const handleRefreshAll = () => {
    void loadDashboard();
    void loadComparison();
    void loadAudit();
  };

  const handleAuditExport = async () => {
    setAuditExporting(true);
    setAuditExportError(null);
    try {
      const res = await fetch(`/api/finance/billing/audit/export?${auditQueryString}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Falha ao exportar auditoria.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = financeBillingAuditExportFilename(
        Number.parseInt(appliedYear, 10) || new Date().getFullYear()
      );
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setAuditExportError(e instanceof Error ? e.message : "Erro ao exportar auditoria.");
    } finally {
      setAuditExporting(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const qs = buildFinanceBillingExportQuery(appliedNfeFilters);
      const res = await fetch(`/api/finance/billing/export?${qs}`, { credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Falha ao exportar CSV.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = financeBillingNfeExportFilename(Number.parseInt(appliedYear, 10) || new Date().getFullYear());
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Erro ao exportar CSV.");
    } finally {
      setExporting(false);
    }
  };

  const comparisonLabel = data
    ? `${data.selectedYear} × ${data.previousYear}`
    : `${appliedYear} × ${Number.parseInt(appliedYear, 10) - 1}`;

  const filtersActive =
    appliedNfeFilters.month ||
    appliedNfeFilters.customerCnpj ||
    appliedNfeFilters.documentNumber ||
    appliedNfeFilters.classification !== "all" ||
    appliedNfeFilters.status !== "all" ||
    appliedYear !== createDefaultFinanceBillingYear();

  const tab = data?.tab;
  const selectedYear =
    data?.selectedYear ?? (Number.parseInt(appliedYear, 10) || new Date().getFullYear());
  const previousYear = data?.previousYear ?? selectedYear - 1;
  const referenceMonth = data?.currentMonth ?? new Date().getMonth() + 1;
  const summaryCard = (id: string) => tab?.summaryCards.find((c) => c.id === id);

  const monthComparison = useMemo(
    () => computeFinanceBillingComparisonDelta(tab?.target.actual, tab?.target.previousPeriod),
    [tab?.target.actual, tab?.target.previousPeriod]
  );

  const ytdComparison = useMemo(
    () =>
      computeFinanceBillingComparisonDelta(
        tab?.yearComparison?.yearToDateCurrent,
        tab?.yearComparison?.yearToDatePrevious
      ),
    [tab?.yearComparison?.yearToDateCurrent, tab?.yearComparison?.yearToDatePrevious]
  );

  const selectedPeriodTitle = buildFinanceBillingSelectedPeriodTitle(selectedYear, referenceMonth);
  const comparisonPeriodTitle = buildFinanceBillingComparisonPeriodTitle(
    referenceMonth,
    previousYear
  );
  const sameMonthPrevYearLabel = formatFinanceBillingShortMonthYear(referenceMonth, previousYear);

  const deltaTone = (delta: number | null | undefined): FinanceKpiTone => {
    if (delta == null || !Number.isFinite(delta) || delta === 0) return "neutral";
    return delta > 0 ? "success" : "danger";
  };

  const filterStatus = useMemo(
    () => resolveFinanceBiFilterStatus(Boolean(filtersActive), hasPendingFilterChanges),
    [filtersActive, hasPendingFilterChanges]
  );

  const handleRemoveBillingChip = useCallback(
    (id: string) => {
      if (id === "year") return;
      const nextNfe = { ...appliedNfeFilters };
      if (id === "month") nextNfe.month = "";
      else if (id === "customerCnpj") nextNfe.customerCnpj = "";
      else if (id === "documentNumber") nextNfe.documentNumber = "";
      else if (id === "classification") nextNfe.classification = "all";
      else if (id === "status") nextNfe.status = "all";
      setAppliedNfeFilters(nextNfe);
      setDraftNfeFilters(nextNfe);
    },
    [appliedNfeFilters]
  );

  const appliedFilterChips = useMemo(
    () => buildFinanceBillingFilterChips(appliedYear, appliedNfeFilters, handleRemoveBillingChip),
    [appliedYear, appliedNfeFilters, handleRemoveBillingChip]
  );

  const headerUpdatedAt = data?.generatedAt ?? null;

  const auditSections = useMemo(
    () =>
      buildFinanceBillingAuditSections({
        generatedAt: data?.generatedAt,
        lastInvoicedAt: data?.lastInvoicedAt,
        periodLabel: data?.periodLabel ?? null,
        appliedFilterItems: buildFinanceAuditItemsFromChips(appliedFilterChips),
      }),
    [appliedFilterChips, data?.generatedAt, data?.lastInvoicedAt, data?.periodLabel]
  );

  return (
    <FinanceBiDashboardShell>
      <FinanceExecutivePageHeader
        eyebrow={buildFinanceModuleEyebrow("billing")}
        title="Faturamento"
        subtitle={FINANCE_BILLING_EXECUTIVE_SUBTITLE}
        updatedAt={headerUpdatedAt}
        compact
        actions={[
          {
            id: "refresh",
            label: FINANCE_HEADER_ACTION_REFRESH,
            onClick: handleRefreshAll,
            disabled: loading,
            loading,
            icon: loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            ),
          },
          {
            id: "audit-export",
            label: "Exportar composição",
            onClick: () => void handleAuditExport(),
            disabled: auditExporting || loadingAudit,
            loading: auditExporting,
            variant: "accent" as const,
            icon: auditExporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            ),
          },
          {
            id: "export",
            label: "Exportar CSV NF-e",
            onClick: () => void handleExport(),
            disabled: exporting || loading,
            loading: exporting,
            icon: exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            ),
          },
        ]}
        extraActions={
          <FinanceDataAuditButton
            onClick={() => setAuditDrawerOpen(true)}
            disabled={loading && !data}
          />
        }
      />

      <FinanceDataAuditDrawer
        open={auditDrawerOpen}
        onClose={() => setAuditDrawerOpen(false)}
        sections={auditSections}
      >
        <div className="border-t border-[#E5E7EB] pt-4 space-y-4">
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#6B7280]">
              Auditoria do faturamento
            </h3>
            <button
              type="button"
              onClick={() => void loadAudit()}
              disabled={loadingAudit}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs font-semibold hover:bg-[#F9FAFB] disabled:opacity-50"
            >
              {loadingAudit ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Target className="h-3.5 w-3.5" />
              )}
              Auditar base do faturamento
            </button>
            <FinanceBillingAuditPanel
              audit={audit}
              loading={loadingAudit}
              error={auditError}
              onRetry={() => void loadAudit()}
            />
          </div>
          <div className="space-y-3 border-t border-[#E5E7EB] pt-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#6B7280]">
              {FINANCE_AUDIT_SECTION_TECHNICAL}
            </h3>
            <FinanceBillingNfeSyncPanel
              canRun={canRunSync}
              embedded
              onSyncFinished={() => {
                void loadDashboard();
                void loadComparison();
                void loadAudit();
              }}
            />
          </div>
        </div>
      </FinanceDataAuditDrawer>

      <main data-testid="finance-main-content">
      {error ? (
        <FinanceApErrorBanner
          message={error}
          onRetry={() => void loadDashboard()}
          onDismiss={() => setError(null)}
        />
      ) : null}
      {exportError ? (
        <FinanceApErrorBanner message={exportError} onDismiss={() => setExportError(null)} />
      ) : null}
      {auditExportError ? (
        <FinanceApErrorBanner message={auditExportError} onDismiss={() => setAuditExportError(null)} />
      ) : null}

      <FinanceBiFilterPanel
        title={FINANCE_FILTER_PANEL_TITLE}
        expanded={showAdvancedFilters}
        onToggle={() => setShowAdvancedFilters((v) => !v)}
        filterStatus={filterStatus}
        chips={appliedFilterChips}
        onApply={handleApplyFilters}
        onClear={handleClearFilters}
        applyDisabled={!hasPendingFilterChanges || loading}
        hint={FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE}
        alwaysVisible={
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Data base (NF-e)">
              <select
                value={draftDateBase}
                onChange={(e) =>
                  setDraftDateBase(e.target.value as FinanceBillingDateBase)
                }
                className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-sm"
              >
                <option value="emissao">Data fiscal / emissão</option>
                <option value="processamento">Data processamento</option>
              </select>
            </FilterField>
            <FilterField label="Ano">
              <select
                value={draftYear}
                onChange={(e) => {
                  setDraftYear(e.target.value);
                  setDraftNfeFilters((p) => ({ ...p, year: e.target.value }));
                }}
                className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-sm"
              >
                {yearOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Mês (NF-e)">
              <select
                value={draftNfeFilters.month}
                onChange={(e) => setDraftNfeFilters((p) => ({ ...p, month: e.target.value }))}
                className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-sm"
              >
                {FINANCE_BILLING_MONTH_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Cliente">
              <input
                value={draftNfeFilters.customerCnpj}
                onChange={(e) =>
                  setDraftNfeFilters((p) => ({ ...p, customerCnpj: e.target.value }))
                }
                placeholder="CNPJ ou parte do documento"
                className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-sm"
              />
            </FilterField>
            <FilterField label="Classificação">
              <select
                value={draftNfeFilters.classification}
                onChange={(e) =>
                  setDraftNfeFilters((p) => ({
                    ...p,
                    classification: e.target.value as FinanceBillingNfeDraftFilters["classification"],
                  }))
                }
                className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-sm"
              >
                <option value="all">Todas</option>
                <option value="market">Mercado</option>
                <option value="group">Grupo</option>
                <option value="logistics">Logística</option>
              </select>
            </FilterField>
            <FilterField label="Status NF">
              <select
                value={draftNfeFilters.status}
                onChange={(e) =>
                  setDraftNfeFilters((p) => ({
                    ...p,
                    status: e.target.value as FinanceBillingNfeDraftFilters["status"],
                  }))
                }
                className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-sm"
              >
                <option value="all">Todas</option>
                <option value="authorized">Autorizada</option>
                <option value="cancelled">Cancelada</option>
              </select>
            </FilterField>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FilterField label="Número NF (avançado)">
            <input
              value={draftNfeFilters.documentNumber}
              onChange={(e) =>
                setDraftNfeFilters((p) => ({ ...p, documentNumber: e.target.value }))
              }
              placeholder="Ex.: 12345"
              className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-sm"
            />
          </FilterField>
          <p className="text-[11px] text-[#6B7280] self-end pb-2">{FINANCE_BILLING_NFE_EXPORT_SCOPE}</p>
        </div>
      </FinanceBiFilterPanel>

      <FinanceFilterScopeBanner active={Boolean(filtersActive)} />

      <ExecutiveSummarySection
        title="Resumo executivo"
        eyebrow={`Painel NF-e fiscal — ano ${appliedYear}. Comparativo ${comparisonLabel}. Meses futuros exibem null, não zero falso.`}
        testId="finance-billing-executive-summary"
        className="space-y-8"
      >
          <FinanceBillingKpiGroup
            title={selectedPeriodTitle}
            subtitle="Fonte NF-e fiscal autorizada."
          >
            <FinanceExecutiveTotalizerCard
              icon={Wallet}
              label="Faturamento líquido"
              value={loading ? "…" : formatFinanceKpiCurrency(tab?.target.actual)}
              subtitle={tab?.periodLabel ?? "—"}
              helperText={FINANCE_KPI_BILLING_NET_REVENUE}
              tone="info"
              loading={loading}
            />
            <FinanceExecutiveTotalizerCard
              icon={TrendingUp}
              label="Faturamento do ano"
              value={
                loading
                  ? "…"
                  : formatFinanceKpiCurrency(summaryCard("billing-year")?.value ?? null)
              }
              subtitle={`Ano ${appliedYear} — NF-e`}
              helperText={FINANCE_KPI_BILLING_GROSS_FOUND}
              loading={loading}
            />
            <FinanceExecutiveTotalizerCard
              icon={Target}
              label="NF-e no mês"
              value={
                loading
                  ? "…"
                  : (summaryCard("billing-count-month")?.formatted ??
                    formatExecutiveInteger(summaryCard("billing-count-month")?.value))
              }
              subtitle="Autorizadas no período"
              helperText={FINANCE_KPI_BILLING_NFE_COUNT}
              loading={loading}
            />
            <FinanceExecutiveTotalizerCard
              icon={Wallet}
              label="Ticket médio"
              value={
                loading ? "…" : formatFinanceKpiCurrency(summaryCard("billing-ticket")?.value ?? null)
              }
              subtitle="Líquido ÷ quantidade"
              helperText={FINANCE_KPI_BILLING_TICKET_AVG}
              loading={loading}
            />
            <FinanceExecutiveTotalizerCard
              icon={Target}
              label="Previsto no mês"
              value={
                loading
                  ? "…"
                  : formatFinanceKpiCurrency(
                      tab?.forecast?.monthForecastAmount ??
                        tab?.projection.projectedMonth ??
                        null
                    )
              }
              subtitle="Carteira / projeção"
              helperText={FINANCE_KPI_BILLING_FORECAST}
              tone="warning"
              loading={loading}
            />
          </FinanceBillingKpiGroup>

          <FinanceBillingKpiGroup
            title={comparisonPeriodTitle}
            subtitle="Mesmo mês do ano anterior — não é o mês cronológico anterior."
            columns={3}
          >
            <FinanceExecutiveTotalizerCard
              icon={TrendingUp}
              label={sameMonthPrevYearLabel}
              value={loading ? "…" : formatFinanceKpiCurrency(tab?.target.previousPeriod)}
              subtitle="Mesmo mês do ano anterior"
              helperText={FINANCE_KPI_BILLING_SAME_MONTH_PREV_YEAR}
              loading={loading}
            />
            <FinanceExecutiveTotalizerCard
              icon={TrendingUp}
              label={`Diferença vs ${previousYear}`}
              value={loading ? "…" : formatFinanceBillingDeltaValue(monthComparison.delta)}
              subtitle="Período − mesmo mês ano anterior"
              helperText={FINANCE_KPI_BILLING_DELTA_VS_PREV_YEAR}
              tone={deltaTone(monthComparison.delta)}
              loading={loading}
            />
            <FinanceExecutiveTotalizerCard
              icon={TrendingUp}
              label={`Variação vs ${previousYear}`}
              value={loading ? "…" : formatFinanceBillingVariationValue(monthComparison.variationPercent)}
              subtitle="Percentual sobre a base comparativa"
              helperText={FINANCE_KPI_BILLING_VARIATION_VS_PREV_YEAR}
              tone={deltaTone(monthComparison.delta)}
              loading={loading}
            />
          </FinanceBillingKpiGroup>

          <FinanceBillingKpiGroup
            title="Acumulado do ano — YTD"
            subtitle="Comparação acumulada entre ano selecionado e ano anterior."
          >
            <FinanceExecutiveTotalizerCard
              icon={Wallet}
              label={`YTD ${selectedYear}`}
              value={
                loading ? "…" : formatFinanceKpiCurrency(tab?.yearComparison?.yearToDateCurrent)
              }
              subtitle="Ano selecionado"
              helperText={FINANCE_KPI_BILLING_YTD_CURRENT}
              tone="info"
              loading={loading}
            />
            <FinanceExecutiveTotalizerCard
              icon={Wallet}
              label={`YTD ${previousYear}`}
              value={
                loading ? "…" : formatFinanceKpiCurrency(tab?.yearComparison?.yearToDatePrevious)
              }
              subtitle="Mesmo recorte no ano anterior"
              helperText={FINANCE_KPI_BILLING_YTD_PREVIOUS}
              loading={loading}
            />
            <FinanceExecutiveTotalizerCard
              icon={TrendingUp}
              label="Diferença YTD"
              value={loading ? "…" : formatFinanceBillingDeltaValue(ytdComparison.delta)}
              subtitle={`${selectedYear} − ${previousYear}`}
              helperText={FINANCE_KPI_BILLING_YTD_DELTA}
              tone={deltaTone(ytdComparison.delta)}
              loading={loading}
            />
            <FinanceExecutiveTotalizerCard
              icon={TrendingUp}
              label="Variação YTD"
              value={loading ? "…" : formatFinanceBillingVariationValue(ytdComparison.variationPercent)}
              subtitle="Percentual sobre YTD anterior"
              helperText={FINANCE_KPI_BILLING_YTD_VARIATION}
              tone={deltaTone(ytdComparison.delta)}
              loading={loading}
            />
          </FinanceBillingKpiGroup>
      </ExecutiveSummarySection>

      <FinanceHorizonSection
        summary={tab?.forecast?.financialHorizon}
        variant="billing"
        loading={loading}
        filters={horizonDrilldownFilters}
        enableDrilldown
      />

      <section className={financeBiSectionClass}>
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <h2 className="text-sm font-bold text-[#111827]">Análises gráficas</h2>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            Evolução mensal, acumulado, projeção e carteira prevista — fonte NF-e.
          </p>
        </div>
        <div className="px-5 pt-4">
          <FinanceDetailTabs
            tabs={FINANCE_BILLING_ANALYSIS_TABS}
            activeId={analysisTab}
            onChange={setAnalysisTab}
          />
        </div>
        <div className="p-5" role="tabpanel">
          {loading && !data ? <FinanceApLoadingBlock label="gráficos de faturamento" /> : null}
          {analysisTab === "overview" ? (
            <FinanceBillingOverviewView data={data} loading={loading} />
          ) : null}
          {analysisTab === "accumulated" ? (
            <FinanceBillingAccumulatedView data={data} loading={loading} />
          ) : null}
          {analysisTab === "monthly" ? (
            <FinanceBillingMonthlyView data={data} loading={loading} />
          ) : null}
          {analysisTab === "projection" ? (
            <FinanceBillingProjectionView data={data} loading={loading} />
          ) : null}
          {analysisTab === "forecast" ? (
            <FinanceBillingForecastView data={data} loading={loading} />
          ) : null}
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <FinanceBillingActionCenter
          tab={tab}
          comparison={comparison}
          audit={audit}
          loading={loading || loadingComparison || loadingAudit}
        />
        <FinanceBillingCustomersTab
          rows={tab?.topCustomers ?? []}
          loading={loading}
          yearLabel={appliedYear}
        />
      </div>
      </main>
    </FinanceBiDashboardShell>
  );
}

function FinanceBillingKpiGroup({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  columns?: 3 | 4;
  children: React.ReactNode;
}) {
  return (
    <ExecutiveSummarySection title={title} eyebrow={subtitle} className="border-0 shadow-none p-0 gap-3">
      <SummaryKpiGrid minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS}>{children}</SummaryKpiGrid>
    </ExecutiveSummarySection>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 block min-w-0">
      <span className="text-[10px] font-bold uppercase text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
