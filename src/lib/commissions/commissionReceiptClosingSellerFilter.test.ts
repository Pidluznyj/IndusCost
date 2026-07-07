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
import { RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY } from "./commissionReceiptClosingApi.shared.js";

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
        status: "COMMISSIONABLE",
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
        status: "NO_SELLER",
        canonicalSellerId: null,
        canonicalSellerName: null,
        rawSellerName: null,
      }),
      RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY
    );
    assert.equal(
      receiptClosingSellerFilterLabel({ sellerId: null, sellerName: null }),
      "Sem vendedor / Excluído"
    );
  });

  it("CUSTOMER_EXCLUDED com vendedor raw agrupa no bucket — e não na vendedora", () => {
    assert.equal(
      receiptClosingLineSellerKey({
        status: "CUSTOMER_EXCLUDED",
        canonicalSellerId: "seller-gislene",
        canonicalSellerName: "GISLENE LIMA",
        rawSellerName: "GISLENE",
      }),
      RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY
    );
  });

  it("filtra linhas por vendedor e limpa com null", () => {
    const lines = [
      line({
        lineKey: "g1",
        status: "COMMISSIONABLE",
        canonicalSellerId: "seller-gislene",
        canonicalSellerName: "GISLENE LIMA",
        nomusReceivableId: 1,
      }),
      line({
        lineKey: "ex1",
        status: "CUSTOMER_EXCLUDED",
        canonicalSellerId: "seller-gislene",
        canonicalSellerName: "GISLENE LIMA",
        rawSellerName: "GISLENE",
        nomusReceivableId: 2,
      }),
      line({
        lineKey: "r1",
        canonicalSellerId: "seller-rodrigo",
        canonicalSellerName: "RODRIGO",
        nomusReceivableId: 3,
      }),
      line({
        lineKey: "n1",
        status: "NO_SELLER",
        canonicalSellerId: null,
        canonicalSellerName: null,
        rawSellerName: null,
        nomusReceivableId: 4,
      }),
    ];
    const gislene = filterReceiptClosingLinesBySellerKey(lines, "seller-gislene");
    assert.equal(gislene.length, 1);
    assert.equal(gislene[0]?.lineKey, "g1");

    const noSeller = filterReceiptClosingLinesBySellerKey(lines, RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY);
    assert.equal(noSeller.length, 2);
    assert.deepEqual(
      noSeller.map((row) => row.lineKey).sort(),
      ["ex1", "n1"]
    );

    assert.equal(filterReceiptClosingLinesBySellerKey(lines, null).length, 4);
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
