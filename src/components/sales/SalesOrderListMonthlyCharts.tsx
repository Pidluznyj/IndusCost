import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { noteDevPerfRender } from "@/src/lib/devPerfBaselineClient";
import { FinanceSalesOrdersMonthlyChart } from "@/src/components/finance/sales-orders/FinanceSalesOrdersMonthlyChart";
import { SalesOrderListMonthlyMarginPercentChart } from "@/src/components/sales/SalesOrderListMonthlyMarginPercentChart";
import { fetchJsonOk } from "@/src/lib/http";
import type { SalesOrderResultChartsCachePayload } from "@/src/lib/sales/salesOrderResultChartsCache";
import { buildChartSeriesConfig } from "@/src/lib/executiveDashboardChartSeries";
import { resolveExecutiveDashboardYearContext } from "@/src/lib/executiveDashboardYear";
import type { FinanceSalesOrdersMonthlyComparisonRow } from "@/src/lib/financeSalesOrdersDashboardTypes";
import { useSectionVisible } from "@/src/hooks/useSectionVisible";

export type SalesOrderListMonthlyChartsFilters = {
  /** Ano dos gráficos — único filtro da listagem que os afeta. */
  year: number;
};

/**
 * Gráficos acima do grid: valor vendido YoY + margem % mês a mês.
 * Só o Ano da listagem entra; mês/cliente/vendedor/status/valor são ignorados.
 *
 * Os dados vêm do CACHE materializado por ano (`SalesOrderResultChartsCache`)
 * — carga instantânea, sem rodar o motor de margem na requisição. O cache é
 * recalculado automaticamente ao fim do sync de pedidos do Nomus; o botão
 * Atualizar força o recálculo sob demanda.
 */
export const SalesOrderListMonthlyCharts = memo(function SalesOrderListMonthlyCharts({
  filters,
  showMarginChart,
}: {
  filters: SalesOrderListMonthlyChartsFilters;
  showMarginChart: boolean;
}) {
  noteDevPerfRender("SalesOrderListMonthlyCharts");
  const { ref: sectionRef, visible } = useSectionVisible<HTMLDivElement>();
  const [payload, setPayload] = useState<SalesOrderResultChartsCachePayload | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void fetchJsonOk<{ cache: SalesOrderResultChartsCachePayload }>(
      `/api/sales-orders/results/charts-cache?year=${filters.year}`,
      { signal: controller.signal }
    )
      .then((data) => {
        if (!controller.signal.aborted) setPayload(data.cache);
      })
      .catch((cause: unknown) => {
        if (
          controller.signal.aborted ||
          (cause instanceof DOMException && cause.name === "AbortError")
        ) {
          return;
        }
        console.error(cause);
        setError("Não foi possível carregar os gráficos mensais.");
        setPayload(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [filters.year, visible]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setError(null);
    void fetchJsonOk<{ cache: SalesOrderResultChartsCachePayload }>(
      "/api/sales-orders/results/charts-cache/refresh",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: filters.year }),
      }
    )
      .then((data) => setPayload(data.cache))
      .catch((cause: unknown) => {
        console.error(cause);
        setError("Não foi possível atualizar os gráficos mensais.");
      })
      .finally(() => setRefreshing(false));
  }, [filters.year]);

  const yearCtx = useMemo(
    () => resolveExecutiveDashboardYearContext(filters.year, new Date()),
    [filters.year]
  );
  const chartConfig = useMemo(
    () => buildChartSeriesConfig("salesOrders", yearCtx),
    [yearCtx]
  );

  const salesRows: FinanceSalesOrdersMonthlyComparisonRow[] = useMemo(() => {
    const rows = payload?.monthlySalesComparison ?? [];
    return rows.map((row) => ({
      month: row.month,
      monthLabel: row.monthLabel,
      currentYearAmount: row.currentYearAmount,
      previousYearAmount: row.previousYearAmount,
      differenceAmount: row.currentYearAmount - row.previousYearAmount,
      growthPercent:
        row.previousYearAmount === 0
          ? row.currentYearAmount > 0
            ? 100
            : 0
          : ((row.currentYearAmount - row.previousYearAmount) /
              row.previousYearAmount) *
            100,
    }));
  }, [payload?.monthlySalesComparison]);

  const computedAtLabel = useMemo(() => {
    if (!payload?.computedAt) return null;
    const date = new Date(payload.computedAt);
    if (Number.isNaN(date.getTime())) return null;
    return `${date.toLocaleDateString("pt-BR")} ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  }, [payload?.computedAt]);

  if (!visible || loading) {
    return (
      <div
        ref={sectionRef}
        className="grid gap-4 xl:grid-cols-2"
        data-testid="sales-order-list-monthly-charts-loading"
      >
        <div className="h-[340px] animate-pulse rounded-xl border border-border bg-muted/40" />
        {showMarginChart ? (
          <div className="h-[340px] animate-pulse rounded-xl border border-border bg-muted/40" />
        ) : null}
      </div>
    );
  }

  if (error && !payload) {
    return (
      <p
        ref={sectionRef}
        className="text-sm text-amber-700 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
        data-testid="sales-order-list-monthly-charts-error"
      >
        {error}
      </p>
    );
  }

  if (!payload) {
    return <div ref={sectionRef} className="hidden" aria-hidden />;
  }

  return (
    <div ref={sectionRef} className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {error ? (
          <span className="text-xs text-amber-700" role="alert">
            {error}
          </span>
        ) : null}
        {computedAtLabel ? (
          <span
            className="text-xs text-muted-foreground"
            data-testid="sales-order-list-monthly-charts-computed-at"
          >
            Atualizado em {computedAtLabel}
          </span>
        ) : null}
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          data-testid="sales-order-list-monthly-charts-refresh"
          disabled={refreshing}
          onClick={refresh}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {refreshing ? "Atualizando…" : "Atualizar"}
        </button>
      </div>
      <div
        className={`grid gap-4 ${showMarginChart ? "xl:grid-cols-2" : "grid-cols-1"}`}
        data-testid="sales-order-list-monthly-charts"
      >
        <FinanceSalesOrdersMonthlyChart
          rows={salesRows}
          selectedYear={filters.year}
          previousYear={filters.year - 1}
          config={chartConfig}
        />
        {showMarginChart ? (
          <SalesOrderListMonthlyMarginPercentChart
            rows={payload.monthlyCommercialMargin ?? []}
            selectedYear={filters.year}
          />
        ) : null}
      </div>
    </div>
  );
});
