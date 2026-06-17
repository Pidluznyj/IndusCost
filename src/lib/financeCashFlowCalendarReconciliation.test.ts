import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCalendarReconciliation,
  buildFinanceCashFlowCalendar,
  resolveCalendarDisplayMonth,
  sumCalendarDays,
} from "./financeCashFlowCalendar.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";

const REF = new Date(2026, 5, 17);

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: "Recebível",
    dueDate: new Date(2026, 5, 10),
    settlementDate: null,
    competenceDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: "Conta 1",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 5, 16),
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: "22222222000122",
    description: "Pagável",
    dueDate: new Date(2026, 5, 10),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: "PIX",
    bankAccountName: "Conta 2",
    sourceInvoiceId: null,
    documentNumber: "DOC-1",
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 5, 16),
    ...overrides,
  };
}

describe("financeCashFlowCalendarReconciliation", () => {
  it("Mês = Todos abre mês atual do ano filtrado por padrão", () => {
    const month = resolveCalendarDisplayMonth(
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    assert.equal(month, 6);
  });

  it("Mês = Todos respeita calendarDisplayMonth no payload", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 5000, dueDate: new Date(2026, 4, 12) })],
      [],
      {
        viewMode: "projected",
        dateBase: "due",
        status: "all",
        year: 2026,
        calendarDisplayMonth: 5,
      },
      REF
    );
    assert.equal(payload.calendar.isAnnualFilter, true);
    assert.equal(payload.calendar.filterMonth, null);
    assert.equal(payload.calendar.displayMonth, 5);
    assert.equal(payload.calendar.monthSummary.inflow, 5000);
  });

  it("calendário com CR de milhões soma corretamente no dia", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [
        arRow({ externalId: 1, balanceReceivable: 1_200_000, dueDate: new Date(2026, 5, 10) }),
        arRow({ externalId: 2, balanceReceivable: 850_000, dueDate: new Date(2026, 5, 10) }),
      ],
      [apRow({ externalId: 3, balancePayable: 900_000, dueDate: new Date(2026, 5, 10) })],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026, month: 6 },
      REF
    );
    const day = calendar.days.find((d) => d.date.endsWith("-10"))!;
    assert.equal(day.inflow, 2_050_000);
    assert.equal(day.outflow, 900_000);
    assert.equal(day.net, 1_150_000);
    assert.equal(day.movements.length, 3);
  });

  it("soma dos dias do mês bate com linha do tempo e conciliação OK", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({ externalId: 1, balanceReceivable: 1_200_000, dueDate: new Date(2026, 5, 10) }),
        arRow({ externalId: 2, balanceReceivable: 850_000, dueDate: new Date(2026, 5, 10) }),
      ],
      [apRow({ externalId: 3, balancePayable: 900_000, dueDate: new Date(2026, 5, 10) })],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026, month: 6 },
      REF
    );
    const monthInflow = payload.calendar.days.reduce((s, d) => s + d.inflow, 0);
    assert.equal(monthInflow, payload.calendar.monthSummary.inflow);
    assert.equal(payload.calendar.reconciliation.status, "ok");
    assert.equal(payload.calendar.reconciliation.calendarInflow, monthInflow);
    assert.equal(
      payload.calendar.reconciliation.timelineInflow,
      payload.monthlySeries.find((p) => p.month === 6)!.inflowAmount
    );
  });

  it("monthNav cobre 12 meses sem top N", () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      arRow({
        externalId: 100 + i,
        balanceReceivable: 100_000,
        dueDate: new Date(2026, i % 12, 5),
      })
    );
    const calendar = buildFinanceCashFlowCalendar(
      rows,
      [],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF
    );
    assert.equal(calendar.monthNav.length, 12);
    assert.equal(calendar.yearMovementCount, 40);
    const navTotal = calendar.monthNav.reduce((s, m) => s + m.movementCount, 0);
    assert.equal(navTotal, 40);
  });

  it("buildCalendarReconciliation detecta divergência", () => {
    const rec = buildCalendarReconciliation(
      2026,
      6,
      { inflow: 100, outflow: 50, net: 50, receivableCount: 1, payableCount: 1, movementCount: 2 },
      [{ year: 2026, month: 6, monthLabel: "Jun", inflowAmount: 90, outflowAmount: 50, netFlowAmount: 40, accumulatedBalance: 40, status: "positive", inflowCount: 1, outflowCount: 1 }]
    );
    assert.equal(rec.status, "mismatch");
    assert.equal(rec.inflowDiff, 10);
  });

  it("sumCalendarDays bate com soma manual dos dias", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [arRow({ balanceReceivable: 3000, dueDate: new Date(2026, 5, 3) })],
      [apRow({ balancePayable: 700, dueDate: new Date(2026, 5, 18) })],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026, month: 6 },
      REF
    );
    assert.deepEqual(sumCalendarDays(calendar.days), calendar.monthSummary);
  });
});
