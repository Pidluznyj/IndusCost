import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Filter,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import {
  buildFinanceArDashboardQuery,
  buildFinanceArExportQuery,
  buildFinanceArYearOptions,
  EMPTY_FINANCE_AR_UI_FILTERS,
  FINANCE_AR_INVOICE_ISSUED_OPTIONS,
  FINANCE_AR_MONTH_OPTIONS,
  FINANCE_AR_STATUS_OPTIONS,
  FINANCE_AR_TABS,
  normalizeFinanceArUiFilters,
  type FinanceArCriticalTitle,
  type FinanceArDashboardPayload,
  type FinanceArDataQualityAlertItem,
  type FinanceArDataQualityAlertKey,
  type FinanceArTabId,
  type FinanceArUiFilters,
} from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  displayFinanceText,
  financeArExportFilename,
  formatFinanceCalculatedStatus,
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceDaysOverdue,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  canExportFinanceAccountsReceivable,
  canRunFinanceAccountsReceivableSync,
} from "@/src/lib/financeAccountsReceivablePermissions";
import {
  FinanceArAgingTab,
  FinanceArCompaniesTab,
  FinanceArCustomersTab,
  FinanceArPaymentTab,
  FinanceArScheduleTab,
  statusBadgeClass,
} from "@/src/components/finance/FinanceAccountsReceivableTabPanels";
import { FinanceAccountsReceivableDataQualityPanel } from "@/src/components/finance/FinanceAccountsReceivableDataQualityPanel";
import { FinanceArInvoicePortfolioPanel } from "@/src/components/finance/FinanceAccountsReceivableInvoicePortfolioPanel";
import { FinanceAccountsReceivableSyncPanel } from "@/src/components/finance/FinanceAccountsReceivableSyncPanel";
import { FinanceArTitlesTab } from "@/src/components/finance/FinanceAccountsReceivableTitlesTab";
import {
  FinanceArAgingChart,
  FinanceArTopDebtorsChart,
} from "@/src/components/finance/FinanceAccountsReceivableCharts";
import {
  FinanceArErrorBanner,
  FinanceArLoadingBlock,
  FinanceArSuccessBanner,
  FinanceArTabNav,
} from "@/src/components/finance/FinanceAccountsReceivableUiShared";
import { cn } from "@/src/lib/utils";
import {
  FinanceFilterScopeBanner,
  FinanceManagementSanitizationNote,
} from "@/src/components/finance/FinanceFilterScopeBanner";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceBiExecutiveHeader } from "@/src/components/finance/bi/FinanceBiExecutiveHeader";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import { FinanceBiKpiCard } from "@/src/components/finance/bi/FinanceBiKpiCard";
import { buildFinanceArFilterChips } from "@/src/lib/financeBiFilterChips";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import {
  FINANCE_AR_LAST_SYNC_FILTERED_SCOPE,
  FINANCE_AR_RECEIVED_THIS_MONTH_SCOPE,
  withAppliedFilterSub,
} from "@/src/lib/financeFilterScope";
import { financeBiCardClass, financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";

/* ─────────────────────────────────────────────────────────────────
   ACTION CENTER — deriva de criticalTitles + dataQualitySummary
   ───────────────────────────────────────────────────────────────── */
type ActionItem = {
  id: string;
  type: "high-risk" | "collection" | "suspended" | "quality" | "due-soon";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  value?: string;
  meta?: string;
};

function buildActionItems(
  criticalTitles: FinanceArCriticalTitle[],
  qualityAlerts: FinanceArDataQualityAlertItem[]
): ActionItem[] {
  const items: ActionItem[] = [];

  const highRisk = criticalTitles.filter((t) => t.daysOverdue > 60 && t.balanceReceivable > 0);
  if (highRisk.length > 0) {
    const top = highRisk[0];
    items.push({
      id: "high-risk",
      type: "high-risk",
      severity: "critical",
      title: `${highRisk.length} título${highRisk.length > 1 ? "s" : ""} com alto risco (>60 dias)`,
      description: `Maior exposição: ${displayFinanceText(top.personName)} — ${formatFinanceCurrency(top.balanceReceivable)}`,
      value: formatFinanceCurrencyCompact(highRisk.reduce((s, t) => s + t.balanceReceivable, 0)),
      meta: `Mais antigo: ${top.daysOverdue} dias em atraso`,
    });
  }

  const suspended = criticalTitles.filter((t) => t.suspendCollection && t.balanceReceivable > 0);
  if (suspended.length > 0) {
    items.push({
      id: "suspended",
      type: "suspended",
      severity: "warning",
      title: `${suspended.length} título${suspended.length > 1 ? "s" : ""} com cobrança suspensa`,
      description: suspended.slice(0, 2).map((t) => displayFinanceText(t.personName)).join(", "),
      value: formatFinanceCurrencyCompact(suspended.reduce((s, t) => s + t.balanceReceivable, 0)),
    });
  }

  const collection = criticalTitles.filter(
    (t) => t.daysOverdue >= 1 && t.daysOverdue <= 60 && !t.suspendCollection && t.balanceReceivable > 0
  );
  if (collection.length > 0) {
    const top = collection[0];
    items.push({
      id: "collection",
      type: "collection",
      severity: "warning",
      title: `${collection.length} título${collection.length > 1 ? "s" : ""} para cobrança`,
      description: `Maior: ${displayFinanceText(top.personName)} — ${formatFinanceCurrency(top.balanceReceivable)}`,
      value: formatFinanceCurrencyCompact(collection.reduce((s, t) => s + t.balanceReceivable, 0)),
      meta: `Vencimento mais antigo: ${formatFinanceDate(collection[collection.length - 1].dueDate)}`,
    });
  }

  const dueSoon = criticalTitles.filter((t) => t.calculatedStatus === "dueToday");
  if (dueSoon.length > 0) {
    items.push({
      id: "due-today",
      type: "due-soon",
      severity: "info",
      title: `${dueSoon.length} título${dueSoon.length > 1 ? "s" : ""} vencem hoje`,
      description: dueSoon.slice(0, 2).map((t) => displayFinanceText(t.personName)).join(", "),
      value: formatFinanceCurrencyCompact(dueSoon.reduce((s, t) => s + t.balanceReceivable, 0)),
    });
  }

  const criticalQuality = qualityAlerts.filter((a) => a.severity === "critical" && a.count > 0);
  for (const alert of criticalQuality.slice(0, 2)) {
    items.push({
      id: `quality-${alert.key}`,
      type: "quality",
      severity: "critical",
      title: `Anomalia: ${alert.label}`,
      description: `${alert.count} título${alert.count > 1 ? "s" : ""} afetado${alert.count > 1 ? "s" : ""}`,
      value: alert.amount != null ? formatFinanceCurrencyCompact(alert.amount) : undefined,
    });
  }

  return items;
}

function severityStyles(severity: ActionItem["severity"]) {
  if (severity === "critical") {
    return {
      border: "border-l-4 border-l-red-500",
      bg: "bg-white dark:bg-card",
      icon: "text-red-500",
      badge: "bg-red-100 text-red-800",
    };
  }
  if (severity === "warning") {
    return {
      border: "border-l-4 border-l-amber-400",
      bg: "bg-white dark:bg-card",
      icon: "text-amber-500",
      badge: "bg-amber-100 text-amber-800",
    };
  }
  return {
    border: "border-l-4 border-l-blue-400",
    bg: "bg-white dark:bg-card",
    icon: "text-blue-500",
    badge: "bg-blue-100 text-blue-800",
  };
}

function ActionIcon({ type }: { type: ActionItem["type"] }) {
  if (type === "high-risk") return <ShieldAlert className="h-4 w-4" />;
  if (type === "suspended") return <Clock className="h-4 w-4" />;
  if (type === "quality") return <AlertTriangle className="h-4 w-4" />;
  if (type === "due-soon") return <Clock className="h-4 w-4" />;
  return <TrendingDown className="h-4 w-4" />;
}

function FinanceArActionCenter({
  criticalTitles,
  qualityAlerts,
  loading,
}: {
  criticalTitles: FinanceArCriticalTitle[];
  qualityAlerts: FinanceArDataQualityAlertItem[];
  loading: boolean;
}) {
  const items = useMemo(
    () => buildActionItems(criticalTitles, qualityAlerts),
    [criticalTitles, qualityAlerts]
  );

  return (
    <div className={`${financeBiCardClass} flex flex-col`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
        <div>
          <h3 className="text-sm font-bold text-[#111827]">Centro de Ações</h3>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            Alertas priorizados por risco — filtros aplicados
          </p>
        </div>
        {items.length > 0 ? (
          <span className="h-6 min-w-[1.5rem] rounded-full bg-red-500 text-white text-[10px] font-bold px-2 flex items-center justify-center">
            {items.length}
          </span>
        ) : null}
      </div>
      <div className="flex-1 divide-y divide-border/40 overflow-auto max-h-[400px]">
        {loading ? (
          <div className="p-5 flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Carregando ações…</span>
          </div>
        ) : items.length === 0 ? (
          <div className="p-6 flex flex-col items-center gap-2 text-center">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
            <p className="text-sm font-semibold text-foreground">
              Nenhuma ação crítica no momento.
            </p>
            <p className="text-[11px] text-muted-foreground">
              Carteira sem alertas com os filtros atuais.
            </p>
          </div>
        ) : (
          items.map((item) => {
            const styles = severityStyles(item.severity);
            return (
              <div
                key={item.id}
                className={cn(
                  "px-4 py-3 flex items-start gap-3",
                  styles.border,
                  styles.bg
                )}
              >
                <span className={cn("mt-0.5 shrink-0", styles.icon)}>
                  <ActionIcon type={item.type} />
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-xs font-bold text-foreground leading-snug">{item.title}</p>
                  <p className="text-[11px] text-muted-foreground leading-snug truncate">
                    {item.description}
                  </p>
                  {item.meta ? (
                    <p className="text-[10px] text-muted-foreground">{item.meta}</p>
                  ) : null}
                </div>
                {item.value ? (
                  <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold", styles.badge)}>
                    {item.value}
                  </span>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   EXECUTIVE TITLES TABLE — top critical titles
   ───────────────────────────────────────────────────────────────── */
function FinanceArHighlightTable({
  rows,
  loading,
  onViewAll,
}: {
  rows: FinanceArCriticalTitle[];
  loading: boolean;
  onViewAll: () => void;
}) {
  const top = rows.slice(0, 8);

  return (
    <div className={`${financeBiCardClass} flex flex-col`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
        <div>
          <h3 className="text-sm font-bold text-[#111827]">Títulos Críticos</h3>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            Top 8 por antiguidade e saldo — mesmo universo dos filtros aplicados
          </p>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="text-[11px] font-semibold text-[#2563EB] hover:underline"
        >
          Ver todos →
        </button>
      </div>
      {loading && rows.length === 0 ? (
        <div className="p-5 flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Carregando títulos…</span>
        </div>
      ) : top.length === 0 ? (
        <div className="p-6 text-center">
          <CheckCircle2 className="h-7 w-7 text-green-500 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            Nenhum título em aberto com os filtros atuais.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-left">
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Cliente
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-right">
                  Saldo
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Vencimento
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground text-right">
                  Atraso
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {top.map((t) => (
                <tr
                  key={t.externalId}
                  className={cn(
                    "hover:bg-muted/30 transition-colors",
                    t.daysOverdue > 60 ? "bg-red-50/40 dark:bg-red-950/10" : ""
                  )}
                >
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-foreground truncate max-w-[200px]">
                      {displayFinanceText(t.personName)}
                    </p>
                    {t.sourceInvoiceNumber ? (
                      <p className="text-[10px] text-muted-foreground">
                        NF {t.sourceInvoiceNumber}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-foreground">
                    {formatFinanceCurrency(t.balanceReceivable)}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
                    {formatFinanceDate(t.dueDate)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {t.daysOverdue > 0 ? (
                      <span
                        className={cn(
                          "font-bold",
                          t.daysOverdue > 60
                            ? "text-red-600"
                            : t.daysOverdue > 30
                              ? "text-orange-500"
                              : "text-amber-500"
                        )}
                      >
                        {formatFinanceDaysOverdue(t.daysOverdue)} dias
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold",
                        statusBadgeClass(t.calculatedStatus)
                      )}
                    >
                      {formatFinanceCalculatedStatus(t.calculatedStatus)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   MAIN PAGE
   ───────────────────────────────────────────────────────────────── */
export function FinanceAccountsReceivablePage() {
  const auth = useAuth();
  const canExport = canExportFinanceAccountsReceivable(auth);
  const canRunSync = canRunFinanceAccountsReceivableSync(auth);

  const [activeTab, setActiveTab] = useState<FinanceArTabId>("overview");
  const [titlesQualityAlert, setTitlesQualityAlert] = useState<FinanceArDataQualityAlertKey | null>(null);
  const [draftFilters, setDraftFilters] = useState<FinanceArUiFilters>(EMPTY_FINANCE_AR_UI_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FinanceArUiFilters>(() =>
    normalizeFinanceArUiFilters(EMPTY_FINANCE_AR_UI_FILTERS)
  );
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const normalizedDraftFilters = useMemo(
    () => normalizeFinanceArUiFilters(draftFilters),
    [draftFilters]
  );

  const hasPendingFilterChanges = useMemo(
    () =>
      buildFinanceArDashboardQuery(normalizedDraftFilters) !==
      buildFinanceArDashboardQuery(appliedFilters),
    [normalizedDraftFilters, appliedFilters]
  );

  const yearOptions = useMemo(() => buildFinanceArYearOptions(), []);
  const queryString = useMemo(() => buildFinanceArDashboardQuery(appliedFilters), [appliedFilters]);

  const [data, setData] = useState<FinanceArDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setDashboardError(null);
    try {
      const url = queryString
        ? `/api/finance/accounts-receivable/dashboard?${queryString}`
        : "/api/finance/accounts-receivable/dashboard";
      const payload = await fetchJsonOk<FinanceArDashboardPayload>(url);
      setData(payload);
    } catch (e) {
      setDashboardError(
        e instanceof Error
          ? e.message
          : "Não foi possível carregar o dashboard. Tente atualizar em instantes."
      );
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleExport = async () => {
    if (!canExport) return;
    setExporting(true);
    setExportError(null);
    setExportSuccess(null);
    try {
      const qs = buildFinanceArExportQuery(appliedFilters);
      const res = await fetch(`/api/finance/accounts-receivable/export?${qs}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Falha ao exportar CSV.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = financeArExportFilename();
      a.click();
      URL.revokeObjectURL(url);
      setExportSuccess(`Arquivo ${financeArExportFilename()} gerado com os filtros atuais.`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Erro ao exportar CSV.");
    } finally {
      setExporting(false);
    }
  };

  const handleViewTitlesFromAlert = (key: FinanceArDataQualityAlertKey) => {
    setTitlesQualityAlert(key);
    setActiveTab("titles");
  };

  const handleApplyFilters = () => setAppliedFilters(normalizedDraftFilters);

  const handleClearFilters = () => {
    const empty = normalizeFinanceArUiFilters(EMPTY_FINANCE_AR_UI_FILTERS);
    setDraftFilters(EMPTY_FINANCE_AR_UI_FILTERS);
    setAppliedFilters(empty);
    setTitlesQualityAlert(null);
  };

  const handleFilterInvoiceIssued = (value: "all" | "yes" | "no") => {
    const nextDraft = { ...draftFilters, invoiceIssued: value };
    setDraftFilters(nextDraft);
    setAppliedFilters(normalizeFinanceArUiFilters(nextDraft));
  };

  const cards = data?.cards;
  const filtersActive =
    appliedFilters.companyName ||
    appliedFilters.personName ||
    appliedFilters.personCnpj ||
    appliedFilters.status !== "all" ||
    appliedFilters.year ||
    appliedFilters.month ||
    appliedFilters.dueDateFrom ||
    appliedFilters.dueDateTo ||
    appliedFilters.invoiceIssued !== "all" ||
    appliedFilters.paymentMethodName ||
    appliedFilters.bankAccountName;

  const filterStatus = useMemo(
    () => resolveFinanceBiFilterStatus(Boolean(filtersActive), hasPendingFilterChanges),
    [filtersActive, hasPendingFilterChanges]
  );

  const handleRemoveFilterChip = useCallback((field: keyof FinanceArUiFilters) => {
    const next: FinanceArUiFilters = { ...appliedFilters };
    if (field === "status" || field === "invoiceIssued") next[field] = "all";
    else next[field] = "";
    const normalized = normalizeFinanceArUiFilters(next);
    setDraftFilters(normalized);
    setAppliedFilters(normalized);
  }, [appliedFilters]);

  const appliedFilterChips = useMemo(
    () => buildFinanceArFilterChips(appliedFilters, handleRemoveFilterChip),
    [appliedFilters, handleRemoveFilterChip]
  );

  /* ── delinquency trend label */
  const delinquencyTrend: "up" | "down" | "neutral" =
    cards?.delinquencyRate != null
      ? cards.delinquencyRate > 15
        ? "up"
        : cards.delinquencyRate < 5
          ? "down"
          : "neutral"
      : "neutral";

  return (
    <FinanceBiDashboardShell>
      <FinanceBiExecutiveHeader
        eyebrow="Financeiro · Carteira de Recebíveis"
        title="Contas a Receber"
        subtitle={
          <>
            Fonte oficial: <span className="font-semibold text-[#111827]">NomusAccountsReceivable</span>
            .{" "}
            {cards?.totalRecords != null ? (
              <span className="font-semibold text-[#111827]">
                {formatFinanceInteger(cards.totalRecords)} registros no universo filtrado.
              </span>
            ) : null}
          </>
        }
        filterStatus={filterStatus}
        meta={[
          {
            label: "Última sync",
            value: formatFinanceDateTime(cards?.lastSyncAt),
            hint: FINANCE_AR_LAST_SYNC_FILTERED_SCOPE,
          },
          {
            label: "Calculado em",
            value: data ? formatFinanceDateTime(data.generatedAt) : loading ? "…" : "—",
          },
        ]}
        actions={[
          {
            id: "refresh",
            label: "Atualizar",
            onClick: () => void loadDashboard(),
            disabled: loading,
            loading,
            icon: loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            ),
          },
          ...(canExport
            ? [
                {
                  id: "export",
                  label: "Exportar CSV",
                  onClick: () => void handleExport(),
                  disabled: exporting || loading,
                  loading: exporting,
                  variant: "accent" as const,
                  icon: exporting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  ),
                },
              ]
            : []),
        ]}
      />

      <FinanceAccountsReceivableSyncPanel
        canRun={canRunSync}
        onSyncFinished={() => void loadDashboard()}
      />

      {dashboardError ? (
        <FinanceArErrorBanner message={dashboardError} onDismiss={() => setDashboardError(null)} />
      ) : null}
      {exportError ? (
        <FinanceArErrorBanner message={exportError} onDismiss={() => setExportError(null)} />
      ) : null}
      {exportSuccess ? (
        <FinanceArSuccessBanner message={exportSuccess} onDismiss={() => setExportSuccess(null)} />
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
        alwaysVisible={
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <FilterSelect
              label="Ano vencimento"
              value={draftFilters.year}
              onChange={(v) => setDraftFilters((f) => ({ ...f, year: v }))}
              options={yearOptions}
            />
            <FilterSelect
              label="Mês vencimento"
              value={draftFilters.month}
              onChange={(v) =>
                setDraftFilters((f) => {
                  const next = { ...f, month: v };
                  if (v && !f.year.trim()) next.year = String(new Date().getFullYear());
                  return next;
                })
              }
              options={FINANCE_AR_MONTH_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <FilterSelect
              label="Status"
              value={draftFilters.status}
              onChange={(v) => setDraftFilters((f) => ({ ...f, status: v }))}
              options={FINANCE_AR_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <FilterInput
              label="Cliente"
              value={draftFilters.personName}
              onChange={(v) => setDraftFilters((f) => ({ ...f, personName: v }))}
            />
            <FilterInput
              label="CNPJ/CPF"
              value={draftFilters.personCnpj}
              onChange={(v) => setDraftFilters((f) => ({ ...f, personCnpj: v }))}
            />
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <FilterInput
            label="Empresa"
            value={draftFilters.companyName}
            onChange={(v) => setDraftFilters((f) => ({ ...f, companyName: v }))}
          />
          <FilterInput
            label="Vencimento de"
            type="date"
            value={draftFilters.dueDateFrom}
            onChange={(v) => setDraftFilters((f) => ({ ...f, dueDateFrom: v }))}
          />
          <FilterInput
            label="Vencimento até"
            type="date"
            value={draftFilters.dueDateTo}
            onChange={(v) => setDraftFilters((f) => ({ ...f, dueDateTo: v }))}
          />
          <FilterSelect
            label="NF emitida"
            value={draftFilters.invoiceIssued}
            onChange={(v) => setDraftFilters((f) => ({ ...f, invoiceIssued: v }))}
            options={FINANCE_AR_INVOICE_ISSUED_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
          />
          <FilterInput
            label="Forma de pagamento"
            value={draftFilters.paymentMethodName}
            onChange={(v) => setDraftFilters((f) => ({ ...f, paymentMethodName: v }))}
          />
          <FilterInput
            label="Conta bancária"
            value={draftFilters.bankAccountName}
            onChange={(v) => setDraftFilters((f) => ({ ...f, bankAccountName: v }))}
          />
        </div>
      </FinanceBiFilterPanel>

      <FinanceFilterScopeBanner active={Boolean(filtersActive)} />
      <FinanceManagementSanitizationNote dataSanitization={data?.dataSanitization} />

      {/* ─── RESUMO EXECUTIVO ─── */}
      <section className={financeBiSectionClass}>
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <h2 className="text-sm font-bold text-[#111827]">Resumo executivo</h2>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            KPIs principais da carteira — números refletem filtros aplicados, salvo exceções rotuladas
          </p>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <FinanceBiKpiCard
            icon={Wallet}
            label="Carteira em Aberto"
            value={loading ? "…" : formatFinanceCurrencyCompact(cards?.totalOpenAmount)}
            sub={withAppliedFilterSub(
              cards?.openTitlesCount != null
                ? `${formatFinanceInteger(cards.openTitlesCount)} título${cards.openTitlesCount !== 1 ? "s" : ""}`
                : undefined,
              Boolean(filtersActive)
            )}
            hint="Σ balanceReceivable onde saldo > 0"
            colorClass="text-[#2563EB]"
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={AlertTriangle}
            label="Vencido"
            value={loading ? "…" : formatFinanceCurrencyCompact(cards?.overdueAmount)}
            sub={withAppliedFilterSub("Vencimento anterior a hoje", Boolean(filtersActive))}
            hint="Σ saldo em aberto com status overdue"
            colorClass={
              (cards?.overdueAmount ?? 0) > 0 ? "text-[#DC2626]" : "text-[#111827]"
            }
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={ShieldAlert}
            label="Vencido > 30 Dias"
            value={loading ? "…" : formatFinanceCurrencyCompact(cards?.overdueOver30DaysAmount)}
            sub={withAppliedFilterSub(
              cards?.overdueOver30DaysCount != null
                ? `${formatFinanceInteger(cards.overdueOver30DaysCount)} título${cards.overdueOver30DaysCount !== 1 ? "s" : ""}`
                : undefined,
              Boolean(filtersActive)
            )}
            hint="Σ saldo vencido há mais de 30 dias"
            colorClass={
              (cards?.overdueOver30DaysAmount ?? 0) > 0 ? "text-[#DC2626]" : "text-[#111827]"
            }
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={TrendingUp}
            label="Recebido no Mês"
            value={loading ? "…" : formatFinanceCurrencyCompact(cards?.receivedThisMonthAmount)}
            sub="Baixas no mês corrente"
            scopeNote={FINANCE_AR_RECEIVED_THIS_MONTH_SCOPE}
            hint="Σ amountReceived com settlementDate no mês/ano de hoje"
            colorClass="text-[#059669]"
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={TrendingDown}
            label="% Inadimplência"
            value={loading ? "…" : formatFinancePercent(cards?.delinquencyRate)}
            sub={withAppliedFilterSub(
              cards?.overdueCustomersCount != null
                ? `${formatFinanceInteger(cards.overdueCustomersCount)} cliente${cards.overdueCustomersCount !== 1 ? "s" : ""} em atraso`
                : undefined,
              Boolean(filtersActive)
            )}
            hint="Vencido ÷ carteira em aberto × 100"
            trend={delinquencyTrend}
            trendLabel={
              cards?.delinquencyRate != null
                ? delinquencyTrend === "up"
                  ? "Alto risco"
                  : delinquencyTrend === "down"
                    ? "Controlado"
                    : "Atenção"
                : undefined
            }
            colorClass={
              (cards?.delinquencyRate ?? 0) > 15
                ? "text-[#DC2626]"
                : (cards?.delinquencyRate ?? 0) > 5
                  ? "text-[#D97706]"
                  : "text-[#059669]"
            }
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={Clock}
            label="Atraso Médio"
            value={
              loading
                ? "…"
                : cards?.avgDaysOverdue != null
                  ? `${cards.avgDaysOverdue} dias`
                  : "—"
            }
            sub={withAppliedFilterSub("Média ponderada por saldo vencido", Boolean(filtersActive))}
            hint="Σ (dias em atraso × saldo) ÷ Σ saldo vencido"
            colorClass={
              (cards?.avgDaysOverdue ?? 0) > 30 ? "text-[#DC2626]" : "text-[#111827]"
            }
            loading={loading}
          />
        </div>
      </section>

      {/* ─── CHARTS ─── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {loading && !data ? (
          <>
            <div className="rounded-2xl border border-border/70 bg-card h-[300px] animate-pulse" />
            <div className="rounded-2xl border border-border/70 bg-card h-[300px] animate-pulse" />
          </>
        ) : (
          <>
            <FinanceArAgingChart buckets={data?.agingBuckets ?? []} />
            <FinanceArTopDebtorsChart rows={data?.topDebtors ?? []} />
          </>
        )}
      </div>

      {/* ─── ACTION CENTER + HIGHLIGHT TABLE ─── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <FinanceArActionCenter
          criticalTitles={data?.criticalTitles ?? []}
          qualityAlerts={data?.dataQualitySummary ?? []}
          loading={loading && !data}
        />
        <FinanceArHighlightTable
          rows={data?.criticalTitles ?? []}
          loading={loading && !data}
          onViewAll={() => setActiveTab("titles")}
        />
      </div>

      {/* ─── INVOICE PORTFOLIO + DATA QUALITY ─── */}
      <FinanceArInvoicePortfolioPanel
        cards={cards}
        activeFilter={appliedFilters.invoiceIssued}
        loading={loading}
        onFilterInvoiceIssued={handleFilterInvoiceIssued}
      />

      {loading && !data ? (
        <FinanceArLoadingBlock label="alertas e indicadores" />
      ) : (
        <FinanceAccountsReceivableDataQualityPanel
          alerts={data?.dataQualitySummary ?? []}
          onViewTitles={handleViewTitlesFromAlert}
        />
      )}

      {/* ─── ANALYTICS TABS ─── */}
      <div className={`${financeBiSectionClass}`}>
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <h2 className="text-sm font-bold text-[#111827]">Análise detalhada</h2>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            Drill-down: aging, agenda, clientes, títulos e formas de pagamento
          </p>
        </div>
        <div className="p-5 space-y-4">
          <FinanceArTabNav
            tabs={FINANCE_AR_TABS}
            activeId={activeTab}
            onChange={(id) => setActiveTab(id as FinanceArTabId)}
          />
          <div role="tabpanel" aria-label={FINANCE_AR_TABS.find((t) => t.id === activeTab)?.label}>
            {activeTab === "overview" ? (
              <OverviewSummary data={data} loading={loading} />
            ) : null}
            {activeTab === "aging" ? (
              loading && !data ? (
                <FinanceArLoadingBlock label="aging" />
              ) : (
                <FinanceArAgingTab data={data} />
              )
            ) : null}
            {activeTab === "schedule" ? (
              loading && !data ? (
                <FinanceArLoadingBlock label="agenda" />
              ) : (
                <FinanceArScheduleTab data={data} />
              )
            ) : null}
            {activeTab === "customers" ? (
              loading && !data ? (
                <FinanceArLoadingBlock label="clientes" />
              ) : (
                <FinanceArCustomersTab data={data} />
              )
            ) : null}
            {activeTab === "titles" ? (
              <FinanceArTitlesTab
                filters={appliedFilters}
                qualityAlert={titlesQualityAlert}
                onClearQualityAlert={() => setTitlesQualityAlert(null)}
              />
            ) : null}
            {activeTab === "payment-methods" ? (
              loading && !data ? (
                <FinanceArLoadingBlock label="formas de pagamento" />
              ) : (
                <FinanceArPaymentTab data={data} />
              )
            ) : null}
            {activeTab === "companies" ? (
              loading && !data ? (
                <FinanceArLoadingBlock label="empresas" />
              ) : (
                <FinanceArCompaniesTab data={data} />
              )
            ) : null}
          </div>
        </div>
      </div>
    </FinanceBiDashboardShell>
  );
}

/* ─── Overview tab: compact summary of all key numbers ──────────── */
function OverviewSummary({
  data,
  loading,
}: {
  data: FinanceArDashboardPayload | null;
  loading: boolean;
}) {
  if (!data && loading) return <FinanceArLoadingBlock label="visão geral" />;
  if (!data) return <p className="text-sm text-muted-foreground">Sem dados para visão geral.</p>;
  const { cards } = data;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {[
        { label: "Em aberto", value: formatFinanceCurrencyCompact(cards.totalOpenAmount), hint: "balanceReceivable > 0" },
        { label: "Vencido", value: formatFinanceCurrencyCompact(cards.overdueAmount), hint: "Vencimento < hoje" },
        { label: "A vencer", value: formatFinanceCurrencyCompact(cards.upcomingAmount), hint: "Vencimento futuro" },
        { label: "Vence hoje", value: formatFinanceCurrencyCompact(cards.dueTodayAmount), hint: "Vencimento = hoje" },
        { label: "Próx. 7 dias", value: formatFinanceCurrencyCompact(cards.dueNext7DaysAmount), hint: "Hoje + 7 dias" },
        { label: "Próx. 30 dias", value: formatFinanceCurrencyCompact(cards.dueNext30DaysAmount), hint: "Hoje + 30 dias" },
        { label: "Recebido no mês", value: formatFinanceCurrencyCompact(cards.receivedThisMonthAmount), hint: "dataBaixa no mês corrente" },
        { label: "Inadimplência", value: formatFinancePercent(cards.delinquencyRate), hint: "Vencido ÷ aberto" },
        { label: "Títulos em aberto", value: formatFinanceInteger(cards.openTitlesCount), hint: "" },
        { label: "Clientes em atraso", value: formatFinanceInteger(cards.overdueCustomersCount), hint: "" },
        { label: "Em aberto com NF", value: formatFinanceCurrencyCompact(cards.openWithInvoiceAmount), hint: `${formatFinanceInteger(cards.openWithInvoiceCount)} títulos` },
        { label: "Em aberto pré-NF", value: formatFinanceCurrencyCompact(cards.openWithoutInvoiceAmount), hint: `${formatFinancePercent(cards.preInvoiceShareOfOpenPercent)} da carteira` },
      ].map((kpi) => (
        <div key={kpi.label} className="rounded-xl border border-border/50 bg-background/50 p-3 space-y-1" title={kpi.hint}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
          <p className="text-base font-extrabold tabular-nums text-foreground">{kpi.value}</p>
          {kpi.hint ? <p className="text-[10px] text-muted-foreground">{kpi.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}

/* ─── shared input helpers ──────────────────────────────────────── */
function FilterInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="space-y-1 block min-w-0">
      <span className="text-[10px] font-bold uppercase text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 rounded-xl border border-border bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="space-y-1 block min-w-0">
      <span className="text-[10px] font-bold uppercase text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 rounded-xl border border-border bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
