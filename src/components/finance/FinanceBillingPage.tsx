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
  FINANCE_BILLING_TABS,
  hasPendingFinanceBillingYearChange,
  type FinanceBillingDashboardPayload,
  type FinanceBillingTabId,
} from "@/src/lib/financeBillingDashboardTypes";
import {
  buildFinanceBillingDashboardQuery,
  FINANCE_BILLING_SOURCE_DEFAULT,
  financeBillingSourceLabel,
  type FinanceBillingDateBase,
  type FinanceBillingSource,
} from "@/src/lib/financeBillingSourceTypes";
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
  formatExecutivePercent,
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
import {
  buildBillingAuditQueryString,
  parseBillingAuditFilters,
} from "@/src/lib/financeBillingAuditFilters";
import type { BillingAuditResult } from "@/src/lib/financeBillingAuditTypes";
import { financeBillingAuditExportFilename } from "@/src/lib/financeBillingAuditExport";
import { cn } from "@/src/lib/utils";
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
import { FinanceBiKpiCard } from "@/src/components/finance/bi/FinanceBiKpiCard";
import { buildFinanceBillingFilterChips } from "@/src/lib/financeBiFilterChips";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import { financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceFilterScopeBanner } from "@/src/components/finance/FinanceFilterScopeBanner";

export function FinanceBillingPage() {
  const auth = useAuth();
  const canRunSync = canRunFinanceBillingNfeSync(auth);
  const defaultYear = createDefaultFinanceBillingYear();

  const [activeTab, setActiveTab] = useState<FinanceBillingTabId>("overview");
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
  const [draftBillingSource, setDraftBillingSource] = useState<FinanceBillingSource>(
    FINANCE_BILLING_SOURCE_DEFAULT
  );
  const [appliedBillingSource, setAppliedBillingSource] = useState<FinanceBillingSource>(
    FINANCE_BILLING_SOURCE_DEFAULT
  );
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
      draftBillingSource !== appliedBillingSource ||
      draftDateBase !== appliedDateBase ||
      hasPendingFinanceBillingNfeFilterChanges(draftNfeFilters, appliedNfeFilters),
    [
      draftYear,
      appliedYear,
      draftBillingSource,
      appliedBillingSource,
      draftDateBase,
      appliedDateBase,
      draftNfeFilters,
      appliedNfeFilters,
    ]
  );

  const queryString = useMemo(
    () =>
      buildFinanceBillingDashboardQuery(appliedYear, {
        billingSource: appliedBillingSource,
        dateBase: appliedDateBase,
      }),
    [appliedYear, appliedBillingSource, appliedDateBase]
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
    setAppliedBillingSource(draftBillingSource);
    setAppliedDateBase(draftDateBase);
    setAppliedNfeFilters({ ...draftNfeFilters, year: draftYear.trim() });
  };

  const handleClearFilters = () => {
    const year = createDefaultFinanceBillingYear();
    setDraftYear(year);
    setAppliedYear(year);
    setDraftBillingSource(FINANCE_BILLING_SOURCE_DEFAULT);
    setAppliedBillingSource(FINANCE_BILLING_SOURCE_DEFAULT);
    setDraftDateBase("emissao");
    setAppliedDateBase("emissao");
    const defaults = createDefaultFinanceBillingNfeFilters(year);
    setDraftNfeFilters(defaults);
    setAppliedNfeFilters(defaults);
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
    params.set("billingSource", appliedBillingSource);
    params.set("dateBase", appliedDateBase);
    return params.toString();
  }, [appliedYear, appliedNfeFilters, appliedBillingSource, appliedDateBase]);

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
  const billingSource = data?.billingSource ?? appliedBillingSource;
  const isNfeSource = billingSource === "nfe";
  const pageTitle = financeBillingSourceLabel(billingSource);
  const yearSummary = tab?.multiYearSummary.find((s) => s.year === data?.selectedYear);
  const monthCardLabel = isNfeSource ? "Mês atual — NF-e fiscal" : "Mês atual — Pedidos";
  const yearCardLabel = isNfeSource
    ? `Faturamento ${appliedYear} — NF-e`
    : `Faturamento ${appliedYear} — Pedidos`;

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
        eyebrow="Financeiro · Mercado"
        title={pageTitle}
        subtitle={
          <>
            Fonte do dashboard:{" "}
            <span className="font-semibold text-[#111827]">
              {isNfeSource ? "NF-e fiscal (NomusNfe)" : "Pedidos de venda (SalesOrder)"}
            </span>
            . Comparativo {comparisonLabel}. Use a aba Composição / Auditoria para NF-e × pedidos.
          </>
        }
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
              setActiveTab("audit");
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
          <FinanceBillingSourceBadge source={billingSource} />
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
            <div>
              <span className="text-[10px] font-bold uppercase text-muted-foreground">
                Fonte do faturamento
              </span>
              <div className="mt-1 flex flex-wrap gap-2">
                {(
                  [
                    ["nfe", "Fiscal NF-e"],
                    ["sales_order", "Pedidos de venda"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setDraftBillingSource(id)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                      draftBillingSource === id
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "border border-[#E5E7EB] bg-white text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <FilterField label="Data base (NF-e)">
              <select
                value={draftDateBase}
                onChange={(e) =>
                  setDraftDateBase(e.target.value as FinanceBillingDateBase)
                }
                disabled={draftBillingSource !== "nfe"}
                className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-sm disabled:opacity-50"
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
            {isNfeSource
              ? `Painel NF-e fiscal — ano ${appliedYear}. Alinhado ao BI fiscal.`
              : `Painel pedidos de venda — ano ${appliedYear}. Pode divergir do BI fiscal.`}
          </p>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <FinanceBiKpiCard
            icon={Wallet}
            label={yearCardLabel}
            value={loading ? "…" : formatExecutiveCompactCurrency(yearSummary?.yearTotal)}
            sub="Total anual mercado"
            hint={isNfeSource ? "Σ mensal NF-e autorizada mercado" : "Σ mensal SalesOrder"}
            colorClass="text-[#059669]"
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={TrendingUp}
            label={monthCardLabel}
            value={loading ? "…" : formatExecutiveCompactCurrency(tab?.target.actual)}
            sub={tab?.periodLabel}
            hint={isNfeSource ? "Valor líquido NF-e no mês" : "SalesOrder.totalNetValue no mês"}
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={Target}
            label="Meta (+30%)"
            value={loading ? "…" : formatExecutiveCompactCurrency(tab?.target.target)}
            sub={`Base: ${tab?.target.formatted.previousPeriod ?? "—"}`}
            hint="Mês anterior × 1,3"
            loading={loading}
          />
          <FinanceBiKpiCard
            label="% Atingimento"
            value={loading ? "…" : formatExecutivePercent(tab?.target.achievementPercent, 1)}
            sub={`Gap: ${tab?.target.formatted.gap ?? "—"}`}
            hint="Realizado ÷ meta × 100"
            loading={loading}
          />
          <FinanceBiKpiCard
            label="Acumulado YTD"
            value={loading ? "…" : formatExecutiveCompactCurrency(yearSummary?.ytdTotal)}
            scopeNote={FINANCE_BILLING_YTD_SCOPE}
            hint="Σ até mês de referência no ano"
            loading={loading}
          />
          <FinanceBiKpiCard
            label="Projeção anual"
            value={loading ? "…" : formatExecutiveCompactCurrency(tab?.projection.projectedYear)}
            scopeNote={FINANCE_BILLING_PROJECTION_SCOPE}
            hint="Média diária YTD × dias úteis restantes"
            loading={loading}
          />
        </div>
      </section>

      <div className={financeBiSectionClass}>
        <nav className="flex flex-wrap gap-1 p-2 border-b border-border/50 bg-background/30">
          {FINANCE_BILLING_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="p-5" role="tabpanel">
          {loading && !data ? <FinanceApLoadingBlock label="faturamento" /> : null}

          {activeTab === "overview" ? (
            <FinanceBillingOverviewView data={data} loading={loading} />
          ) : null}
          {activeTab === "accumulated" ? (
            <FinanceBillingAccumulatedView data={data} loading={loading} />
          ) : null}
          {activeTab === "monthly" ? (
            <FinanceBillingMonthlyView data={data} loading={loading} />
          ) : null}
          {activeTab === "projection" ? (
            <FinanceBillingProjectionView data={data} loading={loading} />
          ) : null}
          {activeTab === "forecast" ? (
            <FinanceBillingForecastView data={data} loading={loading} />
          ) : null}
          {activeTab === "nfe-details" ? (
            <FinanceBillingNfeDetailsTable
              nfeList={nfeList}
              loading={loadingNfe}
              error={nfeError}
              onRetry={() => void loadNfeList()}
            />
          ) : null}
          {activeTab === "comparison" ? (
            <FinanceBillingComparisonPanel
              comparison={comparison}
              loading={loadingComparison}
              error={comparisonError}
              onRetry={() => void loadComparison()}
            />
          ) : null}
          {activeTab === "audit" ? (
            <FinanceBillingAuditPanel
              audit={audit}
              loading={loadingAudit}
              error={auditError}
              onRetry={() => void loadAudit()}
            />
          ) : null}
        </div>
      </div>
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
