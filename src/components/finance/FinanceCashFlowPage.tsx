import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import {
  buildFinanceCashFlowDashboardQuery,
  buildFinanceCashFlowExportQuery,
  buildFinanceCashFlowYearOptions,
  createDefaultFinanceCashFlowUiFilters,
  FINANCE_CASH_FLOW_DATE_BASE_OPTIONS,
  FINANCE_CASH_FLOW_INVOICE_OPTIONS,
  FINANCE_CASH_FLOW_MONTH_OPTIONS,
  FINANCE_CASH_FLOW_STATUS_OPTIONS,
  FINANCE_CASH_FLOW_TABS,
  FINANCE_CASH_FLOW_VIEW_OPTIONS,
  normalizeFinanceCashFlowUiFilters,
  PHASE1_FINANCE_CASH_FLOW_TABS,
  type FinanceCashFlowDashboardPayload,
  type FinanceCashFlowTabId,
  type FinanceCashFlowUiFilters,
} from "@/src/lib/financeCashFlowDashboardTypes";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDateTime,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeCashFlowExportFilename } from "@/src/lib/financeCashFlowExport";
import {
  canExportFinanceCashFlow,
  canViewFinanceCashFlow,
} from "@/src/lib/financeCashFlowPermissions";
import { FinanceCashFlowCalendar } from "@/src/components/finance/cash-flow/FinanceCashFlowCalendar";
import { FinanceCashFlowRiskTab } from "@/src/components/finance/cash-flow/FinanceCashFlowRiskTab";
import { FinanceCashFlowDetailTable } from "@/src/components/finance/cash-flow/FinanceCashFlowDetailTable";
import { FinanceCashFlowYtdSummary } from "@/src/components/finance/cash-flow/FinanceCashFlowYtdSummary";
import { FinanceCashFlowExecutiveSummaryPanel } from "@/src/components/finance/cash-flow/FinanceCashFlowExecutiveSummaryPanel";
import { FinanceCashFlowMonthlyPlannedChart } from "@/src/components/finance/cash-flow/FinanceCashFlowMonthlyPlannedChart";
import { FinanceCashFlowMonthlyTimelineTable } from "@/src/components/finance/cash-flow/FinanceCashFlowMonthlyTimelineTable";
import { FinanceCashFlowReconciliationPanel } from "@/src/components/finance/cash-flow/FinanceCashFlowReconciliationPanel";
import {
  FinanceFilterScopeBanner,
  FinanceManagementSanitizationNote,
} from "@/src/components/finance/FinanceFilterScopeBanner";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceBiExecutiveHeader } from "@/src/components/finance/bi/FinanceBiExecutiveHeader";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import { buildFinanceCashFlowFilterChips } from "@/src/lib/financeBiFilterChips";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import {
  FINANCE_CASH_FLOW_NOT_BILLING_SCOPE,
  FINANCE_CASH_FLOW_SYNC_SCOPE,
} from "@/src/lib/financeFilterScope";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

function filterFieldClass() {
  return "w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-primary/30";
}

function labelClass() {
  return "text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]";
}

export function FinanceCashFlowPage() {
  const auth = useAuth();
  const canView = canViewFinanceCashFlow(auth);
  const canExport = canExportFinanceCashFlow(auth);

  const [draftFilters, setDraftFilters] = useState<FinanceCashFlowUiFilters>(() =>
    createDefaultFinanceCashFlowUiFilters()
  );
  const [appliedFilters, setAppliedFilters] = useState<FinanceCashFlowUiFilters>(() =>
    createDefaultFinanceCashFlowUiFilters()
  );
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [activeTab, setActiveTab] = useState<FinanceCashFlowTabId>("overview");
  const [payload, setPayload] = useState<FinanceCashFlowDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const appliedQuery = useMemo(
    () => buildFinanceCashFlowDashboardQuery(appliedFilters),
    [appliedFilters]
  );
  const draftQuery = useMemo(
    () => buildFinanceCashFlowDashboardQuery(draftFilters),
    [draftFilters]
  );
  const hasPendingFilterChanges = appliedQuery !== draftQuery;
  const filterStatus = resolveFinanceBiFilterStatus(appliedQuery, hasPendingFilterChanges);
  const filtersActive = appliedQuery.length > 0;

  const loadDashboard = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const url = appliedQuery
        ? `/api/finance/cash-flow/dashboard?${appliedQuery}`
        : "/api/finance/cash-flow/dashboard";
      const data = await fetchJsonOk<FinanceCashFlowDashboardPayload>(url);
      setPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar fluxo de caixa.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [appliedQuery, canView]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleApplyFilters = () => {
    setAppliedFilters(normalizeFinanceCashFlowUiFilters(draftFilters));
  };

  const handleClearFilters = () => {
    const defaults = createDefaultFinanceCashFlowUiFilters();
    setDraftFilters(defaults);
    setAppliedFilters(defaults);
  };

  const handleExport = async () => {
    if (!canExport) return;
    setExporting(true);
    try {
      const q = buildFinanceCashFlowExportQuery(appliedFilters);
      const res = await fetch(`/api/finance/cash-flow/export?${q}`, { credentials: "include" });
      if (!res.ok) throw new Error("Exportação falhou.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = financeCashFlowExportFilename(
        appliedFilters.year ? Number(appliedFilters.year) : undefined
      );
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha na exportação.");
    } finally {
      setExporting(false);
    }
  };

  const chips = useMemo(
    () =>
      buildFinanceCashFlowFilterChips(appliedFilters, (field) => {
        const next = { ...draftFilters };
        if (field === "year" || field === "month") next[field] = "";
        else if (field === "viewMode") next.viewMode = "projected";
        else if (field === "dateBase") next.dateBase = "due";
        else if (field === "status") next.status = "all";
        else if (field === "invoiceIssued") next.invoiceIssued = "all";
        else next[field] = "";
        setDraftFilters(next);
        setAppliedFilters(normalizeFinanceCashFlowUiFilters(next));
      }),
    [appliedFilters, draftFilters]
  );

  if (!canView) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        Sem permissão para Fluxo de Caixa.
      </div>
    );
  }

  const cards = payload?.cards;
  const appliedFiltersLabel = useMemo(
    () => chips.map((c) => c.label).join(" · "),
    [chips]
  );

  return (
    <FinanceBiDashboardShell>
      <div data-testid="cash-flow-page" className="contents">
      <FinanceBiExecutiveHeader
        eyebrow="Financeiro · Fluxo de Caixa"
        title="Fluxo de Caixa"
        subtitle={
          <>
            Entradas de <strong>Contas a Receber</strong> e saídas de{" "}
            <strong>Contas a Pagar</strong> — visão gerencial de caixa projetado.
          </>
        }
        filterStatus={filterStatus}
        meta={[
          {
            label: "Fonte",
            value: "Contas a Receber + Contas a Pagar",
          },
          {
            label: "Última sync",
            value: cards?.lastSyncAt ? formatFinanceDateTime(cards.lastSyncAt) : "—",
            hint: FINANCE_CASH_FLOW_SYNC_SCOPE,
          },
        ]}
        actions={[
          {
            id: "refresh",
            label: "Atualizar",
            onClick: () => void loadDashboard(),
            disabled: loading,
            loading,
            icon: <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />,
            variant: "outline",
          },
          ...(canExport
            ? [
                {
                  id: "export",
                  label: "Exportar",
                  onClick: () => void handleExport(),
                  disabled: exporting || loading,
                  loading: exporting,
                  icon: <Download className="h-4 w-4" />,
                  variant: "accent" as const,
                },
              ]
            : []),
        ]}
      />

      <FinanceFilterScopeBanner active={filtersActive} />
      <FinanceManagementSanitizationNote
        dataSanitization={payload?.dataSanitization}
        managementScope={payload?.filtersApplied?.cashFlowScope ?? "company"}
      />

      <div data-testid="cash-flow-filters">
      <FinanceBiFilterPanel
        expanded={showAdvancedFilters}
        onToggle={() => setShowAdvancedFilters((v) => !v)}
        filterStatus={filterStatus}
        chips={chips}
        onApply={handleApplyFilters}
        onClear={handleClearFilters}
        applyDisabled={!hasPendingFilterChanges}
        hint={hasPendingFilterChanges ? "Alterações pendentes — clique em Aplicar." : undefined}
        alwaysVisible={
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <label className="space-y-1">
              <span className={labelClass()}>Ano</span>
              <select
                className={filterFieldClass()}
                value={draftFilters.year}
                onChange={(e) => setDraftFilters((f) => ({ ...f, year: e.target.value }))}
              >
                {buildFinanceCashFlowYearOptions().map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelClass()}>Mês</span>
              <select
                className={filterFieldClass()}
                value={draftFilters.month}
                onChange={(e) => setDraftFilters((f) => ({ ...f, month: e.target.value }))}
              >
                {FINANCE_CASH_FLOW_MONTH_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelClass()}>Empresa</span>
              <input
                className={filterFieldClass()}
                value={draftFilters.companyName}
                onChange={(e) => setDraftFilters((f) => ({ ...f, companyName: e.target.value }))}
                placeholder="Filtrar empresa"
              />
            </label>
            <label className="space-y-1">
              <span className={labelClass()}>Visão</span>
              <select
                className={filterFieldClass()}
                value={draftFilters.viewMode}
                onChange={(e) =>
                  setDraftFilters((f) => ({
                    ...f,
                    viewMode: e.target.value as FinanceCashFlowUiFilters["viewMode"],
                  }))
                }
              >
                {FINANCE_CASH_FLOW_VIEW_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelClass()}>Data base</span>
              <select
                className={filterFieldClass()}
                value={draftFilters.viewMode === "realized" ? "settlement" : draftFilters.dateBase}
                disabled={draftFilters.viewMode === "realized"}
                onChange={(e) =>
                  setDraftFilters((f) => ({
                    ...f,
                    dateBase: e.target.value as FinanceCashFlowUiFilters["dateBase"],
                  }))
                }
              >
                {FINANCE_CASH_FLOW_DATE_BASE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {draftFilters.viewMode === "realized" ? (
                <p className="text-[10px] text-[#6B7280]">Modo realizado usa data de baixa/pagamento.</p>
              ) : null}
            </label>
            <label className="space-y-1">
              <span className={labelClass()}>Status</span>
              <select
                className={filterFieldClass()}
                value={draftFilters.status}
                onChange={(e) =>
                  setDraftFilters((f) => ({
                    ...f,
                    status: e.target.value as FinanceCashFlowUiFilters["status"],
                  }))
                }
              >
                {FINANCE_CASH_FLOW_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 px-5 py-4">
          <label className="space-y-1">
            <span className={labelClass()}>Cliente</span>
            <input
              className={filterFieldClass()}
              value={draftFilters.customerName}
              onChange={(e) => setDraftFilters((f) => ({ ...f, customerName: e.target.value }))}
            />
          </label>
          <label className="space-y-1">
            <span className={labelClass()}>Fornecedor</span>
            <input
              className={filterFieldClass()}
              value={draftFilters.supplierName}
              onChange={(e) => setDraftFilters((f) => ({ ...f, supplierName: e.target.value }))}
            />
          </label>
          <label className="space-y-1">
            <span className={labelClass()}>CNPJ/CPF</span>
            <input
              className={filterFieldClass()}
              value={draftFilters.personCnpj}
              onChange={(e) => setDraftFilters((f) => ({ ...f, personCnpj: e.target.value }))}
            />
          </label>
          <label className="space-y-1">
            <span className={labelClass()}>Forma de pagamento</span>
            <input
              className={filterFieldClass()}
              value={draftFilters.paymentMethodName}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, paymentMethodName: e.target.value }))
              }
            />
          </label>
          <label className="space-y-1">
            <span className={labelClass()}>Conta bancária</span>
            <input
              className={filterFieldClass()}
              value={draftFilters.bankAccountName}
              onChange={(e) => setDraftFilters((f) => ({ ...f, bankAccountName: e.target.value }))}
            />
          </label>
          <label className="space-y-1">
            <span className={labelClass()}>Origem do recebível</span>
            <select
              className={filterFieldClass()}
              value={draftFilters.invoiceIssued}
              onChange={(e) => setDraftFilters((f) => ({ ...f, invoiceIssued: e.target.value }))}
            >
              {FINANCE_CASH_FLOW_INVOICE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </FinanceBiFilterPanel>
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-[#E5E7EB] pb-2">
        {FINANCE_CASH_FLOW_TABS.map((tab) => {
          const enabled = PHASE1_FINANCE_CASH_FLOW_TABS.includes(tab.id);
          return (
            <button
              key={tab.id}
              type="button"
              disabled={!enabled}
              onClick={() => enabled && setActiveTab(tab.id)}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                activeTab === tab.id && enabled
                  ? "bg-primary text-primary-foreground"
                  : enabled
                    ? "text-muted-foreground hover:bg-accent"
                    : "text-muted-foreground/50 cursor-not-allowed"
              )}
              title={enabled ? undefined : "Disponível em fase posterior"}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : null}

      {loading && !payload ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando fluxo de caixa…
        </div>
      ) : null}

      {payload && activeTab === "overview" ? (
        <div className="space-y-6">
          <FinanceCashFlowExecutiveSummaryPanel
            summary={payload.executiveSummary}
            cashHealthScore={payload.cashHealthScore}
            filtersActive={filtersActive}
            appliedFiltersLabel={appliedFiltersLabel}
          />

          <FinanceCashFlowReconciliationPanel reconciliation={payload.reconciliation} />

          <FinanceCashFlowMonthlyPlannedChart
            year={payload.executiveSummary.metadata.year}
            rows={payload.executiveSummary.monthlyTimeline}
          />

          <FinanceCashFlowMonthlyTimelineTable
            rows={payload.executiveSummary.monthlyTimeline}
            year={payload.executiveSummary.metadata.year}
          />

          <FinanceCashFlowYtdSummary
            executiveYtd={payload.executiveYtd}
            executiveYtdReading={payload.executiveYtdReading}
            filtersActive={filtersActive}
            appliedFiltersLabel={appliedFiltersLabel}
          />

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CriticalList
              title="Maiores entradas previstas"
              items={payload.largestProjectedInflows}
            />
            <CriticalList
              title="Maiores saídas previstas"
              items={payload.largestProjectedOutflows}
              outflow
            />
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CriticalList title="Vencidos a receber" items={payload.overdueReceivables} />
            <CriticalList title="Pagamentos vencidos" items={payload.overduePayables} outflow />
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PartyList
              title="Top clientes por entrada"
              subtitle="Saldo em aberto AR — filtros aplicados"
              items={payload.topCustomers}
              emptyLabel="Nenhum cliente com saldo em aberto."
              inflow
            />
            <PartyList
              title="Top fornecedores por saída"
              subtitle="Saldo em aberto AP — filtros aplicados"
              items={payload.topSuppliers}
              emptyLabel="Nenhum fornecedor com saldo em aberto."
              outflow
            />
          </section>

          <FinanceCashFlowDetailTable
            inflows={[...payload.largestProjectedInflows, ...payload.overdueReceivables]}
            outflows={[...payload.largestProjectedOutflows, ...payload.overduePayables]}
          />
        </div>
      ) : null}

      {payload && activeTab === "calendar" ? (
        <FinanceCashFlowCalendar
          days={payload.dailyCalendar}
          monthLabel={
            appliedFilters.month
              ? (FINANCE_CASH_FLOW_MONTH_OPTIONS.find((o) => o.value === appliedFilters.month)
                  ?.label ?? "Mês selecionado")
              : new Date(payload.referenceDate).toLocaleDateString("pt-BR", {
                  month: "long",
                  year: "numeric",
                })
          }
        />
      ) : null}

      {payload && activeTab === "risk" ? <FinanceCashFlowRiskTab payload={payload} /> : null}
      </div>
    </FinanceBiDashboardShell>
  );
}

function PartyList({
  title,
  subtitle,
  items,
  emptyLabel,
  inflow = true,
  outflow = false,
}: {
  title: string;
  subtitle: string;
  items: FinanceCashFlowDashboardPayload["topCustomers"];
  emptyLabel: string;
  inflow?: boolean;
  outflow?: boolean;
}) {
  return (
    <div className={`${financeBiCardClass} p-5 space-y-3`}>
      <div>
        <h3 className="text-sm font-bold text-[#111827]">{title}</h3>
        <p className="text-[11px] text-[#6B7280]">{subtitle}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 6).map((item, idx) => (
            <li
              key={`${item.personCnpj ?? item.personName ?? idx}`}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="truncate font-medium text-[#111827]">{displayFinanceText(item.personName)}</span>
              <span
                className={cn(
                  "shrink-0 font-bold tabular-nums text-right",
                  outflow ? "text-[#DC2626]" : inflow ? "text-[#059669]" : "text-[#111827]"
                )}
              >
                {outflow ? "−" : inflow ? "+" : ""}
                {formatFinanceCurrency(item.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CriticalList({
  title,
  items,
  outflow = false,
}: {
  title: string;
  items: FinanceCashFlowDashboardPayload["largestProjectedInflows"];
  outflow?: boolean;
}) {
  return (
    <div className={`${financeBiCardClass} p-5 space-y-3`}>
      <div className="flex items-center gap-2">
        {outflow ? (
          <TrendingDown className="h-4 w-4 text-red-600" />
        ) : (
          <TrendingUp className="h-4 w-4 text-emerald-600" />
        )}
        <h3 className="text-sm font-bold text-[#111827]">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum título nesta categoria.</p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 5).map((item) => (
            <li key={`${item.side}-${item.externalId}`} className="text-sm space-y-0.5">
              <div className="flex justify-between gap-2">
                <span className="font-medium truncate">{displayFinanceText(item.personName)}</span>
                <span
                  className={cn(
                    "shrink-0 font-bold tabular-nums text-right",
                    outflow ? "text-[#DC2626]" : "text-[#059669]"
                  )}
                >
                  {outflow ? "−" : "+"}
                  {formatFinanceCurrency(item.amount)}
                </span>
              </div>
              <p className="text-[11px] text-[#6B7280]">
                Venc. {item.dueDate ? new Date(item.dueDate).toLocaleDateString("pt-BR") : "—"}
                {item.daysOverdue > 0 ? ` · ${item.daysOverdue}d atraso` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
