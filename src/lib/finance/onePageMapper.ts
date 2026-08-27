/**
 * Mapper puro do Financeiro > One Page.
 *
 * Camada executiva SOBRE os motores canônicos — recebe os tabs oficiais
 * (Faturamento NF-e e Pedidos de Venda) e apenas seleciona/formata:
 * - nenhum recálculo de população, fonte, data-base, exclusão ou meta;
 * - card obrigatório ausente FALHA com erro claro (nunca vira R$ 0 silencioso);
 * - YTD/meta vêm dos blocos estruturados oficiais (yearComparison,
 *   previousYearComparableYtd), não de cards de apresentação.
 */
import type {
  BillingDashboardTab,
  DashboardMetricCard,
  SalesOrdersDashboardTab,
} from "../executiveDashboardTypes.js";
import {
  formatFinanceKpiCurrency,
  formatFinanceKpiVariationPercent,
} from "../financeKpiFormat.js";
import { formatExecutivePercent } from "../executiveDashboardFormatters.js";
import type { OnePagePeriod } from "./onePagePeriod.js";
import type { OnePageDashboardPayload } from "./onePageTypes.js";

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const MONTH_SHORT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

/**
 * Card obrigatório do motor canônico. Ausência = contrato quebrado entre o
 * One Page e o motor — falha alto em vez de degradar para zero silencioso.
 */
export function requireSummaryCard(
  cards: ReadonlyArray<DashboardMetricCard>,
  id: string,
  engineLabel: string
): DashboardMetricCard {
  const card = cards.find((c) => c.id === id);
  if (!card) {
    throw new Error(
      `One Page: card obrigatório "${id}" não existe no motor ${engineLabel}. ` +
        `IDs disponíveis: ${cards.map((c) => c.id).join(", ") || "(nenhum)"}.`
    );
  }
  return card;
}

/** Variação % com denominador protegido — null quando não há base (> 0). */
export function computeVariationPercent(
  current: number | null | undefined,
  previous: number | null | undefined
): number | null {
  if (current == null || previous == null || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function yoyGrowthLabel(
  growthPercent: number | null,
  metricMonth: number,
  previousYear: number
): string {
  if (growthPercent == null) return "Sem base comparativa";
  return `${formatFinanceKpiVariationPercent(growthPercent)} vs ${MONTH_NAMES[metricMonth - 1]}/${previousYear}`;
}

function toChartData(
  accumulatedEvolution:
    | ReadonlyArray<{
        month: number;
        previousYearAccumulated: number | null;
        currentYearAccumulated: number | null;
        accumulatedTarget: number | null;
        projectedAccumulated: number | null;
      }>
    | null
    | undefined
) {
  return MONTH_SHORT.map((label, idx) => {
    const month = idx + 1;
    const point = accumulatedEvolution?.find((p) => p.month === month);
    return {
      month,
      monthLabel: label,
      previousYear: point?.previousYearAccumulated ?? null,
      currentYear: point?.currentYearAccumulated ?? null,
      target: point?.accumulatedTarget ?? null,
      projected: point?.projectedAccumulated ?? null,
    };
  });
}

export type OnePageMarginInput = {
  /** Margem ponderada canônica (Σ margem R$ ÷ Σ venda coberta) — null sem população. */
  percent: number | null;
  orderCount: number;
};

export type OnePageEngineInputs = {
  period: OnePagePeriod;
  billingTab: BillingDashboardTab;
  salesTab: SalesOrdersDashboardTab;
  margin: OnePageMarginInput;
  now: Date;
};

export function buildOnePagePayload(inputs: OnePageEngineInputs): OnePageDashboardPayload {
  const { period, billingTab, salesTab, margin, now } = inputs;
  const { selectedYear, previousYear, metricMonth } = period;
  const monthLabel = MONTH_NAMES[metricMonth - 1] ?? "";

  // 1. Faturamento — mesma fonte e blocos estruturados da tela oficial (NF-e).
  const fatMonthCard = requireSummaryCard(
    billingTab.summaryCards,
    "billing-month",
    "Faturamento NF-e"
  );
  const fatPrevMonthCard = requireSummaryCard(
    billingTab.summaryCards,
    "billing-prev-month",
    "Faturamento NF-e"
  );

  const fatMonthVal = fatMonthCard.value ?? null;
  const fatPrevMonthVal = fatPrevMonthCard.value ?? null;
  const fatMonthYoY = computeVariationPercent(fatMonthVal, fatPrevMonthVal);

  const fatYtdVal = billingTab.yearComparison.yearToDateCurrent ?? null;
  const fatYtdPrevVal = billingTab.yearComparison.yearToDatePrevious ?? null;
  const fatYtdDiff =
    fatYtdVal != null && fatYtdPrevVal != null ? fatYtdVal - fatYtdPrevVal : null;
  const fatYtdVariation = computeVariationPercent(fatYtdVal, fatYtdPrevVal);

  const fatMetaVal = billingTab.yearComparison.annualTarget ?? null;
  const fatAtingimento =
    fatYtdVal != null && fatMetaVal != null && fatMetaVal > 0
      ? (fatYtdVal / fatMetaVal) * 100
      : null;

  // 2. Pedidos de Venda — motor canônico (salesOrderRulesEngine via tab).
  const pedMonthCard = requireSummaryCard(
    salesTab.summaryCards,
    "realized-month",
    "Pedidos de Venda"
  );
  const pedYtdCard = requireSummaryCard(
    salesTab.summaryCards,
    "realized-ytd",
    "Pedidos de Venda"
  );
  const pedBacklogCard = requireSummaryCard(
    salesTab.summaryCards,
    "open-portfolio",
    "Pedidos de Venda"
  );

  const pedMonthVal = pedMonthCard.value ?? null;
  const pedYtdVal = pedYtdCard.value ?? null;
  const pedBacklogVal = pedBacklogCard.value ?? null;

  // YoY mensal — mesma semântica do motor: mesmo mês do ANO ANTERIOR.
  const pedPrevSameMonthVal = salesTab.target.previousPeriod ?? null;
  const pedMonthYoY = computeVariationPercent(pedMonthVal, pedPrevSameMonthVal);

  // YTD anterior COMPARÁVEL (mesmo corte temporal), exposto pelo motor.
  if (!salesTab.previousYearComparableYtd) {
    throw new Error(
      "One Page: o motor de Pedidos de Venda não expôs previousYearComparableYtd — contrato quebrado."
    );
  }
  const pedYtdPrevVal = salesTab.previousYearComparableYtd.net ?? null;
  const pedYtdDiff =
    pedYtdVal != null && pedYtdPrevVal != null ? pedYtdVal - pedYtdPrevVal : null;
  const pedYtdVariation = computeVariationPercent(pedYtdVal, pedYtdPrevVal);

  // 3. Séries acumuladas — direto dos motores canônicos.
  const faturamentoChartData = toChartData(billingTab.accumulatedEvolution);
  const pedidoChartData = toChartData(salesTab.accumulatedEvolution);

  // 4. Leitura executiva — só afirma o que tem base numérica.
  const leituraExecutiva: string[] = [];

  {
    const parts: string[] = [
      `Faturamento (NF-e) YTD ${selectedYear} de ${formatFinanceKpiCurrency(fatYtdVal)}`,
    ];
    if (fatYtdVariation != null) {
      const direction =
        fatYtdVariation > 0 ? "acima" : fatYtdVariation < 0 ? "abaixo" : "em linha com";
      const magnitude = formatFinanceKpiVariationPercent(Math.abs(fatYtdVariation)).replace(
        "+",
        ""
      );
      parts.push(
        fatYtdVariation === 0
          ? `em linha com o mesmo período de ${previousYear}`
          : `${magnitude} ${direction} do mesmo período de ${previousYear}`
      );
    } else {
      parts.push(`sem base comparativa em ${previousYear}`);
    }
    if (fatAtingimento != null) {
      parts.push(`atingimento de ${formatExecutivePercent(fatAtingimento)} da meta anual`);
    }
    leituraExecutiva.push(`${parts.join(", ")}.`);
  }

  {
    const parts: string[] = [
      `Pedidos YTD ${selectedYear} de ${formatFinanceKpiCurrency(pedYtdVal)}`,
    ];
    if (pedYtdVariation != null) {
      const direction =
        pedYtdVariation > 0 ? "acima" : pedYtdVariation < 0 ? "abaixo" : "em linha com";
      const magnitude = formatFinanceKpiVariationPercent(Math.abs(pedYtdVariation)).replace(
        "+",
        ""
      );
      parts.push(
        pedYtdVariation === 0
          ? `em linha com o mesmo período de ${previousYear}`
          : `${magnitude} ${direction} do mesmo período de ${previousYear}`
      );
    } else {
      parts.push(`sem base comparativa em ${previousYear}`);
    }
    if (pedBacklogVal != null) {
      parts.push(`backlog de ${formatFinanceKpiCurrency(pedBacklogVal)}`);
    }
    leituraExecutiva.push(`${parts.join(", ")}.`);
  }

  if (margin.percent != null) {
    leituraExecutiva.push(
      `Margem comercial de ${formatExecutivePercent(margin.percent)} no período ${period.marginPeriodLabel} (Σ margem R$ ÷ Σ venda coberta, sem intercompany).`
    );
  } else {
    leituraExecutiva.push(
      `Margem comercial indisponível para ${period.marginPeriodLabel} — sem pedidos com margem calculável no período.`
    );
  }

  const updatedAtStr = `${String(now.getDate()).padStart(2, "0")}/${String(
    now.getMonth() + 1
  ).padStart(2, "0")}/${now.getFullYear()} ${String(now.getHours()).padStart(
    2,
    "0"
  )}:${String(now.getMinutes()).padStart(2, "0")}`;

  const periodLabel =
    period.mode === "ytd"
      ? `Janeiro – ${monthLabel}/${selectedYear} (YTD)`
      : `${monthLabel}/${selectedYear}`;

  return {
    updatedAt: updatedAtStr,
    year: selectedYear,
    month: metricMonth,
    monthLabel,
    periodLabel,
    faturamento: {
      liquido: fatMonthVal,
      liquidoFormatted: formatFinanceKpiCurrency(fatMonthVal),
      liquidoGrowthPercent: fatMonthYoY,
      liquidoGrowthPercentFormatted: yoyGrowthLabel(fatMonthYoY, metricMonth, previousYear),
      ytd: fatYtdVal,
      ytdFormatted: formatFinanceKpiCurrency(fatYtdVal),
      ytdPrevious: fatYtdPrevVal,
      ytdPreviousFormatted: formatFinanceKpiCurrency(fatYtdPrevVal),
      ytdDiff: fatYtdDiff,
      ytdDiffFormatted: formatFinanceKpiCurrency(fatYtdDiff),
      ytdVariation: fatYtdVariation,
      ytdVariationFormatted: formatFinanceKpiVariationPercent(fatYtdVariation),
      meta: fatMetaVal,
      metaFormatted: formatFinanceKpiCurrency(fatMetaVal),
      atingimento: fatAtingimento,
      atingimentoFormatted:
        fatAtingimento != null ? formatExecutivePercent(fatAtingimento) : "—",
      chartData: faturamentoChartData,
    },
    pedidoVenda: {
      total: pedMonthVal,
      totalFormatted: formatFinanceKpiCurrency(pedMonthVal),
      totalGrowthPercent: pedMonthYoY,
      totalGrowthPercentFormatted: yoyGrowthLabel(pedMonthYoY, metricMonth, previousYear),
      margem: margin.percent,
      margemFormatted:
        margin.percent != null ? formatExecutivePercent(margin.percent) : "—",
      margemPeriodLabel: period.marginPeriodLabel,
      ytd: pedYtdVal,
      ytdFormatted: formatFinanceKpiCurrency(pedYtdVal),
      ytdPrevious: pedYtdPrevVal,
      ytdPreviousFormatted: formatFinanceKpiCurrency(pedYtdPrevVal),
      ytdDiff: pedYtdDiff,
      ytdDiffFormatted: formatFinanceKpiCurrency(pedYtdDiff),
      ytdVariation: pedYtdVariation,
      ytdVariationFormatted: formatFinanceKpiVariationPercent(pedYtdVariation),
      backlog: pedBacklogVal,
      backlogFormatted: formatFinanceKpiCurrency(pedBacklogVal),
      chartData: pedidoChartData,
    },
    leituraExecutiva,
  };
}
