import React, { useCallback, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FinanceCashFlowExecutiveYtdTrendPoint } from "@/src/lib/financeCashFlowExecutiveYtd";
import {
  formatFinanceCurrency,
  formatFinanceCurrencyCompact,
} from "@/src/lib/financeAccountsReceivableFormat";
import { FINANCE_BI_COLORS, financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cashFlowMonthlySeriesHasData } from "@/src/lib/financeCashFlowDisplay";
import { FinanceBiChartExpandButton } from "@/src/components/finance/bi/FinanceBiChartExpandButton";
import {
  FinanceBiChartExpandModal,
  useFinanceBiExpandedChartHeight,
} from "@/src/components/finance/bi/FinanceBiChartExpandModal";

function YtdTrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: FinanceCashFlowExecutiveYtdTrendPoint }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm text-[11px]">
      <p className="font-semibold mb-1">{label}</p>
      <p className="text-[#059669]">Entrada: {formatFinanceCurrency(row.inflow ?? 0)}</p>
      <p className="text-[#DC2626]">Saída: {formatFinanceCurrency(row.outflow ?? 0)}</p>
      <p>Líquido: {formatFinanceCurrency(row.net ?? 0)}</p>
      {row.accumulated != null ? (
        <p className="text-[#2563EB]">Acumulado: {formatFinanceCurrency(row.accumulated)}</p>
      ) : null}
      {row.receivedInMonth != null ? (
        <p className="text-[#059669]">Recebido no mês: {formatFinanceCurrency(row.receivedInMonth)}</p>
      ) : null}
      {row.receivedAccumulated != null ? (
        <p>Recebido acumulado: {formatFinanceCurrency(row.receivedAccumulated)}</p>
      ) : null}
      {row.previousYearReceivedAccumulated != null ? (
        <p className="text-[#6B7280]">
          Recebido acum. ano anterior: {formatFinanceCurrency(row.previousYearReceivedAccumulated)}
        </p>
      ) : null}
    </div>
  );
}

function YtdTrendChartBody({
  points,
  height,
}: {
  points: FinanceCashFlowExecutiveYtdTrendPoint[];
  height: number;
}) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={FINANCE_BI_COLORS.border} />
          <ReferenceLine y={0} stroke={FINANCE_BI_COLORS.textSecondary} strokeWidth={1} />
          <XAxis
            dataKey="monthLabel"
            tick={{ fontSize: 9, fill: FINANCE_BI_COLORS.textSecondary }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 9, fill: FINANCE_BI_COLORS.textSecondary }}
            tickFormatter={(v: number) => formatFinanceCurrencyCompact(v)}
            width={72}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<YtdTrendTooltip />} />
          <Bar dataKey="net" name="Líquido" maxBarSize={14} radius={[2, 2, 0, 0]}>
            {points.map((entry) => (
              <Cell
                key={`ytd-${entry.month}`}
                fill={
                  entry.status === "negative"
                    ? FINANCE_BI_COLORS.risk
                    : entry.status === "positive"
                      ? FINANCE_BI_COLORS.success
                      : FINANCE_BI_COLORS.border
                }
              />
            ))}
          </Bar>
          <Line
            type="monotone"
            dataKey="accumulated"
            name="Acumulado"
            stroke={FINANCE_BI_COLORS.primary}
            strokeWidth={1.5}
            dot={false}
            connectNulls={false}
          />
          <Line
            type="monotone"
            dataKey="previousYearReceivedAccumulated"
            name="Recebido acum. ano ant."
            stroke={FINANCE_BI_COLORS.textSecondary}
            strokeWidth={1.25}
            strokeDasharray="4 3"
            dot={false}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FinanceCashFlowYtdTrendChart({
  points,
}: {
  points: FinanceCashFlowExecutiveYtdTrendPoint[];
}) {
  const [expanded, setExpanded] = useState(false);
  const expandedHeight = useFinanceBiExpandedChartHeight(520);
  const openExpand = useCallback(() => setExpanded(true), []);
  const closeExpand = useCallback(() => setExpanded(false), []);

  const hasData = points.some(
    (p) =>
      (p.inflow != null && p.inflow !== 0) ||
      (p.outflow != null && p.outflow !== 0) ||
      (p.net != null && p.net !== 0)
  );

  const title = "Tendência YTD do caixa";

  return (
    <>
      <div
        data-testid="cash-flow-ytd-trend-chart"
        className={`${financeBiCardClass} p-3 flex flex-col min-h-[140px]`}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#6B7280]">{title}</p>
          {hasData ? (
            <FinanceBiChartExpandButton
              onClick={openExpand}
              testId="cash-flow-ytd-trend-chart-expand"
              className="h-7 w-7"
            />
          ) : null}
        </div>
        {!hasData ? (
          <p className="text-sm text-muted-foreground flex-1 flex items-center">
            Sem movimentos no ano para exibir tendência.
          </p>
        ) : (
          <YtdTrendChartBody points={points} height={120} />
        )}
      </div>
      {hasData ? (
        <FinanceBiChartExpandModal
          open={expanded}
          title={title}
          subtitle="Saldo líquido mensal e acumulado no ano corrente (YTD)."
          onClose={closeExpand}
          testId="cash-flow-ytd-trend-chart-expand-modal"
        >
          <YtdTrendChartBody points={points} height={expandedHeight} />
        </FinanceBiChartExpandModal>
      ) : null}
    </>
  );
}

export function ytdTrendChartHasRenderableData(
  points: FinanceCashFlowExecutiveYtdTrendPoint[]
): boolean {
  return cashFlowMonthlySeriesHasData(
    points.map((p) => ({
      year: 0,
      month: Number(p.month),
      monthLabel: p.monthLabel,
      inflowAmount: p.inflow,
      outflowAmount: p.outflow,
      netFlowAmount: p.net,
      accumulatedBalance: p.accumulated,
      status: p.status === "neutral" ? null : p.status,
      inflowCount: 0,
      outflowCount: 0,
    }))
  );
}
