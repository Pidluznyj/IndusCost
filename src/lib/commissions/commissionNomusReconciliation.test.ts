import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNomusReconciliationCsv,
  buildNomusReconciliationFromPayableRows,
  filterMonthlyPayableSummaryBySellerName,
  parseNomusReconciliationCliArgs,
  sellerNameMatches,
} from "./commissionNomusReconciliation.js";
import {
  aggregateMonthlyPayableFromRows,
  buildMonthKey,
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
    commissionPersonId: "p-gislene",
    commissionPersonName: "GISLENE LIMA",
    customerName: "Cliente A",
    orderCode: "PED-1",
    nfeNumber: "12345",
    nomusNfeId: 100,
    confirmedAt: "2026-04-10T12:00:00.000Z",
    documentKey: "p-gislene:100",
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

describe("commissionNomusReconciliation", () => {
  it("parseNomusReconciliationCliArgs aceita parâmetros", () => {
    const args = parseNomusReconciliationCliArgs([
      "--seller=GISLENE LIMA",
      "--year=2026",
      "--month=6",
      "--nomus-base=808107.32",
      "--nomus-commission=20926.56",
      "--json",
    ]);
    assert.equal(args.sellerName, "GISLENE LIMA");
    assert.equal(args.year, 2026);
    assert.equal(args.month, 6);
    assert.equal(args.nomusBase, 808107.32);
    assert.equal(args.nomusCommission, 20926.56);
    assert.equal(args.asJson, true);
    assert.equal(args.asCsv, false);
  });

  it("comparação calcula diferença corretamente", () => {
    const row = buildVisualAuditRow(
      baseInput({
        settlementDate: "2026-06-15T00:00:00.000Z",
        receivedAmount: 500,
        openBalance: 0,
        commissionReleased: 12.5,
      })
    );
    const payableRows = filterRowsByAppraisalMode([row], "PAYABLE", JUNE_PERIOD);
    const result = buildNomusReconciliationFromPayableRows(payableRows, {
      year: 2026,
      month: 6,
      nomusBase: 1000,
      nomusCommission: 20,
    });
    assert.equal(result.indusBase, 500);
    assert.equal(result.indusCommission, 12.5);
    assert.equal(result.baseDiff, -500);
    assert.equal(result.commissionDiff, -7.5);
    assert.equal(result.nomusAverageRatePercent, 2);
  });

  it("filtro por vendedor funciona", () => {
    const gislene = buildVisualAuditRow(
      baseInput({
        settlementDate: "2026-06-10T00:00:00.000Z",
        receivedAmount: 500,
        commissionReleased: 12.5,
      })
    );
    const outro = buildVisualAuditRow(
      baseInput({
        lineId: "r2:s2",
        scheduleId: "s2",
        recordId: "r2",
        commissionPersonId: "p-outro",
        commissionPersonName: "OUTRO VENDEDOR",
        settlementDate: "2026-06-12T00:00:00.000Z",
        receivedAmount: 300,
        commissionReleased: 9,
      })
    );
    const allRows = filterRowsByAppraisalMode([gislene, outro], "PAYABLE", JUNE_PERIOD);
    const summary = aggregateMonthlyPayableFromRows(allRows, { year: 2026, month: 6 });
    const filtered = filterMonthlyPayableSummaryBySellerName(summary, "GISLENE");
    assert.equal(filtered.sellers.length, 1);
    assert.equal(filtered.sellers[0]?.sellerName, "GISLENE LIMA");
    assert.equal(filtered.payableCommissionTotal, 12.5);

    const result = buildNomusReconciliationFromPayableRows([gislene, outro], {
      year: 2026,
      month: 6,
      sellerName: "GISLENE",
    });
    assert.equal(result.indusCommission, 12.5);
    assert.equal(result.matchedSellerNames[0], "GISLENE LIMA");
  });

  it("settlementDate é usado — título não baixado em junho não entra", () => {
    const openRow = buildVisualAuditRow(
      baseInput({
        dueDate: "2026-06-20T00:00:00.000Z",
        settlementDate: null,
        receivedAmount: 0,
        commissionReleased: 0,
      })
    );
    const settledRow = buildVisualAuditRow(
      baseInput({
        lineId: "r1:s2",
        scheduleId: "s2",
        settlementDate: "2026-06-05T00:00:00.000Z",
        receivedAmount: 400,
        commissionReleased: 10,
      })
    );
    const result = buildNomusReconciliationFromPayableRows([openRow, settledRow], {
      year: 2026,
      month: 6,
    });
    assert.equal(result.indusCommission, 10);
    assert.equal(result.uniqueReceivablesCount, 1);
  });

  it("sellerNameMatches é case-insensitive", () => {
    assert.equal(sellerNameMatches("Gislene Lima", "GISLENE"), true);
    assert.equal(sellerNameMatches("Outro", "GISLENE"), false);
  });

  it("export CSV inclui cabeçalho e diferença", () => {
    const row = buildVisualAuditRow(
      baseInput({
        settlementDate: "2026-06-15T00:00:00.000Z",
        receivedAmount: 500,
        commissionReleased: 12.5,
      })
    );
    const result = buildNomusReconciliationFromPayableRows(
      filterRowsByAppraisalMode([row], "PAYABLE", JUNE_PERIOD),
      {
        year: 2026,
        month: 6,
        nomusBase: 808107.32,
        nomusCommission: 20926.56,
        sellerName: "GISLENE",
      }
    );
    const csv = buildNomusReconciliationCsv(result);
    assert.match(csv, /# indus_comissao=12\.50/);
    assert.match(csv, /# nomus_comissao=20926\.56/);
    assert.match(csv, /percentual_nomus_inferido/);
    assert.match(csv, /GISLENE LIMA/);
  });

  it("buildMonthKey para junho/2026", () => {
    assert.equal(buildMonthKey(2026, 6), "2026-06");
  });
});
