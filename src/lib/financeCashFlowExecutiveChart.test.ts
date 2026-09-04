import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildExecutiveMonthlyPlannedChartRows,
  executiveMonthlyTimelineHasChartData,
} from "./financeCashFlowExecutiveChart.js";
import type { FinanceCashFlowExecutiveMonthlyRow } from "./financeCashFlowExecutiveSummary.js";
import { buildExecutiveMonthlyTimeline } from "./financeCashFlowExecutiveSummary.js";
import type { FinanceCashFlowApRow, FinanceCashFlowArRow } from "./financeCashFlowDashboard.js";

const REF = new Date(2026, 5, 9);

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

function monthlyRow(
  overrides: Partial<FinanceCashFlowExecutiveMonthlyRow> = {}
): FinanceCashFlowExecutiveMonthlyRow {
  return {
    year: 2026,
    month: 1,
    monthLabel: "Jan",
    received: 0,
    receivableOpenDue: 0,
    estimatedInflow: 0,
    paid: 0,
    payableOpenDue: 0,
    estimatedOutflow: 0,
    netFlow: 0,
    accumulatedNet: 0,
    ...overrides,
  };
}

describe("financeCashFlowExecutiveChart", () => {
  it("mapeia timeline executiva sem recalcular valores", () => {
    const rows = [
      monthlyRow({
        month: 1,
        monthLabel: "Jan",
        received: 100,
        receivableOpenDue: 50,
        estimatedInflow: 150,
        paid: 40,
        payableOpenDue: 10,
        estimatedOutflow: 50,
        netFlow: 100,
        accumulatedNet: 100,
      }),
      monthlyRow({
        month: 2,
        monthLabel: "Fev",
        received: 20,
        receivableOpenDue: 0,
        estimatedInflow: 20,
        paid: 80,
        payableOpenDue: 0,
        estimatedOutflow: 80,
        netFlow: -60,
        accumulatedNet: 40,
      }),
    ];

    const chartRows = buildExecutiveMonthlyPlannedChartRows(rows);
    assert.equal(chartRows.length, 2);
    assert.equal(chartRows[0]!.netBalance, 100);
    assert.equal(chartRows[0]!.accumulatedBalance, 100);
    assert.equal(chartRows[1]!.netBalance, -60);
    assert.equal(chartRows[1]!.accumulatedBalance, 40);
    assert.equal(chartRows[0]!.receivableOpen, 50);
    assert.equal(chartRows[0]!.payableOpen, 10);
  });

  it("detecta estado vazio quando todos os valores são zero", () => {
    assert.equal(executiveMonthlyTimelineHasChartData([monthlyRow()]), false);
    assert.equal(
      executiveMonthlyTimelineHasChartData([monthlyRow({ netFlow: -1 })]),
      true
    );
  });

  it("acumulado da timeline segue soma mês a mês por vencimento", () => {
    const timeline = buildExecutiveMonthlyTimeline(
      [
        arRow({
          amountReceived: 200,
          dueDate: new Date(2026, 0, 10),
          balanceReceivable: 0,
        }),
        arRow({
          externalId: 2,
          amountReceived: 100,
          dueDate: new Date(2026, 1, 10),
          balanceReceivable: 0,
        }),
      ],
      [
        apRow({
          amountPaid: 50,
          dueDate: new Date(2026, 0, 15),
          paymentDate: new Date(2026, 0, 15),
          balancePayable: 0,
        }),
        apRow({
          externalId: 2,
          amountPaid: 30,
          dueDate: new Date(2026, 1, 15),
          paymentDate: new Date(2026, 1, 15),
          balancePayable: 0,
        }),
      ],
      2026,
      REF
    );

    assert.equal(timeline.length, 12);

    const jan = timeline.find((r) => r.month === 1);
    const fev = timeline.find((r) => r.month === 2);
    assert.equal(jan?.netFlow, 150);
    assert.equal(fev?.netFlow, 70);
    assert.equal(fev?.accumulatedNet, 220);

    const chart = buildExecutiveMonthlyPlannedChartRows(timeline);
    assert.equal(chart.length, 12);
    assert.equal(chart[0]!.name, "Jan");
    assert.equal(chart[11]!.name, "Dez");
    assert.equal(chart[1]!.accumulatedBalance, chart[0]!.netBalance + chart[1]!.netBalance);
  });

  it("não produz NaN/Infinity no mapeamento", () => {
    const chart = buildExecutiveMonthlyPlannedChartRows([
      monthlyRow({
        received: 0,
        receivableOpenDue: 0,
        paid: 0,
        payableOpenDue: 0,
        netFlow: 0,
        accumulatedNet: 0,
      }),
    ]);
    for (const row of chart) {
      for (const value of Object.values(row)) {
        if (typeof value === "number") {
          assert.ok(Number.isFinite(value));
        }
      }
    }
  });
});

describe("FinanceCashFlowMonthlyPlannedChart UI", () => {
  it("gráfico planejado fica acima da tabela mensal na página", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowPage.tsx"),
      "utf8"
    );
    const chartIdx = page.indexOf("FinanceCashFlowMonthlyPlannedChart");
    const tableIdx = page.indexOf("FinanceCashFlowMonthlyTimelineTable");
    assert.ok(chartIdx >= 0);
    assert.ok(tableIdx >= 0);
    assert.ok(chartIdx < tableIdx);
    assert.match(page, /executiveSummary\.plannedMonthlyTimeline/);
    assert.match(page, /executiveSummary\.monthlyTimeline/);
  });

  it("componente delega ao gráfico compartilhado com saldo líquido e acumulado", () => {
    const chart = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "cash-flow",
        "FinanceCashFlowMonthlyPlannedChart.tsx"
      ),
      "utf8"
    );
    const planned = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowPlannedChart.tsx"),
      "utf8"
    );
    assert.match(chart, /FinanceCashFlowPlannedChart/);
    assert.match(chart, /buildExecutiveMonthlyPlannedChartRows/);
    assert.match(planned, /ComposedChart/);
    assert.match(planned, /dataKey="netBalance"/);
    assert.match(planned, /dataKey="accumulatedBalance"/);
    assert.match(planned, /Recebido:/);
    assert.match(planned, /A receber:/);
    assert.match(planned, /Entradas est\./);
    assert.match(planned, /Pago:/);
    assert.match(planned, /A pagar:/);
    assert.match(planned, /Saídas est\./);
    assert.match(planned, /Saldo líquido:/);
    assert.match(planned, /Saldo acumulado:/);
    assert.match(planned, /FINANCE_BI_COLORS\.success/);
    assert.match(planned, /FINANCE_BI_COLORS\.risk/);
    assert.match(chart, /Sem dados para montar o fluxo planejado do período filtrado/);
  });
});
