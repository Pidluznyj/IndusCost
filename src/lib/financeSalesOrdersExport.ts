import { fleetRowsToCsv } from "./fleetCsv.js";
import type { FinanceSalesOrdersDashboardPayload } from "./financeSalesOrdersDashboardTypes.js";
import { formatExecutivePercent } from "./executiveDashboardFormatters.js";

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
  return fleetRowsToCsv(headers, [...rows, ...summaryRows]);
}
