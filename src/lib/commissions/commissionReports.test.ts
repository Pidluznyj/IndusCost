import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleCommissionReportsPayload,
  buildEmptyCommissionReportsPayload,
  filterCommissionReportRecords,
  mapSourceLineToReportRecord,
  matchesCommissionReportSearch,
  type CommissionReportSourceLine,
} from "./commissionReports.shared.js";
import { parseCommissionReportsQuery, CommissionQueryParseError } from "./commissionQuery.js";

function line(
  partial: Partial<CommissionReportSourceLine> & { lineKey: string }
): CommissionReportSourceLine {
  return {
    nomusReceivableId: 1,
    receivableNumber: "CR-1",
    installmentNumber: 1,
    settlementDate: "2026-06-15T00:00:00.000Z",
    dueDate: null,
    customerId: null,
    customerExternalId: null,
    customerName: "Cliente A",
    orderCode: "PED-1",
    localOrderId: null,
    nomusNfeId: null,
    nfeNumber: "NF-100",
    localItemId: null,
    nomusOrderItemId: null,
    productCode: "P1",
    productName: null,
    rawSellerId: 10,
    rawSellerName: "Vendedor Raw",
    canonicalSellerId: "11111111-1111-4111-8111-111111111111",
    canonicalSellerName: "Vendedor Oficial",
    sellerResolutionStatus: "RESOLVED_FROM_SCHEDULE",
    receivedAmount: 1000,
    uniqueReceivedAmount: 1000,
    commissionableBaseAmount: 800,
    ratePercent: 5,
    expectedCommissionAmount: 40,
    releasedCommissionAmount: 40,
    grossCommissionAmount: 40,
    scheduledCommissionAmount: 40,
    commissionReceivableScheduleId: null,
    ruleId: null,
    ruleName: null,
    exclusionReason: null,
    status: "COMMISSIONABLE",
    statusReason: null,
    source: "PERSISTED_LEDGER",
    year: 2026,
    month: 6,
    periodStatus: "CLOSED",
    closingId: "22222222-2222-4222-8222-222222222222",
    ...partial,
  };
}

describe("parseCommissionReportsQuery", () => {
  it("exige ano válido", () => {
    assert.throws(
      () => parseCommissionReportsQuery({}),
      (err: unknown) => err instanceof CommissionQueryParseError
    );
  });

  it("aceita mês all e filtros padrão", () => {
    const q = parseCommissionReportsQuery({ year: "2026", month: "all" });
    assert.equal(q.year, 2026);
    assert.equal(q.month, "all");
    assert.equal(q.sellerId, "all");
    assert.equal(q.status, "all");
    assert.equal(q.page, 1);
  });

  it("rejeita status inválido com erro amigável", () => {
    assert.throws(
      () => parseCommissionReportsQuery({ year: "2026", status: "PAGO_XYZ" }),
      (err: unknown) =>
        err instanceof CommissionQueryParseError &&
        String(err.message).includes("Status inválido")
    );
  });
});

describe("commissionReports.shared", () => {
  it("arrays vazios não quebram payload", () => {
    const empty = buildEmptyCommissionReportsPayload({
      year: 2026,
      month: "all",
      sellerId: "all",
      status: "all",
      search: null,
      page: 1,
      pageSize: 50,
    });
    assert.deepEqual(empty.sellers, []);
    assert.deepEqual(empty.records, []);
    assert.equal(empty.summary.recordCount, 0);
  });

  it("filtra por vendedor e todos os vendedores", () => {
    const records = [
      mapSourceLineToReportRecord(line({ lineKey: "a" })),
      mapSourceLineToReportRecord(
        line({
          lineKey: "b",
          canonicalSellerId: "33333333-3333-4333-8333-333333333333",
          canonicalSellerName: "Outro",
          nomusReceivableId: 2,
        })
      ),
    ];
    const one = filterCommissionReportRecords(records, {
      sellerId: "11111111-1111-4111-8111-111111111111",
      status: "all",
      search: null,
    });
    assert.equal(one.length, 1);
    const all = filterCommissionReportRecords(records, {
      sellerId: "all",
      status: "all",
      search: null,
    });
    assert.equal(all.length, 2);
  });

  it("busca por cliente/pedido/NF/CR", () => {
    const record = mapSourceLineToReportRecord(line({ lineKey: "x" }));
    assert.equal(matchesCommissionReportSearch(record, "Cliente A"), true);
    assert.equal(matchesCommissionReportSearch(record, "PED-1"), true);
    assert.equal(matchesCommissionReportSearch(record, "NF-100"), true);
    assert.equal(matchesCommissionReportSearch(record, "CR-1"), true);
    assert.equal(matchesCommissionReportSearch(record, "inexistente"), false);
  });

  it("resumo por vendedor soma comissão final", () => {
    const payload = assembleCommissionReportsPayload(
      [
        line({ lineKey: "1", releasedCommissionAmount: 40, grossCommissionAmount: 40 }),
        line({
          lineKey: "2",
          nomusReceivableId: 2,
          releasedCommissionAmount: 60,
          grossCommissionAmount: 60,
        }),
      ],
      {
        year: 2026,
        month: 6,
        sellerId: "all",
        status: "all",
        search: null,
        page: 1,
        pageSize: 50,
      },
      [{ year: 2026, month: 6, periodStatus: "CLOSED", closingId: "c1" }]
    );
    assert.equal(payload.summary.totalCommission, 100);
    assert.equal(payload.sellers.length, 1);
    assert.equal(payload.sellers[0]?.finalCommission, 100);
    assert.ok(Array.isArray(payload.records));
  });

  it("não recalcula percentual no frontend — usa rate da linha", () => {
    const record = mapSourceLineToReportRecord(line({ lineKey: "r", ratePercent: 7.5 }));
    assert.equal(record.ratePercent, 7.5);
    assert.equal(record.finalCommissionAmount, 40);
  });
});
