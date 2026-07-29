import React, { memo, useEffect, useMemo, useState } from "react";
import { noteDevPerfRender } from "@/src/lib/devPerfBaselineClient";
import { FinanceSalesOrdersMonthlyChart } from "@/src/components/finance/sales-orders/FinanceSalesOrdersMonthlyChart";
import { SalesOrderListMonthlyMarginPercentChart } from "@/src/components/sales/SalesOrderListMonthlyMarginPercentChart";
import { fetchUiSessionCachedJson } from "@/src/lib/uiSessionGetCache";
import { getSalesOrderResultApiPath } from "@/src/lib/salesOrderResultApi";
import type { SalesOrderResultDashboardPayload } from "@/src/lib/salesOrderResultTypes";
import { buildChartSeriesConfig } from "@/src/lib/executiveDashboardChartSeries";
import { resolveExecutiveDashboardYearContext } from "@/src/lib/executiveDashboardYear";
import type { FinanceSalesOrdersMonthlyComparisonRow } from "@/src/lib/financeSalesOrdersDashboardTypes";
import { useSectionVisible } from "@/src/hooks/useSectionVisible";

export type SalesOrderListMonthlyChartsFilters = {
  year: number;
  status?: string;
  hasInvoice?: string;
  receivableStatus?: string;
  customerId?: string;
  sellerKey?: string;
  startDate?: string;
  endDate?: string;
  q?: string;
};

/**
 * Gráficos acima do grid: valor vendido YoY + margem % mês a mês.
 * Consome `/api/sales-orders/results` (mesma população OP-02 da listagem).
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
  const [payload, setPayload] = useState<SalesOrderResultDashboardPayload | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const path = getSalesOrderResultApiPath({
      year: filters.year,
      // Comparativo mensal = ano completo (igual Financeiro > Pedidos).
      month: undefined,
      status: filters.status || undefined,
      hasInvoice: filters.hasInvoice || undefined,
      receivableStatus: filters.receivableStatus || undefined,
      customerId: filters.customerId || undefined,
      sellerKey: filters.sellerKey || undefined,
      startDate: filters.startDate || undefined,
      endDate: filters.endDate || undefined,
      q: filters.q || undefined,
    });

    void fetchUiSessionCachedJson<SalesOrderResultDashboardPayload>(path, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setPayload(data);
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
  }, [filtersKey, filters, visible]);

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

  if (error) {
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
    <div
      ref={sectionRef}
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
          rows={payload.monthlyCommercialMargin ?? payload.monthlyMargin}
          selectedYear={filters.year}
        />
      ) : null}
    </div>
  );
});
