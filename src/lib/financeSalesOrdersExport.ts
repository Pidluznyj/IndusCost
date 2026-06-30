import { fleetRowsToCsv } from "./fleetCsv.js";
import type { FinanceSalesOrdersDashboardPayload } from "./financeSalesOrdersDashboardTypes.js";
import { formatExecutivePercent } from "./executiveDashboardFormatters.js";
import { SALES_ORDER_INTERNAL_MARGIN_REPORT_DISCLAIMER } from "./salesOrderInternalMarginExport.js";
import {
  resolveSalesOrderMarginMoneyLabel,
  resolveSalesOrderMarginPercentLabel,
} from "./salesOrderMarginCoverage.js";

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildFinanceSalesOrdersExportCsv(
  payload: FinanceSalesOrdersDashboardPayload
): string {
  const headers = [
    "Mês",
    "Ano atual",
    "Ano anterior",
    "Diferença",
    "Crescimento %",
    "Meta",
    "Projeção",
  ];
  const rows = payload.monthlyComparison.map((row) => {
    const rp = payload.realizedProjected.find((p) => p.month === row.month);
    return [
      row.monthLabel,
      formatMoney(row.currentYearAmount),
      formatMoney(row.previousYearAmount),
      formatMoney(row.differenceAmount),
      row.growthPercent != null ? formatExecutivePercent(row.growthPercent, 1) : "",
      formatMoney(rp?.targetAmount ?? null),
      formatMoney(rp?.projectedAmount ?? null),
    ];
  });
  const summaryRows = [
    [],
    ["Resumo"],
    ["Vendido no mês", formatMoney(payload.summary.monthSalesAmount)],
    ["Vendido YTD", formatMoney(payload.summary.ytdSalesAmount)],
    ["Meta mês", formatMoney(payload.summary.monthTargetAmount)],
    ["Meta ano", formatMoney(payload.summary.yearTargetAmount)],
    ["Carteira aberta", formatMoney(payload.summary.openPortfolioAmount)],
    ["Pedidos", String(payload.summary.orderCount)],
    ["Itens", String(payload.summary.itemCount)],
  ];

  const margin = payload.summary.marginPortfolio;
  const marginRows = margin
    ? [
        [],
        ["Margem consolidada (interno)"],
        [SALES_ORDER_INTERNAL_MARGIN_REPORT_DISCLAIMER],
        ["Receita líquida", formatMoney(margin.netRevenue)],
        ["Custo estimado", formatMoney(margin.totalCost)],
        [resolveSalesOrderMarginMoneyLabel(margin), formatMoney(margin.marginValue)],
        [
          resolveSalesOrderMarginPercentLabel(margin),
          margin.marginPercent != null ? formatExecutivePercent(margin.marginPercent, 2) : "",
        ],
        ["Cobertura receita", margin.costCoverageStatus],
        [
          "Receita vendida (escopo)",
          formatMoney(margin.totalSalesRevenueInScope),
        ],
        ["Receita coberta", formatMoney(margin.marginRevenueCovered)],
        ["Receita sem custo", formatMoney(margin.marginRevenueUncovered)],
        ["Markup", margin.markup != null ? String(margin.markup) : ""],
        ["Status margem", margin.statusLabel],
        ["Itens sem custo", margin.hasMissingCost ? "Sim" : "Não"],
        ["Itens sem produto", margin.hasMissingProduct ? "Sim" : "Não"],
        ["Margem negativa", margin.hasNegativeMargin ? "Sim" : "Não"],
      ]
    : [];

  return fleetRowsToCsv(headers, [...rows, ...summaryRows, ...marginRows]);
}
