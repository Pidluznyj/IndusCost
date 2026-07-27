import React, { useCallback, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SalesOrderResultMonthlyRow } from "@/src/lib/salesOrderResultTypes";
import { formatFinanceCurrencyCompact } from "@/src/lib/financeAccountsReceivableFormat";
import { formatSalesOrderMarginPercent } from "@/src/lib/salesOrderMarginDisplay";
import { formatCurrency } from "@/src/lib/utils";
import { ChartBarValueLabel } from "@/src/components/finance/shared/ChartValueLabel";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceBiChartExpandButton } from "@/src/components/finance/bi/FinanceBiChartExpandButton";
import {
  FinanceBiChartExpandModal,
  useFinanceBiExpandedChartHeight,
} from "@/src/components/finance/bi/FinanceBiChartExpandModal";

function MonthlyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: SalesOrderResultMonthlyRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm text-[11px] text-[#111827]">
      <p className="font-semibold capitalize mb-1">{row.monthLabel}</p>
      <p>Valor vendido: {formatCurrency(row.salesAmount)}</p>
      <p>Custo: {formatCurrency(row.costAmount)}</p>
      <p>Imposto: {formatCurrency(row.taxAmount)}</p>
      <p>Margem R$: {formatCurrency(row.marginAmount)}</p>
      <p>Margem %: {formatSalesOrderMarginPercent(row.marginPercent)}</p>
      <p>Pedidos: {row.ordersCount}</p>
    </div>
  );
}

function ChartBody({
  data,
  height,
}: {
  data: Array<SalesOrderResultMonthlyRow & { marginPercentLine: number }>;
  height: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 28, right: 48, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis dataKey="monthLabel" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 11, fill: "#6B7280" }}
          tickFormatter={(v: number) => formatFinanceCurrencyCompact(v)}
          width={88}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 11, fill: "#6B7280" }}
          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
          width={48}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<MonthlyTooltip />} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <Bar
          yAxisId="left"
          dataKey="salesAmount"
          name="R$ Pedido Venda"
          fill="#059669"
          radius={[4, 4, 0, 0]}
          maxBarSize={32}
        >
          <LabelList dataKey="salesAmount" content={<ChartBarValueLabel />} />
        </Bar>
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="marginPercentLine"
          name="% Margem"
          stroke="#4F46E5"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "#4F46E5" }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function SalesOrderResultMonthlyMarginChart({
  rows,
}: {
  rows: SalesOrderResultMonthlyRow[];
}) {
  const [expanded, setExpanded] = useState(false);
  const expandedHeight = useFinanceBiExpandedChartHeight(560);
  const openExpand = useCallback(() => setExpanded(true), []);
  const closeExpand = useCallback(() => setExpanded(false), []);

  const data = rows.map((row) => ({
    ...row,
    marginPercentLine: row.marginPercent ?? 0,
  }));
  const empty = rows.every((r) => r.salesAmount === 0 && (r.marginPercent ?? 0) === 0);
  const title = "R$ Pedido Venda e % Margem por mês";
  const subtitle = "Barras = valor vendido · Linha = margem gerencial % (ponderada por receita líquida).";

  return (
    <>
      <div className={`${financeBiCardClass} p-5`} data-testid="sales-order-result-monthly-chart">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-[#111827]">{title}</h3>
            <p className="text-[11px] text-[#6B7280] mt-0.5 mb-3">{subtitle}</p>
          </div>
          {!empty ? (
            <FinanceBiChartExpandButton
              onClick={openExpand}
              testId="sales-order-result-monthly-chart-expand"
            />
          ) : null}
        </div>
        {empty ? (
          <p className="text-sm text-[#6B7280] py-8 text-center">Sem dados para o período.</p>
        ) : (
          <ChartBody data={data} height={320} />
        )}
      </div>
      {!empty ? (
        <FinanceBiChartExpandModal
          open={expanded}
          title={title}
          subtitle={subtitle}
          eyebrow="Comercial · Pedidos de venda"
          onClose={closeExpand}
          testId="sales-order-result-monthly-chart-expand-modal"
        >
          <ChartBody data={data} height={expandedHeight} />
        </FinanceBiChartExpandModal>
      ) : null}
    </>
  );
}
