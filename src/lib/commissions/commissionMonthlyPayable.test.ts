import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateMonthlyPayableFromRows,
  buildMonthKey,
  formatMonthLabelPt,
} from "./commissionMonthlyPayable.js";
import {
  buildVisualAuditRow,
  filterRowsByAppraisalMode,
  type VisualAuditRowInput,
} from "./commissionVisualAudit.js";

function baseInput(overrides: Partial<VisualAuditRowInput> = {}): VisualAuditRowInput {
  return {
    lineId: "r1:s1",
    recordId: "r1",
    scheduleId: "s1",
    commissionPersonId: "p1",
    commissionPersonName: "GISLENE LIMA",
    customerName: "Cliente A",
    orderCode: "PED-1",
    nfeNumber: "12345",
    nomusNfeId: 100,
    confirmedAt: "2026-04-10T12:00:00.000Z",
    documentKey: "p1:100",
    documentBaseAmount: 1000,
    documentCommissionTotal: 25,
    itemBaseAmount: 1000,
    itemCommissionAmount: 25,
    itemRatePercent: 2.5,
    productCode: "PROD-1",
    nomusReceivableId: 98765,
    installmentNumber: 1,
    dueDate: "2026-06-01T00:00:00.000Z",
    settlementDate: null,
    receivableAmount: 500,
    receivedAmount: 0,
    openBalance: 500,
    allocationPercent: 50,
    commissionExpected: 12.5,
    commissionReleased: 0,
    hasArLink: true,
    hasSchedule: true,
    customerNoCommission: false,
    ...overrides,
  };
}

const JUNE_PERIOD = {
  from: new Date("2026-06-01T00:00:00.000Z"),
  to: new Date("2026-06-30T23:59:59.999Z"),
};

function payableRows(rows: ReturnType<typeof buildVisualAuditRow>[]) {
  return filterRowsByAppraisalMode(rows, "PAYABLE", JUNE_PERIOD);
}

describe("commissionMonthlyPayable", () => {
  it("título baixado em junho entra em junho", () => {
    const row = buildVisualAuditRow(
      baseInput({
        settlementDate: "2026-06-15T00:00:00.000Z",
        receivedAmount: 500,
        openBalance: 0,
        commissionReleased: 12.5,
      })
    );
    const filtered = payableRows([row]);
    const summary = aggregateMonthlyPayableFromRows(filtered, { year: 2026, month: 6 });
    assert.equal(summary.payableCommissionTotal, 12.5);
    assert.equal(summary.uniqueReceivablesCount, 1);
  });

  it("título vencido em junho mas não baixado não entra em junho", () => {
    const row = buildVisualAuditRow(
      baseInput({
        dueDate: "2026-06-20T00:00:00.000Z",
        settlementDate: null,
        receivedAmount: 0,
      })
    );
    const filtered = payableRows([row]);
    const summary = aggregateMonthlyPayableFromRows(filtered, { year: 2026, month: 6 });
    assert.equal(summary.payableCommissionTotal, 0);
    assert.equal(filtered.length, 0);
  });

  it("NF emitida em outro mês mas baixada em junho entra em junho", () => {
    const row = buildVisualAuditRow(
      baseInput({
        confirmedAt: "2026-04-05T00:00:00.000Z",
        settlementDate: "2026-06-10T00:00:00.000Z",
        receivedAmount: 500,
        openBalance: 0,
        commissionReleased: 12.5,
      })
    );
    const filtered = payableRows([row]);
    const summary = aggregateMonthlyPayableFromRows(filtered, { year: 2026, month: 6 });
    assert.equal(summary.payableCommissionTotal, 12.5);
    assert.equal(filtered.length, 1);
  });

  it("título com múltiplos itens não duplica valor recebido do CR", () => {
    const row1 = buildVisualAuditRow(
      baseInput({
        lineId: "r1:s1",
        recordId: "r1",
        scheduleId: "s1",
        settlementDate: "2026-06-10T00:00:00.000Z",
        receivedAmount: 500,
        openBalance: 0,
        commissionReleased: 12.5,
      })
    );
    const row2 = buildVisualAuditRow(
      baseInput({
        lineId: "r2:s3",
        recordId: "r2",
        scheduleId: "s3",
        itemBaseAmount: 800,
        itemCommissionAmount: 20,
        commissionExpected: 10,
        allocationPercent: 50,
        settlementDate: "2026-06-10T00:00:00.000Z",
        receivedAmount: 500,
        openBalance: 0,
        commissionReleased: 10,
      })
    );
    const filtered = payableRows([row1, row2]);
    const summary = aggregateMonthlyPayableFromRows(filtered, { year: 2026, month: 6 });
    assert.equal(summary.receivedAmountTotal, 500);
    assert.equal(summary.payableCommissionTotal, 22.5);
    assert.equal(summary.uniqueReceivablesCount, 1);
  });

  it("NF com múltiplas parcelas não duplica NF no resumo", () => {
    const row1 = buildVisualAuditRow(
      baseInput({
        scheduleId: "s1",
        lineId: "r1:s1",
        settlementDate: "2026-06-05T00:00:00.000Z",
        receivedAmount: 500,
        openBalance: 0,
        commissionReleased: 12.5,
      })
    );
    const row2 = buildVisualAuditRow(
      baseInput({
        scheduleId: "s2",
        lineId: "r1:s2",
        nomusReceivableId: 98766,
        installmentNumber: 2,
        settlementDate: "2026-06-20T00:00:00.000Z",
        receivedAmount: 500,
        openBalance: 0,
        commissionReleased: 12.5,
      })
    );
    const filtered = payableRows([row1, row2]);
    const summary = aggregateMonthlyPayableFromRows(filtered, { year: 2026, month: 6 });
    assert.equal(summary.sellers[0]!.uniqueNfeCount, 1);
    assert.equal(summary.uniqueReceivablesCount, 2);
    assert.equal(summary.payableCommissionTotal, 25);
  });

  it("base rateada soma corretamente por schedule", () => {
    const row1 = buildVisualAuditRow(
      baseInput({
        allocationPercent: 60,
        commissionExpected: 15,
        settlementDate: "2026-06-10T00:00:00.000Z",
        receivedAmount: 600,
        commissionReleased: 15,
      })
    );
    const row2 = buildVisualAuditRow(
      baseInput({
        lineId: "r1:s2",
        scheduleId: "s2",
        nomusReceivableId: 888,
        installmentNumber: 2,
        allocationPercent: 40,
        commissionExpected: 10,
        settlementDate: "2026-06-12T00:00:00.000Z",
        receivedAmount: 400,
        commissionReleased: 10,
      })
    );
    const filtered = payableRows([row1, row2]);
    const summary = aggregateMonthlyPayableFromRows(filtered, { year: 2026, month: 6 });
    assert.equal(summary.allocatedBaseAmountTotal, 1000);
    assert.equal(summary.payableCommissionTotal, 25);
  });

  it("filtro por vendedor funciona", () => {
    const rowP1 = buildVisualAuditRow(
      baseInput({
        settlementDate: "2026-06-10T00:00:00.000Z",
        receivedAmount: 500,
        commissionReleased: 12.5,
      })
    );
    const rowP2 = buildVisualAuditRow(
      baseInput({
        lineId: "r2:s2",
        recordId: "r2",
        scheduleId: "s2",
        commissionPersonId: "p2",
        commissionPersonName: "OUTRO VENDEDOR",
        documentKey: "p2:200",
        nomusReceivableId: 111,
        settlementDate: "2026-06-11T00:00:00.000Z",
        receivedAmount: 300,
        commissionReleased: 8,
      })
    );
    const filtered = payableRows([rowP1, rowP2]);
    const summary = aggregateMonthlyPayableFromRows(filtered, {
      year: 2026,
      month: 6,
      sellerId: "p1",
    });
    assert.equal(summary.uniqueSellersCount, 1);
    assert.equal(summary.payableCommissionTotal, 12.5);
    assert.equal(summary.sellers[0]!.sellerId, "p1");
  });

  it("buildMonthKey e formatMonthLabelPt", () => {
    assert.equal(buildMonthKey(2026, 6), "2026-06");
    assert.equal(formatMonthLabelPt(2026, 6), "Junho/2026");
  });
});
