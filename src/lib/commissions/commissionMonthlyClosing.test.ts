import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateMonthlyPayableFromRows,
  buildMonthlyClosingCards,
  buildMonthlyPayableDetailCsv,
  buildMonthlyPayableSellerSummaryCsv,
} from "./commissionMonthlyPayable.js";
import { buildVisualAuditNomusReference, buildVisualAuditRow, computeVisualAuditCards } from "./commissionVisualAudit.js";
import { parseCommissionMonthlyClosingQuery } from "./commissionQuery.js";
import {
  buildMonthlyClosingExportQueryString,
  buildMonthlyClosingQueryString,
} from "../../components/commissions/monthlyClosing/commissionsMonthlyClosingFilters.ts";

function settledRow(overrides: Record<string, unknown> = {}) {
  return buildVisualAuditRow({
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
    dueDate: "2026-06-01T00:00:00.000Z",
    settlementDate: "2026-06-15T00:00:00.000Z",
    receivableAmount: 500,
    receivedAmount: 500,
    openBalance: 0,
    allocationPercent: 50,
    commissionExpected: 12.5,
    commissionReleased: 12.5,
    hasArLink: true,
    hasSchedule: true,
    customerNoCommission: false,
    isCommissionable: true,
    exclusionReason: null,
    exclusionRuleId: null,
    ...overrides,
  });
}

describe("commissionMonthlyClosing", () => {
  it("cards usam comissão liberada por settlementDate", () => {
    const rows = [settledRow()];
    const summary = aggregateMonthlyPayableFromRows(rows, { year: 2026, month: 6 });
    const cards = buildMonthlyClosingCards(summary, 0);
    assert.equal(cards.payableCommissionTotal, 12.5);
    assert.equal(cards.uniqueReceivablesCount, 1);
    assert.equal(cards.receivedAmountTotal, 500);
  });

  it("NF antiga recebida no mês entra no fechamento", () => {
    const row = settledRow({
      confirmedAt: "2026-03-01T00:00:00.000Z",
      settlementDate: "2026-06-10T00:00:00.000Z",
    });
    const summary = aggregateMonthlyPayableFromRows([row], { year: 2026, month: 6 });
    assert.equal(summary.payableCommissionTotal, 12.5);
    assert.equal(summary.details.length, 1);
  });

  it("export resumo bate com cards", () => {
    const rows = [settledRow()];
    const summary = aggregateMonthlyPayableFromRows(rows, { year: 2026, month: 6 });
    const csv = buildMonthlyPayableSellerSummaryCsv(summary);
    assert.match(csv, /# total_liberado=12\.50/);
    assert.match(csv, /# base_rateada=500\.00/);
    assert.match(csv, /# valor_recebido=500\.00/);
    assert.match(csv, /Vendedor A/);
  });

  it("export detalhe bate com cards", () => {
    const rows = [settledRow()];
    const summary = aggregateMonthlyPayableFromRows(rows, { year: 2026, month: 6 });
    const csv = buildMonthlyPayableDetailCsv(summary);
    assert.match(csv, /# total_liberado=12\.50/);
    assert.match(csv, /999/);
    assert.match(csv, /12\.50/);
  });

  it("comparação Nomus manual usa comissão liberada", () => {
    const rows = [settledRow()];
    const auditCards = computeVisualAuditCards(rows, "PAYABLE");
    const nomus = buildVisualAuditNomusReference({
      mode: "PAYABLE",
      cards: auditCards,
      nomusBase: 500,
      nomusCommission: 10,
    });
    assert.equal(nomus.comparable, true);
    assert.equal(nomus.commissionDiff, 2.5);
    assert.equal(nomus.indusAverageRatePercent, auditCards.averageRatePercent);
  });

  it("parseCommissionMonthlyClosingQuery exige year/month", () => {
    const q = parseCommissionMonthlyClosingQuery({ year: "2026", month: "6", page: "1", pageSize: "50" });
    assert.equal(q.year, 2026);
    assert.equal(q.month, 6);
  });

  it("filtro vendedor na query string", () => {
    const qs = buildMonthlyClosingQueryString({
      year: "2026",
      month: "6",
      commissionPersonId: "abc-123",
      customer: "",
      orderCode: "",
      nfeNumber: "",
      nomusReceivableId: "",
      receivableTitleStatus: "",
      commissionStatus: "",
      onlyDivergences: false,
      nomusReferenceBase: "",
      nomusReferenceCommission: "",
      page: 1,
      pageSize: 50,
    });
    assert.match(qs, /commissionPersonId=abc-123/);
    const exportQs = buildMonthlyClosingExportQueryString(
      {
        year: "2026",
        month: "6",
        commissionPersonId: "",
        customer: "",
        orderCode: "",
        nfeNumber: "",
        nomusReceivableId: "",
        receivableTitleStatus: "",
        commissionStatus: "",
        onlyDivergences: false,
        nomusReferenceBase: "",
        nomusReferenceCommission: "",
        page: 1,
        pageSize: 50,
      },
      "summary"
    );
    assert.match(exportQs, /format=summary/);
  });
});
