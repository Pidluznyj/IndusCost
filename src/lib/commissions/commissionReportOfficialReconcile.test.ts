import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMISSION_SOURCE_MISMATCH_STATUS,
  reconcileReportLineWithOfficialSnapshot,
  reportLineMisclassifiedAgainstSnapshot,
} from "./commissionReportOfficialReconcile.js";
import { mapSourceLineToReportRecord } from "./commissionReports.shared.js";

const SNAP = {
  salesOrderId: "o1",
  orderCode: "PD 02523",
  totalFinalCommissionAmount: 12.19,
  totalSoldAmount: 300,
  canonicalSellerId: "s1",
  canonicalSellerName: "Rodrigo Da Silva Ramos",
  rawSellerId: 1,
  rawSellerName: "RODRIGO",
  scheduledCommissionSum: 12.19,
  itemStatuses: ["COMMISSIONABLE"],
};

describe("commissionReportOfficialReconcile", () => {
  it("NO_MARGIN com snapshot oficial vira COMMISSION_SOURCE_MISMATCH e mostra R$ 12,19", () => {
    assert.equal(
      reportLineMisclassifiedAgainstSnapshot(
        { status: "NO_MARGIN", expectedCommissionAmount: 0, releasedCommissionAmount: 0 },
        SNAP
      ),
      true
    );
    const out = reconcileReportLineWithOfficialSnapshot(
      {
        status: "NO_MARGIN",
        statusReason: "Sem margem",
        expectedCommissionAmount: 0,
        releasedCommissionAmount: 0,
        grossCommissionAmount: 0,
        commissionableBaseAmount: 0,
        canonicalSellerId: null,
        canonicalSellerName: null,
        rawSellerId: null,
        rawSellerName: null,
        source: "EXCEPTION",
      },
      SNAP
    );
    assert.equal(out.status, COMMISSION_SOURCE_MISMATCH_STATUS);
    assert.equal(out.expectedCommissionAmount, 12.19);
    assert.equal(out.commissionableBaseAmount, 300);
    assert.equal(out.releasedCommissionAmount, 0);

    const record = mapSourceLineToReportRecord({
      lineKey: "k",
      nomusReceivableId: 16428,
      receivableNumber: "16428",
      installmentNumber: 1,
      settlementDate: null,
      dueDate: null,
      customerId: null,
      customerExternalId: null,
      customerName: "C",
      orderCode: "PD 02523",
      localOrderId: "o1",
      linkResolutionSource: null,
      linkResolutionStatus: null,
      nomusNfeId: null,
      nfeNumber: null,
      localItemId: null,
      nomusOrderItemId: null,
      productCode: null,
      productName: null,
      rawSellerId: 1,
      rawSellerName: "RODRIGO",
      canonicalSellerId: out.canonicalSellerId,
      canonicalSellerName: out.canonicalSellerName,
      sellerResolutionStatus: "OK",
      receivedAmount: 300,
      uniqueReceivedAmount: 300,
      commissionableBaseAmount: out.commissionableBaseAmount,
      ratePercent: 4,
      expectedCommissionAmount: out.expectedCommissionAmount,
      releasedCommissionAmount: 0,
      grossCommissionAmount: 12.19,
      scheduledCommissionAmount: 12.19,
      commissionReceivableScheduleId: null,
      ruleId: null,
      ruleName: null,
      exclusionReason: null,
      status: out.status,
      statusReason: out.statusReason,
      source: out.source,
      year: 2026,
      month: 5,
      periodStatus: "CLOSED",
      closingId: "c1",
    });
    assert.equal(record.finalCommissionAmount, 12.19);
    assert.notEqual(record.lineStatus, "NO_MARGIN");
  });

  it("não força snapshot sobre cliente excluído", () => {
    assert.equal(
      reportLineMisclassifiedAgainstSnapshot(
        {
          status: "CUSTOMER_EXCLUDED",
          expectedCommissionAmount: 0,
          releasedCommissionAmount: 0,
        },
        SNAP
      ),
      false
    );
  });

  it("pedido sem comissão no snapshot pode continuar NO_MARGIN", () => {
    assert.equal(
      reportLineMisclassifiedAgainstSnapshot(
        { status: "NO_MARGIN", expectedCommissionAmount: 0, releasedCommissionAmount: 0 },
        { totalFinalCommissionAmount: 0, scheduledCommissionSum: 0 }
      ),
      false
    );
  });
});
