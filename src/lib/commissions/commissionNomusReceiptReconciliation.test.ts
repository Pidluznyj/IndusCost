import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NOMUS_NFE_STATUS_AUTHORIZED } from "@/src/lib/nomusNfeClassification.js";
import {
  buildCommissionReceiptPreview,
  type CommissionReceiptPreviewLine,
  type CommissionReceiptReceivableInput,
} from "./commissionReceiptEngine.js";
import type {
  CommissionOrderItemSource,
  CommissionOrderSourceBundle,
} from "./commission-types.js";
import type { CommissionSellerIdentityContext } from "./commissionSellerIdentity.js";
import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";
import {
  buildNomusReceiptReconciliationReport,
  detectDuplicateReceived,
} from "./commissionNomusReceiptReconciliation.js";
import { sellerNameMatchesFilter } from "./commissionSellerIdentity.js";

const OK_IDENTITY: CommissionSellerIdentityContext = {
  persons: [
    {
      id: "person-gislene",
      nomusPersonId: 464,
      name: "GISLENE LIMA",
      type: "SELLER",
      source: "NOMUS",
      active: true,
      linkedRecordCount: 1,
    },
  ],
  aliases: [
    {
      id: "alias-1",
      commissionedPersonId: "person-gislene",
      source: "NOMUS_ORDER",
      rawSellerId: 464,
      rawSellerName: "GISLENE LIMA",
      normalizedSellerName: "GISLENE LIMA",
      status: "ACTIVE",
      confidence: 1,
    },
  ],
};

function item(localItemId: string, net: number): CommissionOrderItemSource {
  return {
    localItemId,
    localProductId: `p-${localItemId}`,
    nomusOrderItemId: null,
    nomusProductId: null,
    productCode: localItemId,
    productName: localItemId,
    quantity: 1,
    unitPrice: net,
    discount: 0,
    surcharge: 0,
    itemNetAmount: net,
  };
}

function orderBundle(items: CommissionOrderItemSource[]): CommissionOrderSourceBundle {
  const nfe = {
    nfeExternalId: 100,
    nfeNumber: "NF-1",
    nfeStatus: NOMUS_NFE_STATUS_AUTHORIZED,
    tipoOperacao: 1,
    dataProcessamento: new Date("2026-06-01"),
    nfeValue: items.reduce((s, r) => s + r.itemNetAmount, 0),
    isAuthorized: true,
    isCancelled: false,
    isOutputOperation: true,
    nomusNfeLocalId: "nfe-1",
  };
  return {
    localOrderId: "order-1",
    nomusOrderId: 1,
    orderCode: "PED-1",
    issueDate: new Date("2026-06-01"),
    status: "CONFIRMED",
    paymentTerms: null,
    paymentMethod: null,
    companyExternalId: 1,
    customerExternalId: 200,
    customerName: "Cliente Teste",
    seller: { nomusSellerId: 464, responsibleName: "GISLENE LIMA" },
    representative: { nomusRepresentativeId: null, name: null },
    items,
    forecastInstallments: [],
    linkedNfes: [nfe],
    authorizedOutputNfes: [nfe],
    outputDocumentsByNfeId: new Map(),
    receivablesByNfeId: new Map(),
  };
}

function receivable(
  id: number,
  received: number,
  total = received
): CommissionReceiptReceivableInput {
  const receiptDate = new Date("2026-06-15");
  return {
    nomusReceivableId: id,
    receivableNumber: `CR-${id}`,
    installmentNumber: 1,
    settlementDate: receiptDate,
    // Recebimento no mesmo dia da baixa — equivalente ao fixture anterior.
    receiptCompetence: {
      receivableExternalId: id,
      receiptDate,
      firstReceiptDate: receiptDate,
      receiptIds: [id],
      periodReceivedAmount: received,
      priorReceivedAmount: 0,
      cumulativeReceivedAmount: received,
    },
    dueDate: new Date("2026-06-30"),
    amountReceivable: total,
    amountReceived: received,
    nomusNfeId: 100,
    nfeNumber: "NF-1",
    customerExternalId: 200,
    customerName: "Cliente Teste",
  };
}

function exclusionRule(id: string): CustomerExclusionRuleSnapshot {
  return {
    id,
    customerId: null,
    customerExternalId: 200,
    customerNameSnapshot: "Cliente Teste",
    normalizedCustomerName: "cliente teste",
    reason: "Política comercial",
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    status: "ACTIVE",
    notes: null,
  };
}

function previewLine(
  partial: Partial<CommissionReceiptPreviewLine> & Pick<CommissionReceiptPreviewLine, "ledgerLineKey">
): CommissionReceiptPreviewLine {
  return {
    year: 2026,
    month: 6,
    nomusReceivableId: 1,
    receivableNumber: "CR-1",
    installmentNumber: 1,
    settlementDate: "2026-06-15T00:00:00.000Z",
    dueDate: null,
    receivableAmount: 1000,
    receivedAmount: 1000,
    receivedSharePercent: 100,
    customerExternalId: 200,
    customerId: null,
    customerName: "Cliente Teste",
    nomusNfeId: 100,
    nfeNumber: "NF-1",
    orderCode: "PED-1",
    localOrderId: "order-1",
    nomusOrderItemId: null,
    localItemId: "A",
    productCode: "A",
    productName: "A",
    rawSellerId: 464,
    rawSellerName: "GISLENE LIMA",
    canonicalSellerId: "person-gislene",
    canonicalSellerName: "GISLENE LIMA",
    sellerResolutionStatus: "OK_CANONICAL",
    commissionRecordId: null,
    commissionPaymentScheduleId: null,
    commissionReceivableScheduleId: null,
    ruleId: null,
    ruleName: null,
    ratePercent: 2,
    commissionableBaseAmount: 200,
    expectedCommissionAmount: 4,
    releasedCommissionAmount: 4,
    grossCommissionAmount: 4,
    status: "COMMISSIONABLE",
    statusReason: null,
    exclusionRuleId: null,
    exclusionReason: null,
    source: "CALCULATED",
    ...partial,
  };
}

describe("commissionNomusReceiptReconciliation", () => {
  it("título com 5 linhas não duplica recebido na agregação", () => {
    const preview = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable(900, 5000, 5000)],
      ordersByNfeId: new Map([
        [
          100,
          orderBundle([
            item("A", 1000),
            item("B", 1000),
            item("C", 1000),
            item("D", 1000),
            item("E", 1000),
          ]),
        ],
      ]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
      itemRateOverrides: new Map([
        ["A", 2],
        ["B", 2],
        ["C", 2],
        ["D", 2],
        ["E", 2],
      ]),
      allowItemRecalculationFallback: true,
    });

    assert.equal(preview.lines.length, 5);
    assert.equal(preview.totalReceivedAmount, 5000);

    const duplicates = detectDuplicateReceived(preview.lines);
    assert.equal(duplicates.length, 1);
    assert.equal(duplicates[0]?.excessReceived, 20000);
  });

  it("base/comissão por linha batem no relatório Nomus", () => {
    const lines = [
      previewLine({ ledgerLineKey: "l1", commissionableBaseAmount: 300, releasedCommissionAmount: 6, grossCommissionAmount: 6 }),
      previewLine({ ledgerLineKey: "l2", commissionableBaseAmount: 200, releasedCommissionAmount: 4, grossCommissionAmount: 4 }),
    ];
    const report = buildNomusReceiptReconciliationReport({
      lines,
      nomusBase: 500,
      nomusCommission: 10,
    });

    assert.equal(report.indusCostFinalBase, 500);
    assert.equal(report.indusCostFinalCommission, 10);
    assert.equal(report.diffBaseBeforeExclusions, 0);
    assert.equal(report.diffCommissionBeforeExclusions, 0);
  });

  it("cliente excluído aparece separado com comissão bruta", () => {
    const preview = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable(1, 1000)],
      ordersByNfeId: new Map([[100, orderBundle([item("A", 1000)])]]),
      rules: [],
      exclusionRules: [exclusionRule("ex-1")],
      identityCtx: OK_IDENTITY,
      itemRateOverrides: new Map([["A", 2]]),
      allowItemRecalculationFallback: true,
    });

    const report = buildNomusReceiptReconciliationReport({
      lines: preview.lines,
      nomusBase: 1000,
      nomusCommission: 20,
    });

    assert.equal(preview.lines[0]?.status, "CUSTOMER_EXCLUDED");
    assert.equal(report.excludedCustomers.length, 1);
    assert.equal(report.excludedCommissionTotal, 20);
    assert.equal(report.indusCostFinalCommission, 0);
    assert.equal(report.indusCostCommissionBeforeExclusions, 20);
    assert.equal(report.diffCommissionBeforeExclusions, 0);
    assert.equal(report.diffCommissionFinal, -20);
  });

  it("diferença contra Nomus é explicada antes e depois das exclusões", () => {
    const lines = [
      previewLine({
        ledgerLineKey: "ok",
        commissionableBaseAmount: 800,
        releasedCommissionAmount: 16,
        grossCommissionAmount: 16,
      }),
      previewLine({
        ledgerLineKey: "ex",
        status: "CUSTOMER_EXCLUDED",
        releasedCommissionAmount: 0,
        grossCommissionAmount: 4,
        commissionableBaseAmount: 200,
        exclusionReason: "Exclusão",
      }),
    ];

    const report = buildNomusReceiptReconciliationReport({
      lines,
      nomusBase: 1000,
      nomusCommission: 20,
    });

    assert.equal(report.indusCostBaseBeforeExclusions, 1000);
    assert.equal(report.indusCostCommissionBeforeExclusions, 20);
    assert.equal(report.diffCommissionBeforeExclusions, 0);
    assert.equal(report.indusCostFinalCommission, 16);
    assert.equal(report.diffCommissionFinal, -4);
    assert.equal(report.excludedCustomers[0]?.exclusionReason, "Exclusão");
  });

  it("filtro GISLENE usa raw/canônico sem hardcode", () => {
    const preview = buildCommissionReceiptPreview({
      year: 2026,
      month: 6,
      receivables: [receivable(1, 1000)],
      ordersByNfeId: new Map([[100, orderBundle([item("A", 1000)])]]),
      rules: [],
      exclusionRules: [],
      identityCtx: OK_IDENTITY,
      itemRateOverrides: new Map([["A", 2]]),
      seller: "GISLENE",
      allowItemRecalculationFallback: true,
    });

    assert.equal(preview.lines.length, 1);
    assert.ok(sellerNameMatchesFilter(preview.lines[0]?.canonicalSellerName ?? "", "GISLENE"));
    assert.ok(sellerNameMatchesFilter(preview.lines[0]?.rawSellerName ?? "", "GISLENE"));
  });
});
