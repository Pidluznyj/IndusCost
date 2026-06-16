import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  Download,
  Loader2,
  Package,
  Printer,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  Users,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceBiExecutiveHeader } from "@/src/components/finance/bi/FinanceBiExecutiveHeader";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import { FinanceBiKpiCard } from "@/src/components/finance/bi/FinanceBiKpiCard";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";
import { FinanceFilterScopeBanner } from "@/src/components/finance/FinanceFilterScopeBanner";
import { FinanceDetailTabs } from "@/src/components/finance/shared/FinanceDetailTabs";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import type { FinanceBiFilterChip } from "@/src/lib/financeBiFilterChips";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import {
  buildSoldProductsDashboardQuery,
  buildSoldProductsYearOptions,
  createDefaultSoldProductsUiFilters,
  isDefaultSoldProductsUiFilters,
  normalizeSoldProductsUiFilters,
  SOLD_PRODUCTS_COMPANY_OPTIONS,
  SOLD_PRODUCTS_CUSTOMER_SCOPE_OPTIONS,
  SOLD_PRODUCTS_DATE_BASIS_OPTIONS,
  SOLD_PRODUCTS_MONTH_OPTIONS,
  SOLD_PRODUCTS_ORDER_STATUS_OPTIONS,
  SOLD_PRODUCTS_SORT_OPTIONS,
  SOLD_PRODUCTS_TOP_N_OPTIONS,
  soldProductsFilterSummaryLines,
} from "@/src/lib/salesProductRankingFilters.js";
import type {
  SoldProductsDashboardPayload,
  SoldProductsUiFilters,
} from "@/src/lib/salesProductRankingTypes.js";
import "@/src/components/commercial/sold-products-print.css";

type TabId = "overview" | "ranking" | "customerMix" | "monthly" | "detail";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Visão Geral" },
  { id: "ranking", label: "Ranking de Produtos" },
  { id: "customerMix", label: "Produto x Cliente" },
  { id: "monthly", label: "Evolução Mensal" },
  { id: "detail", label: "Detalhamento" },
];

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827]"
      >
        {options.map((o) => (
          <option key={o.value || "__all"} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827]"
      />
    </label>
  );
}

function buildSoldProductsFilterChips(
  filters: SoldProductsUiFilters,
  onRemove: (field: keyof SoldProductsUiFilters) => void
): FinanceBiFilterChip[] {
  const chips: FinanceBiFilterChip[] = [];
  const push = (id: keyof SoldProductsUiFilters, label: string) => {
    chips.push({ id, label, onRemove: () => onRemove(id) });
  };
  if (filters.year.trim()) push("year", `Ano: ${filters.year}`);
  if (filters.month.trim()) {
    const m = SOLD_PRODUCTS_MONTH_OPTIONS.find((o) => o.value === filters.month)?.label ?? filters.month;
    push("month", `Mês: ${m}`);
  }
  if (filters.startDate.trim()) push("startDate", `De: ${filters.startDate}`);
  if (filters.endDate.trim()) push("endDate", `Até: ${filters.endDate}`);
  if (filters.dateBasis !== "issueDate") {
    push(
      "dateBasis",
      SOLD_PRODUCTS_DATE_BASIS_OPTIONS.find((o) => o.value === filters.dateBasis)?.label ?? filters.dateBasis
    );
  }
  if (filters.customerName.trim()) push("customerName", `Cliente: ${filters.customerName}`);
  if (filters.customerTaxId.trim()) push("customerTaxId", `CNPJ: ${filters.customerTaxId}`);
  if (filters.productCode.trim()) push("productCode", `Código: ${filters.productCode}`);
  if (filters.productName.trim()) push("productName", `Produto: ${filters.productName}`);
  if (filters.sellerKey.trim()) push("sellerKey", `Vendedor: ${filters.sellerKey.replace(/^r:/, "")}`);
  if (filters.company !== "all") {
    push("company", SOLD_PRODUCTS_COMPANY_OPTIONS.find((o) => o.value === filters.company)?.label ?? filters.company);
  }
  if (filters.orderStatus !== "valid") {
    push(
      "orderStatus",
      SOLD_PRODUCTS_ORDER_STATUS_OPTIONS.find((o) => o.value === filters.orderStatus)?.label ?? filters.orderStatus
    );
  }
  if (filters.customerScope !== "external") {
    push(
      "customerScope",
      SOLD_PRODUCTS_CUSTOMER_SCOPE_OPTIONS.find((o) => o.value === filters.customerScope)?.label ??
        filters.customerScope
    );
  }
  if (filters.sortBy !== "quantity") {
    push("sortBy", SOLD_PRODUCTS_SORT_OPTIONS.find((o) => o.value === filters.sortBy)?.label ?? filters.sortBy);
  }
  if (filters.topN !== "50") {
    push("topN", SOLD_PRODUCTS_TOP_N_OPTIONS.find((o) => o.value === filters.topN)?.label ?? filters.topN);
  }
  return chips;
}

function fmtQty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatNumber(v, Number.isInteger(v) ? 0 : 2);
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatCurrency(v);
}

export function SoldProductsReportPage() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [draftFilters, setDraftFilters] = useState<SoldProductsUiFilters>(() =>
    createDefaultSoldProductsUiFilters()
  );
  const [appliedFilters, setAppliedFilters] = useState<SoldProductsUiFilters>(() =>
    normalizeSoldProductsUiFilters(createDefaultSoldProductsUiFilters())
  );
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [data, setData] = useState<SoldProductsDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailPage, setDetailPage] = useState(1);

  const normalizedDraft = useMemo(() => normalizeSoldProductsUiFilters(draftFilters), [draftFilters]);
  const queryString = useMemo(() => {
    const base = buildSoldProductsDashboardQuery(appliedFilters);
    const qs = new URLSearchParams(base);
    qs.set("detailPage", String(detailPage));
    qs.set("detailLimit", "100");
    return qs.toString();
  }, [appliedFilters, detailPage]);

  const hasPending = useMemo(
    () => buildSoldProductsDashboardQuery(normalizedDraft) !== buildSoldProductsDashboardQuery(appliedFilters),
    [normalizedDraft, appliedFilters]
  );

  const filtersActive = !isDefaultSoldProductsUiFilters(appliedFilters);
  const filterStatus = useMemo(
    () => resolveFinanceBiFilterStatus(filtersActive, hasPending),
    [filtersActive, hasPending]
  );

  const yearOptions = useMemo(() => buildSoldProductsYearOptions(), []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = queryString
        ? `/api/commercial/sold-products?${queryString}`
        : "/api/commercial/sold-products";
      const payload = await fetchJsonOk<SoldProductsDashboardPayload>(url);
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar o relatório.");
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleApply = () => {
    setAppliedFilters(normalizedDraft);
    setDetailPage(1);
  };

  const handleClear = () => {
    const defaults = createDefaultSoldProductsUiFilters();
    setDraftFilters(defaults);
    setAppliedFilters(normalizeSoldProductsUiFilters(defaults));
    setDetailPage(1);
  };

  const handleRemoveChip = useCallback(
    (field: keyof SoldProductsUiFilters) => {
      const next = { ...appliedFilters };
      if (field === "year") next.year = String(new Date().getFullYear());
      else if (field === "dateBasis") next.dateBasis = "issueDate";
      else if (field === "orderStatus") next.orderStatus = "valid";
      else if (field === "customerScope") next.customerScope = "external";
      else if (field === "company") next.company = "all";
      else if (field === "sortBy") next.sortBy = "quantity";
      else if (field === "topN") next.topN = "50";
      else next[field] = "";
      const normalized = normalizeSoldProductsUiFilters(next);
      setDraftFilters(normalized);
      setAppliedFilters(normalized);
      setDetailPage(1);
    },
    [appliedFilters]
  );

  const chips = useMemo(
    () => buildSoldProductsFilterChips(appliedFilters, handleRemoveChip),
    [appliedFilters, handleRemoveChip]
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      const qs = buildSoldProductsDashboardQuery(appliedFilters);
      const res = await fetch(
        `/api/commercial/sold-products/export.xlsx${qs ? `?${qs}` : ""}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Falha ao exportar Excel.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `produtos-vendidos-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao exportar.");
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = () => {
    document.body.classList.add("sold-products-print-route");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        document.body.classList.remove("sold-products-print-route");
      });
    });
  };

  const chartData = useMemo(() => {
    return (data?.ranking ?? []).slice(0, 10).map((r) => ({
      name: r.productCode ?? r.productName.slice(0, 18),
      quantity: r.quantitySold,
      fullName: r.productName,
    }));
  }, [data?.ranking]);

  const summary = data?.summary;
  const applied = data?.filters;

  return (
    <>
      <div id="sold-products-print-root" className="hidden print:block">
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-xs text-gray-500">IndusCost · Lazarios Koppetel</p>
            <h1 className="text-xl font-bold">Relatório de Produtos Vendidos</h1>
            <p className="text-gray-600">
              Período: {applied?.periodLabel ?? "—"} · Gerado em{" "}
              {data?.generatedAt ? new Date(data.generatedAt).toLocaleString("pt-BR") : "—"}
            </p>
          </div>
          {applied ? (
            <ul className="text-xs text-gray-600 list-disc pl-4">
              {soldProductsFilterSummaryLines(applied).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>Qtd total: {fmtQty(summary?.totalQuantity)}</div>
            <div>Valor total: {fmtMoney(summary?.totalAmount)}</div>
            <div>Produtos: {summary?.productsCount ?? "—"}</div>
            <div>Pedidos: {summary?.ordersCount ?? "—"}</div>
          </div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left p-1">#</th>
                <th className="text-left p-1">Código</th>
                <th className="text-left p-1">Produto</th>
                <th className="text-right p-1">Qtd</th>
                <th className="text-right p-1">Valor</th>
              </tr>
            </thead>
            <tbody>
              {(data?.ranking ?? []).slice(0, 20).map((r) => (
                <tr key={r.productId} className="border-b">
                  <td className="p-1">{r.rank}</td>
                  <td className="p-1">{r.productCode ?? "—"}</td>
                  <td className="p-1">{r.productName}</td>
                  <td className="p-1 text-right">{fmtQty(r.quantitySold)}</td>
                  <td className="p-1 text-right">{fmtMoney(r.amountSold)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <FinanceBiDashboardShell className="sold-products-no-print">
        <FinanceBiExecutiveHeader
          eyebrow="Comercial · Relatórios"
          title="Produtos Vendidos"
          subtitle="Ranking de produtos por quantidade vendida com base em pedidos de venda."
          filterStatus={filterStatus}
          actions={[
            {
              id: "refresh",
              label: "Atualizar",
              onClick: () => void loadDashboard(),
              disabled: loading,
              loading,
              icon: loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />,
            },
            {
              id: "export",
              label: "Exportar Excel",
              onClick: () => void handleExport(),
              disabled: exporting || loading,
              loading: exporting,
              icon: exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />,
            },
            {
              id: "print",
              label: "Imprimir / PDF",
              onClick: handlePrint,
              icon: <Printer className="h-4 w-4" />,
            },
          ]}
        />

        <FinanceFilterScopeBanner active={filtersActive} />

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : null}

        <FinanceBiFilterPanel
          title="Filtros principais"
          expanded={showAdvancedFilters}
          onToggle={() => setShowAdvancedFilters((v) => !v)}
          filterStatus={filterStatus}
          chips={chips}
          onApply={handleApply}
          onClear={handleClear}
          applyDisabled={!hasPending || loading}
          alwaysVisible={
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
              <FilterSelect
                label="Ano"
                value={draftFilters.year}
                onChange={(v) => setDraftFilters((f) => ({ ...f, year: v }))}
                options={yearOptions}
              />
              <FilterSelect
                label="Mês"
                value={draftFilters.month}
                onChange={(v) => setDraftFilters((f) => ({ ...f, month: v }))}
                options={SOLD_PRODUCTS_MONTH_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
              <FilterSelect
                label="Tipo de data"
                value={draftFilters.dateBasis}
                onChange={(v) =>
                  setDraftFilters((f) => ({
                    ...f,
                    dateBasis: v as SoldProductsUiFilters["dateBasis"],
                  }))
                }
                options={SOLD_PRODUCTS_DATE_BASIS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
              <FilterSelect
                label="Ordenação"
                value={draftFilters.sortBy}
                onChange={(v) =>
                  setDraftFilters((f) => ({ ...f, sortBy: v as SoldProductsUiFilters["sortBy"] }))
                }
                options={SOLD_PRODUCTS_SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
              <FilterSelect
                label="Top N"
                value={draftFilters.topN}
                onChange={(v) =>
                  setDraftFilters((f) => ({ ...f, topN: v as SoldProductsUiFilters["topN"] }))
                }
                options={SOLD_PRODUCTS_TOP_N_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
              <FilterSelect
                label="Status pedido"
                value={draftFilters.orderStatus}
                onChange={(v) =>
                  setDraftFilters((f) => ({
                    ...f,
                    orderStatus: v as SoldProductsUiFilters["orderStatus"],
                  }))
                }
                options={SOLD_PRODUCTS_ORDER_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </div>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <FilterInput
              label="Data inicial"
              value={draftFilters.startDate}
              onChange={(v) => setDraftFilters((f) => ({ ...f, startDate: v }))}
              placeholder="YYYY-MM-DD"
            />
            <FilterInput
              label="Data final"
              value={draftFilters.endDate}
              onChange={(v) => setDraftFilters((f) => ({ ...f, endDate: v }))}
              placeholder="YYYY-MM-DD"
            />
            <FilterInput
              label="Cliente"
              value={draftFilters.customerName}
              onChange={(v) => setDraftFilters((f) => ({ ...f, customerName: v }))}
            />
            <FilterInput
              label="CNPJ/CPF cliente"
              value={draftFilters.customerTaxId}
              onChange={(v) => setDraftFilters((f) => ({ ...f, customerTaxId: v }))}
            />
            <FilterInput
              label="Código produto"
              value={draftFilters.productCode}
              onChange={(v) => setDraftFilters((f) => ({ ...f, productCode: v }))}
            />
            <FilterInput
              label="Nome produto"
              value={draftFilters.productName}
              onChange={(v) => setDraftFilters((f) => ({ ...f, productName: v }))}
            />
            <FilterInput
              label="Vendedor / responsável"
              value={draftFilters.sellerKey.replace(/^r:/, "")}
              onChange={(v) =>
                setDraftFilters((f) => ({
                  ...f,
                  sellerKey: v.trim() ? `r:${v.trim()}` : "",
                }))
              }
            />
            <FilterSelect
              label="Empresa"
              value={draftFilters.company}
              onChange={(v) =>
                setDraftFilters((f) => ({ ...f, company: v as SoldProductsUiFilters["company"] }))
              }
              options={SOLD_PRODUCTS_COMPANY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <FilterSelect
              label="Tipo de cliente"
              value={draftFilters.customerScope}
              onChange={(v) =>
                setDraftFilters((f) => ({
                  ...f,
                  customerScope: v as SoldProductsUiFilters["customerScope"],
                }))
              }
              options={SOLD_PRODUCTS_CUSTOMER_SCOPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </div>
        </FinanceBiFilterPanel>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <FinanceBiKpiCard
            icon={Package}
            label="Quantidade total vendida"
            value={fmtQty(summary?.totalQuantity)}
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={TrendingUp}
            label="Valor total vendido"
            value={fmtMoney(summary?.totalAmount)}
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={BarChart3}
            label="Produtos vendidos"
            value={String(summary?.productsCount ?? "—")}
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={Users}
            label="Clientes compradores"
            value={String(summary?.customersCount ?? "—")}
            loading={loading}
          />
          <FinanceBiKpiCard
            icon={ShoppingCart}
            label="Pedidos considerados"
            value={String(summary?.ordersCount ?? "—")}
            loading={loading}
          />
          <FinanceBiKpiCard
            label="Preço médio geral"
            value={
              summary?.averageUnitPrice != null ? fmtMoney(summary.averageUnitPrice) : "—"
            }
            loading={loading}
          />
          <FinanceBiKpiCard
            label="Mais vendido (qtd)"
            value={summary?.topProductByQuantity?.productName ?? "—"}
            sub={
              summary?.topProductByQuantity
                ? fmtQty(summary.topProductByQuantity.quantitySold)
                : undefined
            }
            loading={loading}
          />
          <FinanceBiKpiCard
            label="Maior valor vendido"
            value={summary?.topProductByAmount?.productName ?? "—"}
            sub={
              summary?.topProductByAmount ? fmtMoney(summary.topProductByAmount.amountSold) : undefined
            }
            loading={loading}
          />
        </div>

        <FinanceDetailTabs tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

        {activeTab === "overview" ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className={`${financeBiCardClass} p-5`}>
              <h3 className="text-sm font-bold text-[#111827] mb-3">Top 10 por quantidade</h3>
              {chartData.length === 0 ? (
                <FinanceBiEmptyState title="Sem dados" description="Ajuste os filtros para ver o gráfico." />
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => formatNumber(v, 0)} />
                    <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(v: number) => [fmtQty(v), "Quantidade"]}
                      labelFormatter={(_, payload) =>
                        payload?.[0]?.payload?.fullName ? String(payload[0].payload.fullName) : ""
                      }
                    />
                    <Bar dataKey="quantity" fill="#2563EB" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className={`${financeBiCardClass} p-5 overflow-x-auto`}>
              <h3 className="text-sm font-bold text-[#111827] mb-3">Ranking resumido</h3>
              <RankingTable rows={data?.ranking?.slice(0, 10) ?? []} loading={loading} compact />
            </div>
          </div>
        ) : null}

        {activeTab === "ranking" ? (
          <div className={`${financeBiCardClass} p-5 overflow-x-auto`}>
            <RankingTable rows={data?.ranking ?? []} loading={loading} />
          </div>
        ) : null}

        {activeTab === "customerMix" ? (
          <div className={`${financeBiCardClass} p-5 overflow-x-auto`}>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[#6B7280]">
                  <th className="p-2">Produto</th>
                  <th className="p-2">Cliente</th>
                  <th className="p-2 text-right">Quantidade</th>
                  <th className="p-2 text-right">Valor</th>
                  <th className="p-2 text-right">% no produto</th>
                </tr>
              </thead>
              <tbody>
                {(data?.customerMix ?? []).map((r, i) => (
                  <tr key={`${r.productId}-${r.customerId}-${i}`} className="border-b border-[#F3F4F6]">
                    <td className="p-2">{r.productName}</td>
                    <td className="p-2">{r.customerName}</td>
                    <td className="p-2 text-right">{fmtQty(r.quantitySold)}</td>
                    <td className="p-2 text-right">{fmtMoney(r.amountSold)}</td>
                    <td className="p-2 text-right">{r.customerSharePercent.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && (data?.customerMix?.length ?? 0) === 0 ? (
              <FinanceBiEmptyState title="Sem mix" description="Nenhum produto/cliente no período." />
            ) : null}
          </div>
        ) : null}

        {activeTab === "monthly" ? (
          <div className={`${financeBiCardClass} p-5 overflow-x-auto`}>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[#6B7280]">
                  <th className="p-2">Produto</th>
                  <th className="p-2">Mês/Ano</th>
                  <th className="p-2 text-right">Quantidade</th>
                  <th className="p-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {(data?.monthlyEvolution ?? []).map((r, i) => (
                  <tr key={`${r.productId}-${r.year}-${r.month}-${i}`} className="border-b border-[#F3F4F6]">
                    <td className="p-2">{r.productName}</td>
                    <td className="p-2">
                      {String(r.month).padStart(2, "0")}/{r.year}
                    </td>
                    <td className="p-2 text-right">{fmtQty(r.quantitySold)}</td>
                    <td className="p-2 text-right">{fmtMoney(r.amountSold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {activeTab === "detail" ? (
          <div className={`${financeBiCardClass} p-5 space-y-4`}>
            <DetailTable rows={data?.detailRows ?? []} loading={loading} />
            {data?.detailPagination ? (
              <div className="flex items-center justify-between text-sm text-[#6B7280]">
                <span>
                  Página {data.detailPagination.page} de {data.detailPagination.totalPages} ·{" "}
                  {data.detailPagination.total} itens
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={detailPage <= 1 || loading}
                    onClick={() => setDetailPage((p) => Math.max(1, p - 1))}
                    className="rounded border px-3 py-1 disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={detailPage >= data.detailPagination.totalPages || loading}
                    onClick={() => setDetailPage((p) => p + 1)}
                    className="rounded border px-3 py-1 disabled:opacity-50"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </FinanceBiDashboardShell>
    </>
  );
}

function RankingTable({
  rows,
  loading,
  compact = false,
}: {
  rows: SoldProductsDashboardPayload["ranking"];
  loading: boolean;
  compact?: boolean;
}) {
  if (!loading && rows.length === 0) {
    return <FinanceBiEmptyState title="Sem ranking" description="Nenhum produto vendido no período." />;
  }
  return (
    <table className="min-w-full text-sm">
      <thead>
        <tr className="border-b text-left text-[#6B7280]">
          <th className="p-2">#</th>
          <th className="p-2">Código</th>
          <th className="p-2">Produto</th>
          <th className="p-2 text-right">Qtd</th>
          <th className="p-2 text-right">Valor</th>
          {!compact ? (
            <>
              <th className="p-2 text-right">Preço médio</th>
              <th className="p-2 text-right">Pedidos</th>
              <th className="p-2 text-right">Clientes</th>
              <th className="p-2">Última venda</th>
              <th className="p-2 text-right">% qtd</th>
              <th className="p-2 text-right">% valor</th>
            </>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.productId} className="border-b border-[#F3F4F6]">
            <td className="p-2">{r.rank}</td>
            <td className="p-2">{r.productCode ?? "—"}</td>
            <td className="p-2">{r.productName}</td>
            <td className="p-2 text-right">{fmtQty(r.quantitySold)}</td>
            <td className="p-2 text-right">{fmtMoney(r.amountSold)}</td>
            {!compact ? (
              <>
                <td className="p-2 text-right">
                  {r.averageUnitPrice != null ? fmtMoney(r.averageUnitPrice) : "—"}
                </td>
                <td className="p-2 text-right">{r.ordersCount}</td>
                <td className="p-2 text-right">{r.customersCount}</td>
                <td className="p-2">{r.lastSaleDate ?? "—"}</td>
                <td className="p-2 text-right">{r.quantitySharePercent.toFixed(2)}%</td>
                <td className="p-2 text-right">{r.amountSharePercent.toFixed(2)}%</td>
              </>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailTable({
  rows,
  loading,
}: {
  rows: SoldProductsDashboardPayload["detailRows"];
  loading: boolean;
}) {
  if (!loading && rows.length === 0) {
    return <FinanceBiEmptyState title="Sem detalhamento" description="Nenhum item no período." />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b text-left text-[#6B7280]">
            <th className="p-2">Data</th>
            <th className="p-2">Pedido</th>
            <th className="p-2">Cliente</th>
            <th className="p-2">Vendedor</th>
            <th className="p-2">Produto</th>
            <th className="p-2 text-right">Qtd</th>
            <th className="p-2 text-right">Unit.</th>
            <th className="p-2 text-right">Total</th>
            <th className="p-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.orderId}-${r.productCode}-${i}`} className="border-b border-[#F3F4F6]">
              <td className="p-2">{r.orderDate}</td>
              <td className="p-2">{r.orderCode}</td>
              <td className="p-2">{r.customerName}</td>
              <td className="p-2">{r.sellerName ?? "—"}</td>
              <td className="p-2">
                {r.productCode ? `[${r.productCode}] ` : ""}
                {r.productName}
              </td>
              <td className="p-2 text-right">{fmtQty(r.quantity)}</td>
              <td className="p-2 text-right">{fmtMoney(r.unitPrice)}</td>
              <td className="p-2 text-right">{fmtMoney(r.lineAmount)}</td>
              <td className="p-2">{r.orderStatusLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
