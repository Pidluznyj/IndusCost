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
  FileSpreadsheet,
  Loader2,
  Package,
  Printer,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCurrencyAdaptive, formatNumberAdaptive } from "@/src/lib/utils";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceBiExecutiveHeader } from "@/src/components/finance/bi/FinanceBiExecutiveHeader";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import { FinanceBiKpiCard } from "@/src/components/finance/bi/FinanceBiKpiCard";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";
import { FinanceFilterScopeBanner } from "@/src/components/finance/FinanceFilterScopeBanner";
import { FinanceDetailTabs } from "@/src/components/finance/shared/FinanceDetailTabs";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import type { FinanceBiFilterChip } from "@/src/lib/financeBiFilterChips";
import {
  financeBiButtonAccentClass,
  financeBiButtonOutlineClass,
  financeBiCardClass,
  financeBiKpiLabelClass,
  financeBiKpiValueClass,
} from "@/src/lib/financeBiDashboardTheme";
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
  SoldProductsRankingRow,
  SoldProductsUiFilters,
} from "@/src/lib/salesProductRankingTypes.js";
import "@/src/components/commercial/sold-products-print.css";

type TabId = "overview" | "customerMix" | "monthly" | "detail";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Visão Geral" },
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
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
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
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wide">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
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
  if (filters.topN !== "all") {
    push("topN", SOLD_PRODUCTS_TOP_N_OPTIONS.find((o) => o.value === filters.topN)?.label ?? filters.topN);
  }
  return chips;
}

function fmtQty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatNumberAdaptive(v);
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatCurrencyAdaptive(v);
}

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildRankingCsv(rows: SoldProductsRankingRow[]): string {
  const headers = [
    "Posição",
    "Código",
    "Produto",
    "Quantidade vendida",
    "Valor vendido",
    "Preço médio",
    "Pedidos",
    "Clientes",
    "Última venda",
    "% participação qtd",
    "% participação valor",
  ];
  const lines = rows.map((r) =>
    [
      r.rank,
      r.productCode ?? "",
      `"${r.productName.replace(/"/g, '""')}"`,
      r.quantitySold,
      r.amountSold,
      r.averageUnitPrice ?? "",
      r.ordersCount,
      r.customersCount,
      r.lastSaleDate ?? "",
      r.quantitySharePercent,
      r.amountSharePercent,
    ].join(";")
  );
  return `\uFEFF${headers.join(";")}\n${lines.join("\n")}`;
}

function ReportSection({
  title,
  description,
  actions,
  children,
  id,
}: {
  id?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`${financeBiCardClass} overflow-hidden`}>
      <div className="flex flex-col gap-3 border-b border-[#E5E7EB] px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-bold text-[#111827]">{title}</h2>
          {description ? <p className="text-sm text-[#6B7280]">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function PeriodContextBar({
  periodLabel,
  productCount,
  loading,
}: {
  periodLabel?: string;
  productCount?: number;
  loading: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#2563EB]/20 bg-gradient-to-r from-[#EFF6FF] to-white px-5 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2563EB]/10 text-[#2563EB]">
        <BarChart3 className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#2563EB]">Análise do período</p>
        <p className="text-sm font-medium text-[#111827]">
          {loading ? "Carregando…" : periodLabel ?? "—"}
          {!loading && productCount != null ? (
            <span className="text-[#6B7280]"> · {productCount} produtos no ranking</span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function SecondaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 min-w-[140px]">
      <p className={financeBiKpiLabelClass}>{label}</p>
      <p className={`${financeBiKpiValueClass} text-xl mt-1`}>{value}</p>
    </div>
  );
}

function rankBadgeClass(rank: number): string {
  if (rank === 1) return "bg-amber-100 text-amber-800 ring-1 ring-amber-200";
  if (rank === 2) return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  if (rank === 3) return "bg-orange-50 text-orange-800 ring-1 ring-orange-200";
  return "bg-[#F3F4F6] text-[#6B7280]";
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

  const rankingQueryString = useMemo(() => {
    const qs = new URLSearchParams(buildSoldProductsDashboardQuery({ ...appliedFilters, topN: "all" }));
    qs.set("detailPage", "1");
    qs.set("detailLimit", "1");
    return qs.toString();
  }, [appliedFilters]);

  const detailQueryString = useMemo(() => {
    const qs = new URLSearchParams(buildSoldProductsDashboardQuery(appliedFilters));
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
      const rankingUrl = `/api/commercial/sold-products?${rankingQueryString}`;
      const rankingPayload = await fetchJsonOk<SoldProductsDashboardPayload>(rankingUrl);

      let detailPayload = rankingPayload;
      if (activeTab === "detail") {
        detailPayload = await fetchJsonOk<SoldProductsDashboardPayload>(
          `/api/commercial/sold-products?${detailQueryString}`
        );
      }

      setData({
        ...rankingPayload,
        detailRows: detailPayload.detailRows,
        detailPagination: detailPayload.detailPagination,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar o relatório.");
    } finally {
      setLoading(false);
    }
  }, [rankingQueryString, detailQueryString, activeTab]);

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
      else if (field === "topN") next.topN = "all";
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

  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const qs = buildSoldProductsDashboardQuery({ ...appliedFilters, topN: "all" });
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

  const handleExportRankingCsv = () => {
    const rows = data?.ranking ?? [];
    if (!rows.length) return;
    downloadTextFile(
      `ranking-produtos-vendidos-${new Date().toISOString().slice(0, 10)}.csv`,
      buildRankingCsv(rows),
      "text/csv;charset=utf-8"
    );
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
      name: r.productCode ?? r.productName.slice(0, 20),
      quantity: r.quantitySold,
      fullName: r.productName,
    }));
  }, [data?.ranking]);

  const summary = data?.summary;
  const applied = data?.filters;
  const rankingRows = data?.ranking ?? [];

  const exportRankingActions = (
    <>
      <button
        type="button"
        onClick={handleExportRankingCsv}
        disabled={!rankingRows.length || loading}
        className={financeBiButtonOutlineClass}
      >
        <Download className="h-4 w-4" />
        CSV do ranking
      </button>
      <button
        type="button"
        onClick={() => void handleExportExcel()}
        disabled={exporting || loading}
        className={financeBiButtonAccentClass}
      >
        {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
        Excel completo
      </button>
    </>
  );

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
          <RankingTable rows={rankingRows} loading={false} />
        </div>
      </div>

      <FinanceBiDashboardShell className="sold-products-no-print">
        <FinanceBiExecutiveHeader
          eyebrow="Comercial · Relatórios"
          title="Produtos Vendidos"
          subtitle="Ranking de produtos por quantidade vendida com base em pedidos de venda."
          filterStatus={filterStatus}
          meta={
            applied
              ? [
                  { label: "Período", value: applied.periodLabel },
                  { label: "Base", value: applied.dateBasisLabel },
                ]
              : []
          }
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
              onClick: () => void handleExportExcel(),
              disabled: exporting || loading,
              loading: exporting,
              variant: "accent" as const,
              icon: exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />,
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
          title="Filtros"
          expanded={showAdvancedFilters}
          onToggle={() => setShowAdvancedFilters((v) => !v)}
          filterStatus={filterStatus}
          chips={chips}
          onApply={handleApply}
          onClear={handleClear}
          applyDisabled={!hasPending || loading}
          alwaysVisible={
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
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
                label="Top N (gráfico)"
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

        <FinanceDetailTabs tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

        {activeTab === "overview" ? (
          <div className="space-y-5">
            <PeriodContextBar
              periodLabel={applied?.periodLabel}
              productCount={summary?.productsCount}
              loading={loading}
            />

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
                label="Produtos no ranking"
                value={String(summary?.productsCount ?? "—")}
                loading={loading}
              />
              <FinanceBiKpiCard
                icon={Users}
                label="Clientes compradores"
                value={String(summary?.customersCount ?? "—")}
                loading={loading}
              />
            </div>

            <div className="flex gap-3 overflow-x-auto pb-1">
              <SecondaryStat label="Pedidos" value={String(summary?.ordersCount ?? "—")} />
              <SecondaryStat
                label="Preço médio"
                value={summary?.averageUnitPrice != null ? fmtMoney(summary.averageUnitPrice) : "—"}
              />
              <SecondaryStat
                label="Líder em qtd"
                value={summary?.topProductByQuantity?.productCode ?? "—"}
              />
              <SecondaryStat
                label="Líder em valor"
                value={summary?.topProductByAmount?.productCode ?? "—"}
              />
            </div>

            <ReportSection
              title="Top 10 por quantidade"
              description="Visualização rápida dos produtos com maior volume no período."
            >
              {chartData.length === 0 ? (
                <FinanceBiEmptyState title="Sem dados" description="Ajuste os filtros para ver o gráfico." />
              ) : (
                <ResponsiveContainer width="100%" height={360}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 4, right: 24, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                    <XAxis
                      type="number"
                      tickFormatter={(v) => formatNumberAdaptive(v)}
                      tick={{ fontSize: 11, fill: "#6B7280" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={100}
                      tick={{ fontSize: 11, fill: "#374151" }}
                    />
                    <Tooltip
                      cursor={{ fill: "#F3F4F6" }}
                      formatter={(v: number) => [fmtQty(v), "Quantidade"]}
                      labelFormatter={(_, payload) =>
                        payload?.[0]?.payload?.fullName ? String(payload[0].payload.fullName) : ""
                      }
                    />
                    <Bar dataKey="quantity" fill="#2563EB" radius={[0, 6, 6, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ReportSection>

            <ReportSection
              id="ranking-completo"
              title="Ranking completo de produtos"
              description={`${rankingRows.length} produtos · ordenado por ${applied?.sortByLabel?.toLowerCase() ?? "quantidade vendida"}`}
              actions={exportRankingActions}
            >
              <RankingTable rows={rankingRows} loading={loading} />
            </ReportSection>
          </div>
        ) : null}

        {activeTab === "customerMix" ? (
          <ReportSection title="Produto x Cliente" description="Principais clientes por produto no período.">
            <div className="overflow-x-auto -mx-1">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5E7EB] text-left text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                    <th className="px-3 py-3">Produto</th>
                    <th className="px-3 py-3">Cliente</th>
                    <th className="px-3 py-3 text-right">Quantidade</th>
                    <th className="px-3 py-3 text-right">Valor</th>
                    <th className="px-3 py-3 text-right">% no produto</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.customerMix ?? []).map((r, i) => (
                    <tr key={`${r.productId}-${r.customerId}-${i}`} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]">
                      <td className="px-3 py-2.5">{r.productName}</td>
                      <td className="px-3 py-2.5">{r.customerName}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtQty(r.quantitySold)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(r.amountSold)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.customerSharePercent.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && (data?.customerMix?.length ?? 0) === 0 ? (
              <FinanceBiEmptyState title="Sem mix" description="Nenhum produto/cliente no período." />
            ) : null}
          </ReportSection>
        ) : null}

        {activeTab === "monthly" ? (
          <ReportSection title="Evolução mensal" description="Quantidade e valor por produto e mês.">
            <div className="overflow-x-auto -mx-1">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5E7EB] text-left text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                    <th className="px-3 py-3">Produto</th>
                    <th className="px-3 py-3">Mês/Ano</th>
                    <th className="px-3 py-3 text-right">Quantidade</th>
                    <th className="px-3 py-3 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.monthlyEvolution ?? []).map((r, i) => (
                    <tr key={`${r.productId}-${r.year}-${r.month}-${i}`} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]">
                      <td className="px-3 py-2.5">{r.productName}</td>
                      <td className="px-3 py-2.5">
                        {String(r.month).padStart(2, "0")}/{r.year}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtQty(r.quantitySold)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(r.amountSold)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ReportSection>
        ) : null}

        {activeTab === "detail" ? (
          <ReportSection
            title="Detalhamento analítico"
            description="Itens de pedido que compõem o relatório."
            actions={exportRankingActions}
          >
            <DetailTable rows={data?.detailRows ?? []} loading={loading} />
            {data?.detailPagination ? (
              <div className="mt-4 flex items-center justify-between text-sm text-[#6B7280]">
                <span>
                  Página {data.detailPagination.page} de {data.detailPagination.totalPages} ·{" "}
                  {data.detailPagination.total} itens
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={detailPage <= 1 || loading}
                    onClick={() => setDetailPage((p) => Math.max(1, p - 1))}
                    className={financeBiButtonOutlineClass}
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={detailPage >= data.detailPagination.totalPages || loading}
                    onClick={() => setDetailPage((p) => p + 1)}
                    className={financeBiButtonOutlineClass}
                  >
                    Próxima
                  </button>
                </div>
              </div>
            ) : null}
          </ReportSection>
        ) : null}
      </FinanceBiDashboardShell>
    </>
  );
}

function RankingTable({
  rows,
  loading,
}: {
  rows: SoldProductsRankingRow[];
  loading: boolean;
}) {
  if (!loading && rows.length === 0) {
    return <FinanceBiEmptyState title="Sem ranking" description="Nenhum produto vendido no período." />;
  }

  return (
    <div className="overflow-x-auto -mx-1 max-h-[70vh] overflow-y-auto rounded-lg border border-[#E5E7EB]">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-[#F9FAFB] shadow-[0_1px_0_#E5E7EB]">
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
            <th className="px-3 py-3 w-12">#</th>
            <th className="px-3 py-3 w-28">Código</th>
            <th className="px-3 py-3 min-w-[220px]">Produto</th>
            <th className="px-3 py-3 text-right">Qtd vendida</th>
            <th className="px-3 py-3 text-right">Valor vendido</th>
            <th className="px-3 py-3 text-right">Preço médio</th>
            <th className="px-3 py-3 text-right">Pedidos</th>
            <th className="px-3 py-3 text-right">Clientes</th>
            <th className="px-3 py-3">Última venda</th>
            <th className="px-3 py-3 text-right">% qtd</th>
            <th className="px-3 py-3 text-right">% valor</th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-[#F3F4F6] animate-pulse">
                  <td colSpan={11} className="px-3 py-4">
                    <div className="h-4 bg-[#F3F4F6] rounded w-full" />
                  </td>
                </tr>
              ))
            : rows.map((r) => (
                <tr key={r.productId} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB] transition-colors">
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-xs font-bold ${rankBadgeClass(r.rank)}`}
                    >
                      {r.rank}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-[#374151]">{r.productCode ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-[#111827] leading-snug">{r.productName}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#111827]">
                    {fmtQty(r.quantitySold)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(r.amountSold)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#6B7280]">
                    {r.averageUnitPrice != null ? fmtMoney(r.averageUnitPrice) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.ordersCount}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.customersCount}</td>
                  <td className="px-3 py-2.5 text-[#6B7280] whitespace-nowrap">{r.lastSaleDate ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#6B7280]">
                    {r.quantitySharePercent.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#6B7280]">
                    {r.amountSharePercent.toFixed(1)}%
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
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
    <div className="overflow-x-auto -mx-1 max-h-[70vh] overflow-y-auto rounded-lg border border-[#E5E7EB]">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-[#F9FAFB] shadow-[0_1px_0_#E5E7EB]">
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
            <th className="px-3 py-3">Data</th>
            <th className="px-3 py-3">Pedido</th>
            <th className="px-3 py-3">Cliente</th>
            <th className="px-3 py-3">Vendedor</th>
            <th className="px-3 py-3">Produto</th>
            <th className="px-3 py-3 text-right">Qtd</th>
            <th className="px-3 py-3 text-right">Unit.</th>
            <th className="px-3 py-3 text-right">Total</th>
            <th className="px-3 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.orderId}-${r.productCode}-${i}`} className="border-b border-[#F3F4F6] hover:bg-[#F9FAFB]">
              <td className="px-3 py-2.5 whitespace-nowrap">{r.orderDate}</td>
              <td className="px-3 py-2.5 font-mono text-xs">{r.orderCode}</td>
              <td className="px-3 py-2.5">{r.customerName}</td>
              <td className="px-3 py-2.5 text-[#6B7280]">{r.sellerName ?? "—"}</td>
              <td className="px-3 py-2.5">
                {r.productCode ? (
                  <span className="font-mono text-xs text-[#6B7280] mr-1">[{r.productCode}]</span>
                ) : null}
                {r.productName}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{fmtQty(r.quantity)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(r.unitPrice)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">{fmtMoney(r.lineAmount)}</td>
              <td className="px-3 py-2.5 text-[#6B7280]">{r.orderStatusLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
