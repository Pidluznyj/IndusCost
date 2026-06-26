import React from "react";
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

export function SalesOrderResultMonthlyMarginChart({
  rows,
}: {
  rows: SalesOrderResultMonthlyRow[];
}) {
  const data = rows.map((row) => ({
    ...row,
    marginPercentLine: row.marginPercent ?? 0,
  }));
  const empty = rows.every((r) => r.salesAmount === 0 && (r.marginPercent ?? 0) === 0);

  return (
    <div className={`${financeBiCardClass} p-5`} data-testid="sales-order-result-monthly-chart">
      <h3 className="text-sm font-bold text-[#111827]">R$ Pedido Venda e % Margem por mês</h3>
      <p className="text-[11px] text-[#6B7280] mt-0.5 mb-3">
        Barras = valor vendido · Linha = margem gerencial % (ponderada por receita líquida).
      </p>
      {empty ? (
        <p className="text-sm text-[#6B7280] py-8 text-center">Sem dados para o período.</p>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
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
      )}
    </div>
  );
}
