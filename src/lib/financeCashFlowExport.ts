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
    "tipo,ano,mes,entradas,saidas,fluxo_liquido,saldo_acumulado,status_mes,qtd_entradas,qtd_saidas,cenario_base_liquido,conservador_liquido,critico_liquido",
  ];
  for (const p of payload.monthlySeries) {
    const forecast = payload.cashForecast.monthlyPoints.find(
      (f) => f.year === p.year && f.month === p.month
    );
    const cons = payload.conservativeScenario.monthlyPoints.find(
      (f) => f.year === p.year && f.month === p.month
    );
    const stress = payload.stressScenario.monthlyPoints.find(
      (f) => f.year === p.year && f.month === p.month
    );
    lines.push(
      [
        csvEscape("mensal"),
        csvEscape(p.year),
        csvEscape(p.month),
        csvEscape(p.inflowAmount),
        csvEscape(p.outflowAmount),
        csvEscape(p.netFlowAmount),
        csvEscape(p.accumulatedBalance),
        csvEscape(p.status),
        csvEscape(p.inflowCount),
        csvEscape(p.outflowCount),
        csvEscape(forecast?.projectedNet ?? null),
        csvEscape(cons?.projectedNet ?? null),
        csvEscape(stress?.projectedNet ?? null),
      ].join(",")
    );
  }

  const h12 = payload.cashForecast.horizons.next12Months;
  lines.push(
    [
      csvEscape("necessidade_caixa"),
      csvEscape(""),
      csvEscape(""),
      csvEscape(""),
      csvEscape(""),
      csvEscape(""),
      csvEscape(""),
      csvEscape(""),
      csvEscape(""),
      csvEscape(""),
      csvEscape(payload.cards.cashNeedAmount),
      csvEscape(payload.conservativeScenario.cashNeedConservative),
      csvEscape(payload.stressScenario.cashNeedStress),
    ].join(",")
  );
  lines.push(
    [
      csvEscape("horizonte_12m"),
      csvEscape(""),
      csvEscape(""),
      csvEscape(h12.projectedInflow),
      csvEscape(h12.projectedOutflow),
      csvEscape(h12.projectedNet),
      csvEscape(h12.projectedAccumulated),
      csvEscape(h12.worstMonth?.monthLabel ?? ""),
      csvEscape(h12.negativeMonthsCount),
      csvEscape(h12.maxCashNeed),
      csvEscape(""),
      csvEscape(""),
      csvEscape(""),
    ].join(",")
  );

  return `${lines.join("\n")}\n`;
}

export function financeCashFlowExportFilename(year?: number): string {
  const y = year ?? new Date().getFullYear();
  const stamp = new Date().toISOString().slice(0, 10);
  return `fluxo-caixa-${y}-${stamp}.csv`;
}
