import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildClosingSellerReport,
  buildClosingSellerSummaries,
  isCanonicalSellerDisplayName,
  resolveClosingSellerGroupKey,
} from "./commissionClosings.shared.js";
import type { ReceiptClosingApiLine } from "./commissionReceiptClosingApi.shared.js";
import { formatCommissionReceiptLineStatus } from "./commissionReceiptLineStatusLabels.js";

function line(
  partial: Partial<ReceiptClosingApiLine> & { lineKey: string }
): ReceiptClosingApiLine {
  return {
    nomusReceivableId: 1,
    receivableNumber: "CR-1",
    installmentNumber: 1,
    settlementDate: "2026-06-15T00:00:00.000Z",
    dueDate: "2026-06-10T00:00:00.000Z",
    customerId: "cust-1",
    customerExternalId: null,
    customerName: "Cliente A",
    orderCode: "PD02523",
    localOrderId: null,
    nomusNfeId: null,
    nfeNumber: "100",
    localItemId: null,
    nomusOrderItemId: null,
    productCode: "P1",
    productName: null,
    rawSellerId: 10,
    rawSellerName: "GISLENE",
    canonicalSellerId: "person-gislene",
    canonicalSellerName: "GISLENE LIMA",
    sellerResolutionStatus: "RESOLVED",
    receivedAmount: 1000,
    uniqueReceivedAmount: 1000,
    receivableOriginalAmount: 950,
    commissionPrincipalAmount: 950,
    ignoredFinancialChargesAmount: 50,
    commissionableBaseAmount: 950,
    ratePercent: 2.5,
    expectedCommissionAmount: 23.75,
    releasedCommissionAmount: 23.75,
    grossCommissionAmount: 23.75,
    scheduledCommissionAmount: 23.75,
    commissionReceivableScheduleId: "s1",
    ruleId: "r1",
    ruleName: "Padrão",
    exclusionReason: null,
    status: "COMMISSIONABLE",
    statusReason: null,
    source: "PERSISTED_LEDGER",
    ...partial,
  };
}

describe("commissionClosings.shared", () => {
  it("agrupa por vendedor canônico e não usa ID cru como nome", () => {
    const sellers = buildClosingSellerSummaries([
      line({ lineKey: "a" }),
      line({
        lineKey: "b",
        nomusReceivableId: 2,
        orderCode: "PD02524",
        customerId: "cust-2",
        customerName: "Cliente B",
        uniqueReceivedAmount: 500,
        receivedAmount: 500,
        commissionableBaseAmount: 500,
        releasedCommissionAmount: 12.5,
        grossCommissionAmount: 12.5,
        expectedCommissionAmount: 12.5,
      }),
      line({
        lineKey: "ex",
        status: "CUSTOMER_EXCLUDED",
        nomusReceivableId: 3,
        uniqueReceivedAmount: 100,
        receivedAmount: 100,
        releasedCommissionAmount: 0,
        expectedCommissionAmount: 5,
        grossCommissionAmount: 5,
        commissionableBaseAmount: 0,
      }),
    ]);
    assert.equal(sellers.length, 1);
    assert.equal(sellers[0]?.sellerName, "GISLENE LIMA");
    assert.ok(isCanonicalSellerDisplayName(sellers[0]?.sellerName));
    assert.equal(sellers[0]?.titleCount, 3);
    assert.equal(sellers[0]?.finalCommissionAmount, 36.25);
    assert.ok(sellers[0]?.excludedCommissionAmount >= 5);
  });

  it("totais do relatório do vendedor batem com as linhas", () => {
    const lines = [
      line({ lineKey: "a" }),
      line({
        lineKey: "b",
        canonicalSellerId: "person-rodrigo",
        canonicalSellerName: "Rodrigo Da Silva Ramos",
        nomusReceivableId: 9,
        uniqueReceivedAmount: 200,
        receivedAmount: 200,
        commissionableBaseAmount: 200,
        releasedCommissionAmount: 5,
        expectedCommissionAmount: 5,
        grossCommissionAmount: 5,
      }),
    ];
    const key = resolveClosingSellerGroupKey(lines[0]!);
    const report = buildClosingSellerReport(
      lines,
      key,
      {
        closingId: "c1",
        year: 2026,
        month: 6,
        status: "CLOSED",
        calculationHash: "abc",
        totalReceivedAmount: 1200,
        totalCommissionableBase: 1150,
        totalExpectedCommission: 28.75,
        totalReleasedCommission: 28.75,
        totalExcludedAmount: 0,
        totalExceptionAmount: 0,
        lineCount: 2,
        closedAt: "2026-07-14T12:00:00.000Z",
        closedBy: "user-1",
        notes: null,
      },
      "Paulo"
    );
    assert.ok(report);
    assert.equal(report!.seller.displayName, "GISLENE LIMA");
    assert.equal(report!.rows.length, 1);
    assert.equal(report!.totals.finalCommissionAmount, 23.75);
    assert.equal(report!.rows[0]?.statusLabel, formatCommissionReceiptLineStatus("COMMISSIONABLE"));
    assert.equal(report!.rows[0]?.overpaidAmount, 50);
  });

  it("rejeita label Vendedor ID como canônico", () => {
    assert.equal(isCanonicalSellerDisplayName("Vendedor ID 1399"), false);
    assert.equal(isCanonicalSellerDisplayName("GISLENE LIMA"), true);
  });
});
