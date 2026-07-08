import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Package,
  RefreshCw,
  ShoppingBag,
  Target,
  TrendingUp,
  Wallet,
  Users,
  AlertTriangle,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import {
  buildFinanceModuleEyebrow,
  FINANCE_FILTER_PANEL_TITLE,
  FINANCE_HEADER_ACTION_EXPORT_CSV,
  FINANCE_HEADER_ACTION_REFRESH,
} from "@/src/lib/financeModuleUiStandards";
import { FINANCE_SALES_ORDERS_EXECUTIVE_SUBTITLE } from "@/src/lib/financeDataAuditCopy";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import type { FinanceSalesOrdersDashboardPayload } from "@/src/lib/financeSalesOrdersDashboardTypes";
import {
  buildFinanceSalesOrdersMonthlyComparisonNarrative,
  buildFinanceSalesOrdersPortfolioNarrative,
  buildFinanceSalesOrdersProjectionNarrative,
  buildFinanceSalesOrdersTopCustomersNarrative,
} from "@/src/lib/financeSalesOrdersNarratives";
import {
  formatExecutiveCurrency,
  formatExecutivePercent,
} from "@/src/lib/executiveDashboardFormatters";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { FinanceDataAuditButton } from "@/src/components/finance/shared/FinanceDataAuditButton";
import { FinanceDataAuditDrawer } from "@/src/components/finance/shared/FinanceDataAuditDrawer";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";
import { FinanceSalesOrdersMonthlyChart } from "@/src/components/finance/sales-orders/FinanceSalesOrdersMonthlyChart";
import { FinanceSalesOrdersProjectionChart } from "@/src/components/finance/sales-orders/FinanceSalesOrdersProjectionChart";
import { FinanceSalesOrdersBreakdownChart } from "@/src/components/finance/sales-orders/FinanceSalesOrdersBreakdownChart";
import { FinanceSalesOrdersOpenPortfolioChart } from "@/src/components/finance/sales-orders/FinanceSalesOrdersOpenPortfolioChart";
import { BI_LOGISTIC_STATUS_CARDS } from "@/src/lib/salesOrderLogisticStatus";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import { ExecutiveChartScenario } from "@/src/components/finance/executive-report/charts/ExecutiveChartScenario";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import {
  ALL_SALES_ORDER_STATUSES,
  SALES_ORDER_STATUS_LABELS,
} from "@/src/lib/materialDemandFilters";
import type { FinanceDataAuditSection } from "@/src/lib/financeDataAudit";

const MONTH_OPTIONS = [
  { value: "", label: "Todos" },
  ...Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1).padStart(2, "0"),
  })),
];

function buildYearOptions(): number[] {
  const current = new Date().getFullYear();
  const years: number[] = [];
  for (let y = current; y >= current - 5; y -= 1) years.push(y);
  return years;
}

function buildAuditSections(data: FinanceSalesOrdersDashboardPayload): FinanceDataAuditSection[] {
  return [
    {
      kind: "list",
      id: "sources",
      title: "Fontes de dados",
      items: [
        { label: "Fonte principal", value: data.dataQuality.source },
        { label: "Campo de valor", value: "SalesOrder.totalNetValue" },
        { label: "Última sincronização Nomus", value: data.dataQuality.lastNomusSyncAt ? formatFinanceDateTime(data.dataQuality.lastNomusSyncAt) : "—" },
        { label: "Meta comercial", value: data.dataQuality.targetConfigured ? "Configurada" : "Não configurada" },
      ],
    },
    {
      kind: "paragraphs",
      id: "rules",
      title: "Critérios de cálculo",
      paragraphs: data.dataQuality.calculationRules,
    },
    {
      kind: "paragraphs",
      id: "portfolio-evolution",
      title: "Evolução da carteira",
      paragraphs: [data.dataQuality.openPortfolioEvolutionNote],
    },
    {
      kind: "list",
      id: "filters",
      title: "Filtros aplicados",
      items: [
        { label: "Ano", value: String(data.filters.year) },
        { label: "Mês", value: data.filters.month ? String(data.filters.month) : "Todos" },
        { label: "Cliente", value: data.filters.customerId ?? "Todos" },
        { label: "Vendedor", value: data.filters.sellerName ?? "Todos" },
        { label: "Empresa", value: data.filters.company ?? "Todas" },
        { label: "Status pedido", value: data.filters.status ?? "Todos" },
        { label: "NF", value: data.filters.invoiceStatus },
        {
          label: "Status logístico BI",
          value:
            BI_LOGISTIC_STATUS_CARDS.find((c) => c.id === data.filters.logisticStatus)?.label ??
            "Todos",
        },
      ],
    },
    {
      kind: "list",
      id: "excluded",
      title: "Exclusões",
      items: [
        {
          label: "Cancelados",
          value: String(data.dataQuality.excludedCancelledOrdersCount),
        },
        { label: "Erro", value: String(data.dataQuality.excludedErrorOrdersCount) },
      ],
    },
    {
      kind: "status",
      id: "warnings",
      title: "Avisos",
      items: data.dataQuality.warnings.map((text) => ({ text })),
    },
  ];
}

const CRITICAL_REASON_LABELS: Record<string, string> = {
  overdue_pending: "Atrasado pendente",
  high_open_portfolio: "Alto valor em carteira",
  without_invoice: "Sem NF processada",
  review_data: "Revisar dados",
};

export function FinanceSalesOrdersPage() {
  const currentYear = new Date().getFullYear();
  const [auditOpen, setAuditOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [data, setData] = useState<FinanceSalesOrdersDashboardPayload | null>(null);

  const [draftYear, setDraftYear] = useState(String(currentYear));
  const [appliedYear, setAppliedYear] = useState(String(currentYear));
  const [draftMonth, setDraftMonth] = useState("");
  const [appliedMonth, setAppliedMonth] = useState("");
  const [draftSeller, setDraftSeller] = useState("");
  const [appliedSeller, setAppliedSeller] = useState("");
  const [draftCompany, setDraftCompany] = useState("");
  const [appliedCompany, setAppliedCompany] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [appliedStatus, setAppliedStatus] = useState("");
  const [draftInvoice, setDraftInvoice] = useState("");
  const [appliedInvoice, setAppliedInvoice] = useState("");
  const [draftCustomerId, setDraftCustomerId] = useState("");
  const [appliedCustomerId, setAppliedCustomerId] = useState("");
  const [customerSelection, setCustomerSelection] = useState<EntityAutocompleteSelection | null>(null);
  const [draftLogistic, setDraftLogistic] = useState("");
  const [appliedLogistic, setAppliedLogistic] = useState("");
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("year", appliedYear);
    if (appliedMonth) params.set("month", appliedMonth);
    if (appliedSeller.trim()) params.set("sellerName", appliedSeller.trim());
    if (appliedCompany.trim()) params.set("company", appliedCompany.trim());
    if (appliedStatus) params.set("status", appliedStatus);
    if (appliedInvoice) params.set("invoiceStatus", appliedInvoice);
    if (appliedCustomerId) params.set("customerId", appliedCustomerId);
    if (appliedLogistic) params.set("logisticStatus", appliedLogistic);
    return params.toString();
  }, [
    appliedYear,
    appliedMonth,
    appliedSeller,
    appliedCompany,
    appliedStatus,
    appliedInvoice,
    appliedCustomerId,
    appliedLogistic,
  ]);

  const hasPendingFilters =
    draftYear !== appliedYear ||
    draftMonth !== appliedMonth ||
    draftSeller !== appliedSeller ||
    draftCompany !== appliedCompany ||
    draftStatus !== appliedStatus ||
    draftInvoice !== appliedInvoice ||
    draftCustomerId !== appliedCustomerId ||
    draftLogistic !== appliedLogistic;

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<FinanceSalesOrdersDashboardPayload>(
        `/api/finance/sales-orders/dashboard?${queryString}`,
        { signal: ac.signal }
      );
      setData(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("FinanceSalesOrdersPage.load", e);
      setError(
        buildFinanceTabLoadError(
          "Não foi possível carregar o dashboard de Pedidos de Venda.",
          e
        )
      );
      setData(null);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyFilters = () => {
    setAppliedYear(draftYear);
    setAppliedMonth(draftMonth);
    setAppliedSeller(draftSeller);
    setAppliedCompany(draftCompany);
    setAppliedStatus(draftStatus);
    setAppliedInvoice(draftInvoice);
    setAppliedCustomerId(draftCustomerId);
    setAppliedLogistic(draftLogistic);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/finance/sales-orders/export?${queryString}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `financeiro-pedidos-${appliedYear}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Falha ao exportar CSV.");
    } finally {
      setExporting(false);
    }
  };

  const summary = data?.summary;
  const auditSections = data ? buildAuditSections(data) : [];

  const filtersActive = Boolean(
    appliedMonth ||
      appliedSeller ||
      appliedCompany ||
      appliedStatus ||
      appliedInvoice ||
      appliedCustomerId ||
      appliedLogistic
  );
  const filterStatus = resolveFinanceBiFilterStatus(filtersActive, hasPendingFilters);

  return (
    <FinanceBiDashboardShell>
      <div data-testid="finance-sales-orders-page">
      <FinanceExecutivePageHeader
        eyebrow={buildFinanceModuleEyebrow("sales-orders")}
        title="Pedidos de Venda"
        subtitle={FINANCE_SALES_ORDERS_EXECUTIVE_SUBTITLE}
        updatedAt={data?.generatedAt}
        actions={[
          {
            id: "refresh",
            label: FINANCE_HEADER_ACTION_REFRESH,
            onClick: () => void load(),
            disabled: loading,
            loading,
            icon: <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />,
            variant: "outline",
          },
          {
            id: "export",
            label: FINANCE_HEADER_ACTION_EXPORT_CSV,
            onClick: () => void exportCsv(),
            disabled: exporting || loading || !data,
            loading: exporting,
            icon: <Download className="h-4 w-4" />,
            variant: "accent",
          },
        ]}
        extraActions={<FinanceDataAuditButton onClick={() => setAuditOpen(true)} />}
      />

      <FinanceDataAuditDrawer
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        sections={auditSections}
      />

      <FinanceBiFilterPanel
        title={FINANCE_FILTER_PANEL_TITLE}
        expanded={filtersExpanded}
        onToggle={() => setFiltersExpanded((v) => !v)}
        filterStatus={filterStatus}
        onApply={applyFilters}
        onClear={() => {
          setDraftYear(String(currentYear));
          setDraftMonth("");
          setDraftSeller("");
          setDraftCompany("");
          setDraftStatus("");
          setDraftInvoice("");
          setDraftCustomerId("");
          setDraftLogistic("");
          setCustomerSelection(null);
          setAppliedYear(String(currentYear));
          setAppliedMonth("");
          setAppliedSeller("");
          setAppliedCompany("");
          setAppliedStatus("");
          setAppliedInvoice("");
          setAppliedCustomerId("");
          setAppliedLogistic("");
        }}
        applyDisabled={!hasPendingFilters || loading}
        alwaysVisible={
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Ano</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              value={draftYear}
              onChange={(e) => setDraftYear(e.target.value)}
            >
              {buildYearOptions().map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Mês</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              value={draftMonth}
              onChange={(e) => setDraftMonth(e.target.value)}
            >
              {MONTH_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <CustomerAutocompleteFilter
              label="Cliente"
              value={customerSelection}
              placeholder="Todos"
              onChange={(sel) => {
                setCustomerSelection(sel);
                setDraftCustomerId(sel?.id ?? "");
              }}
              onClear={() => {
                setCustomerSelection(null);
                setDraftCustomerId("");
              }}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Vendedor</label>
            <input
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              value={draftSeller}
              onChange={(e) => setDraftSeller(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Empresa</label>
            <input
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              value={draftCompany}
              onChange={(e) => setDraftCompany(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">Status</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              value={draftStatus}
              onChange={(e) => setDraftStatus(e.target.value)}
            >
              <option value="">Todos</option>
              {ALL_SALES_ORDER_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {SALES_ORDER_STATUS_LABELS[st] ?? st}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">NF</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              value={draftInvoice}
              onChange={(e) => setDraftInvoice(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="with_invoice">Com NF processada</option>
              <option value="without_invoice">Sem NF processada</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase text-muted-foreground">
              Status logístico BI
            </label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              value={draftLogistic}
              onChange={(e) => setDraftLogistic(e.target.value)}
            >
              <option value="">Todos</option>
              {BI_LOGISTIC_STATUS_CARDS.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        }
      />

      {error ? (
        <FinanceModuleErrorBanner
          message={error}
          onRetry={() => void load()}
          onDismiss={() => setError(null)}
        />
      ) : null}
      {loading && !data ? (
        <FinanceModuleLoadingBlock label="Carregando pedidos de venda…" />
      ) : null}

      {summary && data ? (
        <>
          <ExecutiveSummarySection
            title="Resumo do período"
            eyebrow="Pedidos de venda no escopo filtrado — valores oficiais do módulo financeiro."
            testId="finance-sales-orders-executive-summary"
          >
            <SummaryKpiGrid minColumnWidth={220} className={SYSTEM_TOTALIZER_GRID_CLASS}>
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              icon={Package}
              label="Pedidos emitidos"
              amount={summary.orderCount}
              amountFormat="number"
              helperText="Total de pedidos válidos no período (issueDate)."
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              icon={ShoppingBag}
              label="Valor total de pedidos"
              amount={summary.totalOrdersAmount}
              amountFormat="currency"
              tone="money"
              helperText="Soma do valor líquido dos pedidos no filtro."
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              icon={Wallet}
              label="Carteira aberta"
              amount={summary.openPortfolioCount}
              amountFormat="number"
              helperText="Pedidos válidos sem NF processada."
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              icon={Wallet}
              label="Valor em carteira"
              amount={summary.openPortfolioAmount}
              amountFormat="currency"
              tone="money"
              helperText="Valor líquido dos pedidos ainda sem NF processada."
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              icon={Package}
              label="Pedidos faturados"
              amount={summary.invoicedOrdersCount}
              amountFormat="number"
              helperText="Pedidos com NF processada (dataProcessamento)."
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              icon={TrendingUp}
              label="Valor faturado"
              amount={summary.invoicedOrdersAmount}
              amountFormat="currency"
              tone="success"
              helperText="Valor líquido dos pedidos com NF processada."
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              icon={ShoppingBag}
              label="Ticket médio"
              amount={summary.averageTicketAmount}
              amountFormat="currency"
              tone="money"
              helperText="Valor total ÷ quantidade de pedidos."
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              icon={TrendingUp}
              label="Média diária"
              amount={summary.dailyAverageAmount}
              amountFormat="currency"
              tone="money"
              helperText="Valor YTD ÷ dias úteis decorridos (seg–sex)."
            />
            <SystemTotalizerCard
              className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
              icon={Target}
              label="Meta mês atual"
              amount={summary.monthTargetConfigured ? summary.monthTargetAmount : null}
              amountFormat={summary.monthTargetConfigured ? "currency" : undefined}
              value={summary.monthTargetConfigured ? undefined : "Meta não configurada"}
              valueSize={summary.monthTargetConfigured ? "default" : "text"}
              helperText={
                summary.monthTargetConfigured
                  ? "Meta comercial oficial do mês."
                  : "Nenhuma fonte de meta cadastrada no sistema."
              }
            />
            </SummaryKpiGrid>
          </ExecutiveSummarySection>

          <div className="grid gap-6 xl:grid-cols-2">
            <FinanceSalesOrdersMonthlyChart
              rows={data.monthlyComparison}
              selectedYear={data.filters.year}
              previousYear={data.filters.year - 1}
              config={data.chartSeries}
              scenarioText={buildFinanceSalesOrdersMonthlyComparisonNarrative(data)}
            />
            <FinanceSalesOrdersProjectionChart
              summary={summary}
              selectedYear={data.filters.year}
              scenarioText={buildFinanceSalesOrdersProjectionNarrative(data)}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <FinanceSalesOrdersBreakdownChart
              title="Status fabricação (item Nomus)"
              subtitle="Valor por status do item (códigos 1–6), classificado pelo item mais pendente."
              rows={data.manufacturingStatusBreakdown.map((row) => ({
                name: row.label,
                amount: row.amount,
                orderCount: row.orderCount,
              }))}
            />
            <FinanceSalesOrdersBreakdownChart
              title="Status logístico BI"
              subtitle="Regra Power BI: NF processada tem prioridade; pendente usa data planejada vs hoje."
              rows={data.logisticStatusBreakdown.map((row) => ({
                name: row.label,
                amount: row.amount,
                orderCount: row.orderCount,
              }))}
            />
          </div>

          <FinanceSalesOrdersOpenPortfolioChart
            rows={data.openPortfolioEvolution}
            note={data.dataQuality.openPortfolioEvolutionNote}
          />

          <div className={`${financeBiCardClass} p-5 space-y-3 overflow-x-auto`}>
            <h3 className="text-sm font-bold text-[#111827] flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Pedidos críticos
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">Pedido</th>
                  <th className="py-2 pr-3">Cliente</th>
                  <th className="py-2 pr-3">Vendedor</th>
                  <th className="py-2 pr-3 text-right">Valor</th>
                  <th className="py-2 pr-3">Status BI</th>
                  <th className="py-2">Motivos</th>
                </tr>
              </thead>
              <tbody>
                {data.criticalOrders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6">
                      <FinanceModuleEmptyState
                        title="Nenhum pedido crítico"
                        description="Não há pedidos atrasados, em revisão ou com alto valor em carteira nos filtros."
                      />
                    </td>
                  </tr>
                ) : (
                  data.criticalOrders.map((row) => (
                    <tr key={row.orderId} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-medium">{row.orderCode}</td>
                      <td className="py-2 pr-3">{row.customerName}</td>
                      <td className="py-2 pr-3">{row.sellerName}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatExecutiveCurrency(row.amount)}
                      </td>
                      <td className="py-2 pr-3">{row.logisticStatusLabel}</td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {row.reasons.map((r) => CRITICAL_REASON_LABELS[r] ?? r).join(" · ")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className={`${financeBiCardClass} p-5 space-y-3 overflow-x-auto`}>
            <h3 className="text-sm font-bold text-[#111827] flex items-center gap-2">
              <Users className="h-4 w-4" />
              Top vendedores
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">Vendedor</th>
                  <th className="py-2 pr-3 text-right">Valor</th>
                  <th className="py-2 pr-3 text-right">Pedidos</th>
                  <th className="py-2 pr-3 text-right">Ticket médio</th>
                  <th className="py-2 text-right">Participação</th>
                </tr>
              </thead>
              <tbody>
                {data.topSellers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6">
                      <FinanceModuleEmptyState
                        title="Nenhum vendedor no período"
                        description="Não há pedidos emitidos para os filtros aplicados."
                      />
                    </td>
                  </tr>
                ) : (
                  data.topSellers.map((row) => (
                    <tr key={row.sellerName} className="border-b border-border/50">
                      <td className="py-2 pr-3">{row.sellerName}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatExecutiveCurrency(row.amount)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.orderCount}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatExecutiveCurrency(row.averageTicketAmount)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatExecutivePercent(row.sharePercent, 1)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className={`${financeBiCardClass} p-5 space-y-3`}>
            <ExecutiveChartScenario text={buildFinanceSalesOrdersPortfolioNarrative(data)} />
            <h3 className="text-sm font-bold text-[#111827]">Carteira aberta de pedidos</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Sem NF</p>
                <p className="font-semibold">{formatExecutiveCurrency(data.portfolioBreakdown.notInvoicedAmount)}</p>
                <p className="text-xs">{data.portfolioBreakdown.notInvoicedCount} pedido(s)</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Com NF</p>
                <p className="font-semibold">{formatExecutiveCurrency(data.portfolioBreakdown.invoicedAmount)}</p>
                <p className="text-xs">{data.portfolioBreakdown.invoicedCount} pedido(s)</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Atrasados</p>
                <p className="font-semibold">{formatExecutiveCurrency(data.portfolioBreakdown.overdueAmount)}</p>
                <p className="text-xs">{data.portfolioBreakdown.overdueCount} pedido(s)</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">No prazo</p>
                <p className="font-semibold">{formatExecutiveCurrency(data.portfolioBreakdown.onTimeOpenAmount)}</p>
                <p className="text-xs">{data.portfolioBreakdown.onTimeOpenCount} pedido(s)</p>
              </div>
            </div>
          </div>

          <div className={`${financeBiCardClass} p-5 space-y-3 overflow-x-auto`}>
            <ExecutiveChartScenario text={buildFinanceSalesOrdersTopCustomersNarrative(data)} />
            <h3 className="text-sm font-bold text-[#111827]">Top clientes por pedidos</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">Cliente</th>
                  <th className="py-2 pr-3 text-right">Valor</th>
                  <th className="py-2 pr-3 text-right">Pedidos</th>
                  <th className="py-2 pr-3 text-right">Ticket médio</th>
                  <th className="py-2 text-right">Participação</th>
                </tr>
              </thead>
              <tbody>
                {data.topCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6">
                      <FinanceModuleEmptyState
                        title="Nenhum cliente no período"
                        description="Não há pedidos emitidos para os filtros aplicados."
                      />
                    </td>
                  </tr>
                ) : (
                  data.topCustomers.map((row) => (
                    <tr key={row.customerId ?? row.customerName} className="border-b border-border/50">
                      <td className="py-2 pr-3">{row.customerName}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatExecutiveCurrency(row.amount)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.orderCount}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatExecutiveCurrency(row.averageTicketAmount)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatExecutivePercent(row.sharePercent, 1)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      </div>
    </FinanceBiDashboardShell>
  );
}
