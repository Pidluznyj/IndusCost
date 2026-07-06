import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildFinanceCashFlowDashboard } from "./financeCashFlowDashboard.js";
import type { FinanceCashFlowApRow, FinanceCashFlowArRow } from "./financeCashFlowDashboard.js";
import {
  buildExecutiveReportCashFlowAnnualChart,
  buildExecutiveReportCashFlowAnnualFilters,
  buildExecutiveReportCashFlowFilters,
  resolveExecutiveReportCashFlowMonthlyTimeline,
} from "./financeExecutiveReport.js";
import { parseFinanceExecutiveReportQuery } from "./financeExecutiveReport.js";
import {
  buildExecutiveCashFlowAnnualChart,
  EXECUTIVE_REPORT_CASH_FLOW_CHART_SUBTITLE,
  EXECUTIVE_REPORT_MONTH_LABELS_PT,
} from "./financeExecutiveReportPresentation.js";

const REF = new Date(2026, 5, 9);

const baseFilters = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
};

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: null,
    description: null,
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    competenceDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(),
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: null,
    description: null,
    dueDate: new Date(2026, 5, 20),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date(),
    ...overrides,
  };
}

describe("financeExecutiveReportCashFlowChart", () => {
  it("com filtro jun/2026 monta 12 meses Jan–Dez no gráfico anual", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({ dueDate: new Date(2026, 0, 10), amountReceived: 1000, balanceReceivable: 0 }),
        arRow({
          externalId: 3,
          dueDate: new Date(2026, 5, 10),
          amountReceivable: 2000,
          balanceReceivable: 2000,
        }),
      ],
      [apRow({ dueDate: new Date(2026, 5, 20), balancePayable: 800 })],
      { year: 2026, month: 6, ...baseFilters },
      REF
    );

    const chart = buildExecutiveCashFlowAnnualChart(
      payload.executiveSummary.monthlyTimeline,
      2026,
      6
    );

    assert.equal(chart.rows.length, 12);
    assert.deepEqual(
      chart.rows.map((r) => r.monthLabel),
      [...EXECUTIVE_REPORT_MONTH_LABELS_PT]
    );
    assert.equal(chart.rows[5]?.isCurrentMonth, true);
    assert.equal(chart.rows[0]?.isCurrentMonth, false);
  });

  it("timeline esparça (apenas um mês) ainda gera 12 meses no gráfico", () => {
    const chart = buildExecutiveCashFlowAnnualChart(
      [
        {
          year: 2026,
          month: 6,
          monthLabel: "Jun",
          received: 0,
          receivableOpenDue: 5000,
          estimatedInflow: 5000,
          paid: 0,
          payableOpenDue: 1000,
          estimatedOutflow: 1000,
          netFlow: 4000,
          accumulatedNet: 4000,
        },
      ],
      2026,
      6
    );

    assert.equal(chart.rows.length, 12);
    assert.equal(chart.rows[5]?.netFlow, 4000);
    assert.equal(chart.rows[5]?.accumulated, 4000);
    assert.equal(chart.rows[11]?.accumulated, 4000);
  });

  it("cards do período continuam filtrados por mês enquanto gráfico usa ano inteiro", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({ dueDate: new Date(2026, 0, 10), amountReceived: 1000, balanceReceivable: 0 }),
        arRow({
          externalId: 3,
          dueDate: new Date(2026, 5, 10),
          amountReceivable: 2000,
          balanceReceivable: 2000,
        }),
      ],
      [apRow()],
      { year: 2026, month: 6, ...baseFilters },
      REF
    );

    assert.equal(payload.executiveSummary.period.monthFiltered, true);
    const chart = buildExecutiveCashFlowAnnualChart(
      payload.executiveSummary.monthlyTimeline,
      2026,
      6
    );
    assert.equal(chart.rows.length, 12);
    const juneCardScope = payload.cards.inflowAmount;
    const juneChart = chart.rows.find((r) => r.month === 6)?.inflow ?? 0;
    assert.ok(juneChart >= juneCardScope || juneCardScope > 0);
    assert.ok(payload.executiveSummary.monthlyTimeline.length >= 12);
  });

  it("valores do gráfico anual não retornam NaN/Infinity", () => {
    const chart = buildExecutiveCashFlowAnnualChart([], 2026, 6);
    for (const row of chart.rows) {
      for (const value of [row.inflow, row.outflow, row.netFlow, row.accumulated]) {
        assert.ok(Number.isFinite(value));
      }
    }
  });

  it("filtros anuais removem mês mas mantêm ano", () => {
    const filters = parseFinanceExecutiveReportQuery(
      { year: "2026", month: "6", asOfDate: "2026-06-09" },
      new Date(2026, 5, 9)
    );
    const periodFilters = buildExecutiveReportCashFlowFilters(filters);
    const annualFilters = buildExecutiveReportCashFlowAnnualFilters(filters);
    assert.equal(periodFilters.month, 6);
    assert.equal(periodFilters.year, 2026);
    assert.equal(annualFilters.month, undefined);
    assert.equal(annualFilters.year, 2026);
  });

  it("caminho real: payload mensal filtrado vs anual produz gráfico Jan–Dez", () => {
    const julAr = arRow({
      externalId: 10,
      dueDate: new Date(2026, 6, 15),
      amountReceivable: 5000,
      balanceReceivable: 5000,
    });
    const junAr = arRow({
      externalId: 3,
      dueDate: new Date(2026, 5, 10),
      amountReceivable: 2000,
      balanceReceivable: 2000,
    });
    const junAp = apRow({ dueDate: new Date(2026, 5, 20), balancePayable: 800 });

    const periodPayload = buildFinanceCashFlowDashboard(
      [junAr],
      [junAp],
      { year: 2026, month: 6, ...baseFilters },
      REF
    );
    const annualPayload = buildFinanceCashFlowDashboard(
      [julAr, junAr],
      [junAp],
      { year: 2026, ...baseFilters },
      REF
    );

    assert.equal(periodPayload.executiveSummary.period.monthFiltered, true);
    const julInPeriod = periodPayload.executiveSummary.monthlyTimeline.find((r) => r.month === 7);
    assert.equal(julInPeriod?.estimatedInflow ?? 0, 0, "jul deve estar zerado no load mensal");

    const annualChart = buildExecutiveReportCashFlowAnnualChart(annualPayload, 2026, 6);
    assert.equal(annualChart.points.length, 12);
    assert.deepEqual(
      annualChart.points.map((r) => r.monthLabel),
      [...EXECUTIVE_REPORT_MONTH_LABELS_PT]
    );
    const julInChart = annualChart.points.find((r) => r.month === 7);
    assert.ok((julInChart?.inflow ?? 0) > 0, "jul deve aparecer no gráfico anual");
  });

  it("resolveExecutiveReportCashFlowMonthlyTimeline usa carga anual e bate com Fluxo de Caixa", () => {
    const julAr = arRow({
      externalId: 2,
      dueDate: new Date(2026, 6, 10),
      amountReceivable: 3000,
      balanceReceivable: 3000,
    });
    const junAr = arRow({
      externalId: 3,
      dueDate: new Date(2026, 5, 10),
      amountReceivable: 2000,
      balanceReceivable: 2000,
    });
    const junAp = apRow({ dueDate: new Date(2026, 5, 20), balancePayable: 800 });

    const periodPayload = buildFinanceCashFlowDashboard(
      [junAr],
      [junAp],
      { year: 2026, month: 6, ...baseFilters },
      REF
    );
    const annualPayload = buildFinanceCashFlowDashboard(
      [julAr, junAr],
      [junAp],
      { year: 2026, ...baseFilters },
      REF
    );

    const timeline = resolveExecutiveReportCashFlowMonthlyTimeline(annualPayload);
    assert.equal(timeline.length, 12);
    assert.deepEqual(
      timeline.map((row) => row.month),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    );

    const julInTimeline = timeline.find((row) => row.month === 7);
    assert.ok((julInTimeline?.estimatedInflow ?? 0) > 0, "jul não deve ser zerado na timeline anual");

    const julInPeriod = periodPayload.executiveSummary.monthlyTimeline.find((row) => row.month === 7);
    assert.equal(julInPeriod?.estimatedInflow ?? 0, 0, "carga mensal zera meses fora do filtro");

    assert.deepEqual(
      timeline,
      annualPayload.executiveSummary.monthlyTimeline,
      "timeline do relatório = executiveSummary.monthlyTimeline da carga anual"
    );
  });

  it("buildExecutiveReportCashFlowAnnualChart retorna months 1–12 sem NaN", () => {
    const payload = buildFinanceCashFlowDashboard([], [], { year: 2026, ...baseFilters }, REF);
    const chart = buildExecutiveReportCashFlowAnnualChart(payload, 2026, 6);
    assert.equal(chart.year, 2026);
    assert.equal(chart.highlightMonth, 6);
    assert.equal(chart.points.length, 12);
    assert.deepEqual(
      chart.points.map((r) => r.month),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    );
    for (const row of chart.points) {
      for (const value of [row.inflow, row.outflow, row.netFlow, row.accumulated]) {
        assert.ok(Number.isFinite(value));
      }
    }
  });

  it("documento do relatório presidencial usa annualChart.points e gráfico compartilhado", () => {
    const document = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/executive-report/ExecutiveReportDocument.tsx"
      ),
      "utf8"
    );
    const cashFlowChart = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/executive-report/charts/ExecutiveCashFlowChart.tsx"
      ),
      "utf8"
    );
    assert.match(document, /calendarAgenda\.annualChart\.points/);
    assert.match(document, /calendarAgenda\.annualChart\.hasData/);
    assert.doesNotMatch(document, /buildExecutiveCashFlowAnnualChart/);
    assert.match(document, /ExecutiveCashFlowChart/);
    assert.match(cashFlowChart, /FinanceCashFlowPlannedChart/);
    assert.match(cashFlowChart, /showValueLabels/);
    assert.match(cashFlowChart, /mapExecutiveCashFlowRowsToPlannedChart/);
  });

  it("serviço executive-report carrega fluxo duas vezes (período + anual)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeExecutiveReport.ts"), "utf8");
    assert.match(src, /cashFlowAnnualLoad/);
    assert.match(src, /buildExecutiveReportCashFlowAnnualFilters/);
    assert.match(src, /annualChart:\s*cashFlowAnnualChart/);
    assert.match(src, /resolveExecutiveReportCashFlowMonthlyTimeline\(cashFlowAnnualPayload\)/);
  });

  it("componente compartilhado alinha com Fluxo de Caixa (barras, linha, tooltip)", () => {
    const planned = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceCashFlowPlannedChart.tsx"),
      "utf8"
    );
    const monthly = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/cash-flow/FinanceCashFlowMonthlyPlannedChart.tsx"
      ),
      "utf8"
    );
    assert.match(planned, /ComposedChart/);
    assert.match(planned, /netBalance/);
    assert.match(planned, /accumulatedBalance/);
    assert.match(planned, /Saldo acumulado/);
    assert.match(planned, /Saldo líquido mensal/);
    assert.match(monthly, /FinanceCashFlowPlannedChart/);
  });

  it("subtítulo executivo alinha com Fluxo de Caixa", () => {
    assert.match(
      EXECUTIVE_REPORT_CASH_FLOW_CHART_SUBTITLE,
      /Saldo líquido mensal e acumulado calculados por vencimento/i
    );
    assert.match(EXECUTIVE_REPORT_CASH_FLOW_CHART_SUBTITLE, /acumulado/i);
  });
});
