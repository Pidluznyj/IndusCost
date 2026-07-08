import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, FileBarChart2, RefreshCw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import {
  MATERIAL_MARKET_CRITICALITY_LABELS,
  MATERIAL_MARKET_CRITICALITY_VALUES,
  type MaterialMarketCriticality,
} from "@/src/lib/materialMarketMonitoring";
import {
  MATERIAL_MARKET_QUOTE_ANALYTICS_PERIOD_LABELS,
  MATERIAL_MARKET_QUOTE_ANALYTICS_PERIODS,
  type MaterialMarketQuoteAnalyticsPeriod,
} from "@/src/lib/materialMarketQuoteAnalytics";
import {
  MATERIAL_MARKET_SITUATION_STATUS_LABELS,
  MATERIAL_MARKET_SITUATION_STATUS_VALUES,
  type MaterialMarketSituationStatus,
} from "@/src/lib/materialMarketSituationStatus";
import {
  MATERIAL_MARKET_REPORT_EMPTY_MESSAGE,
  MATERIAL_MARKET_REPORT_TYPE_LABELS,
  MATERIAL_MARKET_REPORT_TYPE_VALUES,
  type MaterialMarketIntelligenceReport,
  type MaterialMarketReportType,
} from "@/src/lib/materialMarketIntelligenceReports";
import {
  getMaterialMarketIntelligenceReportsApiPath,
  MATERIALS_MARKET_INTELLIGENCE_MONITORED_API,
  MATERIALS_SECTION_PATHS,
} from "@/src/lib/materialsNavigation";
import type { MonitoredMaterialListItem } from "@/src/lib/materialMarketIntelligenceMonitored";
import { formatMaterialCategoryLabel } from "@/src/lib/materialCategoryLabels";
import { ExecutiveReportSection } from "@/src/components/finance/executive-report/ExecutiveReportSection";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiCard } from "@/src/components/ui/SummaryKpiCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { ContextualDashboardEmpty } from "@/src/components/contextual/ContextualDashboardEmpty";
import { MaterialMarketIntelligenceExportButtons } from "@/src/components/materials/MaterialMarketIntelligenceExportButtons";

type FilterState = {
  materialId: string;
  supplier: string;
  category: string;
  period: MaterialMarketQuoteAnalyticsPeriod;
  criticality: "" | MaterialMarketCriticality;
  situation: "" | MaterialMarketSituationStatus;
  alertStatus: string;
  reportType: "" | MaterialMarketReportType;
};

const DEFAULT_FILTERS: FilterState = {
  materialId: "",
  supplier: "",
  category: "",
  period: "90d",
  criticality: "",
  situation: "",
  alertStatus: "ALL",
  reportType: "",
};

function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, 2)}%`;
}

function formatDatePt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

function filtersFromSearchParams(params: URLSearchParams): FilterState {
  const periodRaw = params.get("period") ?? "";
  const period = (MATERIAL_MARKET_QUOTE_ANALYTICS_PERIODS as readonly string[]).includes(periodRaw)
    ? (periodRaw as MaterialMarketQuoteAnalyticsPeriod)
    : DEFAULT_FILTERS.period;
  const criticalityRaw = params.get("criticality") ?? "";
  const situationRaw = params.get("situation") ?? params.get("status") ?? "";
  const reportTypeRaw = params.get("reportType") ?? params.get("type") ?? "";

  return {
    materialId: params.get("materialId") ?? "",
    supplier: params.get("supplier") ?? "",
    category: params.get("category") ?? params.get("family") ?? params.get("group") ?? "",
    period,
    criticality: (MATERIAL_MARKET_CRITICALITY_VALUES as readonly string[]).includes(criticalityRaw)
      ? (criticalityRaw as MaterialMarketCriticality)
      : "",
    situation: (MATERIAL_MARKET_SITUATION_STATUS_VALUES as readonly string[]).includes(situationRaw)
      ? (situationRaw as MaterialMarketSituationStatus)
      : "",
    alertStatus: params.get("alertStatus") ?? "ALL",
    reportType: (MATERIAL_MARKET_REPORT_TYPE_VALUES as readonly string[]).includes(reportTypeRaw)
      ? (reportTypeRaw as MaterialMarketReportType)
      : "",
  };
}

function filtersToQuery(filters: FilterState): Record<string, string> {
  const query: Record<string, string> = { period: filters.period };
  if (filters.materialId.trim()) query.materialId = filters.materialId.trim();
  if (filters.supplier.trim()) query.supplier = filters.supplier.trim();
  if (filters.category.trim()) query.category = filters.category.trim();
  if (filters.criticality) query.criticality = filters.criticality;
  if (filters.situation) query.situation = filters.situation;
  if (filters.alertStatus && filters.alertStatus !== "ALL") query.alertStatus = filters.alertStatus;
  if (filters.reportType) query.reportType = filters.reportType;
  return query;
}

function SectionEmpty({ message }: { message: string | null }) {
  return (
    <ContextualDashboardEmpty message={message ?? MATERIAL_MARKET_REPORT_EMPTY_MESSAGE} />
  );
}

export function MaterialsMarketIntelligenceReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<FilterState>(() => filtersFromSearchParams(searchParams));
  const [report, setReport] = useState<MaterialMarketIntelligenceReport | null>(null);
  const [materialsOptions, setMaterialsOptions] = useState<MonitoredMaterialListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const categoryOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of materialsOptions) {
      if (item.familyCode) map.set(item.familyCode, item.family);
    }
    return [...map.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [materialsOptions]);

  const loadOptions = useCallback(async () => {
    try {
      const data = await fetchJsonOk<{ items: MonitoredMaterialListItem[] }>(
        MATERIALS_MARKET_INTELLIGENCE_MONITORED_API
      );
      setMaterialsOptions(Array.isArray(data.items) ? data.items : []);
    } catch {
      setMaterialsOptions([]);
    }
  }, []);

  const loadReport = useCallback(async (nextFilters: FilterState) => {
    setLoading(true);
    setError(null);
    try {
      const query = filtersToQuery(nextFilters);
      const url = getMaterialMarketIntelligenceReportsApiPath(query);
      const payload = await fetchJsonOk<MaterialMarketIntelligenceReport>(url);
      setReport(payload);
      setSearchParams(query, { replace: true });
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Não foi possível carregar o relatório executivo."
      );
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [setSearchParams]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    void loadReport(filtersFromSearchParams(searchParams));
    // Carrega uma vez a partir da URL inicial / mudanças externas mínimas via botão Aplicar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => {
    void loadReport(filters);
  };

  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    void loadReport(DEFAULT_FILTERS);
  };

  const showSection = (type: MaterialMarketReportType) =>
    !filters.reportType || filters.reportType === type;

  return (
    <div className="space-y-8" data-testid="materials-market-intelligence-reports-page">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Inteligência de Mercado · Relatórios
          </p>
          <h3 className="text-lg font-bold tracking-tight text-foreground">
            Relatório executivo de mercado
          </h3>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Consolida evolução de preços, fornecedores, câmbio, Brent, oportunidades, riscos e
            economia com as mesmas bases da visão 360º e da Home.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <MaterialMarketIntelligenceExportButtons
            scope="reports"
            filters={{
              materialId: filters.materialId || null,
              supplier: filters.supplier || null,
              group: filters.category || null,
              period: filters.period || null,
              criticality: filters.criticality || null,
              status: filters.alertStatus || null,
            }}
            size="md"
            labelPrefix="Exportar"
          />
          <Link
            to={MATERIALS_SECTION_PATHS.marketIntelligence}
            className="inline-flex items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            data-testid="materials-market-intelligence-reports-back"
          >
            Voltar à Home
          </Link>
        </div>
      </header>

      <section
        className="rounded-xl border border-border bg-card p-4 space-y-4"
        data-testid="materials-market-intelligence-reports-filters"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileBarChart2 className="h-4 w-4 text-primary" />
          Filtros
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Matéria-prima
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={filters.materialId}
              onChange={(e) => setFilters((prev) => ({ ...prev, materialId: e.target.value }))}
              data-testid="mi-report-filter-material"
            >
              <option value="">Todas as monitoradas</option>
              {materialsOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.description}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Fornecedor
            <input
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={filters.supplier}
              onChange={(e) => setFilters((prev) => ({ ...prev, supplier: e.target.value }))}
              placeholder="Nome do fornecedor"
              data-testid="mi-report-filter-supplier"
            />
          </label>

          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Grupo / Família
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={filters.category}
              onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))}
              data-testid="mi-report-filter-category"
            >
              <option value="">Todas</option>
              {categoryOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
              {!categoryOptions.length ? (
                <option value="MATERIA_PRIMA">{formatMaterialCategoryLabel("MATERIA_PRIMA")}</option>
              ) : null}
            </select>
          </label>

          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Período
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={filters.period}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  period: e.target.value as MaterialMarketQuoteAnalyticsPeriod,
                }))
              }
              data-testid="mi-report-filter-period"
            >
              {MATERIAL_MARKET_QUOTE_ANALYTICS_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {MATERIAL_MARKET_QUOTE_ANALYTICS_PERIOD_LABELS[period]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Criticidade
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={filters.criticality}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  criticality: e.target.value as FilterState["criticality"],
                }))
              }
              data-testid="mi-report-filter-criticality"
            >
              <option value="">Todas</option>
              {MATERIAL_MARKET_CRITICALITY_VALUES.map((value) => (
                <option key={value} value={value}>
                  {MATERIAL_MARKET_CRITICALITY_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Situação
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={filters.situation}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  situation: e.target.value as FilterState["situation"],
                }))
              }
              data-testid="mi-report-filter-situation"
            >
              <option value="">Todas</option>
              {MATERIAL_MARKET_SITUATION_STATUS_VALUES.map((value) => (
                <option key={value} value={value}>
                  {MATERIAL_MARKET_SITUATION_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Status de alerta
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={filters.alertStatus}
              onChange={(e) => setFilters((prev) => ({ ...prev, alertStatus: e.target.value }))}
              data-testid="mi-report-filter-alert-status"
            >
              <option value="ALL">Todos</option>
              <option value="OPEN">Abertos</option>
              <option value="READ">Lidos</option>
              <option value="RESOLVED">Resolvidos</option>
            </select>
          </label>

          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Tipo de relatório
            <select
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={filters.reportType}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  reportType: e.target.value as FilterState["reportType"],
                }))
              }
              data-testid="mi-report-filter-type"
            >
              <option value="">Todos os tipos</option>
              {MATERIAL_MARKET_REPORT_TYPE_VALUES.map((type) => (
                <option key={type} value={type}>
                  {MATERIAL_MARKET_REPORT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={applyFilters}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
            data-testid="mi-report-apply-filters"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar relatório
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
            data-testid="mi-report-clear-filters"
          >
            Limpar filtros
          </button>
        </div>
      </section>

      {loading ? (
        <div
          className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-16"
          data-testid="materials-market-intelligence-reports-loading"
        >
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-2 text-sm text-muted-foreground">Gerando relatório executivo…</p>
        </div>
      ) : null}

      {!loading && error ? (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          data-testid="materials-market-intelligence-reports-error"
        >
          {error}
        </div>
      ) : null}

      {!loading && !error && report?.empty ? (
        <div data-testid="materials-market-intelligence-reports-empty">
          <ContextualDashboardEmpty
            message={report.emptyMessage ?? MATERIAL_MARKET_REPORT_EMPTY_MESSAGE}
          />
        </div>
      ) : null}

      {!loading && !error && report && !report.empty ? (
        <div className="space-y-6" data-testid="materials-market-intelligence-reports-content">
          <ExecutiveSummarySection
            title="Resumo executivo"
            eyebrow={`Gerado em ${formatDatePt(report.generatedAt)} · ${report.filters.periodLabel}`}
            testId="materials-market-intelligence-reports-summary"
          >
            <SummaryKpiGrid minColumnWidth={160}>
              <SummaryKpiCard label="Matérias monitoradas" value={String(report.summary.monitoredCount)} />
              <SummaryKpiCard
                label="Oportunidades"
                value={String(report.summary.opportunitiesCount)}
                variant="success"
              />
              <SummaryKpiCard
                label="Riscos / alertas"
                value={String(report.summary.risksCount)}
                variant="warning"
              />
              <SummaryKpiCard
                label="Economia potencial"
                value={formatCurrency(report.summary.potentialSavingsTotal)}
              />
              <SummaryKpiCard
                label="Economia obtida"
                value={formatCurrency(report.summary.obtainedSavingsTotal)}
                variant="success"
              />
              <SummaryKpiCard
                label="Sem cotação recente"
                value={String(report.summary.staleQuotesCount)}
                variant={report.summary.staleQuotesCount > 0 ? "danger" : "default"}
              />
            </SummaryKpiGrid>
          </ExecutiveSummarySection>

          {showSection("price_evolution") ? (
            <ExecutiveReportSection
              id="mi-price-evolution"
              title="Evolução de preços"
              eyebrow="Analytics"
              subtitle={report.filters.periodLabel}
            >
              {report.sections.priceEvolution.empty ? (
                <SectionEmpty message={report.sections.priceEvolution.message} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="p-2">Matéria</th>
                        <th className="p-2 text-right">Atual</th>
                        <th className="p-2 text-right">Média</th>
                        <th className="p-2 text-right">Mín / Máx</th>
                        <th className="p-2 text-right">Volatilidade</th>
                        <th className="p-2">Tendência</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.sections.priceEvolution.items.map((item) => (
                        <tr key={item.materialId} className="border-b border-border/60">
                          <td className="p-2">
                            <Link className="font-medium text-primary hover:underline" to={item.intelligencePath}>
                              {item.code}
                            </Link>
                            <div className="text-xs text-muted-foreground">{item.description}</div>
                          </td>
                          <td className="p-2 text-right">
                            {item.analytics.currentPrice != null
                              ? formatCurrency(item.analytics.currentPrice)
                              : "—"}
                          </td>
                          <td className="p-2 text-right">
                            {item.analytics.average != null ? formatCurrency(item.analytics.average) : "—"}
                          </td>
                          <td className="p-2 text-right">
                            {item.analytics.minPrice != null && item.analytics.maxPrice != null
                              ? `${formatCurrency(item.analytics.minPrice)} / ${formatCurrency(item.analytics.maxPrice)}`
                              : "—"}
                          </td>
                          <td className="p-2 text-right">{formatPct(item.analytics.volatility)}</td>
                          <td className="p-2">{item.analytics.trendLabel ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ExecutiveReportSection>
          ) : null}

          {showSection("supplier_comparison") ? (
            <ExecutiveReportSection
              id="mi-supplier-comparison"
              title="Comparação entre fornecedores"
              eyebrow="Fornecedores"
            >
              {report.sections.supplierComparison.empty ? (
                <SectionEmpty message={report.sections.supplierComparison.message} />
              ) : (
                <div className="space-y-4">
                  {report.sections.supplierComparison.items.map((item) => (
                    <div key={item.materialId} className="space-y-2">
                      <h4 className="text-sm font-semibold">
                        <Link className="text-primary hover:underline" to={item.intelligencePath}>
                          {item.code}
                        </Link>{" "}
                        <span className="text-muted-foreground font-normal">· {item.description}</span>
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-sm">
                          <thead>
                            <tr className="border-b border-border text-left text-xs text-muted-foreground">
                              <th className="p-2">#</th>
                              <th className="p-2">Fornecedor</th>
                              <th className="p-2 text-right">Último</th>
                              <th className="p-2 text-right">Média</th>
                              <th className="p-2 text-right">Cotações</th>
                            </tr>
                          </thead>
                          <tbody>
                            {item.comparison.items.slice(0, 8).map((row) => (
                              <tr key={`${item.materialId}-${row.supplierKey}`} className="border-b border-border/60">
                                <td className="p-2">{row.rank}</td>
                                <td className="p-2">{row.supplierName}</td>
                                <td className="p-2 text-right">{formatCurrency(row.lastPrice)}</td>
                                <td className="p-2 text-right">{formatCurrency(row.averagePrice)}</td>
                                <td className="p-2 text-right">{row.quoteCount}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ExecutiveReportSection>
          ) : null}

          {showSection("fx_impact") ? (
            <ExecutiveReportSection id="mi-fx-impact" title="Impacto cambial" eyebrow="Câmbio">
              {report.sections.fxImpact.empty ? (
                <SectionEmpty message={report.sections.fxImpact.message} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="p-2">Matéria</th>
                        <th className="p-2 text-right">Δ BRL</th>
                        <th className="p-2 text-right">Δ Câmbio</th>
                        <th className="p-2 text-right">Δ Preço/Forn.</th>
                        <th className="p-2">Explicação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.sections.fxImpact.items.map((item) => (
                        <tr key={item.materialId} className="border-b border-border/60">
                          <td className="p-2">
                            <Link className="font-medium text-primary hover:underline" to={item.intelligencePath}>
                              {item.code}
                            </Link>
                          </td>
                          <td className="p-2 text-right">{formatPct(item.fx.brlVariationPct)}</td>
                          <td className="p-2 text-right">{formatPct(item.fx.exchangeVariationPct)}</td>
                          <td className="p-2 text-right">{formatPct(item.fx.unexplainedVariationPct)}</td>
                          <td className="p-2 text-xs text-muted-foreground">{item.fx.explanation}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ExecutiveReportSection>
          ) : null}

          {showSection("brent_impact") ? (
            <ExecutiveReportSection id="mi-brent-impact" title="Impacto Brent" eyebrow="Commodity">
              {report.sections.brentImpact.empty ? (
                <SectionEmpty message={report.sections.brentImpact.message} />
              ) : (
                <div className="space-y-4">
                  <SummaryKpiGrid minColumnWidth={160}>
                    <SummaryKpiCard
                      label="Brent"
                      value={
                        report.sections.brentImpact.brentPrice != null
                          ? `US$ ${formatNumber(report.sections.brentImpact.brentPrice, 2)}`
                          : "—"
                      }
                      description={formatPct(report.sections.brentImpact.brentVariationPct)}
                    />
                    <SummaryKpiCard
                      label="Matérias com cotação USD"
                      value={String(report.sections.brentImpact.materialsWithUsdQuotes)}
                    />
                    <SummaryKpiCard
                      label="Δ câmbio médio"
                      value={formatPct(report.sections.brentImpact.averageExchangeVariationPct)}
                    />
                  </SummaryKpiGrid>
                </div>
              )}
            </ExecutiveReportSection>
          ) : null}

          {showSection("opportunities") ? (
            <ExecutiveReportSection id="mi-opportunities" title="Oportunidades" eyebrow="Economia potencial">
              {report.sections.opportunities.empty ? (
                <SectionEmpty message={report.sections.opportunities.message} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="p-2">Matéria</th>
                        <th className="p-2">Fornecedor sugerido</th>
                        <th className="p-2 text-right">Melhor preço</th>
                        <th className="p-2 text-right">Economia unit.</th>
                        <th className="p-2 text-right">Economia total</th>
                        <th className="p-2 text-right">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.sections.opportunities.items.map((item) => (
                        <tr key={item.materialId} className="border-b border-border/60">
                          <td className="p-2">
                            <Link className="font-medium text-primary hover:underline" to={item.intelligencePath}>
                              {item.code}
                            </Link>
                            <div className="text-xs text-muted-foreground">{item.description}</div>
                          </td>
                          <td className="p-2">{item.recommendedSupplier ?? "—"}</td>
                          <td className="p-2 text-right">
                            {item.bestPrice != null ? formatCurrency(item.bestPrice) : "—"}
                          </td>
                          <td className="p-2 text-right">{formatCurrency(item.unitSavings)}</td>
                          <td className="p-2 text-right font-medium">{formatCurrency(item.totalSavings)}</td>
                          <td className="p-2 text-right">{formatPct(item.savingsPercent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ExecutiveReportSection>
          ) : null}

          {showSection("risks") ? (
            <ExecutiveReportSection id="mi-risks" title="Riscos" eyebrow="Situação e alertas">
              {report.sections.risks.empty ? (
                <SectionEmpty message={report.sections.risks.message} />
              ) : (
                <div className="space-y-4">
                  {report.sections.risks.situationItems.length ? (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Situações de atenção / crítico</h4>
                      <ul className="space-y-2">
                        {report.sections.risks.situationItems.map((item) => (
                          <li
                            key={item.id}
                            className="rounded-lg border border-border px-3 py-2 text-sm"
                          >
                            <Link className="font-medium text-primary hover:underline" to={item.intelligencePath}>
                              {item.code}
                            </Link>{" "}
                            · {item.marketSituation.statusLabel}
                            <p className="text-xs text-muted-foreground mt-1">{item.marketSituation.reason}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {report.sections.risks.alerts.length ? (
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold">Alertas</h4>
                      <ul className="space-y-2">
                        {report.sections.risks.alerts.map((alert) => (
                          <li key={alert.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  "text-xs font-semibold uppercase",
                                  alert.severity === "CRITICAL" ? "text-red-700" : "text-amber-700"
                                )}
                              >
                                {alert.severityLabel}
                              </span>
                              <span className="font-medium">{alert.title}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{alert.message}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </ExecutiveReportSection>
          ) : null}

          {showSection("savings_obtained") ? (
            <ExecutiveReportSection id="mi-savings-obtained" title="Economia obtida" eyebrow="Compras vinculadas">
              {report.sections.savingsObtained.empty ? (
                <SectionEmpty message={report.sections.savingsObtained.message} />
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Total realizado:{" "}
                    <span className="font-semibold text-foreground">
                      {formatCurrency(report.sections.savingsObtained.totalSavings)}
                    </span>
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted-foreground">
                          <th className="p-2">Fornecedor</th>
                          <th className="p-2">Data</th>
                          <th className="p-2 text-right">Qtd.</th>
                          <th className="p-2 text-right">Negociado</th>
                          <th className="p-2 text-right">Economia</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.sections.savingsObtained.items.map((item) => (
                          <tr key={item.id} className="border-b border-border/60">
                            <td className="p-2">{item.supplierName}</td>
                            <td className="p-2">{formatDatePt(item.purchaseDate)}</td>
                            <td className="p-2 text-right">{formatNumber(item.quantityPurchased, 2)}</td>
                            <td className="p-2 text-right">{formatCurrency(item.negotiatedPrice)}</td>
                            <td className="p-2 text-right font-medium">{formatCurrency(item.estimatedSavings)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </ExecutiveReportSection>
          ) : null}

          {showSection("impacted_products") ? (
            <ExecutiveReportSection id="mi-impacted-products" title="Produtos impactados" eyebrow="BOM oficial">
              {report.sections.impactedProducts.empty ? (
                <SectionEmpty message={report.sections.impactedProducts.message} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="p-2">Matéria</th>
                        <th className="p-2">Produto</th>
                        <th className="p-2 text-right">Consumo</th>
                        <th className="p-2 text-right">Custo estimado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.sections.impactedProducts.items.map((item) => (
                        <tr
                          key={`${item.materialId}-${item.productId}`}
                          className="border-b border-border/60"
                        >
                          <td className="p-2">{item.materialCode}</td>
                          <td className="p-2">
                            <div className="font-medium">{item.productSku}</div>
                            <div className="text-xs text-muted-foreground">{item.productName}</div>
                          </td>
                          <td className="p-2 text-right">
                            {formatNumber(item.quantityConsumed, 4)} {item.unit}
                          </td>
                          <td className="p-2 text-right">{formatCurrency(item.estimatedCurrentCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </ExecutiveReportSection>
          ) : null}

          {showSection("materials_without_recent_quotes") ? (
            <ExecutiveReportSection
              id="mi-stale-quotes"
              title="Matérias sem cotação recente"
              eyebrow="Monitoramento"
            >
              {report.sections.materialsWithoutRecentQuotes.empty ? (
                <SectionEmpty message={report.sections.materialsWithoutRecentQuotes.message} />
              ) : (
                <ul className="space-y-2">
                  {report.sections.materialsWithoutRecentQuotes.items.map((item) => (
                    <li key={item.materialId} className="rounded-lg border border-border px-3 py-2 text-sm">
                      <Link className="font-medium text-primary hover:underline" to={item.intelligencePath}>
                        {item.code}
                      </Link>{" "}
                      · {item.description}
                      <p className="text-xs text-muted-foreground mt-1">{item.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </ExecutiveReportSection>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
