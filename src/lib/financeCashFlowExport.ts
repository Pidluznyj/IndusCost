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

  const rec = payload.reconciliation;
  const exec = payload.executiveSummary;
  const summaryRows: Array<[string, number]> = [
    ["resumo_recebido_ytd", exec.receivable.receivedYtd],
    ["resumo_a_receber_ate_fim_ano", exec.receivable.openFromTodayToYearEnd],
    ["resumo_estimativa_ar_ano", exec.receivable.estimatedYearTotal],
    ["resumo_pago_ytd", exec.payable.paidYtd],
    ["resumo_a_pagar_ate_fim_ano", exec.payable.openFromTodayToYearEnd],
    ["resumo_estimativa_ap_ano", exec.payable.estimatedYearTotal],
    ["resumo_saldo_realizado_ytd", exec.net.realizedYtd],
    ["resumo_saldo_projetado_restante", exec.net.projectedRemaining],
    ["resumo_estimativa_liquida_anual", exec.net.estimatedYearNet],
  ];
  for (const [tipo, valor] of summaryRows) {
    lines.push(
      [
        csvEscape(tipo),
        csvEscape(exec.metadata.year),
        csvEscape(""),
        csvEscape(valor),
        csvEscape(""),
        csvEscape(""),
        csvEscape(""),
        csvEscape(""),
        csvEscape(""),
        csvEscape(""),
        csvEscape(""),
        csvEscape(""),
        csvEscape(""),
      ].join(",")
    );
  }

  lines.push(
    [
      csvEscape("conferencia_entradas"),
      csvEscape(rec.periodLabel),
      csvEscape(""),
      csvEscape(rec.receivable.cashFlowInflow),
      csvEscape(rec.receivable.ledgerInflow),
      csvEscape(rec.receivable.arDashboardOpen),
      csvEscape(rec.receivable.deltaVsLedger),
      csvEscape(rec.receivable.matchesLedger ? "ok" : "divergencia"),
      csvEscape(""),
      csvEscape(""),
      csvEscape(""),
      csvEscape(""),
      csvEscape(""),
    ].join(",")
  );
  lines.push(
    [
      csvEscape("conferencia_saidas"),
      csvEscape(rec.periodLabel),
      csvEscape(""),
      csvEscape(rec.payable.cashFlowOutflow),
      csvEscape(rec.payable.ledgerOutflow),
      csvEscape(rec.payable.apDashboardOpen),
      csvEscape(rec.payable.deltaVsLedger),
      csvEscape(rec.payable.matchesLedger ? "ok" : "divergencia"),
      csvEscape(""),
      csvEscape(""),
      csvEscape(""),
      csvEscape(""),
      csvEscape(""),
    ].join(",")
  );
  lines.push(
    [
      csvEscape("conferencia_saldo"),
      csvEscape(rec.periodLabel),
      csvEscape(""),
      csvEscape(""),
      csvEscape(""),
      csvEscape(rec.netCashFlow),
      csvEscape(""),
      csvEscape(rec.netMatchesLedger ? "ok" : "divergencia"),
      csvEscape(""),
      csvEscape(""),
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
