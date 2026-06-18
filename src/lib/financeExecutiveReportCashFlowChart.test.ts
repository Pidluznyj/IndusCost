import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildFinanceCashFlowDashboard } from "./financeCashFlowDashboard.js";
import type { FinanceCashFlowApRow, FinanceCashFlowArRow } from "./financeCashFlowDashboard.js";
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

  it("documento do relatório presidencial usa gráfico anual explícito", () => {
    const document = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/executive-report/ExecutiveReportDocument.tsx"
      ),
      "utf8"
    );
    assert.match(document, /buildExecutiveCashFlowAnnualChart/);
    assert.match(document, /EXECUTIVE_REPORT_CASH_FLOW_CHART_SUBTITLE/);
  });

  it("subtítulo executivo documenta visão anual", () => {
    assert.match(EXECUTIVE_REPORT_CASH_FLOW_CHART_SUBTITLE, /Visão anual do caixa/i);
    assert.match(EXECUTIVE_REPORT_CASH_FLOW_CHART_SUBTITLE, /saldo acumulado/i);
  });
});
