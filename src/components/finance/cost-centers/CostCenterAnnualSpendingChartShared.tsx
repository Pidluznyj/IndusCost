import React from "react";
import type { LabelProps } from "recharts";
import type {
  CostCenterAnnualSpendingChartPayload,
  CostCenterAnnualSpendingRow,
} from "@/src/lib/financeCostCenterAnnualSpendingChart";
import {
  buildCostCenterAnnualSpendingScenarioText,
  formatCostCenterAnnualSpendingPeriodLabel,
  truncateCostCenterChartLabel,
} from "@/src/lib/financeCostCenterAnnualSpendingChart";
import {
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import { buildHorizontalBarEndLabelProps } from "@/src/lib/chartValueLabels";
import { ExecutiveChartScenario } from "@/src/components/finance/executive-report/charts/ExecutiveChartScenario";

export function resolveCostCenterChartRows(
  chart: CostCenterAnnualSpendingChartPayload | null | undefined,
  options: { useDisplayRows?: boolean; labelMax?: number } = {}
): Array<CostCenterAnnualSpendingRow & { shortLabel: string }> {
  if (!chart) return [];
  const source = options.useDisplayRows !== false ? chart.displayRows : chart.rows;
  const labelMax = options.labelMax ?? 32;
  return source.map((row) => ({
    ...row,
    shortLabel: truncateCostCenterChartLabel(row.displayName, labelMax),
  }));
}

export function CostCenterAnnualSpendingScenario({ chart }: { chart: CostCenterAnnualSpendingChartPayload | null | undefined }) {
  if (!chart) return null;
  const text = buildCostCenterAnnualSpendingScenarioText(chart);
  return <ExecutiveChartScenario text={text} />;
}

type TooltipRow = CostCenterAnnualSpendingRow & {
  periodLabel?: string;
};

export function CostCenterAnnualSpendingTooltip({
  active,
  payload,
  periodLabel,
  compact = false,
}: {
  active?: boolean;
  payload?: Array<{ payload: TooltipRow }>;
  periodLabel?: string;
  compact?: boolean;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const row = payload[0].payload;
  const period = periodLabel ?? row.periodLabel ?? "—";
  const boxClass = compact
    ? "rounded border border-slate-200 bg-white px-2 py-1.5 text-[10px] shadow-sm max-w-[240px]"
    : "rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md max-w-sm";

  return (
    <div className={boxClass}>
      <p className="font-semibold text-foreground">
        {row.isOthersBucket ? "Outros" : `Centro de custo: ${row.displayName}`}
      </p>
      {!row.isOthersBucket ? (
        <p className="text-muted-foreground mt-0.5">Código: {row.costCenterCode || "—"}</p>
      ) : (
        <p className="text-muted-foreground mt-0.5">
          {row.othersContainedPreview?.length ?? 0} centro(s) agrupados
        </p>
      )}
      <p className="mt-1 tabular-nums">
        Valor: {formatFinanceCurrency(row.totalAmount)}
      </p>
      <p className="tabular-nums text-muted-foreground">
        Participação: {formatFinancePercent(row.percentageOfTotal)}
      </p>
      <p className="tabular-nums text-muted-foreground">Ranking: {row.rank}º</p>
      <p className="tabular-nums text-muted-foreground mt-1">Período: {period}</p>
      <p className="text-muted-foreground mt-1">Fonte: AP gerencial classificado</p>
      {row.isOthersBucket && row.othersContainedPreview && row.othersContainedPreview.length > 0 ? (
        <div className="mt-2 border-t border-border/60 pt-2 space-y-0.5">
          <p className="font-medium text-foreground">Maiores dentro de Outros:</p>
          {row.othersContainedPreview.map((item) => (
            <p key={item.costCenterCode} className="tabular-nums text-muted-foreground">
              {item.displayName}: {formatFinanceCurrencyCompact(item.totalAmount)}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function HorizontalBarAmountLabel(
  props: LabelProps & { fontSize?: number; data?: TooltipRow[] }
) {
  const index = typeof props.index === "number" ? props.index : -1;
  const row = index >= 0 ? props.data?.[index] : undefined;
  const built = buildHorizontalBarEndLabelProps({
    x: props.x as number,
    y: props.y as number,
    width: props.width as number,
    height: props.height as number,
    value: props.value as number,
    suffix: row ? formatFinancePercent(row.percentageOfTotal) : undefined,
  });
  if (!built) return null;
  return (
    <text
      x={built.x}
      y={built.y}
      fill={built.fill}
      fontSize={props.fontSize ?? 10}
      fontWeight={600}
      textAnchor={built.textAnchor}
    >
      {built.text}
    </text>
  );
}

export function CostCenterAnnualSpendingTable({
  rows,
  testId = "cost-center-annual-spending-table",
}: {
  rows: CostCenterAnnualSpendingRow[];
  testId?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-border/80" data-testid={testId}>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/80 bg-muted/40 text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium w-14">#</th>
            <th className="px-3 py-2 font-medium">Centro de custo</th>
            <th className="px-3 py-2 font-medium text-right">Valor</th>
            <th className="px-3 py-2 font-medium text-right w-24">Part.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.costCenterId} className="border-b border-border/50 last:border-0">
              <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.rank}</td>
              <td className="px-3 py-2">
                <span className="font-medium text-foreground" title={row.displayName}>
                  {row.displayName}
                </span>
                {!row.isOthersBucket && row.costCenterCode ? (
                  <span className="block text-[10px] text-muted-foreground truncate" title={row.costCenterCode}>
                    {row.costCenterCode}
                  </span>
                ) : null}
                {row.isOthersBucket && row.othersContainedPreview ? (
                  <span className="block text-[10px] text-muted-foreground">
                    {row.othersContainedPreview.length} centros agrupados
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">
                {formatFinanceCurrencyCompact(row.totalAmount)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {formatFinancePercent(row.percentageOfTotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function resolveCostCenterChartPeriodLabel(
  chart: CostCenterAnnualSpendingChartPayload | null | undefined
): string {
  if (!chart) return "—";
  return formatCostCenterAnnualSpendingPeriodLabel(chart);
}
