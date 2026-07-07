import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReceiptClosingApiLine } from "./commissionReceiptClosingApi.js";
import {
  computeReceiptClosingDetailTotals,
  filterReceiptClosingLinesBySellerKey,
  receiptClosingLineSellerKey,
  receiptClosingSellerFilterLabel,
  receiptClosingSellerRowKey,
} from "./commissionReceiptClosingSellerFilter.js";

function line(
  partial: Partial<ReceiptClosingApiLine> & Pick<ReceiptClosingApiLine, "lineKey">
): ReceiptClosingApiLine {
  return {
    nomusReceivableId: 100,
    receivableNumber: "CR-100",
    installmentNumber: 1,
    settlementDate: "2026-06-15",
    dueDate: "2026-06-10",
    customerId: null,
    customerExternalId: null,
    customerName: "Cliente",
    orderCode: null,
    localOrderId: null,
    nomusNfeId: null,
    nfeNumber: null,
    localItemId: null,
    nomusOrderItemId: null,
    productCode: null,
    productName: null,
    rawSellerId: null,
    rawSellerName: null,
    canonicalSellerId: null,
    canonicalSellerName: null,
    sellerResolutionStatus: null,
    receivedAmount: 1000,
    uniqueReceivedAmount: 1000,
    commissionableBaseAmount: 1000,
    ratePercent: 2,
    expectedCommissionAmount: 20,
    releasedCommissionAmount: 20,
    grossCommissionAmount: 20,
    scheduledCommissionAmount: 20,
    commissionReceivableScheduleId: null,
    ruleId: null,
    ruleName: null,
    exclusionReason: null,
    status: "COMMISSIONABLE",
    statusReason: null,
    source: "EXCEPTION",
    ...partial,
  };
}

describe("commissionReceiptClosingSellerFilter", () => {
  it("agrupa vendedor canônico por sellerId", () => {
    const key = receiptClosingSellerRowKey({
      sellerId: "seller-gislene",
      sellerName: "GISLENE LIMA",
    });
    assert.equal(key, "seller-gislene");
    assert.equal(
      receiptClosingLineSellerKey({
        canonicalSellerId: "seller-gislene",
        canonicalSellerName: "GISLENE LIMA",
        rawSellerName: "GISLENE",
      }),
      key
    );
  });

  it("linha sem vendedor canônico usa chave —", () => {
    assert.equal(
      receiptClosingLineSellerKey({
        canonicalSellerId: null,
        canonicalSellerName: null,
        rawSellerName: null,
      }),
      "—"
    );
    assert.equal(
      receiptClosingSellerFilterLabel({ sellerId: null, sellerName: null }),
      "—"
    );
  });

  it("filtra linhas por vendedor e limpa com null", () => {
    const lines = [
      line({
        lineKey: "g1",
        canonicalSellerId: "seller-gislene",
        canonicalSellerName: "GISLENE LIMA",
        nomusReceivableId: 1,
      }),
      line({
        lineKey: "r1",
        canonicalSellerId: "seller-rodrigo",
        canonicalSellerName: "RODRIGO",
        nomusReceivableId: 2,
      }),
      line({
        lineKey: "n1",
        canonicalSellerId: null,
        canonicalSellerName: null,
        rawSellerName: null,
        nomusReceivableId: 3,
      }),
    ];
    const gislene = filterReceiptClosingLinesBySellerKey(lines, "seller-gislene");
    assert.equal(gislene.length, 1);
    assert.equal(gislene[0]?.lineKey, "g1");

    const noSeller = filterReceiptClosingLinesBySellerKey(lines, "—");
    assert.equal(noSeller.length, 1);
    assert.equal(noSeller[0]?.lineKey, "n1");

    assert.equal(filterReceiptClosingLinesBySellerKey(lines, null).length, 3);
  });

  it("totais do detalhe somam colunas visíveis com âncora de recebido", () => {
    const lines = [
      line({
        lineKey: "a1",
        uniqueReceivedAmount: 500,
        scheduledCommissionAmount: 10,
        releasedCommissionAmount: 10,
      }),
      line({
        lineKey: "a2",
        uniqueReceivedAmount: 0,
        scheduledCommissionAmount: 5,
        releasedCommissionAmount: 5,
      }),
    ];
    const totals = computeReceiptClosingDetailTotals(lines);
    assert.equal(totals.lineCount, 2);
    assert.equal(totals.receivedAmount, 500);
    assert.equal(totals.scheduledCommissionAmount, 15);
    assert.equal(totals.releasedCommissionAmount, 15);
  });
});
