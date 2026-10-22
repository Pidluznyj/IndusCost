import React, { memo, useEffect, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LabelProps } from "recharts";
import {
  FINANCE_BILLING_CHART_HEIGHT,
  FinanceBillingChartShell,
} from "@/src/components/finance/billing/FinanceBillingChartShell";
import { getExecutiveChartColors } from "@/src/lib/executiveDashboardChartTheme";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { fetchJsonOk } from "@/src/lib/http";
import type { ProposalConversionYtdPayload } from "@/src/lib/proposalConversionYtd";
import { formatSalesOrderMarginPercent } from "@/src/lib/salesOrderMarginDisplay";
import { useSectionVisible } from "@/src/hooks/useSectionVisible";

type ChartRow = {
  name: string;
  conversionRate: number | null;
  hasRate: boolean;
  isFuture: boolean;
  convertedCount: number;
  convertedAmount: number;
  totalCount: number;
};

function ConversionRateBarLabel(props: LabelProps) {
  const value =
    typeof props.value === "number"
      ? props.value
      : typeof props.value === "string"
        ? Number(props.value)
        : null;
  if (value == null || !Number.isFinite(value)) return null;
  const x = Number(props.x ?? 0) + Number(props.width ?? 0) / 2;
  const y = Number(props.y ?? 0) - 4;
  return (
    <text x={x} y={y} fill="#15803D" fontSize={10} fontWeight={600} textAnchor="middle">
      {formatSalesOrderMarginPercent(value)}
    </text>
  );
}

/**
 * Taxa de conversão mês a mês do ano vigente (YTD).
 * Não recebe filtro da lista — a rota também ignora query string.
 */
export const ProposalConversionYtdChart = memo(function ProposalConversionYtdChart() {
  const { ref: sectionRef, visible } = useSectionVisible<HTMLDivElement>();
  const [payload, setPayload] = useState<ProposalConversionYtdPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void fetchJsonOk<ProposalConversionYtdPayload>("/api/proposals/conversion-ytd", {
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
        setError("Não foi possível carregar a conversão mês a mês.");
        setPayload(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [visible]);

  if (!visible || loading) {
    return (
      <div
        ref={sectionRef}
        className="h-[340px] animate-pulse rounded-xl border border-border bg-muted/40"
        data-testid="proposal-conversion-ytd-chart-loading"
      />
    );
  }

  if (error && !payload) {
    return (
      <p
        ref={sectionRef}
        className="text-sm text-amber-700 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
        data-testid="proposal-conversion-ytd-chart-error"
      >
        {error}
      </p>
    );
  }

  if (!payload) {
    return <div ref={sectionRef} className="hidden" aria-hidden />;
  }

  const colors = getExecutiveChartColors("salesOrders");
  const data: ChartRow[] = payload.months.map((row) => ({
    name: row.monthLabel,
    conversionRate: row.conversionRate,
    hasRate: row.conversionRate != null,
    isFuture: row.isFuture,
    convertedCount: row.convertedCount,
    convertedAmount: row.convertedAmount,
    totalCount: row.totalCount,
  }));
  const empty = data.every((row) => !row.hasRate);

  return (
    <div ref={sectionRef} data-testid="proposal-conversion-ytd-chart-section">
      <FinanceBillingChartShell
        title={`Conversão em PV % — ${payload.year}`}
        subtitle={`Taxa mês a mês de janeiro até o mês corrente (YTD). Quantidade e valor no detalhe de cada barra. Este gráfico não acompanha os filtros da lista.`}
        empty={empty}
        emptyDescription="Sem propostas no ano vigente para calcular a conversão."
        testId="proposal-conversion-ytd-chart"
        modalEyebrow="Comercial · Propostas"
      >
        {({ height }) => (
          <ResponsiveContainer width="100%" height={height || FINANCE_BILLING_CHART_HEIGHT}>
            <ComposedChart data={data} margin={{ top: 28, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: "#6B7280" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#6B7280" }}
                tickFormatter={(value: number) => `${value.toFixed(0)}%`}
                width={48}
                axisLine={false}
                tickLine={false}
                domain={[0, 100]}
              />
              <Tooltip
                formatter={(value: number | null, _name, item) => {
                  const point = item?.payload as ChartRow | undefined;
                  if (!point || point.isFuture) {
                    return ["Mês ainda não iniciado", "Conversão em PV"];
                  }
                  if (!point.hasRate || value == null || !Number.isFinite(value)) {
                    return ["Sem propostas no mês", "Conversão em PV"];
                  }
                  const quantity = `${point.convertedCount.toLocaleString("pt-BR")} de ${point.totalCount.toLocaleString("pt-BR")}`;
                  return [
                    `${formatSalesOrderMarginPercent(value)} · ${quantity} · ${formatFinanceCurrency(point.convertedAmount)}`,
                    "Conversão em PV",
                  ];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="conversionRate"
                name={`Conversão em PV % ${payload.year}`}
                fill={colors.currentYearBar}
                radius={[4, 4, 0, 0]}
                maxBarSize={36}
              >
                {data.map((entry, index) => (
                  <Cell
                    key={`proposal-conversion-cell-${index}`}
                    fill={entry.hasRate ? colors.currentYearBar : "transparent"}
                  />
                ))}
                <LabelList dataKey="conversionRate" content={<ConversionRateBarLabel />} />
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </FinanceBillingChartShell>
    </div>
  );
});
