import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Download,
  Loader2,
  RefreshCw,
  Scale,
  TrendingDown,
  Wallet,
} from "lucide-react";
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
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
  formatFinanceDateTime,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeCashFlowExportFilename } from "@/src/lib/financeCashFlowExport";
import {
  canExportFinanceCashFlow,
  canViewFinanceCashFlow,
} from "@/src/lib/financeCashFlowPermissions";
import { FinanceCashFlowMonthlyChart } from "@/src/components/finance/FinanceCashFlowCharts";
import { FinanceCashFlowCalendar } from "@/src/components/finance/cash-flow/FinanceCashFlowCalendar";
import {
  FinanceCashFlowCriticalList,
  FinanceCashFlowPartyList,
} from "@/src/components/finance/cash-flow/FinanceCashFlowAnalyticLists";
import { FinanceCashFlowDetailTable } from "@/src/components/finance/cash-flow/FinanceCashFlowDetailTable";
import { FinanceCashFlowFilterPanel } from "@/src/components/finance/cash-flow/FinanceCashFlowFilterPanel";
import { FinanceCashFlowHeader } from "@/src/components/finance/cash-flow/FinanceCashFlowHeader";
import { FinanceCashFlowKpiCard } from "@/src/components/finance/cash-flow/FinanceCashFlowKpiCard";
import { FinanceCashFlowScopeBanner } from "@/src/components/finance/cash-flow/FinanceCashFlowScopeBanner";
import { FinanceCashFlowShell } from "@/src/components/finance/cash-flow/FinanceCashFlowShell";
import { FinanceCashFlowTabs } from "@/src/components/finance/cash-flow/FinanceCashFlowTabs";
import { buildFinanceCashFlowFilterChips } from "@/src/lib/financeBiFilterChips";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import { countActiveCashFlowFilters } from "@/src/lib/financeCashFlowPageUi";
import { controlRoomFieldClass, controlRoomLabelClass } from "@/src/lib/financeControlRoomTheme";
import {
  FINANCE_CASH_FLOW_COMBINED_SCOPE,
  FINANCE_CASH_FLOW_NOT_BILLING_SCOPE,
  FINANCE_CASH_FLOW_PROJECTED_BALANCE_SCOPE,
  FINANCE_CASH_FLOW_SYNC_SCOPE,
  withAppliedFilterSub,
} from "@/src/lib/financeFilterScope";
import { cn } from "@/src/lib/utils";

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
  const activeFilterCount = countActiveCashFlowFilters(appliedFilters);

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

  const viewModeLabel =
    FINANCE_CASH_FLOW_VIEW_OPTIONS.find((o) => o.value === appliedFilters.viewMode)?.label ??
    "Previsto";

  const calendarMonthLabel = useMemo(() => {
    const year = appliedFilters.year || String(new Date().getFullYear());
    const monthOpt = FINANCE_CASH_FLOW_MONTH_OPTIONS.find((m) => m.value === appliedFilters.month);
    const monthName = monthOpt?.value ? monthOpt.label : "Todos os meses";
    return `${monthName} / ${year}`;
  }, [appliedFilters.month, appliedFilters.year]);

  if (!canView) {
    return (
      <div className="rounded-md border border-[#E7E5E4] bg-[#F5F5F4] p-4 text-sm text-[#57534E]">
        Sem permissão para Fluxo de Caixa.
      </div>
    );
  }

  const cards = payload?.cards;

  return (
    <FinanceCashFlowShell>
      <FinanceCashFlowHeader
        title="Fluxo de Caixa"
        subtitle={
          <>
            Entradas de <strong>Contas a Receber</strong> e saídas de{" "}
            <strong>Contas a Pagar</strong>
          </>
        }
        scopePill={FINANCE_CASH_FLOW_NOT_BILLING_SCOPE}
        filterStatus={filterStatus}
        meta={[
          {
            label: "Fonte",
            value: "Nomus AR + Nomus AP",
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
            icon: <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />,
            variant: "outline",
          },
          ...(canExport
            ? [
                {
                  id: "export",
                  label: "Exportar",
                  testId: "cash-flow-export-btn",
                  onClick: () => void handleExport(),
                  disabled: exporting || loading,
                  loading: exporting,
                  icon: <Download className="h-3.5 w-3.5" />,
                  variant: "accent" as const,
                },
              ]
            : []),
        ]}
      />

      <FinanceCashFlowScopeBanner active={filtersActive} />

      <FinanceCashFlowFilterPanel
        expanded={showAdvancedFilters}
        onToggle={() => setShowAdvancedFilters((v) => !v)}
        filterStatus={filterStatus}
        activeFilterCount={activeFilterCount}
        chips={chips}
        onApply={handleApplyFilters}
        onClear={handleClearFilters}
        applyDisabled={!hasPendingFilterChanges}
        hint={hasPendingFilterChanges ? "Alterações pendentes — clique em Aplicar." : undefined}
        alwaysVisible={
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <label className="space-y-0.5">
              <span className={controlRoomLabelClass}>Ano</span>
              <select
                className={controlRoomFieldClass}
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
            <label className="space-y-0.5">
              <span className={controlRoomLabelClass}>Mês</span>
              <select
                className={controlRoomFieldClass}
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
            <label className="space-y-0.5">
              <span className={controlRoomLabelClass}>Empresa</span>
              <input
                className={controlRoomFieldClass}
                value={draftFilters.companyName}
                onChange={(e) => setDraftFilters((f) => ({ ...f, companyName: e.target.value }))}
                placeholder="Filtrar empresa"
              />
            </label>
            <label className="space-y-0.5">
              <span className={controlRoomLabelClass}>Visão</span>
              <select
                className={controlRoomFieldClass}
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
            <label className="space-y-0.5">
              <span className={controlRoomLabelClass}>Status</span>
              <select
                className={controlRoomFieldClass}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <label className="space-y-0.5">
            <span className={controlRoomLabelClass}>Cliente</span>
            <input
              className={controlRoomFieldClass}
              value={draftFilters.customerName}
              onChange={(e) => setDraftFilters((f) => ({ ...f, customerName: e.target.value }))}
            />
          </label>
          <label className="space-y-0.5">
            <span className={controlRoomLabelClass}>Fornecedor</span>
            <input
              className={controlRoomFieldClass}
              value={draftFilters.supplierName}
              onChange={(e) => setDraftFilters((f) => ({ ...f, supplierName: e.target.value }))}
            />
          </label>
          <label className="space-y-0.5">
            <span className={controlRoomLabelClass}>CNPJ/CPF</span>
            <input
              className={controlRoomFieldClass}
              value={draftFilters.personCnpj}
              onChange={(e) => setDraftFilters((f) => ({ ...f, personCnpj: e.target.value }))}
            />
          </label>
          <label className="space-y-0.5">
            <span className={controlRoomLabelClass}>Forma de pagamento</span>
            <input
              className={controlRoomFieldClass}
              value={draftFilters.paymentMethodName}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, paymentMethodName: e.target.value }))
              }
            />
          </label>
          <label className="space-y-0.5">
            <span className={controlRoomLabelClass}>Conta bancária</span>
            <input
              className={controlRoomFieldClass}
              value={draftFilters.bankAccountName}
              onChange={(e) => setDraftFilters((f) => ({ ...f, bankAccountName: e.target.value }))}
            />
          </label>
          <label className="space-y-0.5">
            <span className={controlRoomLabelClass}>Data base</span>
            <select
              className={controlRoomFieldClass}
              value={draftFilters.dateBase}
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
          </label>
          <label className="space-y-0.5">
            <span className={controlRoomLabelClass}>NF emitida?</span>
            <select
              className={controlRoomFieldClass}
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
      </FinanceCashFlowFilterPanel>

      <FinanceCashFlowTabs
        tabs={FINANCE_CASH_FLOW_TABS}
        activeTab={activeTab}
        onChange={setActiveTab}
        isEnabled={(id) => PHASE1_FINANCE_CASH_FLOW_TABS.includes(id)}
      />

      {error ? (
        <div className="rounded-md border border-[#B64230]/30 bg-[#F9EBE8] px-3 py-2 text-sm text-[#B64230]">
          {error}
        </div>
      ) : null}

      {loading && !payload ? (
        <div className="space-y-3 py-4">
          <div className="cr-skeleton h-24 rounded-md" />
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="cr-skeleton h-20 rounded-md" />
            ))}
          </div>
          <div className="cr-skeleton h-72 rounded-md" />
          <p className="font-mono text-[10px] text-[#57534E] text-center">
            Aguardando dados de Contas a Receber/Pagar…
          </p>
        </div>
      ) : null}

      {payload && activeTab === "overview" ? (
        <div className="space-y-4">
          <section>
            <h2 className="font-ui text-xs font-bold uppercase tracking-[0.12em] text-[#57534E] mb-2 px-0.5">
              Resumo executivo
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
              <FinanceCashFlowKpiCard
                testId="kpi-net-balance"
                label="Saldo líquido"
                value={formatFinanceCurrency(cards?.netFlowAmount ?? 0)}
                sub={withAppliedFilterSub(viewModeLabel, filtersActive)}
                icon={Scale}
                colorClass={
                  cards && cards.netFlowAmount < 0 ? "text-[#B64230]" : "text-[#2C5530]"
                }
                scopeNote={
                  appliedFilters.viewMode === "combined"
                    ? FINANCE_CASH_FLOW_COMBINED_SCOPE
                    : undefined
                }
              />
              <FinanceCashFlowKpiCard
                testId="kpi-total-inflow"
                label="Total a receber"
                value={formatFinanceCurrency(cards?.totalReceivableOpen ?? 0)}
                sub={withAppliedFilterSub("Títulos AR em aberto", filtersActive)}
                icon={ArrowDownRight}
                colorClass="text-[#2C5530]"
              />
              <FinanceCashFlowKpiCard
                testId="kpi-total-outflow"
                label="Total a pagar"
                value={formatFinanceCurrency(cards?.totalPayableOpen ?? 0)}
                sub={withAppliedFilterSub("Títulos AP em aberto", filtersActive)}
                icon={ArrowUpRight}
                colorClass="text-[#B64230]"
              />
              <FinanceCashFlowKpiCard
                testId="kpi-accumulated-balance"
                label="Saldo acumulado"
                value={formatFinanceCurrency(cards?.accumulatedBalance ?? 0)}
                sub="No período filtrado"
                icon={Wallet}
                colorClass="text-[#1C1917]"
                scopeNote={FINANCE_CASH_FLOW_PROJECTED_BALANCE_SCOPE}
              />
              <FinanceCashFlowKpiCard
                label="Dias negativos"
                value={String(cards?.negativeBalanceDaysCount ?? 0)}
                sub={`${cards?.negativeBalanceMonthsCount ?? 0} mês(es) líquido < 0`}
                icon={TrendingDown}
                colorClass={
                  cards && cards.negativeBalanceDaysCount > 0
                    ? "text-[#D07722]"
                    : "text-[#57534E]"
                }
              />
              <FinanceCashFlowKpiCard
                label="Vencidos no caixa"
                value={formatFinanceCurrency(cards?.overdueCashImpact ?? 0)}
                sub={`AR ${formatFinanceCurrencyCompact(cards?.overdueReceivableAmount ?? 0)} · AP ${formatFinanceCurrencyCompact(cards?.overduePayableAmount ?? 0)}`}
                icon={AlertTriangle}
                colorClass="text-[#D07722]"
              />
            </div>
          </section>

          <FinanceCashFlowMonthlyChart
            points={payload.monthlySeries}
            viewModeLabel={viewModeLabel}
          />

          <FinanceCashFlowCalendar points={payload.dailyCalendar} monthLabel={calendarMonthLabel} />

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <FinanceCashFlowPartyList
              title="Top clientes por entrada"
              subtitle="Saldo em aberto AR — filtros aplicados"
              items={payload.topCustomers}
              emptyLabel="Nenhum cliente com saldo em aberto."
              inflow
            />
            <FinanceCashFlowPartyList
              title="Top fornecedores por saída"
              subtitle="Saldo em aberto AP — filtros aplicados"
              items={payload.topSuppliers}
              emptyLabel="Nenhum fornecedor com saldo em aberto."
              inflow={false}
            />
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <FinanceCashFlowCriticalList
              title="Maiores entradas previstas"
              items={payload.largestProjectedInflows}
            />
            <FinanceCashFlowCriticalList
              title="Maiores saídas previstas"
              items={payload.largestProjectedOutflows}
              outflow
            />
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <FinanceCashFlowCriticalList title="Vencidos a receber" items={payload.overdueReceivables} />
            <FinanceCashFlowCriticalList
              title="Pagamentos vencidos"
              items={payload.overduePayables}
              outflow
            />
          </section>

          <FinanceCashFlowDetailTable
            inflows={[...payload.largestProjectedInflows, ...payload.overdueReceivables]}
            outflows={[...payload.largestProjectedOutflows, ...payload.overduePayables]}
          />
        </div>
      ) : null}
    </FinanceCashFlowShell>
  );
}
