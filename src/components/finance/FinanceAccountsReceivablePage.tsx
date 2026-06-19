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
import { FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE } from "@/src/lib/financeAccountsReceivableManagement";
import {
  buildFinanceArDashboardQuery,
  buildFinanceArExportQuery,
  buildFinanceArYearOptions,
  createDefaultFinanceArUiFilters,
  isDefaultFinanceArUiFilters,
  FINANCE_AR_INVOICE_ISSUED_OPTIONS,
  FINANCE_AR_MONTH_OPTIONS,
  FINANCE_AR_STATUS_OPTIONS,
  FINANCE_AR_TABS,
  normalizeFinanceArUiFilters,
  type FinanceArCriticalTitle,
  type FinanceArDashboardPayload,
  type FinanceArDashboardCards,
  type FinanceArDataQualityAlertItem,
  type FinanceArDataQualityAlertKey,
  type FinanceArTabId,
  type FinanceArTopDebtor,
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
  FinanceArAuditTab,
  FinanceArCompaniesTab,
  FinanceArCustomersTab,
  FinanceArPaymentTab,
  FinanceArScheduleTab,
  statusBadgeClass,
} from "@/src/components/finance/FinanceAccountsReceivableTabPanels";
import { FinanceArInvoicePortfolioPanel } from "@/src/components/finance/FinanceAccountsReceivableInvoicePortfolioPanel";
import { FinanceAccountsReceivableSyncPanel } from "@/src/components/finance/FinanceAccountsReceivableSyncPanel";
import { FinanceArTitlesTab } from "@/src/components/finance/FinanceAccountsReceivableTitlesTab";
import { FinanceAccountsReceivableOverdueTab } from "@/src/components/finance/FinanceAccountsReceivableOverdueTab";
import {
  FinanceArAgingChart,
  FinanceArMonthlyScheduleChart,
  FinanceArPortfolioMixChart,
  FinanceArScheduleBucketsChart,
  FinanceArTopDebtorsChart,
} from "@/src/components/finance/FinanceAccountsReceivableCharts";
import { FinanceActionCenterShell } from "@/src/components/finance/shared/FinanceActionCenterShell";
import { FinanceDetailTabs } from "@/src/components/finance/shared/FinanceDetailTabs";
import {
  FinanceArErrorBanner,
  FinanceArLoadingBlock,
  FinanceArSuccessBanner,
} from "@/src/components/finance/FinanceAccountsReceivableUiShared";
import { cn } from "@/src/lib/utils";
import { FinanceFilterScopeNote } from "@/src/components/finance/FinanceFilterScopeBanner";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import { financePersonFieldsFromSelection } from "@/src/lib/customerSearch";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { FinanceDataAuditButton } from "@/src/components/finance/shared/FinanceDataAuditButton";
import { FinanceDataAuditDrawer } from "@/src/components/finance/shared/FinanceDataAuditDrawer";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import { FinanceBiKpiCard } from "@/src/components/finance/bi/FinanceBiKpiCard";
import { buildFinanceArFilterChips } from "@/src/lib/financeBiFilterChips";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import {
  FINANCE_AR_LAST_SYNC_FILTERED_SCOPE,
  withAppliedFilterSub,
} from "@/src/lib/financeFilterScope";
import {
  buildFinanceArApAuditSections,
  buildFinanceAuditItemsFromChips,
  countFinanceDataAuditWarnings,
} from "@/src/lib/financeDataAudit";
import {
  FINANCE_AR_EXECUTIVE_SUBTITLE,
  FINANCE_EXECUTIVE_FILTER_SCOPE_NOTE,
} from "@/src/lib/financeDataAuditCopy";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import {
  FINANCE_KPI_AR_DELINQUENCY,
  FINANCE_KPI_AR_DUE_30_DAYS,
  FINANCE_KPI_AR_DUE_7_DAYS,
  FINANCE_KPI_AR_DUE_TODAY,
  FINANCE_KPI_AR_OPEN,
  FINANCE_KPI_AR_OVERDUE,
  FINANCE_KPI_AR_RECEIVED,
  FINANCE_KPI_AR_TOTAL_RECEIVABLE,
} from "@/src/lib/financeKpiTooltips";
import { financeBiCardClass, financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceArOpenHorizonSection } from "@/src/components/finance/FinanceArOpenHorizonSection";

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
  qualityAlerts: FinanceArDataQualityAlertItem[],
  topDebtors: FinanceArTopDebtor[] = [],
  cards?: FinanceArDashboardCards
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

  const topDebtor = topDebtors[0];
  if (topDebtor && topDebtor.percentOfPortfolio >= 25) {
    items.push({
      id: "concentration",
      type: "collection",
      severity: topDebtor.percentOfPortfolio >= 40 ? "critical" : "warning",
      title: "Revisar concentração por cliente",
      description: `${displayFinanceText(topDebtor.personName)} — ${topDebtor.percentOfPortfolio.toFixed(1)}% da carteira em aberto`,
      value: formatFinanceCurrencyCompact(topDebtor.totalOpenAmount),
    });
  }

  if ((cards?.dueNext7DaysAmount ?? 0) > 0) {
    items.push({
      id: "due-7",
      type: "due-soon",
      severity: "info",
      title: "Acompanhar vencimentos nos próximos 7 dias",
      description: "Saldo em aberto com vencimento entre hoje e +7 dias",
      value: formatFinanceCurrencyCompact(cards!.dueNext7DaysAmount),
    });
  }

  if ((cards?.openWithoutInvoiceAmount ?? 0) > 0) {
    items.push({
      id: "pre-invoice",
      type: "quality",
      severity: "warning",
      title: "Verificar títulos em aberto sem NF",
      description: `${formatFinanceInteger(cards?.openWithoutInvoiceCount ?? 0)} título(s) pré-NF na carteira`,
      value: formatFinanceCurrencyCompact(cards!.openWithoutInvoiceAmount),
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
  topDebtors,
  cards,
  loading,
}: {
  criticalTitles: FinanceArCriticalTitle[];
  qualityAlerts: FinanceArDataQualityAlertItem[];
  topDebtors: FinanceArTopDebtor[];
  cards?: FinanceArDashboardCards;
  loading: boolean;
}) {
  const items = useMemo(
    () => buildActionItems(criticalTitles, qualityAlerts, topDebtors, cards),
    [criticalTitles, qualityAlerts, topDebtors, cards]
  );

  return (
    <FinanceActionCenterShell
      title="Centro de Ações"
      subtitle="Cobrança, concentração e vencimentos — filtros aplicados"
      badgeCount={items.length}
    >
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
    </FinanceActionCenterShell>
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

  const [activeTab, setActiveTab] = useState<FinanceArTabId>("titles");
  const [titlesQualityAlert, setTitlesQualityAlert] = useState<FinanceArDataQualityAlertKey | null>(null);
  const [draftFilters, setDraftFilters] = useState<FinanceArUiFilters>(() =>
    createDefaultFinanceArUiFilters()
  );
  const [appliedFilters, setAppliedFilters] = useState<FinanceArUiFilters>(() =>
    normalizeFinanceArUiFilters(createDefaultFinanceArUiFilters())
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
  const [auditDrawerOpen, setAuditDrawerOpen] = useState(false);

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
    const defaults = createDefaultFinanceArUiFilters();
    const normalized = normalizeFinanceArUiFilters(defaults);
    setDraftFilters(defaults);
    setAppliedFilters(normalized);
    setTitlesQualityAlert(null);
  };

  const handleFilterInvoiceIssued = (value: "all" | "yes" | "no") => {
    const nextDraft = { ...draftFilters, invoiceIssued: value };
    setDraftFilters(nextDraft);
    setAppliedFilters(normalizeFinanceArUiFilters(nextDraft));
  };

  const cards = data?.cards;
  const filtersActive = !isDefaultFinanceArUiFilters(appliedFilters);

  const filterStatus = useMemo(
    () => resolveFinanceBiFilterStatus(Boolean(filtersActive), hasPendingFilterChanges),
    [filtersActive, hasPendingFilterChanges]
  );

  const handleRemoveFilterChip = useCallback((field: keyof FinanceArUiFilters) => {
    const next: FinanceArUiFilters = { ...appliedFilters };
    if (field === "status" || field === "invoiceIssued") next[field] = "all";
    else if (field === "year") next[field] = String(new Date().getFullYear());
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

  const headerUpdatedAt = cards?.lastSyncAt ?? data?.generatedAt ?? null;

  const auditSections = useMemo(
    () =>
      buildFinanceArApAuditSections({
        moduleLabel: "Contas a Receber",
        nomusSource: "Nomus — Contas a Receber",
        lastSyncAt: cards?.lastSyncAt,
        generatedAt: data?.generatedAt,
        lastSyncHint: FINANCE_AR_LAST_SYNC_FILTERED_SCOPE,
        appliedFilterItems: buildFinanceAuditItemsFromChips(appliedFilterChips),
        dataSanitization: data?.dataSanitization,
      }),
    [appliedFilterChips, cards?.lastSyncAt, data?.dataSanitization, data?.generatedAt]
  );

  const auditWarningCount = useMemo(
    () => countFinanceDataAuditWarnings({ dataSanitization: data?.dataSanitization }),
    [data?.dataSanitization]
  );

  return (
    <FinanceBiDashboardShell>
      <FinanceExecutivePageHeader
        eyebrow="FINANCEIRO · CONTAS A RECEBER"
        title="Contas a Receber"
        subtitle={FINANCE_AR_EXECUTIVE_SUBTITLE}
        updatedAt={headerUpdatedAt}
        compact
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
        extraActions={
          <FinanceDataAuditButton
            onClick={() => setAuditDrawerOpen(true)}
            warningCount={auditWarningCount}
            disabled={loading && !data}
          />
        }
      />

      <FinanceDataAuditDrawer
        open={auditDrawerOpen}
        onClose={() => setAuditDrawerOpen(false)}
        sections={auditSections}
      />

      <main data-testid="finance-main-content">
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
        compact
        expanded={showAdvancedFilters}
        onToggle={() => setShowAdvancedFilters((v) => !v)}
        filterStatus={filterStatus}
        chips={appliedFilterChips}
        onApply={handleApplyFilters}
        onClear={handleClearFilters}
        applyDisabled={!hasPendingFilterChanges || loading}
        filterScopeNote={filtersActive ? FINANCE_EXECUTIVE_FILTER_SCOPE_NOTE : null}
        alwaysVisible={
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            <FilterSelect
              compact
              label="Ano vencimento"
              value={draftFilters.year}
              onChange={(v) => setDraftFilters((f) => ({ ...f, year: v }))}
              options={yearOptions}
            />
            <FilterSelect
              compact
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
              compact
              label="Status"
              value={draftFilters.status}
              onChange={(v) => setDraftFilters((f) => ({ ...f, status: v }))}
              options={FINANCE_AR_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <CustomerAutocompleteFilter
              compact
              label="Cliente"
              personName={draftFilters.personName}
              personCnpj={draftFilters.personCnpj}
              placeholder="Buscar cliente…"
              onChange={(sel) => {
                const fields = financePersonFieldsFromSelection(sel);
                setDraftFilters((f) => ({
                  ...f,
                  personName: fields.personName,
                  personCnpj: fields.personCnpj,
                }));
              }}
              onClear={() =>
                setDraftFilters((f) => ({
                  ...f,
                  personName: "",
                  personCnpj: "",
                }))
              }
            />
            <FilterInput
              compact
              label="CNPJ/CPF"
              value={draftFilters.personCnpj}
              onChange={(v) => setDraftFilters((f) => ({ ...f, personCnpj: v }))}
            />
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
          <FilterInput
            compact
            label="Empresa"
            value={draftFilters.companyName}
            onChange={(v) => setDraftFilters((f) => ({ ...f, companyName: v }))}
          />
          <FilterInput
            compact
            label="Vencimento de"
            type="date"
            value={draftFilters.dueDateFrom}
            onChange={(v) => setDraftFilters((f) => ({ ...f, dueDateFrom: v }))}
          />
          <FilterInput
            compact
            label="Vencimento até"
            type="date"
            value={draftFilters.dueDateTo}
            onChange={(v) => setDraftFilters((f) => ({ ...f, dueDateTo: v }))}
          />
          <FilterSelect
            compact
            label="Origem do recebível"
            value={draftFilters.invoiceIssued}
            onChange={(v) => setDraftFilters((f) => ({ ...f, invoiceIssued: v }))}
            options={FINANCE_AR_INVOICE_ISSUED_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
            }))}
          />
          <FilterInput
            compact
            label="Forma de pagamento"
            value={draftFilters.paymentMethodName}
            onChange={(v) => setDraftFilters((f) => ({ ...f, paymentMethodName: v }))}
          />
          <FilterInput
            compact
            label="Conta bancária"
            value={draftFilters.bankAccountName}
            onChange={(v) => setDraftFilters((f) => ({ ...f, bankAccountName: v }))}
          />
        </div>
      </FinanceBiFilterPanel>

      <FinanceFilterScopeNote className="px-1">
        <span title={FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE}>
          {FINANCE_AR_OVERDUE_FISCAL_BACKING_NOTE}
        </span>
      </FinanceFilterScopeNote>

      {/* ─── RESUMO EXECUTIVO ─── */}
      <section className={financeBiSectionClass}>
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <h2 className="text-sm font-bold text-[#111827]">Resumo executivo</h2>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            KPIs principais da carteira — números refletem filtros aplicados, salvo exceções rotuladas
          </p>
        </div>
        <div className="p-5 indus-kpi-grid indus-kpi-grid--wide">
          <FinanceBiKpiCard
            icon={Wallet}
            label="Total a Receber"
            value="—"
            amount={loading ? undefined : cards?.totalAmountReceivable}
            amountFormat="currency"
            sub={withAppliedFilterSub("Σ valor original no filtro", Boolean(filtersActive))}
            hint={FINANCE_KPI_AR_TOTAL_RECEIVABLE}
            colorClass="text-[#111827]"
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={TrendingUp}
            label="Recebido"
            value="—"
            amount={loading ? undefined : cards?.totalReceivedAmount}
            amountFormat="currency"
            sub={withAppliedFilterSub("Baixas acumuladas no filtro", Boolean(filtersActive))}
            hint={FINANCE_KPI_AR_RECEIVED}
            colorClass="text-[#059669]"
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={Wallet}
            label="Em Aberto"
            value="—"
            amount={loading ? undefined : cards?.totalOpenAmount}
            amountFormat="currency"
            sub={withAppliedFilterSub(
              cards?.openTitlesCount != null
                ? `${formatFinanceInteger(cards.openTitlesCount)} título${cards.openTitlesCount !== 1 ? "s" : ""}`
                : undefined,
              Boolean(filtersActive)
            )}
            hint={FINANCE_KPI_AR_OPEN}
            colorClass="text-[#2563EB]"
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={AlertTriangle}
            label="Vencido"
            value="—"
            amount={loading ? undefined : cards?.overdueAmount}
            amountFormat="currency"
            sub={withAppliedFilterSub("Vencimento anterior a hoje", Boolean(filtersActive))}
            hint={FINANCE_KPI_AR_OVERDUE}
            colorClass={(cards?.overdueAmount ?? 0) > 0 ? "text-[#DC2626]" : "text-[#111827]"}
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={Clock}
            label="Vence Hoje"
            value="—"
            amount={loading ? undefined : cards?.dueTodayAmount}
            amountFormat="currency"
            sub={withAppliedFilterSub("Vencimento = hoje", Boolean(filtersActive))}
            hint={FINANCE_KPI_AR_DUE_TODAY}
            colorClass="text-[#D97706]"
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={Clock}
            label="Próximos 7 Dias"
            value="—"
            amount={loading ? undefined : cards?.dueNext7DaysAmount}
            amountFormat="currency"
            sub={withAppliedFilterSub("Hoje até +7 dias", Boolean(filtersActive))}
            hint={FINANCE_KPI_AR_DUE_7_DAYS}
            colorClass="text-[#2563EB]"
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={Clock}
            label="Próximos 30 Dias"
            value="—"
            amount={loading ? undefined : cards?.dueNext30DaysAmount}
            amountFormat="currency"
            sub={withAppliedFilterSub("Hoje até +30 dias", Boolean(filtersActive))}
            hint={FINANCE_KPI_AR_DUE_30_DAYS}
            colorClass="text-[#2563EB]"
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={TrendingDown}
            label="Inadimplência"
            value="—"
            amount={loading ? undefined : cards?.delinquencyRate}
            amountFormat="percent"
            sub={withAppliedFilterSub(
              cards?.overdueCustomersCount != null
                ? `${formatFinanceInteger(cards.overdueCustomersCount)} cliente(s) em atraso`
                : undefined,
              Boolean(filtersActive)
            )}
            hint={FINANCE_KPI_AR_DELINQUENCY}
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
        </div>
      </section>

      <FinanceArOpenHorizonSection horizon={data?.financialHorizon} loading={loading} />

      {/* ─── CHARTS ─── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {loading && !data ? (
          <>
            <div className="rounded-2xl border border-border/70 bg-card h-[300px] animate-pulse" />
            <div className="rounded-2xl border border-border/70 bg-card h-[300px] animate-pulse" />
            <div className="rounded-2xl border border-border/70 bg-card h-[300px] animate-pulse" />
            <div className="rounded-2xl border border-border/70 bg-card h-[300px] animate-pulse" />
          </>
        ) : (
          <>
            <FinanceArAgingChart buckets={data?.agingBuckets ?? []} />
            <FinanceArTopDebtorsChart rows={data?.topDebtors ?? []} />
            <FinanceArPortfolioMixChart
              openAmount={cards?.totalOpenAmount ?? 0}
              receivedAmount={cards?.totalReceivedAmount ?? 0}
            />
            <FinanceArMonthlyScheduleChart rows={data?.monthlyDueSchedule ?? []} />
          </>
        )}
      </div>
      {!loading && data?.scheduleBuckets?.length ? (
        <FinanceArScheduleBucketsChart
          buckets={data.scheduleBuckets.map((b) => ({
            label: b.label,
            amount: b.amount,
            count: b.count,
          }))}
        />
      ) : null}

      {/* ─── ACTION CENTER + HIGHLIGHT TABLE ─── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <FinanceArActionCenter
          criticalTitles={data?.criticalTitles ?? []}
          qualityAlerts={data?.dataQualitySummary ?? []}
          topDebtors={data?.topDebtors ?? []}
          cards={cards}
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

      {/* ─── ANALYTICS TABS ─── */}
      <div className={`${financeBiSectionClass}`}>
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <h2 className="text-sm font-bold text-[#111827]">Análise detalhada</h2>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            Títulos, clientes, aging e auditoria — refinam o universo dos filtros globais aplicados
          </p>
        </div>
        <div className="p-5 space-y-4">
          <FinanceDetailTabs
            tabs={FINANCE_AR_TABS}
            activeId={activeTab}
            onChange={(id) => setActiveTab(id)}
          />
          <div role="tabpanel" aria-label={FINANCE_AR_TABS.find((t) => t.id === activeTab)?.label}>
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
            {activeTab === "overdue" ? (
              <FinanceAccountsReceivableOverdueTab
                globalFilters={appliedFilters}
                canExport={canExport}
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
            {activeTab === "audit" ? (
              <FinanceArAuditTab
                alerts={data?.dataQualitySummary ?? []}
                dataSanitization={data?.dataSanitization}
                appliedFiltersLabel={appliedFilterChips.map((c) => c.label).join(" · ")}
                onViewTitles={handleViewTitlesFromAlert}
              />
            ) : null}
          </div>
        </div>
      </div>
      </main>

      <FinanceAccountsReceivableSyncPanel
        canRun={canRunSync}
        onSyncFinished={() => void loadDashboard()}
        defaultExpanded={false}
      />
    </FinanceBiDashboardShell>
  );
}

/* ─── shared input helpers ──────────────────────────────────────── */
function FilterInput({
  label,
  value,
  onChange,
  type = "text",
  compact = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  compact?: boolean;
}) {
  return (
    <label className="space-y-1 block min-w-0">
      <span className="text-[10px] font-bold uppercase text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full rounded-lg border border-border bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30",
          compact ? "h-8" : "h-9 rounded-xl"
        )}
      />
    </label>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  compact = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  compact?: boolean;
}) {
  return (
    <label className="space-y-1 block min-w-0">
      <span className="text-[10px] font-bold uppercase text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "w-full rounded-lg border border-border bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30",
          compact ? "h-8" : "h-9 rounded-xl"
        )}
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
