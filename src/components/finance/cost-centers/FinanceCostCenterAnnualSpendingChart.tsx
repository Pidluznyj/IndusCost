import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CostCenterAnnualSpendingChartPayload } from "@/src/lib/financeCostCenterAnnualSpendingChart";
import { formatFinanceCurrency, formatFinancePercent } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";
import { ChartBarValueLabel } from "@/src/components/finance/shared/ChartValueLabel";

type Props = {
  chart: CostCenterAnnualSpendingChartPayload | null | undefined;
  loading?: boolean;
  /** Usa displayRows (Top N + Outros) quando definido; senão todas as linhas. */
  useDisplayRows?: boolean;
  maxBarLabelWidth?: number;
  testId?: string;
};

function shortCenterLabel(name: string, max = 28): string {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1)}…`;
}

function AnnualSpendingTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: Record<string, unknown> }>;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const row = payload[0].payload as {
    displayName: string;
    totalAmount: number;
    percentageOfTotal: number;
    paidAmount: number;
    openAmount: number;
    overdueAmount: number;
  };
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md max-w-xs">
      <p className="font-semibold text-foreground">{row.displayName}</p>
      <p className="mt-1 tabular-nums">Total: {formatFinanceCurrency(row.totalAmount)}</p>
      <p className="tabular-nums text-muted-foreground">
        {formatFinancePercent(row.percentageOfTotal)} do total
      </p>
      <p className="mt-1 tabular-nums text-muted-foreground">
        Pago: {formatFinanceCurrency(row.paidAmount)} · Aberto: {formatFinanceCurrency(row.openAmount)}
      </p>
      <p className="tabular-nums text-muted-foreground">
        Vencido: {formatFinanceCurrency(row.overdueAmount)}
      </p>
    </div>
  );
}

export function FinanceCostCenterAnnualSpendingChart({
  chart,
  loading = false,
  useDisplayRows = false,
  maxBarLabelWidth = 28,
  testId = "finance-cost-center-annual-spending-chart",
}: Props) {
  const rows = useMemo(() => {
    if (!chart) return [];
    const source = useDisplayRows ? chart.displayRows : chart.rows;
    return source.map((row) => ({
      ...row,
      shortLabel: shortCenterLabel(row.displayName, maxBarLabelWidth),
    }));
  }, [chart, useDisplayRows, maxBarLabelWidth]);

  const chartHeight = Math.max(280, Math.min(720, rows.length * 40 + 48));

  if (!loading && rows.length === 0) {
    return (
      <FinanceBiEmptyState
        title={chart?.title ?? "Gastos por Centro de Custo"}
        description={
          chart?.subtitle ?? "Sem dados classificados por centro de custo no filtro aplicado."
        }
      />
    );
  }

  return (
    <div className={`${financeBiCardClass} p-5 space-y-3`} data-testid={testId}>
      <div>
        <h3 className="text-sm font-bold text-[#111827]">
          {chart?.title ?? "Gastos por Centro de Custo"}
        </h3>
        <p className="text-[11px] text-[#6B7280] mt-0.5">
          {chart?.subtitle ?? "Total gerencial de AP por centro de custo, conforme filtros aplicados."}
        </p>
        {chart ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2">
            <span>
              Total:{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {formatFinanceCurrency(chart.totalAmount)}
              </span>
            </span>
            <span>
              Centros:{" "}
              <span className="font-semibold text-foreground">{chart.costCentersCount}</span>
            </span>
            {chart.othersIncludedCount > 0 && useDisplayRows ? (
              <span>
                Outros agrupa {chart.othersIncludedCount} centro(s) —{" "}
                {formatFinanceCurrency(chart.othersAmount ?? 0)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
          Carregando gráfico…
        </div>
      ) : (
        <>
          <div style={{ width: "100%", height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows}
                layout="vertical"
                margin={{ top: 8, right: 88, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => formatFinanceCurrency(v)}
                />
                <YAxis
                  type="category"
                  dataKey="shortLabel"
                  width={132}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip content={<AnnualSpendingTooltip />} />
                <Bar dataKey="totalAmount" name="Total" radius={[0, 4, 4, 0]} maxBarSize={28}>
                  {rows.map((row) => (
                    <Cell key={row.costCenterId} fill={row.colorHex} />
                  ))}
                  <LabelList
                    dataKey="totalAmount"
                    position="right"
                    content={<ChartBarValueLabel fontSize={10} />}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div
            className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            data-testid={`${testId}-legend`}
          >
            {rows.map((row) => (
              <div key={row.costCenterId} className="flex items-center gap-2 text-xs min-w-0">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: row.colorHex }}
                  aria-hidden
                />
                <span className="truncate text-muted-foreground" title={row.displayName}>
                  {row.shortLabel}
                </span>
                <span className="ml-auto tabular-nums font-medium text-foreground shrink-0">
                  {formatFinancePercent(row.percentageOfTotal)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
