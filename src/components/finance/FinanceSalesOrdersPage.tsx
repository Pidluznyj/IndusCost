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
import type { FinanceSalesOrdersDashboardPayload } from "@/src/lib/financeSalesOrdersDashboardTypes";
import {
  buildFinanceSalesOrdersMonthlyComparisonNarrative,
  buildFinanceSalesOrdersPortfolioNarrative,
  buildFinanceSalesOrdersProjectionNarrative,
  buildFinanceSalesOrdersTopCustomersNarrative,
} from "@/src/lib/financeSalesOrdersNarratives";
import {
  formatExecutiveCurrency,
  formatExecutiveInteger,
  formatExecutivePercent,
} from "@/src/lib/executiveDashboardFormatters";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { FinanceDataAuditButton } from "@/src/components/finance/shared/FinanceDataAuditButton";
import { FinanceDataAuditDrawer } from "@/src/components/finance/shared/FinanceDataAuditDrawer";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";
import { FinanceApErrorBanner, FinanceApLoadingBlock } from "@/src/components/finance/FinanceAccountsPayableUiShared";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";
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
        eyebrow="FINANCEIRO · PEDIDOS DE VENDA"
        title="Pedidos de Venda"
        subtitle="Dashboard gerencial de pedidos emitidos, carteira, faturamento, status logístico BI e comparativo anual."
        updatedAt={data?.generatedAt}
        actions={[
          {
            id: "refresh",
            label: "Atualizar",
            onClick: () => void load(),
            disabled: loading,
            loading,
            icon: <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />,
            variant: "outline",
          },
          {
            id: "export",
            label: "Exportar CSV",
            onClick: () => void exportCsv(),
            disabled: exporting || loading || !data,
            loading: exporting,
            icon: <Download className="h-4 w-4" />,
            variant: "accent",
          },
        ]}
        extraActions={<FinanceDataAuditButton onClick={() => setAuditOpen(true)} />}
      />

      <FinanceBiFilterPanel
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

      {error ? <FinanceApErrorBanner message={error} /> : null}
      {loading && !data ? <FinanceApLoadingBlock label="Carregando pedidos de venda…" /> : null}

      {summary && data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            <FinanceKpiCard
              icon={Package}
              label="Pedidos emitidos"
              value={formatExecutiveInteger(summary.orderCount)}
              amount={summary.orderCount}
              amountFormat="number"
              helperText="Total de pedidos válidos no período (issueDate)."
            />
            <FinanceKpiCard
              icon={ShoppingBag}
              label="Valor total de pedidos"
              value={formatFinanceKpiCurrency(summary.totalOrdersAmount)}
              amount={summary.totalOrdersAmount}
              helperText="Soma do valor líquido dos pedidos no filtro."
            />
            <FinanceKpiCard
              icon={Wallet}
              label="Carteira aberta"
              value={formatExecutiveInteger(summary.openPortfolioCount)}
              amount={summary.openPortfolioCount}
              amountFormat="number"
              helperText="Pedidos válidos sem NF processada."
            />
            <FinanceKpiCard
              icon={Wallet}
              label="Valor em carteira"
              value={formatFinanceKpiCurrency(summary.openPortfolioAmount)}
              amount={summary.openPortfolioAmount}
              helperText="Valor líquido dos pedidos ainda sem NF processada."
            />
            <FinanceKpiCard
              icon={Package}
              label="Pedidos faturados"
              value={formatExecutiveInteger(summary.invoicedOrdersCount)}
              amount={summary.invoicedOrdersCount}
              amountFormat="number"
              helperText="Pedidos com NF processada (dataProcessamento)."
            />
            <FinanceKpiCard
              icon={TrendingUp}
              label="Valor faturado"
              value={formatFinanceKpiCurrency(summary.invoicedOrdersAmount)}
              amount={summary.invoicedOrdersAmount}
              helperText="Valor líquido dos pedidos com NF processada."
            />
            <FinanceKpiCard
              icon={ShoppingBag}
              label="Ticket médio"
              value={formatFinanceKpiCurrency(summary.averageTicketAmount)}
              amount={summary.averageTicketAmount}
              helperText="Valor total ÷ quantidade de pedidos."
            />
            <FinanceKpiCard
              icon={TrendingUp}
              label="Média diária"
              value={formatFinanceKpiCurrency(summary.dailyAverageAmount)}
              amount={summary.dailyAverageAmount}
              helperText="Valor YTD ÷ dias úteis decorridos (seg–sex)."
            />
            <FinanceKpiCard
              icon={Target}
              label="Meta mês atual"
              value={
                summary.monthTargetConfigured
                  ? formatFinanceKpiCurrency(summary.monthTargetAmount)
                  : "Meta não configurada"
              }
              amount={summary.monthTargetAmount}
              helperText={
                summary.monthTargetConfigured
                  ? "Meta comercial oficial do mês."
                  : "Nenhuma fonte de meta cadastrada no sistema."
              }
            />
          </div>

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
                      <FinanceBiEmptyState
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
                      <FinanceBiEmptyState
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
                      <FinanceBiEmptyState
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

      <FinanceDataAuditDrawer
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        sections={auditSections}
      />
      </div>
    </FinanceBiDashboardShell>
  );
}
