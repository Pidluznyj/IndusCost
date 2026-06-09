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
  TrendingUp,
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
  FINANCE_AP_TABS,
  normalizeFinanceApUiFilters,
  type FinanceApCriticalTitle,
  type FinanceApDashboardPayload,
  type FinanceApDataQualityAlertItem,
  type FinanceApDataQualityAlertKey,
  type FinanceApTabId,
  type FinanceApUiFilters,
} from "@/src/lib/financeAccountsPayableDashboardTypes";
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
  formatFinancePercent,
} from "@/src/lib/financeAccountsPayableFormat";
import {
  canExportFinanceAccountsPayable,
  canRunFinanceAccountsPayableSync,
} from "@/src/lib/financeAccountsPayablePermissions";
import {
  FinanceApAgingTab,
  FinanceApCompaniesTab,
  FinanceApSuppliersTab,
  FinanceApPaymentTab,
  FinanceApScheduleTab,
  statusBadgeClass,
} from "@/src/components/finance/FinanceAccountsPayableTabPanels";
import { FinanceAccountsPayableDataQualityPanel } from "@/src/components/finance/FinanceAccountsPayableDataQualityPanel";
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
  FinanceApTabNav,
} from "@/src/components/finance/FinanceAccountsPayableUiShared";
import { cn } from "@/src/lib/utils";

function ExecKpiCard({
  icon: Icon,
  label,
  value,
  sub,
  hint,
  trend,
  trendLabel,
  colorClass = "text-foreground",
  bgClass = "bg-card",
  loading = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  colorClass?: string;
  bgClass?: string;
  loading?: boolean;
}) {
  return (
    <div
      className={cn("rounded-2xl border border-border/70 p-5 space-y-3 shadow-sm", bgClass)}
      title={hint}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span className="h-9 w-9 rounded-xl bg-muted/60 flex items-center justify-center">
          <Icon className={cn("h-4 w-4", colorClass)} />
        </span>
      </div>
      {loading ? (
        <div className="h-8 w-32 animate-pulse rounded-lg bg-muted" />
      ) : (
        <p className={cn("text-3xl font-extrabold tracking-tight leading-none", colorClass)}>
          {value}
        </p>
      )}
      <div className="flex items-center justify-between min-h-[1.25rem]">
        {sub ? <span className="text-[11px] text-muted-foreground">{sub}</span> : <span />}
        {trend && trendLabel ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
              trend === "up"
                ? "bg-red-50 text-red-700"
                : trend === "down"
                  ? "bg-green-50 text-green-700"
                  : "bg-muted text-muted-foreground"
            )}
          >
            {trend === "up" ? (
              <TrendingUp className="h-2.5 w-2.5" />
            ) : trend === "down" ? (
              <TrendingDown className="h-2.5 w-2.5" />
            ) : null}
            {trendLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

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
  qualityAlerts: FinanceApDataQualityAlertItem[]
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
  loading,
}: {
  criticalTitles: FinanceApCriticalTitle[];
  qualityAlerts: FinanceApDataQualityAlertItem[];
  loading: boolean;
}) {
  const items = useMemo(
    () => buildActionItems(criticalTitles, qualityAlerts),
    [criticalTitles, qualityAlerts]
  );

  return (
    <div className="rounded-2xl border border-border/70 bg-card shadow-sm flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
        <div>
          <h3 className="text-sm font-bold text-foreground">Centro de Ações</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Pagamentos que exigem atenção imediata
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
      </div>
    </div>
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
    <div className="rounded-2xl border border-border/70 bg-card shadow-sm flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
        <div>
          <h3 className="text-sm font-bold text-foreground">Títulos Críticos</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Maiores obrigações em aberto por antiguidade
          </p>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="text-[11px] font-semibold text-primary hover:underline"
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

  const [activeTab, setActiveTab] = useState<FinanceApTabId>("overview");
  const [titlesQualityAlert, setTitlesQualityAlert] = useState<FinanceApDataQualityAlertKey | null>(
    null
  );
  const [draftFilters, setDraftFilters] = useState<FinanceApUiFilters>(() =>
    createDefaultFinanceApUiFilters()
  );
  const [appliedFilters, setAppliedFilters] = useState<FinanceApUiFilters>(() =>
    normalizeFinanceApUiFilters(createDefaultFinanceApUiFilters())
  );
  const [showFilters, setShowFilters] = useState(false);
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
    setActiveTab("titles");
  };

  const handleApplyFilters = () => {
    setAppliedFilters(normalizedDraftFilters);
  };

  const handleClearFilters = () => {
    const defaults = createDefaultFinanceApUiFilters();
    const normalized = normalizeFinanceApUiFilters(defaults);
    setDraftFilters(defaults);
    setAppliedFilters(normalized);
    setTitlesQualityAlert(null);
  };

  const cards = data?.cards;
  const filtersActive = !isDefaultFinanceApUiFilters(appliedFilters);

  const overdueTrend: "up" | "down" | "neutral" =
    cards?.overduePercent != null
      ? cards.overduePercent > 15
        ? "up"
        : cards.overduePercent < 5
          ? "down"
          : "neutral"
      : "neutral";

  return (
    <div className="space-y-5 pb-10 min-h-screen">
      <header className="rounded-2xl border border-border/70 bg-gradient-to-br from-card via-card/90 to-card/60 p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Financeiro · Contas a Pagar
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
              Contas a Pagar
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Controle de obrigações, fornecedores críticos e agenda de pagamentos.{" "}
              {cards?.totalRecords != null ? (
                <span className="font-semibold text-foreground">
                  {formatFinanceInteger(cards.totalRecords)} registros filtrados.
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <dl className="hidden lg:flex gap-4 text-xs mr-2">
              <div>
                <dt className="text-muted-foreground">Última sync</dt>
                <dd className="font-semibold text-foreground tabular-nums">
                  {formatFinanceDateTime(cards?.lastSyncAt)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Calculado em</dt>
                <dd className="font-semibold text-foreground tabular-nums">
                  {data ? formatFinanceDateTime(data.generatedAt) : loading ? "…" : "—"}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={loading}
              aria-busy={loading}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Atualizar
            </button>
            {canExport ? (
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={exporting || loading}
                aria-busy={exporting}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 text-xs font-semibold text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                {exporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Exportar CSV
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <FinanceAccountsPayableSyncPanel
        canRun={canRunSync}
        onSyncFinished={() => void loadDashboard()}
      />

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

      <section className="rounded-2xl border border-border/70 bg-card/50 overflow-hidden shadow-sm">
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Filtros</span>
            {filtersActive ? (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                Ativos
              </span>
            ) : null}
            {hasPendingFilterChanges ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                Não aplicados
              </span>
            ) : null}
          </div>
          {showFilters ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        {showFilters ? (
          <div className="border-t border-border/50 p-5 space-y-4 bg-background/50">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-xl border border-border/40 bg-card/60 p-4">
              <p className="col-span-full text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Período de vencimento
              </p>
              <FilterSelect
                label="Ano Vencimento"
                value={draftFilters.year}
                onChange={(v) => setDraftFilters((f) => ({ ...f, year: v }))}
                options={yearOptions}
              />
              <FilterSelect
                label="Mês Vencimento"
                value={draftFilters.month}
                onChange={(v) =>
                  setDraftFilters((f) => {
                    const next = { ...f, month: v };
                    if (v && !f.year.trim()) {
                      next.year = String(new Date().getFullYear());
                    }
                    return next;
                  })
                }
                options={FINANCE_AP_MONTH_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
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
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              <FilterSelect
                label="Status"
                value={draftFilters.status}
                onChange={(v) => setDraftFilters((f) => ({ ...f, status: v }))}
                options={FINANCE_AP_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
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
                label="Empresa"
                value={draftFilters.companyName}
                onChange={(v) => setDraftFilters((f) => ({ ...f, companyName: v }))}
              />
              <FilterInput
                label="Fornecedor"
                value={draftFilters.personName}
                onChange={(v) => setDraftFilters((f) => ({ ...f, personName: v }))}
              />
              <FilterInput
                label="CNPJ"
                value={draftFilters.personCnpj}
                onChange={(v) => setDraftFilters((f) => ({ ...f, personCnpj: v }))}
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
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleApplyFilters}
                disabled={!hasPendingFilterChanges || loading}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Filter className="h-3.5 w-3.5" />
                Aplicar filtros
              </button>
              <button
                type="button"
                onClick={handleClearFilters}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-semibold hover:bg-accent"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Limpar filtros
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <ExecKpiCard
          icon={Wallet}
          label="Obrigações em Aberto"
          value={loading ? "…" : formatFinanceCurrencyCompact(cards?.totalOpenAmount)}
          sub={
            cards?.openTitlesCount != null
              ? `${formatFinanceInteger(cards.openTitlesCount)} título${cards.openTitlesCount !== 1 ? "s" : ""} em aberto`
              : undefined
          }
          hint="Soma dos saldos com balancePayable > 0"
          colorClass="text-blue-600 dark:text-blue-400"
          bgClass="bg-white dark:bg-card"
          loading={loading}
        />
        <ExecKpiCard
          icon={Landmark}
          label="Pago no Mês"
          value={loading ? "…" : formatFinanceCurrencyCompact(cards?.paidThisMonthAmount)}
          sub="Liquidações com data de pagamento no mês corrente"
          hint="Soma de amountPaid onde paymentDate está no mês atual"
          colorClass="text-green-600 dark:text-green-400"
          bgClass="bg-white dark:bg-card"
          loading={loading}
        />
        <ExecKpiCard
          icon={TrendingDown}
          label="% em Atraso"
          value={loading ? "…" : formatFinancePercent(cards?.overduePercent)}
          sub={
            cards?.overdueSuppliersCount != null
              ? `${formatFinanceInteger(cards.overdueSuppliersCount)} fornecedor${cards.overdueSuppliersCount !== 1 ? "es" : ""} em atraso`
              : undefined
          }
          hint="Saldo vencido ÷ saldo total em aberto × 100"
          trend={overdueTrend}
          trendLabel={
            cards?.overduePercent != null
              ? overdueTrend === "up"
                ? "Alto risco"
                : overdueTrend === "down"
                  ? "Controlado"
                  : "Atenção"
              : undefined
          }
          colorClass={
            (cards?.overduePercent ?? 0) > 15
              ? "text-red-600 dark:text-red-400"
              : (cards?.overduePercent ?? 0) > 5
                ? "text-amber-600 dark:text-amber-400"
                : "text-green-600 dark:text-green-400"
          }
          bgClass="bg-white dark:bg-card"
          loading={loading}
        />
        <ExecKpiCard
          icon={ShieldAlert}
          label="Vencido > 30 Dias"
          value={loading ? "…" : formatFinanceCurrencyCompact(cards?.overdueOver30DaysAmount)}
          sub={
            cards?.overdueOver30DaysCount != null
              ? `${formatFinanceInteger(cards.overdueOver30DaysCount)} título${cards.overdueOver30DaysCount !== 1 ? "s" : ""}`
              : undefined
          }
          hint="Soma de saldos com vencimento há mais de 30 dias"
          colorClass={
            (cards?.overdueOver30DaysAmount ?? 0) > 0
              ? "text-red-600 dark:text-red-400"
              : "text-foreground"
          }
          bgClass="bg-white dark:bg-card"
          loading={loading}
        />
      </div>

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
          loading={loading && !data}
        />
        <FinanceApHighlightTable
          rows={data?.criticalTitles ?? []}
          loading={loading && !data}
          onViewAll={() => setActiveTab("titles")}
        />
      </div>

      {loading && !data ? (
        <FinanceApLoadingBlock label="alertas e indicadores" />
      ) : (
        <FinanceAccountsPayableDataQualityPanel
          alerts={data?.dataQualitySummary ?? []}
          onViewTitles={handleViewTitlesFromAlert}
        />
      )}

      <div className="rounded-2xl border border-border/70 bg-card/50 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-border/50">
          <h2 className="text-sm font-bold text-foreground">Análise Detalhada</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Aging, agenda, fornecedores, títulos e formas de pagamento
          </p>
        </div>
        <div className="p-5 space-y-4">
          <FinanceApTabNav
            tabs={FINANCE_AP_TABS}
            activeId={activeTab}
            onChange={(id) => setActiveTab(id as FinanceApTabId)}
          />
          <div role="tabpanel" aria-label={FINANCE_AP_TABS.find((t) => t.id === activeTab)?.label}>
            {activeTab === "overview" ? (
              <ApOverviewSummary data={data} loading={loading} />
            ) : null}
            {activeTab === "aging" ? (
              loading && !data ? (
                <FinanceApLoadingBlock label="aging" />
              ) : (
                <FinanceApAgingTab data={data} />
              )
            ) : null}
            {activeTab === "schedule" ? (
              loading && !data ? (
                <FinanceApLoadingBlock label="agenda" />
              ) : (
                <FinanceApScheduleTab data={data} />
              )
            ) : null}
            {activeTab === "suppliers" ? (
              loading && !data ? (
                <FinanceApLoadingBlock label="fornecedores" />
              ) : (
                <FinanceApSuppliersTab data={data} />
              )
            ) : null}
            {activeTab === "titles" ? (
              <FinanceApTitlesTab
                filters={appliedFilters}
                qualityAlert={titlesQualityAlert}
                onClearQualityAlert={() => setTitlesQualityAlert(null)}
              />
            ) : null}
            {activeTab === "payment-methods" ? (
              loading && !data ? (
                <FinanceApLoadingBlock label="formas de pagamento" />
              ) : (
                <FinanceApPaymentTab data={data} />
              )
            ) : null}
            {activeTab === "companies" ? (
              loading && !data ? (
                <FinanceApLoadingBlock label="empresas" />
              ) : (
                <FinanceApCompaniesTab data={data} />
              )
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ApOverviewSummary({
  data,
  loading,
}: {
  data: FinanceApDashboardPayload | null;
  loading: boolean;
}) {
  if (!data && loading) return <FinanceApLoadingBlock label="visão geral" />;
  if (!data) return <p className="text-sm text-muted-foreground">Sem dados para visão geral.</p>;
  const { cards } = data;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {[
        { label: "Em aberto", value: formatFinanceCurrencyCompact(cards.totalOpenAmount), hint: "balancePayable > 0" },
        { label: "Vencido", value: formatFinanceCurrencyCompact(cards.overdueAmount), hint: "Vencimento < hoje" },
        { label: "A vencer", value: formatFinanceCurrencyCompact(cards.upcomingAmount), hint: "Vencimento futuro" },
        { label: "Vence hoje", value: formatFinanceCurrencyCompact(cards.dueTodayAmount), hint: "Vencimento = hoje" },
        { label: "Próx. 7 dias", value: formatFinanceCurrencyCompact(cards.dueNext7DaysAmount), hint: "Hoje + 7 dias" },
        { label: "Próx. 30 dias", value: formatFinanceCurrencyCompact(cards.dueNext30DaysAmount), hint: "Hoje + 30 dias" },
        { label: "Pago no mês", value: formatFinanceCurrencyCompact(cards.paidThisMonthAmount), hint: "Pagamento no mês corrente" },
        { label: "% em atraso", value: formatFinancePercent(cards.overduePercent), hint: "Vencido ÷ aberto" },
        { label: "Títulos em aberto", value: formatFinanceInteger(cards.openTitlesCount), hint: "" },
        { label: "Fornecedores em atraso", value: formatFinanceInteger(cards.overdueSuppliersCount), hint: "" },
        {
          label: "Vencido > 30 dias",
          value: formatFinanceCurrencyCompact(cards.overdueOver30DaysAmount),
          hint: `${formatFinanceInteger(cards.overdueOver30DaysCount)} títulos`,
        },
        {
          label: "Média dias em atraso",
          value: cards.avgDaysOverdue != null ? `${formatFinanceInteger(Math.round(cards.avgDaysOverdue))} dias` : "—",
          hint: "Ponderada por saldo vencido",
        },
      ].map((kpi) => (
        <div
          key={kpi.label}
          className="rounded-xl border border-border/50 bg-background/50 p-3 space-y-1"
          title={kpi.hint}
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {kpi.label}
          </p>
          <p className="text-base font-extrabold tabular-nums text-foreground">{kpi.value}</p>
          {kpi.hint ? <p className="text-[10px] text-muted-foreground">{kpi.hint}</p> : null}
        </div>
      ))}
    </div>
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
