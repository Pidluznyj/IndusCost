import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommissionReceiptPreviewLine, CommissionReceiptPreviewResult } from "./commissionReceiptEngine.js";
import {
  buildReceiptClosingBySeller,
  buildReceiptClosingExportCsv,
  buildReceiptClosingMaterializationCards,
  buildReceiptClosingPageFromLedger,
  buildReceiptClosingPageFromPreview,
  buildReceiptClosingReconciliationFromApiLines,
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
    commissionReceivableScheduleId: "sched-1",
    ruleId: "rule-1",
    ruleName: "2%",
    ratePercent: 2,
    commissionableBaseAmount: 1000,
    expectedCommissionAmount: 20,
    releasedCommissionAmount: 20,
    grossCommissionAmount: 20,
    status: "COMMISSIONABLE",
    statusReason: null,
    exclusionRuleId: null,
    exclusionReason: null,
    source: "MATERIALIZED_SCHEDULE",
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
  it("preview page payload expõe cards e linhas materializadas", () => {
    const preview = previewResult([previewLine({ ledgerLineKey: "k1" })]);
    const payload = buildReceiptClosingPageFromPreview({
      preview,
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });
    assert.equal(payload.mode, "PREVIEW");
    assert.equal(payload.lines.length, 1);
    assert.equal(payload.cards.finalCommissionAmount, 20);
    assert.equal(payload.bySeller.length, 1);
    assert.equal(payload.bySeller[0]?.grossCommission, 20);
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
          ruleSnapshotJson: { ruleId: "rule-1", commissionReceivableScheduleId: "sched-1" },
        },
      ],
    });
    assert.equal(payload.mode, "CLOSED");
    assert.equal(payload.exportMode, "CLOSED");
    assert.equal(payload.canApply, false);
    assert.equal(payload.cards.reportStatus, "CLOSED");
  });

  it("card recebido = soma única dos títulos (sem duplicar multi-item)", () => {
    const lines = [
      previewLine({
        ledgerLineKey: "k1",
        nomusReceivableId: 100,
        receivedAmount: 1000,
        commissionableBaseAmount: 600,
        releasedCommissionAmount: 12,
        grossCommissionAmount: 12,
        nomusOrderItemId: 1,
      }),
      previewLine({
        ledgerLineKey: "k2",
        nomusReceivableId: 100,
        receivedAmount: 1000,
        commissionableBaseAmount: 400,
        releasedCommissionAmount: 8,
        grossCommissionAmount: 8,
        nomusOrderItemId: 2,
      }),
      previewLine({
        ledgerLineKey: "k3",
        nomusReceivableId: 200,
        receivedAmount: 500,
        commissionableBaseAmount: 500,
        releasedCommissionAmount: 10,
        grossCommissionAmount: 10,
      }),
    ];
    const payload = buildReceiptClosingPageFromPreview({
      preview: previewResult(lines),
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });
    assert.equal(payload.cards.totalReceivedAmount, 1500);
    assert.equal(payload.lines[0]?.uniqueReceivedAmount, 1000);
    assert.equal(payload.lines[1]?.uniqueReceivedAmount, 0);
    assert.equal(payload.lines[2]?.uniqueReceivedAmount, 500);
  });

  it("tabela vendedor bate com detalhe", () => {
    const lines = [
      previewLine({
        ledgerLineKey: "k1",
        canonicalSellerId: "seller-1",
        canonicalSellerName: "A",
        commissionableBaseAmount: 600,
        releasedCommissionAmount: 12,
        grossCommissionAmount: 12,
      }),
      previewLine({
        ledgerLineKey: "k2",
        canonicalSellerId: "seller-1",
        canonicalSellerName: "A",
        nomusOrderItemId: 2,
        commissionableBaseAmount: 400,
        releasedCommissionAmount: 8,
        grossCommissionAmount: 8,
      }),
      previewLine({
        ledgerLineKey: "k3",
        nomusReceivableId: 200,
        canonicalSellerId: "seller-2",
        canonicalSellerName: "B",
        receivedAmount: 500,
        commissionableBaseAmount: 500,
        releasedCommissionAmount: 10,
        grossCommissionAmount: 10,
      }),
    ];
    const payload = buildReceiptClosingPageFromPreview({
      preview: previewResult(lines),
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });
    const sellerA = payload.bySeller.find((row) => row.sellerId === "seller-1");
    assert.ok(sellerA);
    const detailA = payload.lines.filter((line) => line.canonicalSellerId === "seller-1");
    const sumBase = detailA.reduce((acc, line) => acc + line.commissionableBaseAmount, 0);
    const sumFinal = detailA.reduce((acc, line) => acc + line.releasedCommissionAmount, 0);
    assert.equal(sellerA.receivedAmount, 1000);
    assert.equal(sellerA.commissionableBase, sumBase);
    assert.equal(sellerA.releasedCommission, sumFinal);
  });

  it("CSV contém cards e colunas alinhadas à tela", () => {
    const preview = previewResult([previewLine({ ledgerLineKey: "k1" })]);
    const page = buildReceiptClosingPageFromPreview({
      preview,
      closing: null,
      canApply: true,
      applyBlockedReason: null,
      nomusCommission: 20,
    });
    const csv = buildReceiptClosingExportCsv({
      year: 2026,
      month: 6,
      closing: null,
      exportMode: "PREVIEW",
      lines: page.lines,
      cards: page.cards,
      calculationHash: "hash-test",
    });
    for (const col of RECEIPT_CLOSING_EXPORT_HEADERS) {
      assert.match(csv, new RegExp(col));
    }
    assert.match(csv, /# totalReceivedAmount,1000\.00/);
    assert.match(csv, /# finalCommissionAmount,20\.00/);
    assert.match(csv, /uniqueReceivedAmount/);
    assert.match(csv, /grossCommissionAmount/);
    assert.match(csv, /CR-100/);
    assert.equal(page.cards.totalReceivedAmount, 1000);
  });

  it("cliente excluído aparece em card próprio", () => {
    const lines = [
      previewLine({
        ledgerLineKey: "k1",
        status: "CUSTOMER_EXCLUDED",
        releasedCommissionAmount: 0,
        grossCommissionAmount: 15,
        commissionableBaseAmount: 0,
        exclusionReason: "Cliente bloqueado",
        commissionReceivableScheduleId: "sched-x",
        source: "MATERIALIZED_SCHEDULE",
      }),
    ];
    const payload = buildReceiptClosingPageFromPreview({
      preview: {
        ...previewResult(lines),
        countByStatus: { CUSTOMER_EXCLUDED: 1 },
      },
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });
    assert.equal(payload.cards.receivedExcludedCustomerAmount, 1000);
    assert.equal(payload.cards.excludedCommissionAmount, 15);
    assert.equal(payload.bySeller[0]?.excludedCommission, 15);
    assert.equal(payload.bySeller[0]?.exceptionCount, 0);
  });

  it("sem schedule aparece como exceção clara", () => {
    const lines = [
      previewLine({
        ledgerLineKey: "k1",
        nomusReceivableId: 300,
        status: "NO_SCHEDULE",
        releasedCommissionAmount: 0,
        grossCommissionAmount: 0,
        commissionableBaseAmount: 0,
        commissionReceivableScheduleId: null,
        source: "CALCULATED",
        statusReason: "Sem schedule materializado",
      }),
    ];
    const payload = buildReceiptClosingPageFromPreview({
      preview: {
        ...previewResult(lines),
        countByStatus: { NO_SCHEDULE: 1 },
      },
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });
    assert.equal(payload.cards.receivedWithoutScheduleAmount, 1000);
    assert.equal(payload.bySeller[0]?.exceptionCount, 1);
    assert.equal(payload.lines[0]?.status, "NO_SCHEDULE");
    assert.match(payload.lines[0]?.statusReason ?? "", /schedule/i);
    assert.equal(payload.requiresCriticalConfirmation, true);
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

  it("parseReceiptClosingApplyBody aceita confirmação de divergência crítica", () => {
    const body = parseReceiptClosingApplyBody({
      year: 2026,
      month: 6,
      confirm: "FECHAR COMISSAO",
      criticalConfirm: "DIVERGENCIA CRITICA",
    });
    assert.equal(body.acknowledgeCriticalDivergence, true);
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

  it("buildReceiptClosingBySeller deduplica recebido por título", () => {
    const page = buildReceiptClosingPageFromPreview({
      preview: previewResult([
        previewLine({ ledgerLineKey: "a", nomusReceivableId: 1, receivedAmount: 800 }),
        previewLine({ ledgerLineKey: "b", nomusReceivableId: 1, receivedAmount: 800, nomusOrderItemId: 2 }),
      ]),
      closing: null,
      canApply: true,
      applyBlockedReason: null,
    });
    const rows = buildReceiptClosingBySeller(page.lines);
    assert.equal(rows[0]?.receivedAmount, 800);
    assert.equal(rows[0]?.receivableCount, 1);
  });

  it("buildReceiptClosingMaterializationCards exige explicação quando há Nomus", () => {
    const page = buildReceiptClosingPageFromPreview({
      preview: previewResult([previewLine({ ledgerLineKey: "k1", releasedCommissionAmount: 18 })]),
      closing: null,
      canApply: true,
      applyBlockedReason: null,
      nomusCommission: 20,
    });
    const reconciliation = buildReceiptClosingReconciliationFromApiLines({
      lines: page.lines,
      nomusBase: null,
      nomusCommission: 20,
    });
    const cards = buildReceiptClosingMaterializationCards(page.lines, "PREVIEW", reconciliation);
    assert.equal(cards.nomusCommissionDiff, -2);
    assert.ok(cards.nomusDiffExplanation);
  });
});
