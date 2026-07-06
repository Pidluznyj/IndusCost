import React from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FinanceSalesOrdersOpenPortfolioEvolutionRow } from "@/src/lib/financeSalesOrdersDashboardTypes";
import { formatExecutiveCompactCurrency, formatExecutiveCurrency } from "@/src/lib/executiveDashboardFormatters";
import { ChartBarValueLabel } from "@/src/components/finance/shared/ChartValueLabel";
import {
  FINANCE_BILLING_CHART_HEIGHT,
  FinanceBillingChartShell,
} from "@/src/components/finance/billing/FinanceBillingChartShell";

export function FinanceSalesOrdersOpenPortfolioChart({
  rows,
  note,
}: {
  rows: FinanceSalesOrdersOpenPortfolioEvolutionRow[];
  note?: string;
}) {
  const data = rows.map((row) => ({
    name: row.monthLabel,
    openAmount: row.openAmount,
    issuedAmount: row.issuedAmount,
  }));
  const empty = rows.every((r) => r.openAmount === 0 && r.issuedAmount === 0);

  return (
    <FinanceBillingChartShell
      title="Carteira aberta por mês de emissão"
      subtitle={note ?? "Valor em carteira (sem NF processada) por mês de emissão do pedido."}
      empty={empty}
    >
      <ResponsiveContainer width="100%" height={FINANCE_BILLING_CHART_HEIGHT}>
        <ComposedChart data={data} margin={{ top: 28, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: "#6B7280" }}
            tickFormatter={(v: number) => formatExecutiveCompactCurrency(v).replace("R$ ", "")}
            width={80}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: number, name: string) => [
              formatExecutiveCurrency(value),
              name === "openAmount" ? "Carteira aberta" : "Emitido no mês",
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar
            dataKey="issuedAmount"
            name="Emitido no mês"
            fill="#94A3B8"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
          />
          <Bar
            dataKey="openAmount"
            name="Carteira aberta"
            fill="#F59E0B"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
          >
            <LabelList dataKey="openAmount" content={<ChartBarValueLabel />} />
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </FinanceBillingChartShell>
  );
}
