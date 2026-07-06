import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateReceivableForecastFromRows,
  buildReceivableForecastDetailCsv,
  buildReceivableForecastMonthlyCsv,
  classifyForecastBucket,
} from "./commissionReceivableForecast.js";
import {
  buildVisualAuditRow,
  filterRowsByAppraisalMode,
  type VisualAuditRowInput,
} from "./commissionVisualAudit.js";

const REF = new Date("2026-06-15T12:00:00.000Z");

function baseInput(overrides: Partial<VisualAuditRowInput> = {}): VisualAuditRowInput {
  return {
    lineId: "r1:s1",
    recordId: "r1",
    scheduleId: "s1",
    commissionPersonId: "p1",
    commissionPersonName: "Vendedor A",
    customerName: "Cliente",
    orderCode: "PED-1",
    nfeNumber: "100",
    nomusNfeId: 100,
    confirmedAt: "2026-04-01T00:00:00.000Z",
    documentKey: "p1:100",
    documentBaseAmount: 1000,
    documentCommissionTotal: 25,
    itemBaseAmount: 1000,
    itemCommissionAmount: 25,
    itemRatePercent: 2.5,
    productCode: "P1",
    nomusReceivableId: 999,
    installmentNumber: 1,
    dueDate: "2026-08-10T00:00:00.000Z",
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
    isCommissionable: true,
    exclusionReason: null,
    exclusionRuleId: null,
    ...overrides,
  };
}

describe("commissionReceivableForecast", () => {
  it("título aberto futuro entra no mês de dueDate", () => {
    const row = buildVisualAuditRow(baseInput({ dueDate: "2026-08-10T00:00:00.000Z" }));
    const summary = aggregateReceivableForecastFromRows([row], {}, REF);
    const aug = summary.monthly.find((m) => m.dueMonthKey === "2026-08");
    assert.ok(aug);
    assert.equal(aug.forecastCommissionAmount, 12.5);
    assert.equal(classifyForecastBucket(row, REF), "future");
  });

  it("título aberto vencido entra em vencido", () => {
    const row = buildVisualAuditRow(
      baseInput({ dueDate: "2026-05-01T00:00:00.000Z", openBalance: 500 })
    );
    assert.equal(row.receivableTitleStatus, "VENCIDO");
    const summary = aggregateReceivableForecastFromRows([row], {}, REF);
    assert.equal(summary.cards.overdueCommissionTotal, 12.5);
    assert.ok(summary.overdue.length > 0);
  });

  it("título baixado não aparece na previsão", () => {
    const settled = buildVisualAuditRow(
      baseInput({
        settlementDate: "2026-06-01T00:00:00.000Z",
        receivedAmount: 500,
        openBalance: 0,
        commissionReleased: 12.5,
        commissionExpected: 12.5,
      })
    );
    const filtered = filterRowsByAppraisalMode([settled], "FORECAST", null);
    assert.equal(filtered.length, 0);
    const summary = aggregateReceivableForecastFromRows([settled], {}, REF);
    assert.equal(summary.details.length, 0);
  });

  it("comissão prevista não duplica schedule", () => {
    const row1 = buildVisualAuditRow(baseInput({ scheduleId: "s1", lineId: "r1:s1" }));
    const row2 = buildVisualAuditRow(
      baseInput({
        lineId: "r2:s2",
        recordId: "r2",
        scheduleId: "s2",
        commissionExpected: 10,
        allocationPercent: 40,
      })
    );
    const summary = aggregateReceivableForecastFromRows([row1, row2], {}, REF);
    assert.equal(summary.cards.futureCommissionTotal, 22.5);
  });

  it("CR único não duplica valor de título", () => {
    const row1 = buildVisualAuditRow(baseInput());
    const row2 = buildVisualAuditRow(
      baseInput({
        lineId: "r2:s3",
        recordId: "r2",
        scheduleId: "s3",
        commissionExpected: 10,
      })
    );
    const summary = aggregateReceivableForecastFromRows([row1, row2], {}, REF);
    const month = summary.monthly.find((m) => m.dueMonthKey === "2026-08");
    assert.equal(month?.openTitlesAmount, 500);
  });

  it("filtro vendedor funciona", () => {
    const rowP1 = buildVisualAuditRow(baseInput());
    const rowP2 = buildVisualAuditRow(
      baseInput({
        lineId: "r2:s2",
        recordId: "r2",
        scheduleId: "s2",
        commissionPersonId: "p2",
        commissionPersonName: "Outro",
        nomusReceivableId: 888,
      })
    );
    const summary = aggregateReceivableForecastFromRows([rowP1, rowP2], {
      commissionPersonId: "p1",
    }, REF);
    assert.equal(summary.details.length, 1);
    assert.equal(summary.cards.futureCommissionTotal, 12.5);
  });

  it("export mensal bate com cards", () => {
    const row = buildVisualAuditRow(baseInput());
    const summary = aggregateReceivableForecastFromRows([row], {}, REF);
    const csv = buildReceivableForecastMonthlyCsv(summary);
    assert.match(csv, /# comissao_prevista_futura=/);
    assert.match(csv, /# comissao_vencida_pendente=0\.00/);
    assert.match(csv, new RegExp(summary.cards.futureCommissionTotal.toFixed(2)));
  });

  it("export detalhe bate com cards", () => {
    const row = buildVisualAuditRow(baseInput());
    const summary = aggregateReceivableForecastFromRows([row], {}, REF);
    const csv = buildReceivableForecastDetailCsv(summary);
    assert.match(csv, /# comissao_prevista_futura=/);
    assert.match(csv, /999/);
    assert.match(csv, /12\.50/);
  });
});
