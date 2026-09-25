import React, { useCallback, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarClock, History, Loader2 } from "lucide-react";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { getExecutiveChartColors } from "@/src/lib/executiveDashboardChartTheme";
import { FinanceBiChartExpandButton } from "@/src/components/finance/bi/FinanceBiChartExpandButton";
import {
  FinanceBiChartExpandModal,
  useFinanceBiExpandedChartHeight,
} from "@/src/components/finance/bi/FinanceBiChartExpandModal";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerBadge,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import {
  describeGrantedPaymentTermMonthlyPoint,
  formatGrantedPaymentTermChartLabel,
  resolveGrantedPaymentTermPeriodCards,
  type SalesOrderGrantedPaymentTermMonthlyRow,
  type SalesOrderGrantedPaymentTermMonthlySeries,
  type SalesOrderGrantedPaymentTermPeriodComparison,
} from "@/src/lib/salesOrderGrantedPaymentTerm";

export const SALES_ORDER_RESULT_RECEIVABLE_TERM_CHART_TEST_ID =
  "sales-order-result-receivable-term-chart";

type ChartDatum = {
  monthLabel: string;
  currentDays: number | null;
  previousDays: number | null;
  row: SalesOrderGrantedPaymentTermMonthlyRow;
};

const formatBarLabel = (value: unknown) =>
  formatGrantedPaymentTermChartLabel(typeof value === "number" ? value : null);

function ReceivableTermTooltip({
  active,
  payload,
  year,
  previousYear,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartDatum }>;
  year: number;
  previousYear: number;
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0]?.payload;
  if (!datum) return null;
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm text-[11px] text-[#111827]">
      <p className="font-semibold mb-1">{datum.row.monthLabel}</p>
      <p>
        <span className="font-semibold">{year}:</span>{" "}
        {describeGrantedPaymentTermMonthlyPoint(datum.row.current)}
      </p>
      <p>
        <span className="font-semibold">{previousYear}:</span>{" "}
        {describeGrantedPaymentTermMonthlyPoint(datum.row.previous)}
      </p>
    </div>
  );
}

function ChartBody({
  data,
  height,
  year,
  previousYear,
}: {
  data: ChartDatum[];
  height: number;
  year: number;
  previousYear: number;
}) {
  const colors = getExecutiveChartColors("salesOrders");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 24, right: 12, left: 0, bottom: 4 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
        <XAxis
          dataKey="monthLabel"
          tick={{ fontSize: 11, fill: "#6B7280" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#6B7280" }}
          tickFormatter={(value: number) => `${value}d`}
          width={40}
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          content={<ReceivableTermTooltip year={year} previousYear={previousYear} />}
          cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
        />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <Bar
          dataKey="previousDays"
          name={String(previousYear)}
          fill={colors.previousYearBar}
          radius={[4, 4, 0, 0]}
          maxBarSize={22}
        >
          <LabelList
            dataKey="previousDays"
            position="top"
            formatter={formatBarLabel}
            style={{ fontSize: 9, fill: "#6B7280" }}
          />
        </Bar>
        <Bar
          dataKey="currentDays"
          name={String(year)}
          fill={colors.currentYearBar}
          radius={[4, 4, 0, 0]}
          maxBarSize={22}
        >
          <LabelList
            dataKey="currentDays"
            position="top"
            formatter={formatBarLabel}
            style={{ fontSize: 9, fill: "#374151", fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Dois cards acima do gráfico: prazo médio do período selecionado (acumulado do
 * ano até hoje, ou o mês escolhido) × as mesmas datas do ano anterior, com selo
 * "melhor/pior" (menos dias = recebimento mais rápido). Textos e tons vêm do
 * motor puro — sem cálculo no React.
 */
function ReceivableTermPeriodCards({
  comparison,
  loading,
}: {
  comparison: SalesOrderGrantedPaymentTermPeriodComparison;
  loading: boolean;
}) {
  const cards = resolveGrantedPaymentTermPeriodCards(comparison);
  return (
    <div
      className="mt-3 mb-4"
      data-testid={`${SALES_ORDER_RESULT_RECEIVABLE_TERM_CHART_TEST_ID}-period`}
      data-trend={comparison.trend}
    >
      <SummaryKpiGrid minColumnWidth={220} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <SystemTotalizerCard
          testId={`${SALES_ORDER_RESULT_RECEIVABLE_TERM_CHART_TEST_ID}-period-current`}
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label={cards.current.label}
          value={cards.current.value}
          valueSize={cards.current.valueSize}
          subtitle={cards.current.subtitle}
          tone={cards.current.tone}
          icon={CalendarClock}
          helperText={cards.current.helperText}
          footer={
            <SystemTotalizerBadge
              label={cards.current.badgeLabel}
              tone={cards.current.badgeTone}
              testId={`${SALES_ORDER_RESULT_RECEIVABLE_TERM_CHART_TEST_ID}-period-trend`}
            />
          }
          loading={loading}
        />
        <SystemTotalizerCard
          testId={`${SALES_ORDER_RESULT_RECEIVABLE_TERM_CHART_TEST_ID}-period-previous`}
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label={cards.previous.label}
          value={cards.previous.value}
          valueSize={cards.previous.valueSize}
          subtitle={cards.previous.subtitle}
          tone={cards.previous.tone}
          icon={History}
          helperText={cards.previous.helperText}
          footer={<SystemTotalizerBadge label={cards.previous.badgeLabel} tone={cards.previous.badgeTone} />}
          loading={loading}
        />
      </SummaryKpiGrid>
    </div>
  );
}

/**
 * Prazo médio de recebimento (tela Resultado): cards do período selecionado × mesmo
 * período do ano anterior e gráfico mês a mês (12 meses do ano filtrado × ano
 * anterior). Barra só com cobertura ≥ 80% do faturado (regra do card da listagem).
 */
export function SalesOrderResultReceivableTermChart({
  series,
  loading,
  error,
}: {
  series: SalesOrderGrantedPaymentTermMonthlySeries | null;
  loading: boolean;
  error: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const expandedHeight = useFinanceBiExpandedChartHeight(560);
  const openExpand = useCallback(() => setExpanded(true), []);
  const closeExpand = useCallback(() => setExpanded(false), []);

  const data = useMemo<ChartDatum[]>(
    () =>
      (series?.rows ?? []).map((row) => ({
        monthLabel: row.monthLabel,
        currentDays: row.current.chartDays,
        previousDays: row.previous.chartDays,
        row,
      })),
    [series]
  );
  const empty = data.every((d) => d.currentDays == null && d.previousDays == null);

  const year = series?.year ?? new Date().getFullYear();
  const previousYear = series?.previousYear ?? year - 1;
  const title = series
    ? `Prazo médio de recebimento por mês — ${year} vs ${previousYear}`
    : "Prazo médio de recebimento por mês";
  const subtitle =
    "Dias entre a emissão da NF-e e o vencimento dos títulos do Contas a Receber, ponderados pelo valor " +
    "líquido dos pedidos faturados. Cards: período selecionado × as mesmas datas do ano anterior. " +
    "Barras: mês a mês pela emissão do pedido (o filtro Mês não se aplica às barras).";

  return (
    <>
      <div
        className={`${financeBiCardClass} p-5`}
        data-testid={SALES_ORDER_RESULT_RECEIVABLE_TERM_CHART_TEST_ID}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-[#111827]">
              {title}
              {series && loading ? (
                <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-normal text-[#6B7280]">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  Atualizando…
                </span>
              ) : null}
            </h3>
            <p className="text-[11px] text-[#6B7280] mt-0.5">{subtitle}</p>
          </div>
          {series && !empty ? (
            <FinanceBiChartExpandButton
              onClick={openExpand}
              testId={`${SALES_ORDER_RESULT_RECEIVABLE_TERM_CHART_TEST_ID}-expand`}
            />
          ) : null}
        </div>

        {series ? <ReceivableTermPeriodCards comparison={series.periodComparison} loading={loading} /> : null}

        {!series && loading ? (
          <div
            className="flex items-center justify-center gap-2 py-12 text-sm text-[#6B7280]"
            data-testid={`${SALES_ORDER_RESULT_RECEIVABLE_TERM_CHART_TEST_ID}-loading`}
          >
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            Carregando prazo médio de recebimento…
          </div>
        ) : null}

        {!series && !loading && error ? (
          <p
            className="text-sm text-[#6B7280] py-8 text-center"
            data-testid={`${SALES_ORDER_RESULT_RECEIVABLE_TERM_CHART_TEST_ID}-error`}
          >
            {error}
          </p>
        ) : null}

        {series && empty ? (
          <p
            className="text-sm text-[#6B7280] py-8 text-center"
            data-testid={`${SALES_ORDER_RESULT_RECEIVABLE_TERM_CHART_TEST_ID}-empty`}
          >
            Sem pedidos faturados com prazo apurado no período.
          </p>
        ) : null}

        {series && !empty ? (
          <ChartBody data={data} height={320} year={year} previousYear={previousYear} />
        ) : null}
      </div>

      {series && !empty ? (
        <FinanceBiChartExpandModal
          open={expanded}
          title={title}
          subtitle={subtitle}
          eyebrow="Comercial · Pedidos de venda · Resultado"
          onClose={closeExpand}
          testId={`${SALES_ORDER_RESULT_RECEIVABLE_TERM_CHART_TEST_ID}-expand-modal`}
        >
          <ChartBody data={data} height={expandedHeight} year={year} previousYear={previousYear} />
        </FinanceBiChartExpandModal>
      ) : null}
    </>
  );
}
