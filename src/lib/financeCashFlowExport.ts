import type { FinanceCashFlowDashboardPayload } from "./financeCashFlowDashboardTypes.js";

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildFinanceCashFlowExportCsv(
  payload: FinanceCashFlowDashboardPayload
): string {
  const lines: string[] = [
    "tipo,ano,mes,entradas,saidas,fluxo_liquido,saldo_acumulado,qtd_entradas,qtd_saidas",
  ];
  for (const p of payload.monthlySeries) {
    lines.push(
      [
        csvEscape("mensal"),
        csvEscape(p.year),
        csvEscape(p.month),
        csvEscape(p.inflowAmount),
        csvEscape(p.outflowAmount),
        csvEscape(p.netFlowAmount),
        csvEscape(p.accumulatedBalance),
        csvEscape(p.inflowCount),
        csvEscape(p.outflowCount),
      ].join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

export function financeCashFlowExportFilename(year?: number): string {
  const y = year ?? new Date().getFullYear();
  const stamp = new Date().toISOString().slice(0, 10);
  return `fluxo-caixa-${y}-${stamp}.csv`;
}
