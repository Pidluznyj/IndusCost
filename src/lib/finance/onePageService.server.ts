import { prisma } from "../prisma.js";
import { buildBillingDashboardTab } from "../billingDashboardMetrics.js";
import { buildSalesOrdersDashboardTab } from "../salesOrdersDashboardMetrics.js";
import { resolveExecutiveDashboardYearContext } from "../executiveDashboardYear.js";
import {
  formatFinanceKpiCurrency,
  formatFinanceKpiVariationPercent,
} from "../financeKpiFormat.js";
import {
  formatExecutivePercent,
} from "../executiveDashboardFormatters.js";
import { getSalesOrdersCommercialMargins } from "../salesOrderCommercialMarginReadService.server.js";
import { aggregateCommercialMarginSummaries } from "../salesOrderCommercialMarginReadModel.js";
import { isIntercompanySalesOrder } from "../financeInternalGroupExclusions.js";
import { buildSalesOrderListWhere } from "../salesOrdersListSummary.js";
import type { OnePageDashboardPayload } from "./onePageTypes.js";

export type { OnePageDashboardPayload } from "./onePageTypes.js";

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

export async function getFinanceOnePageDashboard(
  yearParam: unknown,
  monthParam?: unknown
): Promise<OnePageDashboardPayload> {
  const now = new Date();
  const yearCtx = resolveExecutiveDashboardYearContext(yearParam, now);

  let metricMonth = yearCtx.referenceDate.getMonth() + 1;
  if (monthParam != null && monthParam !== "") {
    const m = Number(monthParam);
    if (Number.isInteger(m) && m >= 1 && m <= 12) {
      metricMonth = m;
      const targetYear = yearCtx.selectedYear;
      const isCurrent = yearCtx.isSelectedYearCurrent;

      if (isCurrent && m > now.getMonth() + 1) {
        metricMonth = now.getMonth() + 1;
      }

      const endOfSelectedMonth = new Date(
        targetYear,
        metricMonth - 1,
        28,
        23,
        59,
        59,
        999
      );
      yearCtx.referenceDate = endOfSelectedMonth;
      yearCtx.ytdMonthLimit = metricMonth;
    }
  }

  const [billingData, salesOrdersData] = await Promise.all([
    buildBillingDashboardTab(yearCtx),
    buildSalesOrdersDashboardTab(yearCtx, { month: metricMonth }),
  ]);

  // 1. Faturamento Calculations
  const fatCard = billingData.summaryCards.find((c) => c.id === "billing_net_found");
  const fatYtdCard = billingData.summaryCards.find((c) => c.id === "billing_ytd_current");
  const fatYtdPrevCard = billingData.summaryCards.find((c) => c.id === "billing_ytd_previous");
  const fatDeltaCard = billingData.summaryCards.find((c) => c.id === "billing_delta_prev_year_month_percent");
  
  const fatMonthVal = fatCard?.value ?? 0;
  const fatYtdVal = fatYtdCard?.value ?? 0;
  const fatYtdPrevVal = fatYtdPrevCard?.value ?? 0;
  
  const fatYtdDiff = fatYtdVal - fatYtdPrevVal;
  const fatYtdVariation = fatYtdPrevVal > 0 ? (fatYtdDiff / fatYtdPrevVal) * 100 : 0;
  
  const fatMetaVal = billingData.target?.target ?? 0;
  const fatAtingimento = fatMetaVal > 0 ? (fatYtdVal / fatMetaVal) * 100 : 0;

  // Growth Faturamento Mês
  const fatMonthDeltaVal = fatDeltaCard?.value ?? 0;
  const fatMonthDeltaFmt = formatFinanceKpiVariationPercent(fatMonthDeltaVal);

  // 2. Pedidos de Venda Calculations
  const pedCard = salesOrdersData.summaryCards.find((c) => c.id === "realized-month");
  const pedYtdCard = salesOrdersData.summaryCards.find((c) => c.id === "realized-ytd");
  const pedAnnualTargetCard = salesOrdersData.summaryCards.find((c) => c.id === "annual-target");
  const pedBacklogCard = salesOrdersData.summaryCards.find((c) => c.id === "open-portfolio");

  const pedMonthVal = pedCard?.value ?? 0;
  const pedYtdVal = pedYtdCard?.value ?? 0;
  const pedBacklogVal = pedBacklogCard?.value ?? 0;

  // Calculo de Pedido YTD anterior e variação
  const pedPrevYearFullNet = salesOrdersData.targets?.annual?.basePreviousYear ?? 0;
  // Para YTD anterior de pedidos, calculamos a soma dos meses anteriores correspondentes
  let pedYtdPrevVal = 0;
  if (salesOrdersData.accumulatedEvolution?.length) {
    const pt = salesOrdersData.accumulatedEvolution.find((p) => p.month === metricMonth);
    pedYtdPrevVal = pt?.previousYearAccumulated ?? 0;
  }
  const pedYtdDiff = pedYtdVal - pedYtdPrevVal;
  const pedYtdVariation = pedYtdPrevVal > 0 ? (pedYtdDiff / pedYtdPrevVal) * 100 : 0;

  // Growth Pedidos Mês vs Mês anterior
  let pedMonthGrowth = 0;
  const prevMonthNet = salesOrdersData.target?.previousPeriod ?? 0;
  if (prevMonthNet > 0) {
    pedMonthGrowth = ((pedMonthVal - prevMonthNet) / prevMonthNet) * 100;
  }

  // Margem do mês selecionado
  let averageMarginPercent = 0;
  const listWhere = buildSalesOrderListWhere({ year: yearCtx.selectedYear });
  const start = new Date(yearCtx.selectedYear, metricMonth - 1, 1, 0, 0, 0, 0);
  const end = new Date(yearCtx.selectedYear, metricMonth, 0, 23, 59, 59, 999);
  
  const monthOrders = await prisma.salesOrder.findMany({
    where: {
      AND: [
        listWhere,
        {
          issueDate: {
            gte: start,
            lte: end,
          },
        },
      ],
    },
    select: {
      id: true,
      customerId: true,
      Customer: {
        select: {
          companyName: true,
          tradeName: true,
          taxId: true,
        },
      },
    },
  });

  const filteredMonthOrders = monthOrders.filter(
    (order) => !isIntercompanySalesOrder(order)
  );
  const monthOrderIds = filteredMonthOrders.map((o) => o.id);

  if (monthOrderIds.length > 0) {
    const marginsMap = await getSalesOrdersCommercialMargins(prisma, monthOrderIds);
    const summaries = monthOrderIds
      .map((id) => marginsMap.get(id))
      .filter((summary): summary is any => Boolean(summary));
    const aggregated = aggregateCommercialMarginSummaries(summaries);
    averageMarginPercent = aggregated.commercialMarginTotalPercent ?? 0;
  }

  // 3. Chart Series Formatting
  const faturamentoChartData = MONTH_SHORT.map((label, idx) => {
    const month = idx + 1;
    // billingData.accumulatedEvolution
    const point = billingData.accumulatedEvolution?.find((p) => p.month === month);
    return {
      month,
      monthLabel: label,
      previousYear: point?.previousYearAccumulated ?? null,
      currentYear: point?.currentYearAccumulated ?? null,
      target: point?.accumulatedTarget ?? null,
      projected: point?.projectedAccumulated ?? null,
    };
  });

  const pedidoChartData = MONTH_SHORT.map((label, idx) => {
    const month = idx + 1;
    const point = salesOrdersData.accumulatedEvolution?.find((p) => p.month === month);
    return {
      month,
      monthLabel: label,
      previousYear: point?.previousYearAccumulated ?? null,
      currentYear: point?.currentYearAccumulated ?? null,
      target: point?.accumulatedTarget ?? null,
      projected: point?.projectedAccumulated ?? null,
    };
  });

  // Insights
  const fatYtdFmt = formatFinanceKpiCurrency(fatYtdVal);
  const fatChangeDir = fatYtdVariation >= 0 ? "acima" : "abaixo";
  const fatVarClean = formatFinanceKpiVariationPercent(fatYtdVariation).replace("+", "").replace("-", "");
  const fatAchievementFmt = formatExecutivePercent(fatAtingimento);
  
  const pedYtdFmt = formatFinanceKpiCurrency(pedYtdVal);
  const pedChangeDir = pedYtdVariation >= 0 ? "acima" : "abaixo";
  const pedVarClean = formatFinanceKpiVariationPercent(pedYtdVariation).replace("+", "").replace("-", "");
  const pedBacklogFmt = formatFinanceKpiCurrency(pedBacklogVal);
  
  const margemFmt = formatExecutivePercent(averageMarginPercent);

  const leituraExecutiva = [
    `Faturamento YTD ${yearCtx.selectedYear} alcançou ${fatYtdFmt}, ${fatVarClean} ${fatChangeDir} do mesmo período de ${yearCtx.previousYear}, com atingimento de ${fatAchievementFmt} da meta anual.`,
    `Pedidos YTD ${yearCtx.selectedYear} totalizam ${pedYtdFmt}, ${pedVarClean} ${pedChangeDir} de ${yearCtx.previousYear} e backlog de ${pedBacklogFmt}, garantindo boa visibilidade de demanda.`,
    `Margem média dos pedidos em ${margemFmt}, mantendo nível saudável e alinhado à estratégia de rentabilidade.`,
  ];

  const updatedAtStr = `${String(now.getDate()).padStart(2, "0")}/${String(
    now.getMonth() + 1
  ).padStart(2, "0")}/${now.getFullYear()} ${String(now.getHours()).padStart(
    2,
    "0"
  )}:${String(now.getMinutes()).padStart(2, "0")}`;

  return {
    updatedAt: updatedAtStr,
    year: yearCtx.selectedYear,
    month: metricMonth,
    monthLabel: MONTH_NAMES[metricMonth - 1] ?? "",
    periodLabel: `Janeiro - Dezembro/${yearCtx.selectedYear} (YTD)`,
    faturamento: {
      liquido: fatMonthVal,
      liquidoFormatted: formatFinanceKpiCurrency(fatMonthVal),
      liquidoGrowthPercent: fatMonthDeltaVal,
      liquidoGrowthPercentFormatted: `${fatMonthDeltaFmt} vs ${MONTH_NAMES[(metricMonth - 2 + 12) % 12]}/${yearCtx.selectedYear}`,
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
      atingimentoFormatted: formatExecutivePercent(fatAtingimento),
      chartData: faturamentoChartData,
    },
    pedidoVenda: {
      total: pedMonthVal,
      totalFormatted: formatFinanceKpiCurrency(pedMonthVal),
      totalGrowthPercent: pedMonthGrowth,
      totalGrowthPercentFormatted: `${formatFinanceKpiVariationPercent(pedMonthGrowth)} vs ${MONTH_NAMES[(metricMonth - 2 + 12) % 12]}/${yearCtx.selectedYear}`,
      margem: averageMarginPercent,
      margemFormatted: margemFmt,
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
