import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";
import { applyActiveCustomerExclusionsToReportLines } from "./commissionReportsCustomerExclusion.js";
import type { CommissionReportSourceLine } from "./commissionReports.shared.js";
import { mapSourceLineToReportRecord } from "./commissionReports.shared.js";

function rule(
  partial: Partial<CustomerExclusionRuleSnapshot> & { id: string }
): CustomerExclusionRuleSnapshot {
  return {
    customerId: "cust-excluded",
    customerExternalId: null,
    customerTaxId: null,
    normalizedCustomerTaxId: null,
    customerNameSnapshot: "Cliente Excluído SA",
    normalizedCustomerName: "cliente excluido sa",
    reason: "Não comissionável",
    effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
    effectiveTo: null,
    status: "ACTIVE",
    notes: null,
    ...partial,
  };
}

function line(
  partial: Partial<CommissionReportSourceLine> & { lineKey: string }
): CommissionReportSourceLine {
  return {
    nomusReceivableId: 1,
    receivableNumber: "CR-1",
    installmentNumber: 1,
    settlementDate: "2026-07-10T00:00:00.000Z",
    dueDate: null,
    customerId: "cust-excluded",
    customerExternalId: null,
    customerName: "Cliente Excluído SA",
    orderCode: "PED-9",
    localOrderId: null,
    linkResolutionSource: null,
    linkResolutionStatus: null,
    nomusNfeId: null,
    nfeNumber: "NF-9",
    localItemId: null,
    nomusOrderItemId: null,
    productCode: "P1",
    productName: null,
    rawSellerId: 10,
    rawSellerName: "GISLENE",
    canonicalSellerId: "person-gislene",
    canonicalSellerName: "GISLENE LIMA",
    sellerResolutionStatus: "RESOLVED_FROM_SCHEDULE",
    receivedAmount: 1000,
    uniqueReceivedAmount: 1000,
    commissionableBaseAmount: 800,
    ratePercent: 2.5,
    expectedCommissionAmount: 20,
    releasedCommissionAmount: 20,
    grossCommissionAmount: 20,
    scheduledCommissionAmount: 20,
    commissionReceivableScheduleId: "sched-1",
    ruleId: "rule-1",
    ruleName: "Padrão",
    exclusionReason: null,
    status: "COMMISSIONABLE",
    statusReason: null,
    source: "MATERIALIZED_SCHEDULE",
    year: 2026,
    month: 7,
    periodStatus: "PREVIEW",
    closingId: null,
    ...partial,
  };
}

describe("applyActiveCustomerExclusionsToReportLines", () => {
  it("reclassifica COMMISSIONABLE para CUSTOMER_EXCLUDED quando regra ativa bate", () => {
    const [out] = applyActiveCustomerExclusionsToReportLines(
      [line({ lineKey: "a" })],
      [rule({ id: "ex-1" })]
    );
    assert.equal(out?.status, "CUSTOMER_EXCLUDED");
    assert.equal(out?.releasedCommissionAmount, 0);
    assert.equal(out?.ratePercent, 0);
    assert.equal(out?.exclusionReason, "Não comissionável");
    assert.ok((out?.grossCommissionAmount ?? 0) >= 20);

    const record = mapSourceLineToReportRecord(out!);
    assert.equal(record.isCustomerExcluded, true);
    assert.equal(record.finalCommissionAmount, 0);
    assert.ok(record.excludedCommissionAmount >= 20);
    assert.equal(record.sellerId, "person-gislene");
    assert.equal(record.sellerName, "GISLENE LIMA");
  });

  it("não altera linha já CUSTOMER_EXCLUDED nem GROUP_COMPANY", () => {
    const excluded = line({
      lineKey: "ex",
      status: "CUSTOMER_EXCLUDED",
      releasedCommissionAmount: 0,
      exclusionReason: "já excluído",
    });
    const group = line({
      lineKey: "g",
      status: "GROUP_COMPANY_EXCLUDED",
      customerId: "cust-other",
    });
    const out = applyActiveCustomerExclusionsToReportLines(
      [excluded, group],
      [rule({ id: "ex-1" })]
    );
    assert.equal(out[0]?.exclusionReason, "já excluído");
    assert.equal(out[1]?.status, "GROUP_COMPANY_EXCLUDED");
  });

  it("não aplica quando cliente não está na regra", () => {
    const [out] = applyActiveCustomerExclusionsToReportLines(
      [line({ lineKey: "ok", customerId: "cust-ok", customerName: "Cliente OK" })],
      [rule({ id: "ex-1" })]
    );
    assert.equal(out?.status, "COMMISSIONABLE");
    assert.equal(out?.releasedCommissionAmount, 20);
  });
});
