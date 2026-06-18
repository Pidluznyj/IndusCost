import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Filter,
  Landmark,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import {
  buildFinanceApDashboardQuery,
  buildFinanceApExportQuery,
  buildFinanceApYearOptions,
  createDefaultFinanceApUiFilters,
  hasPendingFinanceApFilterChanges,
  isDefaultFinanceApUiFilters,
  FINANCE_AP_SUSPEND_PAYMENT_OPTIONS,
  FINANCE_AP_MONTH_OPTIONS,
  FINANCE_AP_STATUS_OPTIONS,
  FINANCE_AP_EXECUTIVE_TABS,
  FINANCE_AP_SECONDARY_TABS,
  normalizeFinanceApUiFilters,
  type FinanceApCriticalTitle,
  type FinanceApDashboardPayload,
  type FinanceApDataQualityAlertItem,
  type FinanceApDataQualityAlertKey,
  type FinanceApExecutiveTabId,
  type FinanceApPurchaseOrderScheduleAudit,
  type FinanceApSecondaryTabId,
  type FinanceApUiFilters,
} from "@/src/lib/financeAccountsPayableDashboardTypes";
import {
  parseFinanceApTitlesLocalFilter,
  type FinanceApTitlesLocalFilter,
} from "@/src/lib/financeAccountsPayableTitlesLocalFilter";
import {
  displayFinanceText,
  financeApExportFilename,
  formatFinanceCalculatedStatus,
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceDaysOverdue,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsPayableFormat";
import {
  canExportFinanceAccountsPayable,
  canRunFinanceAccountsPayableSync,
} from "@/src/lib/financeAccountsPayablePermissions";
import {
  FinanceApAgingTab,
  FinanceApAuditTab,
  FinanceApCompaniesTab,
  FinanceApSuppliersTab,
  FinanceApPaymentTab,
  FinanceApScheduleTab,
  statusBadgeClass,
} from "@/src/components/finance/FinanceAccountsPayableTabPanels";
import { FinanceActionCenterShell } from "@/src/components/finance/shared/FinanceActionCenterShell";
import { FinanceDetailTabs } from "@/src/components/finance/shared/FinanceDetailTabs";
import { FinanceAccountsPayableSyncPanel } from "@/src/components/finance/FinanceAccountsPayableSyncPanel";
import { FinanceApTitlesTab } from "@/src/components/finance/FinanceAccountsPayableTitlesTab";
import {
  FinanceApAgingChart,
  FinanceApTopDebtorsChart,
} from "@/src/components/finance/FinanceAccountsPayableCharts";
import {
  FinanceApErrorBanner,
  FinanceApLoadingBlock,
  FinanceApSuccessBanner,
} from "@/src/components/finance/FinanceAccountsPayableUiShared";
import { cn } from "@/src/lib/utils";
import {
  FinanceApPurchaseOrderScheduleAuditNote,
} from "@/src/components/finance/FinanceFilterScopeBanner";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { FinanceDataAuditButton } from "@/src/components/finance/shared/FinanceDataAuditButton";
import { FinanceDataAuditDrawer } from "@/src/components/finance/shared/FinanceDataAuditDrawer";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import { buildFinanceApFilterChips } from "@/src/lib/financeBiFilterChips";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import {
  FINANCE_AP_LAST_SYNC_FILTERED_SCOPE,
  withAppliedFilterSub,
} from "@/src/lib/financeFilterScope";
import {
  buildFinanceApAuditSections,
  buildFinanceAuditItemsFromChips,
  countFinanceDataAuditWarnings,
} from "@/src/lib/financeDataAudit";
import {
  FINANCE_AP_EXECUTIVE_SUBTITLE,
  FINANCE_AUDIT_SECTION_TECHNICAL,
  FINANCE_EXECUTIVE_FILTER_SCOPE_NOTE,
} from "@/src/lib/financeDataAuditCopy";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import {
  FINANCE_KPI_AP_DUE_30_DAYS,
  FINANCE_KPI_AP_DUE_7_DAYS,
  FINANCE_KPI_AP_DUE_TODAY,
  FINANCE_KPI_AP_OPEN,
  FINANCE_KPI_AP_OVERDUE,
  FINANCE_KPI_AP_PAID_THIS_MONTH,
  FINANCE_KPI_AP_SCHEDULED,
  FINANCE_KPI_AP_TOP_SUPPLIER,
  FINANCE_KPI_AP_TOTAL_PAYABLE,
} from "@/src/lib/financeKpiTooltips";
import { financeBiCardClass, financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceHorizonSection } from "@/src/components/finance/shared/FinanceHorizonSection";

type ActionItem = {
  id: string;
  type: "high-risk" | "payment" | "suspended" | "quality" | "due-soon";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  value?: string;
  meta?: string;
};

function buildActionItems(
  criticalTitles: FinanceApCriticalTitle[],
  qualityAlerts: FinanceApDataQualityAlertItem[],
  purchaseOrderAudit?: FinanceApPurchaseOrderScheduleAudit
): ActionItem[] {
  const items: ActionItem[] = [];

  const highRisk = criticalTitles.filter((t) => t.daysOverdue > 60 && t.balancePayable > 0);
  if (highRisk.length > 0) {
    const top = highRisk[0];
    items.push({
      id: "high-risk",
      type: "high-risk",
      severity: "critical",
      title: `${highRisk.length} pagamento${highRisk.length > 1 ? "s" : ""} crítico${highRisk.length > 1 ? "s" : ""} (>60 dias)`,
      description: `Maior exposição: ${displayFinanceText(top.personName)} — ${formatFinanceCurrency(top.balancePayable)}`,
      value: formatFinanceCurrencyCompact(highRisk.reduce((s, t) => s + t.balancePayable, 0)),
      meta: `Mais antigo: ${top.daysOverdue} dias em atraso`,
    });
  }

  const suspended = criticalTitles.filter((t) => t.suspendPayment && t.balancePayable > 0);
  if (suspended.length > 0) {
    items.push({
      id: "suspended",
      type: "suspended",
      severity: "warning",
      title: `${suspended.length} título${suspended.length > 1 ? "s" : ""} com pagamento suspenso`,
      description: suspended.slice(0, 2).map((t) => displayFinanceText(t.personName)).join(", "),
      value: formatFinanceCurrencyCompact(suspended.reduce((s, t) => s + t.balancePayable, 0)),
    });
  }

  const priority = criticalTitles.filter(
    (t) => t.daysOverdue >= 1 && t.daysOverdue <= 60 && !t.suspendPayment && t.balancePayable > 0
  );
  if (priority.length > 0) {
    const top = priority[0];
    items.push({
      id: "payment",
      type: "payment",
      severity: "warning",
      title: `${priority.length} pagamento${priority.length > 1 ? "s" : ""} prioritário${priority.length > 1 ? "s" : ""}`,
      description: `Maior: ${displayFinanceText(top.personName)} — ${formatFinanceCurrency(top.balancePayable)}`,
      value: formatFinanceCurrencyCompact(priority.reduce((s, t) => s + t.balancePayable, 0)),
      meta: `Vencimento mais antigo: ${formatFinanceDate(priority[priority.length - 1].dueDate)}`,
    });
  }

  const dueSoon = criticalTitles.filter((t) => t.calculatedStatus === "dueToday");
  if (dueSoon.length > 0) {
    items.push({
      id: "due-today",
      type: "due-soon",
      severity: "info",
      title: `${dueSoon.length} título${dueSoon.length > 1 ? "s" : ""} vence${dueSoon.length > 1 ? "m" : ""} hoje`,
      description: dueSoon.slice(0, 2).map((t) => displayFinanceText(t.personName)).join(", "),
      value: formatFinanceCurrencyCompact(dueSoon.reduce((s, t) => s + t.balancePayable, 0)),
    });
  }

  if (purchaseOrderAudit && purchaseOrderAudit.excludedCount > 0) {
    items.push({
      id: "po-excluded",
      type: "quality",
      severity: "warning",
      title: "Revisar pedidos de compra excluídos",
      description: `${purchaseOrderAudit.excludedCount} agenda(s) fora da visão gerencial`,
      value: formatFinanceCurrencyCompact(purchaseOrderAudit.excludedAmount),
    });
  }

  if (purchaseOrderAudit && purchaseOrderAudit.rescheduledOpenCount > 0) {
    items.push({
      id: "rescheduled",
      type: "due-soon",
      severity: "info",
      title: "Títulos com data agendada divergente",
      description: `${purchaseOrderAudit.rescheduledOpenCount} título(s) remarcados em aberto`,
      value: formatFinanceCurrencyCompact(purchaseOrderAudit.rescheduledOpenAmount),
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

function FinanceApActionCenter({
  criticalTitles,
  qualityAlerts,
  purchaseOrderAudit,
  loading,
}: {
  criticalTitles: FinanceApCriticalTitle[];
  qualityAlerts: FinanceApDataQualityAlertItem[];
  purchaseOrderAudit?: FinanceApPurchaseOrderScheduleAudit;
  loading: boolean;
}) {
  const items = useMemo(
    () => buildActionItems(criticalTitles, qualityAlerts, purchaseOrderAudit),
    [criticalTitles, qualityAlerts, purchaseOrderAudit]
  );

  return (
    <FinanceActionCenterShell
      title="Centro de Ações"
      subtitle="Pagamentos, saneamento gerencial e fornecedores críticos — filtros aplicados"
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
                className={cn("px-4 py-3 flex items-start gap-3", styles.border, styles.bg)}
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
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold",
                      styles.badge
                    )}
                  >
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

function FinanceApHighlightTable({
  rows,
  loading,
  onViewAll,
}: {
  rows: FinanceApCriticalTitle[];
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
                  Fornecedor
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
                    {t.documentNumber ? (
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {t.documentNumber}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold tabular-nums text-foreground">
                    {formatFinanceCurrency(t.balancePayable)}
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

export function FinanceAccountsPayablePage() {
  const auth = useAuth();
  const canExport = canExportFinanceAccountsPayable(auth);
  const canRunSync = canRunFinanceAccountsPayableSync(auth);

  const [executiveTab, setExecutiveTab] = useState<FinanceApExecutiveTabId>("titles");
  const [secondaryTab, setSecondaryTab] = useState<FinanceApSecondaryTabId>("schedule");
  const [titlesLocalFilter, setTitlesLocalFilter] = useState<FinanceApTitlesLocalFilter>("all");
  const [titlesQualityAlert, setTitlesQualityAlert] = useState<FinanceApDataQualityAlertKey | null>(
    null
  );
  const [draftFilters, setDraftFilters] = useState<FinanceApUiFilters>(() =>
    createDefaultFinanceApUiFilters()
  );
  const [appliedFilters, setAppliedFilters] = useState<FinanceApUiFilters>(() =>
    normalizeFinanceApUiFilters(createDefaultFinanceApUiFilters())
  );
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const dashboardAbortRef = useRef<AbortController | null>(null);

  const normalizedDraftFilters = useMemo(
    () => normalizeFinanceApUiFilters(draftFilters),
    [draftFilters]
  );

  const hasPendingFilterChanges = useMemo(
    () => hasPendingFinanceApFilterChanges(normalizedDraftFilters, appliedFilters),
    [normalizedDraftFilters, appliedFilters]
  );

  const yearOptions = useMemo(() => buildFinanceApYearOptions(), []);

  const queryString = useMemo(
    () => buildFinanceApDashboardQuery(appliedFilters),
    [appliedFilters]
  );

  const [data, setData] = useState<FinanceApDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  const [auditDrawerOpen, setAuditDrawerOpen] = useState(false);

  const loadDashboard = useCallback(async () => {
    dashboardAbortRef.current?.abort();
    const controller = new AbortController();
    dashboardAbortRef.current = controller;
    setLoading(true);
    setDashboardError(null);
    try {
      const url = `/api/finance/accounts-payable/dashboard?${queryString}`;
      const payload = await fetchJsonOk<FinanceApDashboardPayload>(url, {
        signal: controller.signal,
        credentials: "include",
      });
      if (controller.signal.aborted) return;
      setData(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("FinanceAccountsPayablePage.loadDashboard", e);
      setDashboardError("Não foi possível carregar Contas a Pagar. Tente novamente.");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
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
      const qs = buildFinanceApExportQuery(appliedFilters);
      const res = await fetch(`/api/finance/accounts-payable/export?${qs}`, {
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
      a.download = financeApExportFilename();
      a.click();
      URL.revokeObjectURL(url);
      setExportSuccess(`Arquivo ${financeApExportFilename()} gerado com os filtros atuais.`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Erro ao exportar CSV.");
    } finally {
      setExporting(false);
    }
  };

  const handleViewTitlesFromAlert = (key: FinanceApDataQualityAlertKey) => {
    setTitlesQualityAlert(key);
    setExecutiveTab("titles");
  };

  const handleApplyFilters = () => {
    setAppliedFilters(normalizedDraftFilters);
    setTitlesLocalFilter("all");
  };

  const handleClearFilters = () => {
    const defaults = createDefaultFinanceApUiFilters();
    const normalized = normalizeFinanceApUiFilters(defaults);
    setDraftFilters(defaults);
    setAppliedFilters(normalized);
    setTitlesQualityAlert(null);
    setTitlesLocalFilter("all");
  };

  const cards = data?.cards;
  const filtersActive = !isDefaultFinanceApUiFilters(appliedFilters);

  const filterStatus = useMemo(
    () => resolveFinanceBiFilterStatus(filtersActive, hasPendingFilterChanges),
    [filtersActive, hasPendingFilterChanges]
  );

  const handleRemoveFilterChip = useCallback((field: keyof FinanceApUiFilters) => {
    const next: FinanceApUiFilters = { ...appliedFilters };
    if (field === "status" || field === "suspendPayment") next[field] = "all";
    else if (field === "year") next[field] = String(new Date().getFullYear());
    else next[field] = "";
    const normalized = normalizeFinanceApUiFilters(next);
    setDraftFilters(normalized);
    setAppliedFilters(normalized);
  }, [appliedFilters]);

  const appliedFilterChips = useMemo(
    () => buildFinanceApFilterChips(appliedFilters, handleRemoveFilterChip),
    [appliedFilters, handleRemoveFilterChip]
  );

  const headerUpdatedAt = cards?.lastSyncAt ?? data?.generatedAt ?? null;

  const auditSections = useMemo(
    () =>
      buildFinanceApAuditSections({
        lastSyncAt: cards?.lastSyncAt,
        generatedAt: data?.generatedAt,
        lastSyncHint: FINANCE_AP_LAST_SYNC_FILTERED_SCOPE,
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
        eyebrow="FINANCEIRO · CONTAS A PAGAR"
        title="Contas a Pagar"
        subtitle={FINANCE_AP_EXECUTIVE_SUBTITLE}
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
      >
        <div className="border-t border-[#E5E7EB] pt-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[#6B7280]">
            {FINANCE_AUDIT_SECTION_TECHNICAL}
          </h3>
          <FinanceAccountsPayableSyncPanel
            canRun={canRunSync}
            onSyncFinished={() => void loadDashboard()}
            embedded
          />
        </div>
      </FinanceDataAuditDrawer>

      <main data-testid="finance-main-content">
      {dashboardError ? (
        <FinanceApErrorBanner
          message={dashboardError}
          onRetry={() => void loadDashboard()}
          onDismiss={() => setDashboardError(null)}
        />
      ) : null}
      {exportError ? (
        <FinanceApErrorBanner message={exportError} onDismiss={() => setExportError(null)} />
      ) : null}
      {exportSuccess ? (
        <FinanceApSuccessBanner message={exportSuccess} onDismiss={() => setExportSuccess(null)} />
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
        filterScopeNote={filtersActive ? FINANCE_EXECUTIVE_FILTER_SCOPE_NOTE : null}
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
              options={FINANCE_AP_MONTH_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <FilterSelect
              label="Status"
              value={draftFilters.status}
              onChange={(v) => setDraftFilters((f) => ({ ...f, status: v }))}
              options={FINANCE_AP_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <FilterInput
              label="Fornecedor"
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
          <FilterInput
            label="Documento/NF"
            value={draftFilters.documentQuery}
            onChange={(v) => setDraftFilters((f) => ({ ...f, documentQuery: v }))}
          />
          <FilterSelect
            label="Pagamento suspenso"
            value={draftFilters.suspendPayment}
            onChange={(v) => setDraftFilters((f) => ({ ...f, suspendPayment: v }))}
            options={FINANCE_AP_SUSPEND_PAYMENT_OPTIONS.map((o) => ({
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

      <FinanceApPurchaseOrderScheduleAuditNote audit={data?.purchaseOrderScheduleAudit} />

      <section className={financeBiSectionClass}>
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <h2 className="text-sm font-bold text-[#111827]">Resumo executivo</h2>
          <p className="text-[11px] text-[#6B7280] mt-0.5">
            KPIs principais da carteira — números refletem filtros aplicados, salvo exceções rotuladas
          </p>
        </div>
        <div className="p-5 indus-kpi-grid indus-kpi-grid--wide">
          <FinanceKpiCard
            icon={Wallet}
            label="Total a pagar"
            value="—"
            amount={loading ? undefined : cards?.totalPayableAmount}
            amountFormat="currency"
            subtitle={withAppliedFilterSub(
              cards?.totalRecords != null
                ? `${formatFinanceInteger(cards.totalRecords)} título(s)`
                : undefined,
              Boolean(filtersActive)
            )}
            helperText={FINANCE_KPI_AP_TOTAL_PAYABLE}
            loading={loading}
          />
          <FinanceKpiCard
            icon={Landmark}
            label="Pago no mês"
            value="—"
            amount={loading ? undefined : cards?.paidThisMonthAmount}
            amountFormat="currency"
            subtitle={withAppliedFilterSub("Mês atual, dentro do filtro", Boolean(filtersActive))}
            helperText={FINANCE_KPI_AP_PAID_THIS_MONTH}
            tone="success"
            loading={loading}
          />
          <FinanceKpiCard
            icon={Wallet}
            label="Em aberto"
            value="—"
            amount={loading ? undefined : cards?.totalOpenAmount}
            amountFormat="currency"
            subtitle={withAppliedFilterSub(
              cards?.openTitlesCount != null
                ? `${formatFinanceInteger(cards.openTitlesCount)} título(s)`
                : undefined,
              Boolean(filtersActive)
            )}
            helperText={FINANCE_KPI_AP_OPEN}
            tone="info"
            loading={loading}
          />
          <FinanceKpiCard
            icon={AlertTriangle}
            label="Vencido gerencial"
            value="—"
            amount={loading ? undefined : cards?.overdueAmount}
            amountFormat="currency"
            subtitle={withAppliedFilterSub("Data operacional < hoje", Boolean(filtersActive))}
            helperText={FINANCE_KPI_AP_OVERDUE}
            tone={(cards?.overdueAmount ?? 0) > 0 ? "danger" : "neutral"}
            loading={loading}
          />
          <FinanceKpiCard
            icon={Clock}
            label="Vence hoje"
            value="—"
            amount={loading ? undefined : cards?.dueTodayAmount}
            amountFormat="currency"
            subtitle={withAppliedFilterSub("Data operacional = hoje", Boolean(filtersActive))}
            helperText={FINANCE_KPI_AP_DUE_TODAY}
            tone="warning"
            loading={loading}
          />
          <FinanceKpiCard
            icon={Clock}
            label="Próx. 7 dias"
            value="—"
            amount={loading ? undefined : cards?.dueNext7DaysAmount}
            amountFormat="currency"
            subtitle={withAppliedFilterSub("Janela operacional", Boolean(filtersActive))}
            helperText={FINANCE_KPI_AP_DUE_7_DAYS}
            tone="info"
            loading={loading}
          />
          <FinanceKpiCard
            icon={Clock}
            label="Próx. 30 dias"
            value="—"
            amount={loading ? undefined : cards?.dueNext30DaysAmount}
            amountFormat="currency"
            subtitle={withAppliedFilterSub("Janela operacional", Boolean(filtersActive))}
            helperText={FINANCE_KPI_AP_DUE_30_DAYS}
            tone="info"
            loading={loading}
          />
          {data?.purchaseOrderScheduleAudit?.rescheduledOpenCount ? (
            <FinanceKpiCard
              icon={ShieldAlert}
              label="Agendados"
              value="—"
              amount={
                loading ? undefined : data.purchaseOrderScheduleAudit.rescheduledOpenAmount
              }
              amountFormat="currency"
              subtitle={`${formatFinanceInteger(data.purchaseOrderScheduleAudit.rescheduledOpenCount)} título(s) remarcados`}
              helperText={FINANCE_KPI_AP_SCHEDULED}
              tone="info"
              loading={loading}
            />
          ) : (
            <FinanceKpiCard
              icon={ShieldAlert}
              label="Maior fornecedor"
              value="—"
              amount={loading ? undefined : cards?.topSupplier?.totalOpenAmount}
              amountFormat="currency"
              subtitle={displayFinanceText(cards?.topSupplier?.personName)}
              helperText={FINANCE_KPI_AP_TOP_SUPPLIER}
              loading={loading}
            />
          )}
        </div>
      </section>

      <FinanceHorizonSection
        summary={data?.financialHorizon}
        variant="ap"
        loading={loading}
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {loading && !data ? (
          <>
            <div className="rounded-2xl border border-border/70 bg-card h-[300px] animate-pulse" />
            <div className="rounded-2xl border border-border/70 bg-card h-[300px] animate-pulse" />
          </>
        ) : (
          <>
            <FinanceApAgingChart buckets={data?.agingBuckets ?? []} />
            <FinanceApTopDebtorsChart rows={data?.topSuppliers ?? []} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <FinanceApActionCenter
          criticalTitles={data?.criticalTitles ?? []}
          qualityAlerts={data?.dataQualitySummary ?? []}
          purchaseOrderAudit={data?.purchaseOrderScheduleAudit}
          loading={loading && !data}
        />
        <FinanceApHighlightTable
          rows={data?.criticalTitles ?? []}
          loading={loading && !data}
          onViewAll={() => setExecutiveTab("titles")}
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
            tabs={FINANCE_AP_EXECUTIVE_TABS}
            activeId={executiveTab}
            onChange={setExecutiveTab}
          />
        </div>
        <div className="p-5" role="tabpanel">
          {executiveTab === "titles" ? (
            <FinanceApTitlesTab
              filters={appliedFilters}
              qualityAlert={titlesQualityAlert}
              onClearQualityAlert={() => setTitlesQualityAlert(null)}
              localFilter={titlesLocalFilter}
              onLocalFilterChange={(v) =>
                setTitlesLocalFilter(parseFinanceApTitlesLocalFilter(v))
              }
            />
          ) : null}
          {executiveTab === "suppliers" ? (
            loading && !data ? (
              <FinanceApLoadingBlock label="fornecedores" />
            ) : (
              <FinanceApSuppliersTab data={data} />
            )
          ) : null}
          {executiveTab === "aging" ? (
            loading && !data ? (
              <FinanceApLoadingBlock label="aging" />
            ) : (
              <FinanceApAgingTab data={data} />
            )
          ) : null}
          {executiveTab === "audit" ? (
            <FinanceApAuditTab
              alerts={data?.dataQualitySummary ?? []}
              dataSanitization={data?.dataSanitization}
              purchaseOrderAudit={data?.purchaseOrderScheduleAudit}
              appliedFiltersLabel={appliedFilterChips.map((c) => c.label).join(" · ")}
              managementScope={data?.filtersApplied?.managementScope ?? "company"}
              onViewTitles={handleViewTitlesFromAlert}
            />
          ) : null}
        </div>
      </section>

      <section className={financeBiSectionClass}>
        <div className="px-5 py-4 border-b border-[#E5E7EB]">
          <h2 className="text-sm font-bold text-[#111827]">Análises complementares</h2>
        </div>
        <div className="px-5 pt-4">
          <FinanceDetailTabs
            tabs={FINANCE_AP_SECONDARY_TABS}
            activeId={secondaryTab}
            onChange={setSecondaryTab}
          />
        </div>
        <div className="p-5" role="tabpanel">
          {secondaryTab === "schedule" ? (
            loading && !data ? (
              <FinanceApLoadingBlock label="agenda" />
            ) : (
              <FinanceApScheduleTab data={data} />
            )
          ) : null}
          {secondaryTab === "payment-methods" ? (
            loading && !data ? (
              <FinanceApLoadingBlock label="formas de pagamento" />
            ) : (
              <FinanceApPaymentTab data={data} />
            )
          ) : null}
          {secondaryTab === "companies" ? (
            loading && !data ? (
              <FinanceApLoadingBlock label="empresas" />
            ) : (
              <FinanceApCompaniesTab data={data} />
            )
          ) : null}
        </div>
      </section>
      </main>
    </FinanceBiDashboardShell>
  );
}

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
