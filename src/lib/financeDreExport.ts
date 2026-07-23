import type { FinanceDreReport } from "@/src/lib/financeDreTypes.js";
import { fleetRowsToCsv } from "@/src/lib/fleetCsv.js";

function money(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

/** CSV com colunas mês a mês + YTD + destaque — para o conselho. */
export function buildFinanceDreExportCsv(report: FinanceDreReport): string {
  const headers = [
    "Linha",
    "Tipo",
    "Informativo",
    ...report.monthLabels,
    "YTD",
    "Mês destaque",
    "% s/ Receita líquida (mês)",
    "Fonte",
  ];

  const rows = report.lines.map((line) => [
    line.label,
    line.kind,
    line.informativeOnly ? "sim" : "não",
    ...line.values.byMonth.map(money),
    money(line.values.ytd),
    money(line.values.highlight),
    line.pctOfNetRevenue == null ? "" : `${line.pctOfNetRevenue.toFixed(1).replace(".", ",")}%`,
    line.sourceNote ?? "",
  ]);

  return fleetRowsToCsv(headers, rows);
}

export function buildFinanceDreExportFilename(report: FinanceDreReport): string {
  const m = String(report.filters.highlightMonth).padStart(2, "0");
  return `dre-gerencial-${report.filters.year}-${m}.csv`;
}
