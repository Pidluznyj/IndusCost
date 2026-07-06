import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommissionReceiptPreviewLine, CommissionReceiptPreviewResult } from "./commissionReceiptEngine.js";
import {
  buildReceiptClosingExportCsv,
  buildReceiptClosingPageFromLedger,
  buildReceiptClosingPageFromPreview,
  RECEIPT_CLOSING_EXPORT_HEADERS,
} from "./commissionReceiptClosingApi.js";
import {
  parseReceiptClosingApplyBody,
  parseReceiptClosingReprocessBody,
} from "./commissionApiValidation.js";
import { CommissionValidationError } from "./commissionApiValidation.js";

function previewLine(
  partial: Partial<CommissionReceiptPreviewLine> & Pick<CommissionReceiptPreviewLine, "ledgerLineKey">
): CommissionReceiptPreviewLine {
  return {
    year: 2026,
    month: 6,
    nomusReceivableId: 100,
    receivableNumber: "CR-100",
    installmentNumber: 1,
    settlementDate: "2026-06-15T00:00:00.000Z",
    dueDate: "2026-06-10T00:00:00.000Z",
    receivableAmount: 1000,
    receivedAmount: 1000,
    receivedSharePercent: 100,
    customerExternalId: 10,
    customerId: "cust-1",
    customerName: "Cliente",
    nomusNfeId: 200,
    nfeNumber: "123",
    orderCode: "PED-1",
    localOrderId: "order-1",
    nomusOrderItemId: 1,
    localItemId: "item-1",
    productCode: "A",
    productName: "Produto A",
    rawSellerId: 464,
    rawSellerName: "GISLENE",
    canonicalSellerId: "seller-1",
    canonicalSellerName: "GISLENE LIMA",
    sellerResolutionStatus: "OK_CANONICAL",
    commissionRecordId: null,
    commissionPaymentScheduleId: null,
    ruleId: "rule-1",
    ruleName: "2%",
    ratePercent: 2,
    commissionableBaseAmount: 1000,
    expectedCommissionAmount: 20,
    releasedCommissionAmount: 20,
    status: "COMMISSIONABLE",
    statusReason: null,
    exclusionRuleId: null,
    exclusionReason: null,
    source: "CALCULATED",
    ...partial,
  };
}

function previewResult(lines: CommissionReceiptPreviewLine[]): CommissionReceiptPreviewResult {
  return {
    year: 2026,
    month: 6,
    totalReceivables: lines.length,
    totalReceivedAmount: 1000,
    totalCommissionableBase: 1000,
    totalExpectedCommission: 20,
    totalReleasedCommission: 20,
    totalExcludedAmount: 0,
    totalExceptionAmount: 0,
    countByStatus: { COMMISSIONABLE: lines.length },
    bySeller: [],
    byCustomer: [],
    lines,
  };
}

describe("commissionReceiptClosingApi", () => {
  it("preview page payload expõe resumo e linhas", () => {
    const preview = previewResult([previewLine({ ledgerLineKey: "k1" })]);
    const payload = buildReceiptClosingPageFromPreview({
      preview,
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });
    assert.equal(payload.mode, "PREVIEW");
    assert.equal(payload.lines.length, 1);
    assert.equal(payload.summary.totalReleasedCommission, 20);
    assert.equal(payload.bySeller.length, 1);
  });

  it("ledger page payload usa modo CLOSED", () => {
    const payload = buildReceiptClosingPageFromLedger({
      closing: {
        closingId: "close-1",
        year: 2026,
        month: 6,
        status: "CLOSED",
        calculationHash: "hash-abc",
        totalReceivedAmount: 1000,
        totalCommissionableBase: 1000,
        totalExpectedCommission: 20,
        totalReleasedCommission: 20,
        totalExcludedAmount: 0,
        totalExceptionAmount: 0,
        lineCount: 1,
        closedAt: "2026-07-01T00:00:00.000Z",
        closedBy: "user-1",
        notes: null,
      },
      ledgerLines: [
        {
          id: "line-1",
          ledgerLineKey: "k1",
          nomusReceivableId: 100,
          installmentNumber: 1,
          settlementDate: "2026-06-15T00:00:00.000Z",
          customerName: "Cliente",
          orderCode: "PED-1",
          nfeNumber: "123",
          productCode: "A",
          canonicalSellerId: "seller-1",
          canonicalSellerName: "GISLENE",
          receivedAmount: 1000,
          allocatedCommercialBase: 1000,
          commissionRatePercent: 2,
          expectedCommissionAmount: 20,
          releasedCommissionAmount: 20,
          status: "COMMISSIONABLE",
          exceptionReason: null,
          exclusionReason: null,
          ruleNameSnapshot: "2%",
          ruleSnapshotJson: { ruleId: "rule-1" },
        },
      ],
    });
    assert.equal(payload.mode, "CLOSED");
    assert.equal(payload.exportMode, "CLOSED");
    assert.equal(payload.canApply, false);
  });

  it("CSV contém colunas obrigatórias", () => {
    const preview = previewResult([previewLine({ ledgerLineKey: "k1" })]);
    const page = buildReceiptClosingPageFromPreview({
      preview,
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });
    const csv = buildReceiptClosingExportCsv({
      year: 2026,
      month: 6,
      closing: null,
      exportMode: "PREVIEW",
      lines: page.lines,
      calculationHash: "hash-test",
    });
    for (const col of RECEIPT_CLOSING_EXPORT_HEADERS) {
      assert.match(csv, new RegExp(col));
    }
    assert.match(csv, /exportMode=PREVIEW/);
    assert.match(csv, /CR-100/);
  });

  it("parseReceiptClosingApplyBody exige confirmação", () => {
    assert.throws(
      () => parseReceiptClosingApplyBody({ year: 2026, month: 6, confirm: "errado" }),
      (e: unknown) => e instanceof CommissionValidationError && e.code === "CONFIRMATION_REQUIRED"
    );
    const body = parseReceiptClosingApplyBody({
      year: 2026,
      month: 6,
      confirm: "FECHAR COMISSAO",
    });
    assert.equal(body.year, 2026);
    assert.equal(body.month, 6);
  });

  it("parseReceiptClosingReprocessBody exige REPROCESSAR COMISSAO", () => {
    assert.throws(
      () =>
        parseReceiptClosingReprocessBody({
          year: 2026,
          month: 6,
          confirm: "FECHAR COMISSAO",
          reason: "motivo",
        }),
      CommissionValidationError
    );
    const body = parseReceiptClosingReprocessBody({
      year: 2026,
      month: 6,
      confirm: "REPROCESSAR COMISSAO",
      reason: "correção de regra",
    });
    assert.equal(body.reason, "correção de regra");
  });
});
