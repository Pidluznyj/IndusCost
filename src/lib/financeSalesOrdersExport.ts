import { fleetRowsToCsv } from "./fleetCsv.js";
import type { FinanceSalesOrdersDashboardPayload } from "./financeSalesOrdersDashboardTypes.js";
import { formatExecutivePercent } from "./executiveDashboardFormatters.js";
import { SALES_ORDER_INTERNAL_MARGIN_REPORT_DISCLAIMER } from "./salesOrderInternalMarginExport.js";
import {
  buildOfficialSalesOrderMarginTooltipText,
  resolveSalesOrderMarginRevenueLabel,
} from "./salesOrderMarginDisplay.js";
import {
  resolveCommercialMarginDisplayLabel,
} from "./salesOrderCommercialMarginReadModel.js";

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
  const commercial = margin?.commercialMargin ?? null;
  const commercialLabel = resolveCommercialMarginDisplayLabel(commercial);
  const marginRows = margin
    ? [
        [],
        ["Margem comercial consolidada (interno)"],
        [SALES_ORDER_INTERNAL_MARGIN_REPORT_DISCLAIMER],
        ...buildOfficialSalesOrderMarginTooltipText({ summary: margin })
          .split("\n")
          .map((line) => [line]),
        [],
        [
          "Valor líquido coberto (comercial)",
          formatMoney(commercial?.commercialSoldTotalValue ?? margin.marginRevenueCovered),
        ],
        [
          `${commercialLabel} (R$)`,
          formatMoney(commercial?.commercialMarginTotalValue ?? margin.marginValue),
        ],
        [
          `${commercialLabel} (%)`,
          (commercial?.commercialMarginTotalPercent ?? margin.marginPercent) != null
            ? formatExecutivePercent(
                commercial?.commercialMarginTotalPercent ?? margin.marginPercent!,
                2
              )
            : "",
        ],
        [
          "Cobertura margem %",
          (commercial?.commercialMarginCoveragePercent ?? margin.marginCoveragePercent) !=
          null
            ? formatExecutivePercent(
                commercial?.commercialMarginCoveragePercent ??
                  margin.marginCoveragePercent!,
                2
              )
            : "",
        ],
        ["Status margem comercial", commercialLabel],
        [],
        ["— Separador: indicadores gerenciais (não substituem a comercial) —"],
        [resolveSalesOrderMarginRevenueLabel(margin), formatMoney(margin.netRevenue)],
        ["Custo estimado (gerencial)", formatMoney(margin.totalCost)],
        [
          "Margem gerencial após impostos e custo (R$)",
          formatMoney(margin.marginValue),
        ],
        [
          "Margem gerencial após impostos e custo (%)",
          margin.marginPercent != null
            ? formatExecutivePercent(margin.marginPercent, 2)
            : "",
        ],
        ["Markup (gerencial)", margin.markup != null ? String(margin.markup) : ""],
      ]
    : [];

  return fleetRowsToCsv(headers, [...rows, ...summaryRows, ...marginRows]);
}
