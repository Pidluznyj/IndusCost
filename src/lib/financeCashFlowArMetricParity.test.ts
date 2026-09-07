import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCashFlowAnnualComparison,
  createAnnualComparisonBaseFilters,
  mapExecutiveMonthlyRowToAnnualComparisonMonth,
  sumAnnualComparisonTotalsFromMonths,
} from "./financeCashFlowAnnualComparison.js";
import {
  assertCanonicalArMoneyEqual,
  buildAnnualTotalsParityCheck,
  buildEstimatedYearTotalParityCheck,
  buildPlannedVsAnnualMonthParityChecks,
  buildRadarRangeParityCheck,
  classifyCanonicalArMoneyParity,
  composeCanonicalArEstimatedYearTotal,
  composeCanonicalArPlannedEstimatedInflow,
  FINANCE_CASH_FLOW_AR_METRIC,
  FINANCE_CASH_FLOW_AR_METRIC_FILTER_MATRIX,
  sumCanonicalArOpenBalance,
  sumCanonicalArOpenDueInPeriod,
  sumCanonicalArOpenPortfolioForCustomer,
  sumCanonicalArReceivedByDueInPeriod,
} from "./financeCashFlowArMetrics.js";
import {
  buildFinanceCashFlowDailyRadar,
} from "./financeCashFlowDailyRadar.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import { buildFinanceCashFlowExportCsv } from "./financeCashFlowExport.js";
import { CONSERVATIVE_OPEN_RECEIVABLE_FACTOR } from "./financeCashFlowForecast.js";
import { resolveFinanceArHistoricalMonthlyMovementDate } from "./finance/financeArHistoricalMonthlyAttribution.js";

const REF = new Date(2026, 5, 9);

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personId: null,
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: null,
    comments: null,
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    competenceDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: 1,
    sourceInvoiceNumber: "NF-1",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 5, 8),
    ...overrides,
  };
}

const FILTERS_2026 = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
};

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("financeCashFlowArMetricParity", () => {
  it("A — AR_ESTIMATED_YEAR_TOTAL = receivedYtd + openForwardToYearEnd", () => {
    const rows = [
      arRow({
        externalId: 1,
        sourceInvoiceId: 1,
        amountReceived: 350.15,
        amountReceivable: 350.15,
        balanceReceivable: 0,
        dueDate: new Date(2026, 0, 10),
        settlementDate: new Date(2026, 1, 20),
      }),
      arRow({
        externalId: 2,
        sourceInvoiceId: 2,
        sourceInvoiceNumber: "NF-2",
        personCnpj: "22222222000122",
        balanceReceivable: 480.4,
        amountReceivable: 480.4,
        dueDate: new Date(2026, 8, 1),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(rows, [], FILTERS_2026, REF);
    const { receivedYtd, openFromTodayToYearEnd, estimatedYearTotal } =
      payload.executiveSummary.receivable;
    const check = buildEstimatedYearTotalParityCheck({
      receivedYtd,
      openForwardToYearEnd: openFromTodayToYearEnd,
      estimatedYearTotal,
    });
    assert.equal(check.kind, "MATCH");
    assert.equal(
      estimatedYearTotal,
      composeCanonicalArEstimatedYearTotal(receivedYtd, openFromTodayToYearEnd)
    );
  });

  it("B — gráfico planejado e comparativo anual: mesmos meses no mesmo ano/escopo", () => {
    const rows = [
      arRow({
        externalId: 1,
        amountReceived: 120.11,
        amountReceivable: 120.11,
        balanceReceivable: 0,
        dueDate: new Date(2026, 0, 5),
        settlementDate: new Date(2026, 2, 1),
      }),
      arRow({
        externalId: 2,
        sourceInvoiceId: 2,
        sourceInvoiceNumber: "NF-2",
        personCnpj: "22222222000122",
        balanceReceivable: 330.22,
        amountReceivable: 330.22,
        dueDate: new Date(2026, 6, 12),
      }),
    ];
    const dashboard = buildFinanceCashFlowDashboard(
      rows,
      [],
      createAnnualComparisonBaseFilters(),
      REF
    );
    const annual = buildCashFlowAnnualComparison(rows, [], 2026, REF);
    const checks = buildPlannedVsAnnualMonthParityChecks(
      dashboard.executiveSummary.plannedMonthlyTimeline,
      annual.months
    );
    for (const check of checks) {
      assert.equal(check.kind, "MATCH", check.id);
    }
    for (const planned of dashboard.executiveSummary.plannedMonthlyTimeline) {
      const mapped = mapExecutiveMonthlyRowToAnnualComparisonMonth(planned);
      const month = annual.months.find((m) => m.month === planned.month)!;
      assert.equal(month.receivedAmount, mapped.receivedAmount);
      assert.equal(month.receivableOpenAmount, mapped.receivableOpenAmount);
      assert.equal(month.cashInTotalAmount, mapped.cashInTotalAmount);
    }
  });

  it("C — total anual do comparativo = soma dos 12 meses", () => {
    const rows = [
      arRow({
        externalId: 1,
        amountReceived: 10.01,
        amountReceivable: 10.01,
        balanceReceivable: 0,
        dueDate: new Date(2026, 0, 5),
        settlementDate: new Date(2026, 0, 5),
      }),
      arRow({
        externalId: 2,
        sourceInvoiceId: 2,
        sourceInvoiceNumber: "NF-2",
        personCnpj: "22222222000122",
        balanceReceivable: 20.02,
        amountReceivable: 20.02,
        dueDate: new Date(2026, 10, 5),
      }),
    ];
    const annual = buildCashFlowAnnualComparison(rows, [], 2026, REF);
    const recomputed = sumAnnualComparisonTotalsFromMonths(annual.months, annual.hasReceivableGoal);
    const check = buildAnnualTotalsParityCheck({
      annualCashInTotal: annual.totals.cashInTotalAmount,
      monthsCashInSum: annual.months.reduce((s, m) => s + m.cashInTotalAmount, 0),
    });
    assert.equal(check.kind, "MATCH");
    assert.equal(annual.totals.cashInTotalAmount, recomputed.cashInTotalAmount);
    assert.equal(annual.totals.receivedAmount, recomputed.receivedAmount);
    assert.equal(annual.totals.receivableOpenAmount, recomputed.receivableOpenAmount);
  });

  it("D — Radar: faixa = soma dos dias = soma dos detalhes", () => {
    const rows = [
      arRow({
        externalId: 1,
        balanceReceivable: 100.1,
        amountReceivable: 100.1,
        dueDate: new Date(2026, 5, 9),
      }),
      arRow({
        externalId: 2,
        sourceInvoiceId: 2,
        sourceInvoiceNumber: "NF-2",
        personCnpj: "22222222000122",
        balanceReceivable: 200.2,
        amountReceivable: 200.2,
        dueDate: new Date(2026, 5, 11),
      }),
    ];
    const radar = buildFinanceCashFlowDailyRadar(
      rows,
      [],
      { baseDate: REF, rangeKey: "0-7" },
      REF
    );
    const range = radar.ranges.find((r) => r.key === "0-7")!;
    const daysSum = radar.selectedRange!.days.reduce((s, d) => s + d.receivableTotal, 0);
    const detailsSum = radar.selectedDetail!.receivables.summary.total;
    for (const check of buildRadarRangeParityCheck({
      rangeKey: "0-7",
      rangeTotal: range.receivableTotal,
      daysSum,
      detailsSum,
    })) {
      assert.equal(check.kind, "MATCH", check.id);
    }
  });

  it("E — top cliente = soma canônica dos títulos abertos do cliente", () => {
    const rows = [
      arRow({
        externalId: 1,
        personName: "Cliente Alfa",
        personCnpj: "33333333000133",
        balanceReceivable: 100.15,
        amountReceivable: 100.15,
        dueDate: new Date(2026, 7, 1),
      }),
      arRow({
        externalId: 2,
        sourceInvoiceId: 2,
        sourceInvoiceNumber: "NF-2",
        personName: "Cliente Alfa",
        personCnpj: "33333333000133",
        balanceReceivable: 50.35,
        amountReceivable: 50.35,
        dueDate: new Date(2027, 0, 10),
      }),
      arRow({
        externalId: 3,
        sourceInvoiceId: 3,
        sourceInvoiceNumber: "NF-3",
        personName: "Cliente Beta",
        personCnpj: "44444444000144",
        balanceReceivable: 10,
        amountReceivable: 10,
        dueDate: new Date(2026, 8, 1),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(rows, [], FILTERS_2026, REF);
    const alfa = payload.topCustomers.find((c) => c.personCnpj === "33333333000133");
    assert.ok(alfa);
    const canonical = sumCanonicalArOpenPortfolioForCustomer(rows, {
      personName: "Cliente Alfa",
      personCnpj: "33333333000133",
      externalId: 0,
    });
    assert.equal(alfa!.amount, canonical);
    assert.equal(canonical, 150.5);
  });

  it("F — título aberto usa balanceReceivable, não amountReceivable", () => {
    const rows = [
      arRow({
        amountReceivable: 1000,
        amountReceived: 600,
        balanceReceivable: 400,
        dueDate: new Date(2026, 8, 20),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(rows, [], FILTERS_2026, REF);
    assert.equal(payload.executiveSummary.receivable.openFromTodayToYearEnd, 400);
    assert.equal(payload.cards.totalReceivableOpen, 400);
    const sep = payload.executiveSummary.plannedMonthlyTimeline.find((r) => r.month === 9)!;
    assert.equal(sep.receivableOpenDue, 400);
    assert.notEqual(sep.receivableOpenDue, 1000);
  });

  it("G — planejado aloca recebido por dueDate", () => {
    const rows = [
      arRow({
        amountReceivable: 250,
        amountReceived: 250,
        balanceReceivable: 0,
        dueDate: new Date(2026, 0, 15),
        settlementDate: new Date(2026, 2, 10),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(rows, [], FILTERS_2026, REF);
    const jan = payload.executiveSummary.plannedMonthlyTimeline.find((r) => r.month === 1)!;
    const mar = payload.executiveSummary.plannedMonthlyTimeline.find((r) => r.month === 3)!;
    assert.equal(jan.received, 250);
    assert.equal(mar.received, 0);
    assert.equal(
      sumCanonicalArReceivedByDueInPeriod(rows, new Date(2026, 0, 1), new Date(2026, 0, 31)),
      250
    );
  });

  it("H — YTD oficial usa settlementDate conforme regra vigente", () => {
    const rows = [
      arRow({
        amountReceivable: 250,
        amountReceived: 250,
        balanceReceivable: 0,
        dueDate: new Date(2025, 11, 15),
        settlementDate: new Date(2026, 2, 10),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(rows, [], FILTERS_2026, REF);
    assert.equal(payload.executiveSummary.receivable.receivedYtd, 250);
    assert.equal(payload.executiveYtd.received.currentAmount, 0);
  });

  it("I/L — dueDate janeiro e settlement março: planejado ≠ YTD; diferença semântica", () => {
    const rows = [
      arRow({
        amountReceivable: 250,
        amountReceived: 250,
        balanceReceivable: 0,
        dueDate: new Date(2026, 0, 15),
        settlementDate: new Date(2026, 2, 10),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(rows, [], FILTERS_2026, REF);
    const plannedJan = payload.executiveSummary.plannedMonthlyTimeline.find((r) => r.month === 1)!;
    const movementMar = payload.executiveSummary.monthlyTimeline.find((r) => r.month === 3)!;
    assert.equal(plannedJan.received, 250);
    assert.equal(movementMar.received, 250);
    assert.equal(
      classifyCanonicalArMoneyParity(plannedJan.received, payload.executiveSummary.receivable.receivedYtd),
      "MATCH"
    );
  });

  it("I — overlay fevereiro/2026 afeta somente a timeline mensal de movimento", () => {
    const overlay = arRow({
      externalId: 11,
      sourceInvoiceId: 11,
      sourceInvoiceNumber: "A",
      dueDate: new Date(2025, 11, 6),
      settlementDate: new Date(2026, 1, 5),
      amountReceivable: 100,
      amountReceived: 100,
      balanceReceivable: 0,
    });
    const movement = resolveFinanceArHistoricalMonthlyMovementDate({
      dueDate: overlay.dueDate,
      settlementDate: overlay.settlementDate,
      normalDate: overlay.settlementDate,
    });
    assert.ok(movement instanceof Date);
    assert.equal(movement.getFullYear(), 2025);
    assert.equal(movement.getMonth(), 11);

    const payload = buildFinanceCashFlowDashboard([overlay], [], FILTERS_2026, REF);
    const febMovement = payload.executiveSummary.monthlyTimeline.find((r) => r.month === 2)!;
    const febPlanned = payload.executiveSummary.plannedMonthlyTimeline.find((r) => r.month === 2)!;
    assert.equal(febMovement.received, 0);
    assert.equal(febPlanned.received, 0);
    assert.equal(payload.executiveSummary.receivable.receivedYtd, 100);
  });

  it("J — overlay histórico não entra em planejado, estimativa, radar, forecast, carteira nem comissão", () => {
    const overlay = arRow({
      externalId: 11,
      sourceInvoiceId: 11,
      sourceInvoiceNumber: "A",
      dueDate: new Date(2025, 11, 6),
      settlementDate: new Date(2026, 1, 5),
      amountReceivable: 100,
      amountReceived: 100,
      balanceReceivable: 0,
    });
    const open = arRow({
      externalId: 12,
      sourceInvoiceId: 12,
      sourceInvoiceNumber: "B",
      personCnpj: "55555555000155",
      dueDate: new Date(2026, 8, 1),
      balanceReceivable: 80,
      amountReceivable: 80,
    });
    const payload = buildFinanceCashFlowDashboard([overlay, open], [], FILTERS_2026, REF);
    const plannedSum = payload.executiveSummary.plannedMonthlyTimeline.reduce(
      (s, r) => s + r.received,
      0
    );
    assert.equal(plannedSum, 0);
    assert.equal(payload.executiveSummary.receivable.estimatedYearTotal, 180);
    assert.equal(payload.cards.totalReceivableOpen, 80);
    const radar = buildFinanceCashFlowDailyRadar([overlay, open], [], { baseDate: REF }, REF);
    const radarReceivedLike = radar.ranges.reduce((s, r) => s + r.receivableTotal, 0);
    assert.equal(radarReceivedLike, 80);
    assert.equal(CONSERVATIVE_OPEN_RECEIVABLE_FACTOR, 0.8);

    const banned = /resolveFinanceArHistoricalMonthlyMovementDate/;
    assert.doesNotMatch(read("src/lib/financeCashFlowDailyRadar.ts"), banned);
    assert.doesNotMatch(read("src/lib/financeCashFlowForecast.ts"), banned);
    assert.doesNotMatch(read("src/lib/financeCashFlowDataset.ts"), banned);
    assert.doesNotMatch(read("src/lib/commissions/reconcileArVsCommission.ts"), banned);
    assert.match(read("src/lib/financeCashFlowExecutiveSummary.ts"), banned);
  });

  it("K — título vencido aberto permanece no mês do dueDate e não entra no restante do ano", () => {
    const rows = [
      arRow({
        dueDate: new Date(2026, 4, 1),
        balanceReceivable: 175.55,
        amountReceivable: 175.55,
        amountReceived: 0,
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(rows, [], FILTERS_2026, REF);
    const mayPlanned = payload.executiveSummary.plannedMonthlyTimeline.find((r) => r.month === 5)!;
    assert.equal(mayPlanned.receivableOpenDue, 175.55);
    assert.equal(payload.executiveSummary.receivable.openFromTodayToYearEnd, 0);
  });

  it("M — centavos: superfícies equivalentes permanecem idênticas", () => {
    const rows = [
      arRow({
        externalId: 1,
        balanceReceivable: 10.11,
        amountReceivable: 10.11,
        dueDate: new Date(2026, 7, 2),
      }),
      arRow({
        externalId: 2,
        sourceInvoiceId: 2,
        sourceInvoiceNumber: "NF-2",
        personCnpj: "22222222000122",
        balanceReceivable: 20.22,
        amountReceivable: 20.22,
        dueDate: new Date(2026, 7, 3),
      }),
      arRow({
        externalId: 3,
        sourceInvoiceId: 3,
        sourceInvoiceNumber: "NF-3",
        personCnpj: "66666666000166",
        balanceReceivable: 30.33,
        amountReceivable: 30.33,
        dueDate: new Date(2026, 7, 4),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(
      rows,
      [],
      createAnnualComparisonBaseFilters(),
      REF
    );
    const annual = buildCashFlowAnnualComparison(rows, [], 2026, REF);
    const augPlanned = payload.executiveSummary.plannedMonthlyTimeline.find((r) => r.month === 8)!;
    const augAnnual = annual.months.find((m) => m.month === 8)!;
    assertCanonicalArMoneyEqual(augPlanned.receivableOpenDue, 60.66);
    assertCanonicalArMoneyEqual(augPlanned.estimatedInflow, augAnnual.cashInTotalAmount);
    assertCanonicalArMoneyEqual(
      composeCanonicalArPlannedEstimatedInflow(augPlanned.received, augPlanned.receivableOpenDue),
      augPlanned.estimatedInflow
    );
    assertCanonicalArMoneyEqual(
      sumCanonicalArOpenDueInPeriod(rows, new Date(2026, 7, 1), new Date(2026, 7, 31)),
      60.66
    );
  });

  it("N — mesma métrica + mesmos filtros → mesma população (exec vs export)", () => {
    const rows = [
      arRow({
        amountReceived: 90.09,
        amountReceivable: 90.09,
        balanceReceivable: 0,
        dueDate: new Date(2026, 1, 1),
        settlementDate: new Date(2026, 1, 10),
      }),
      arRow({
        externalId: 2,
        sourceInvoiceId: 2,
        sourceInvoiceNumber: "NF-2",
        personCnpj: "22222222000122",
        balanceReceivable: 40.04,
        amountReceivable: 40.04,
        dueDate: new Date(2026, 9, 1),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(rows, [], FILTERS_2026, REF);
    const csv = buildFinanceCashFlowExportCsv(payload);
    assert.match(
      csv,
      new RegExp(`resumo_recebido_ytd,2026,,${payload.executiveSummary.receivable.receivedYtd}`)
    );
    assert.match(
      csv,
      new RegExp(
        `resumo_estimativa_ar_ano,2026,,${payload.executiveSummary.receivable.estimatedYearTotal}`
      )
    );
    const withNf = buildFinanceCashFlowDashboard(
      rows,
      [],
      { ...FILTERS_2026, invoiceIssued: "yes" },
      REF
    );
    const withoutNf = buildFinanceCashFlowDashboard(
      rows,
      [],
      { ...FILTERS_2026, invoiceIssued: "no" },
      REF
    );
    assert.equal(
      withNf.executiveSummary.receivable.estimatedYearTotal,
      payload.executiveSummary.receivable.estimatedYearTotal
    );
    assert.notEqual(
      withNf.executiveSummary.receivable.estimatedYearTotal,
      withoutNf.executiveSummary.receivable.estimatedYearTotal
    );
  });

  it("matriz de filtros cobre os conceitos canônicos e o calendário parte o mês planejado", () => {
    const ids = FINANCE_CASH_FLOW_AR_METRIC_FILTER_MATRIX.map((row) => row.metric);
    assert.ok(ids.includes(FINANCE_CASH_FLOW_AR_METRIC.ESTIMATED_YEAR_TOTAL));
    assert.ok(ids.includes(FINANCE_CASH_FLOW_AR_METRIC.DAILY_RADAR_OPEN_DUE));
    const radarPolicy = FINANCE_CASH_FLOW_AR_METRIC_FILTER_MATRIX.find(
      (row) => row.metric === FINANCE_CASH_FLOW_AR_METRIC.DAILY_RADAR_OPEN_DUE
    )!;
    assert.ok(radarPolicy.ignores.includes("year"));
    assert.equal(radarPolicy.respects.length, 0);

    const rows = [
      arRow({
        dueDate: new Date(2026, 5, 12),
        balanceReceivable: 77.7,
        amountReceivable: 77.7,
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(
      rows,
      [],
      { ...FILTERS_2026, calendarDisplayMonth: 6 },
      REF
    );
    const jun = payload.executiveSummary.plannedMonthlyTimeline.find((r) => r.month === 6)!;
    assert.equal(payload.calendar.reconciliation.status, "ok");
    assertCanonicalArMoneyEqual(payload.calendar.monthSummary.inflow, jun.estimatedInflow);
  });

  it("frontend do Fluxo de Caixa não recalcula received+open nem soma balanceReceivable", () => {
    const files = [
      "src/components/finance/FinanceCashFlowPage.tsx",
      "src/components/finance/cash-flow/FinanceCashFlowExecutiveSummaryPanel.tsx",
      "src/components/finance/cash-flow/FinanceCashFlowYtdSummary.tsx",
      "src/components/finance/cash-flow/FinanceCashFlowMonthlyPlannedChart.tsx",
      "src/components/finance/cash-flow/FinanceCashFlowMonthlyTimelineTable.tsx",
      "src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChart.tsx",
      "src/components/finance/cash-flow/FinanceCashFlowDailyRadar.tsx",
    ];
    for (const file of files) {
      const src = read(file);
      assert.doesNotMatch(src, /receivedYtd\s*\+\s*/);
      assert.doesNotMatch(src, /openFromTodayToYearEnd\s*\+/);
      assert.doesNotMatch(src, /\.reduce\([^)]*balanceReceivable/);
    }
  });

  it("soma canônica de saldo aberto não usa amountReceivable", () => {
    const total = sumCanonicalArOpenBalance([
      { balanceReceivable: 10.01 },
      { balanceReceivable: 0 },
      { balanceReceivable: 5.5 },
    ]);
    assert.equal(total, 15.51);
  });
});
