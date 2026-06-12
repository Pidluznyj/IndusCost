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
import {
  buildFinanceBillingYearOptions,
  createDefaultFinanceBillingYear,
  FINANCE_BILLING_ANALYSIS_TABS,
  FINANCE_BILLING_EXECUTIVE_TABS,
  hasPendingFinanceBillingYearChange,
  type FinanceBillingAnalysisTabId,
  type FinanceBillingDashboardPayload,
  type FinanceBillingExecutiveTabId,
} from "@/src/lib/financeBillingDashboardTypes";
import {
  buildFinanceBillingDashboardQuery,
  FINANCE_BILLING_SOURCE_DEFAULT,
  type FinanceBillingDateBase,
} from "@/src/lib/financeBillingSourceTypes";
import {
  parseFinanceBillingNfeLocalFilter,
  type FinanceBillingNfeLocalFilter,
} from "@/src/lib/financeBillingNfeLocalFilter";
import {
  buildFinanceBillingExportQuery,
  buildFinanceBillingNfeQuery,
  createDefaultFinanceBillingNfeFilters,
  FINANCE_BILLING_MONTH_OPTIONS,
  hasPendingFinanceBillingNfeFilterChanges,
  type FinanceBillingNfeDraftFilters,
} from "@/src/lib/financeBillingNfeFiltersTypes";
import { financeBillingNfeExportFilename } from "@/src/lib/financeBillingNfeExport";
import {
  formatExecutiveCompactCurrency,
  formatExecutiveInteger,
} from "@/src/lib/executiveDashboardFormatters";
import type { FinanceBillingComparisonPayload } from "@/src/lib/financeBillingNfeComparison";
import type { FinanceBillingNfeListPayload } from "@/src/lib/financeBillingNfeList";
import { canRunFinanceBillingNfeSync } from "@/src/lib/financeBillingPermissions";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsPayableFormat";
import {
  FinanceApErrorBanner,
  FinanceApLoadingBlock,
} from "@/src/components/finance/FinanceAccountsPayableUiShared";
import { FinanceBillingNfeSyncPanel } from "@/src/components/finance/FinanceBillingNfeSyncPanel";
import { FinanceBillingSourceBadge } from "@/src/components/finance/billing/FinanceBillingSourceBadge";
import {
  FinanceBillingAccumulatedView,
  FinanceBillingMonthlyView,
  FinanceBillingForecastView,
  FinanceBillingOverviewView,
  FinanceBillingProjectionView,
} from "@/src/components/finance/billing/FinanceBillingExecutiveViews";
import { FinanceBillingAuditPanel } from "@/src/components/finance/billing/FinanceBillingAuditPanel";
import { FinanceBillingComparisonPanel } from "@/src/components/finance/billing/FinanceBillingComparisonPanel";
import { FinanceBillingNfeDetailsTable } from "@/src/components/finance/billing/FinanceBillingNfeDetailsTable";
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
  FINANCE_BILLING_PROJECTION_SCOPE,
  FINANCE_BILLING_YTD_SCOPE,
  FINANCE_SYNC_GLOBAL_SCOPE,
} from "@/src/lib/financeFilterScope";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceBiExecutiveHeader } from "@/src/components/finance/bi/FinanceBiExecutiveHeader";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import { buildFinanceBillingFilterChips } from "@/src/lib/financeBiFilterChips";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import { financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceFilterScopeBanner } from "@/src/components/finance/FinanceFilterScopeBanner";

export function FinanceBillingPage() {
  const auth = useAuth();
  const canRunSync = canRunFinanceBillingNfeSync(auth);
  const defaultYear = createDefaultFinanceBillingYear();

  const [analysisTab, setAnalysisTab] = useState<FinanceBillingAnalysisTabId>("overview");
  const [executiveTab, setExecutiveTab] = useState<FinanceBillingExecutiveTabId>("documents");
  const [nfeLocalFilter, setNfeLocalFilter] = useState<FinanceBillingNfeLocalFilter>("all");
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
  const abortNfeRef = useRef<AbortController | null>(null);
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
  const nfeQueryString = useMemo(
    () => buildFinanceBillingNfeQuery(appliedNfeFilters),
    [appliedNfeFilters]
  );

  const [data, setData] = useState<FinanceBillingDashboardPayload | null>(null);
  const [nfeList, setNfeList] = useState<FinanceBillingNfeListPayload | null>(null);
  const [comparison, setComparison] = useState<FinanceBillingComparisonPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingNfe, setLoadingNfe] = useState(false);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nfeError, setNfeError] = useState<string | null>(null);
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
      setError("Não foi possível carregar o faturamento. Tente novamente.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [queryString]);

  const loadNfeList = useCallback(async () => {
    abortNfeRef.current?.abort();
    const controller = new AbortController();
    abortNfeRef.current = controller;
    setLoadingNfe(true);
    setNfeError(null);
    try {
      const url = nfeQueryString
        ? `/api/finance/billing/nfes?${nfeQueryString}`
        : "/api/finance/billing/nfes";
      const payload = await fetchJsonOk<FinanceBillingNfeListPayload>(url, {
        signal: controller.signal,
        credentials: "include",
      });
      if (controller.signal.aborted) return;
      setNfeList(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setNfeError("Não foi possível listar NF-e sincronizadas.");
    } finally {
      if (!controller.signal.aborted) setLoadingNfe(false);
    }
  }, [nfeQueryString]);

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
      setComparison(null);
      setComparisonError("Não foi possível carregar o comparativo SalesOrder × NomusNfe.");
    } finally {
      if (!controller.signal.aborted) setLoadingComparison(false);
    }
  }, [appliedYear]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);
  useEffect(() => {
    void loadNfeList();
  }, [loadNfeList]);
  useEffect(() => {
    void loadComparison();
  }, [loadComparison]);

  const handleApplyFilters = () => {
    setAppliedYear(draftYear.trim());
    setAppliedDateBase(draftDateBase);
    setAppliedNfeFilters({ ...draftNfeFilters, year: draftYear.trim() });
    setNfeLocalFilter("all");
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
    setNfeLocalFilter("all");
  };

  const handleRefreshAll = () => {
    void loadDashboard();
    void loadNfeList();
    void loadComparison();
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
      setAuditError("Não foi possível carregar a auditoria do faturamento.");
    } finally {
      if (!controller.signal.aborted) setLoadingAudit(false);
    }
  }, [auditQueryString]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

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
  const yearSummary = tab?.multiYearSummary.find((s) => s.year === data?.selectedYear);
  const appliedMonthNum = appliedNfeFilters.month
    ? Number.parseInt(appliedNfeFilters.month, 10)
    : null;
  const summaryCard = (id: string) => tab?.summaryCards.find((c) => c.id === id);

  const kpiCards = [
    {
      icon: Wallet,
      label: "Faturamento líquido",
      value: loading ? "…" : formatExecutiveCompactCurrency(tab?.target.actual),
      subtitle: tab?.periodLabel ?? "—",
      helperText: "NF-e autorizada mercado · valor líquido · data base aplicada",
      tone: "info" as const,
    },
    {
      icon: TrendingUp,
      label: "Bruto encontrado",
      value: loading
        ? "…"
        : formatExecutiveCompactCurrency(audit?.summary.grossFoundTotal ?? null),
      subtitle: "Auditoria fiscal",
      helperText: "Total bruto antes das regras de exclusão",
      tone: "neutral" as const,
    },
    {
      icon: Target,
      label: "NF-e no mês",
      value: loading
        ? "…"
        : (summaryCard("billing-count-month")?.formatted ??
          formatExecutiveInteger(summaryCard("billing-count-month")?.value)),
      subtitle: "Autorizadas no período",
      helperText: "Contagem de notas incluídas no mês filtrado",
      tone: "neutral" as const,
    },
    {
      icon: Wallet,
      label: "Ticket médio",
      value: loading ? "…" : summaryCard("billing-ticket")?.formatted ?? "—",
      subtitle: "Líquido ÷ quantidade",
      helperText: "Média por NF-e no mês de referência",
      tone: "neutral" as const,
    },
    {
      icon: TrendingUp,
      label: "Mês anterior",
      value: loading ? "…" : formatExecutiveCompactCurrency(tab?.target.previousPeriod),
      subtitle: tab?.target.formatted.previousPeriod ?? "—",
      helperText: "Mesmo mês do ano anterior (NF-e)",
      tone: "neutral" as const,
    },
    {
      icon: TrendingUp,
      label: "Ano anterior",
      value: loading ? "…" : tab?.yearComparison.formatted.yearToDatePrevious ?? "—",
      subtitle: `YTD ${data?.previousYear ?? ""}`,
      helperText: FINANCE_BILLING_YTD_SCOPE,
      tone: "neutral" as const,
    },
    {
      icon: Wallet,
      label: "Acumulado YTD",
      value: loading ? "…" : formatExecutiveCompactCurrency(yearSummary?.ytdTotal),
      subtitle: "Ano selecionado",
      helperText: FINANCE_BILLING_YTD_SCOPE,
      tone: "info" as const,
    },
    {
      icon: Target,
      label: "Previsto no mês",
      value: loading
        ? "…"
        : tab?.forecast?.formatted.monthForecastAmount ??
          tab?.projection.formatted.projectedMonth ??
          "—",
      subtitle: "Carteira / projeção",
      helperText: FINANCE_BILLING_PROJECTION_SCOPE,
      tone: "warning" as const,
    },
  ];

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

  return (
    <FinanceBiDashboardShell>
      <FinanceBiExecutiveHeader
        eyebrow="Financeiro · Faturamento"
        title="Faturamento"
        subtitle="Receita fiscal e operacional por NF-e autorizada. SalesOrder aparece apenas em comparativos e auditoria."
        filterStatus={filterStatus}
        meta={[
          { label: "Período", value: data?.periodLabel ?? (loading ? "…" : "—") },
          {
            label: "Último faturamento",
            value: data?.lastInvoicedAt
              ? formatFinanceDateTime(data.lastInvoicedAt)
              : loading
                ? "…"
                : "—",
          },
          {
            label: "Atualizado",
            value: data ? formatFinanceDateTime(data.generatedAt) : loading ? "…" : "—",
          },
        ]}
        actions={[
          {
            id: "refresh",
            label: "Atualizar",
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
            id: "audit",
            label: "Auditar base do faturamento",
            onClick: () => {
              setExecutiveTab("audit");
              void loadAudit();
            },
            disabled: loadingAudit,
            loading: loadingAudit,
            icon: loadingAudit ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Target className="h-3.5 w-3.5" />
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
      >
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <FinanceBillingSourceBadge source="nfe" />
          <FinanceBillingSourceBadge variant="diagnostic" />
        </div>
      </FinanceBiExecutiveHeader>

      <FinanceBillingNfeSyncPanel
        canRun={canRunSync}
        onSyncFinished={() => {
          void loadDashboard();
          void loadNfeList();
          void loadComparison();
        }}
      />

      <p className="text-[11px] text-muted-foreground">{FINANCE_SYNC_GLOBAL_SCOPE}</p>

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
        title="Filtros principais"
        expanded={showAdvancedFilters}
        onToggle={() => setShowAdvancedFilters((v) => !v)}
        filterStatus={filterStatus}
        chips={appliedFilterChips}
        onApply={handleApplyFilters}
        onClear={handleClearFilters}
        applyDisabled={!hasPendingFilterChanges || loading}
        hint={FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE}
        alwaysVisible={
          <div className="space-y-4">
            <p className="text-[11px] text-[#6B7280]">
              Fonte padrão: <span className="font-semibold text-[#111827]">NF-e fiscal</span>.
              Comparativo SalesOrder na aba Comparativos.
            </p>
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
            <FilterField label="Cliente / CNPJ">
              <input
                value={draftNfeFilters.customerCnpj}
                onChange={(e) =>
                  setDraftNfeFilters((p) => ({ ...p, customerCnpj: e.target.value }))
                }
                placeholder="CNPJ ou parte"
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

      <section className={financeBiSectionClass}>
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <h2 className="text-sm font-bold text-[#111827]">Resumo executivo</h2>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            Painel NF-e fiscal — ano {appliedYear}. Comparativo {comparisonLabel}. Meses futuros
            exibem null, não zero falso.
          </p>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-4">
          {kpiCards.map((card) => (
            <div key={card.label} className="min-w-0">
              <FinanceKpiCard
                icon={card.icon}
                label={card.label}
                value={String(card.value)}
                subtitle={card.subtitle}
                helperText={card.helperText}
                tone={card.tone}
                loading={loading}
              />
            </div>
          ))}
        </div>
      </section>

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

      <section className={financeBiSectionClass}>
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <h2 className="text-sm font-bold text-[#111827]">Detalhamento</h2>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            Grid explicativo dos cards — filtros globais aplicados afetam export e listagens.
          </p>
        </div>
        <div className="px-5 pt-4">
          <FinanceDetailTabs
            tabs={FINANCE_BILLING_EXECUTIVE_TABS}
            activeId={executiveTab}
            onChange={setExecutiveTab}
          />
        </div>
        <div className="p-5" role="tabpanel">
          {executiveTab === "documents" ? (
            <FinanceBillingNfeDetailsTable
              nfeList={nfeList}
              loading={loadingNfe}
              error={nfeError}
              onRetry={() => void loadNfeList()}
              localFilter={nfeLocalFilter}
              onLocalFilterChange={(v) => setNfeLocalFilter(parseFinanceBillingNfeLocalFilter(v))}
              appliedYear={Number.parseInt(appliedYear, 10) || new Date().getFullYear()}
              appliedMonth={appliedMonthNum}
            />
          ) : null}
          {executiveTab === "customers" ? (
            <FinanceBillingCustomersTab
              rows={tab?.topCustomers ?? []}
              loading={loading}
              yearLabel={appliedYear}
            />
          ) : null}
          {executiveTab === "comparison" ? (
            <FinanceBillingComparisonPanel
              comparison={comparison}
              loading={loadingComparison}
              error={comparisonError}
              onRetry={() => void loadComparison()}
            />
          ) : null}
          {executiveTab === "audit" ? (
            <FinanceBillingAuditPanel
              audit={audit}
              loading={loadingAudit}
              error={auditError}
              onRetry={() => void loadAudit()}
            />
          ) : null}
        </div>
      </section>
    </FinanceBiDashboardShell>
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
