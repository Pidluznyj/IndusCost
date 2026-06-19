import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Package,
  RefreshCw,
  ShoppingBag,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
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
import { FinanceSalesOrdersMonthlyChart } from "@/src/components/finance/sales-orders/FinanceSalesOrdersMonthlyChart";
import { FinanceSalesOrdersProjectionChart } from "@/src/components/finance/sales-orders/FinanceSalesOrdersProjectionChart";
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
        { label: "Data do período", value: "SalesOrder.issueDate" },
        { label: "Meta", value: data.dataQuality.targetRule },
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
    return params.toString();
  }, [
    appliedYear,
    appliedMonth,
    appliedSeller,
    appliedCompany,
    appliedStatus,
    appliedInvoice,
    appliedCustomerId,
  ]);

  const hasPendingFilters =
    draftYear !== appliedYear ||
    draftMonth !== appliedMonth ||
    draftSeller !== appliedSeller ||
    draftCompany !== appliedCompany ||
    draftStatus !== appliedStatus ||
    draftInvoice !== appliedInvoice ||
    draftCustomerId !== appliedCustomerId;

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
      setError("Não foi possível carregar o dashboard de Pedidos de Venda.");
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
      appliedCustomerId
  );
  const filterStatus = resolveFinanceBiFilterStatus(filtersActive, hasPendingFilters);

  return (
    <FinanceBiDashboardShell>
      <div data-testid="finance-sales-orders-page">
      <FinanceExecutivePageHeader
        eyebrow="FINANCEIRO · PEDIDOS DE VENDA"
        title="Pedidos de Venda"
        subtitle="Visão financeira dos pedidos emitidos, carteira aberta, metas, projeção e comparação com o ano anterior."
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
          setCustomerSelection(null);
          setAppliedYear(String(currentYear));
          setAppliedMonth("");
          setAppliedSeller("");
          setAppliedCompany("");
          setAppliedStatus("");
          setAppliedInvoice("");
          setAppliedCustomerId("");
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
              <option value="with_invoice">Com NF</option>
              <option value="without_invoice">Sem NF</option>
            </select>
          </div>
        </div>
        }
      />

      {error ? <FinanceApErrorBanner message={error} /> : null}
      {loading && !data ? <FinanceApLoadingBlock label="Carregando pedidos de venda…" /> : null}

      {summary && data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <FinanceKpiCard
              icon={ShoppingBag}
              label="Vendido no mês"
              value={formatFinanceKpiCurrency(summary.monthSalesAmount)}
              amount={summary.monthSalesAmount}
              helperText="Soma dos pedidos emitidos no mês, excluindo cancelados e erros."
            />
            <FinanceKpiCard
              icon={TrendingUp}
              label="Vendido YTD"
              value={formatFinanceKpiCurrency(summary.ytdSalesAmount)}
              amount={summary.ytdSalesAmount}
              helperText="Acumulado do ano até o mês de referência."
            />
            <FinanceKpiCard
              icon={Target}
              label="Meta mês"
              value={formatFinanceKpiCurrency(summary.monthTargetAmount)}
              amount={summary.monthTargetAmount}
              helperText="Mesmo mês do ano anterior × 1,30 (meta derivada)."
            />
            <FinanceKpiCard
              icon={Target}
              label="Atingimento mês"
              value={formatExecutivePercent(summary.monthAchievementPercent, 1)}
              amountFormat="percent"
              helperText="Vendido no mês dividido pela meta mensal."
            />
            <FinanceKpiCard
              icon={TrendingUp}
              label="Projeção mês"
              value={formatFinanceKpiCurrency(summary.monthProjectedAmount)}
              amount={summary.monthProjectedAmount}
              helperText="Média diária YTD × dias úteis do mês."
            />
            <FinanceKpiCard
              icon={Wallet}
              label="Carteira aberta"
              value={formatFinanceKpiCurrency(summary.openPortfolioAmount)}
              amount={summary.openPortfolioAmount}
              helperText="Pedidos válidos ainda sem NF processada."
            />
            <FinanceKpiCard
              icon={Package}
              label="Pedidos"
              value={formatExecutiveInteger(summary.orderCount)}
              amount={summary.orderCount}
              amountFormat="number"
            />
            <FinanceKpiCard
              icon={Package}
              label="Itens"
              value={formatExecutiveInteger(summary.itemCount)}
              amount={summary.itemCount}
              amountFormat="number"
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
                {data.topCustomers.map((row) => (
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
                ))}
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
