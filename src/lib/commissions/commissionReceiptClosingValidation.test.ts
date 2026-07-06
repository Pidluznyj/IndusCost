import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NOMUS_NFE_STATUS_AUTHORIZED } from "@/src/lib/nomusNfeClassification.js";
import {
  buildCommissionReceiptPreview,
  type CommissionReceiptReceivableInput,
} from "./commissionReceiptEngine.js";
import type {
  CommissionOrderItemSource,
  CommissionOrderSourceBundle,
} from "./commission-types.js";
import type { CommissionSellerIdentityContext } from "./commissionSellerIdentity.js";
import { buildReceiptClosingHashFromPreview } from "./commissionReceiptClosing.js";
import { aggregateMonthlyPayableFromRows } from "./commissionMonthlyPayable.js";
import { buildVisualAuditRow } from "./commissionVisualAudit.js";
import {
  buildBreakdownByStatus,
  buildCommissionReceiptClosingValidationReport,
  buildTopExceptions,
  buildValidationCompareLines,
  buildValidationCsv,
  diffPayableSummaries,
  summaryFromPreview,
  VALIDATION_CSV_HEADERS,
} from "./commissionReceiptClosingValidation.js";
import type { CommissionMonthlyPayableDetailLine } from "./commissionMonthlyPayable.js";
import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";

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
  settlement: string,
  total = received
): CommissionReceiptReceivableInput {
  return {
    nomusReceivableId: id,
    receivableNumber: `CR-${id}`,
    installmentNumber: 1,
    settlementDate: new Date(settlement),
    dueDate: new Date(settlement),
    amountReceivable: total,
    amountReceived: received,
    nomusNfeId: 100,
    nfeNumber: "NF-1",
    customerExternalId: 200,
    customerName: "Cliente Teste",
  };
}

function previewCtx(
  receivables: CommissionReceiptReceivableInput[],
  overrides: Partial<Parameters<typeof buildCommissionReceiptPreview>[0]> = {}
) {
  return {
    year: 2026,
    month: 6,
    receivables,
    ordersByNfeId: new Map([[100, orderBundle([item("A", 1000)])]]),
    rules: [
      {
        id: "rule-2",
        name: "2%",
        active: true,
        priority: 1,
        beneficiaryType: "SELLER" as const,
        beneficiaryPersonId: null,
        baseType: "SALES_ORDER_ITEM_NET" as const,
        releaseRule: "EACH_RECEIVABLE_PAID" as const,
        calculationType: "FIXED_PERCENT" as const,
        ratePercent: 2,
        effectiveFrom: new Date("2020-01-01"),
        effectiveTo: null,
        conditions: [],
      },
    ],
    exclusionRules: [],
    identityCtx: OK_IDENTITY,
    itemRateOverrides: new Map([["A", 2]]),
    ...overrides,
  };
}

function exclusionRule(
  partial: Partial<CustomerExclusionRuleSnapshot> & Pick<CustomerExclusionRuleSnapshot, "id">
): CustomerExclusionRuleSnapshot {
  return {
    customerId: null,
    customerExternalId: 200,
    customerNameSnapshot: "Cliente Teste",
    normalizedCustomerName: "cliente teste",
    reason: "Política comercial",
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    status: "ACTIVE",
    notes: null,
    ...partial,
  };
}

function auditInput(
  partial: Partial<Parameters<typeof buildVisualAuditRow>[0]> &
    Pick<Parameters<typeof buildVisualAuditRow>[0], "lineId" | "commissionPersonId" | "commissionPersonName">
): Parameters<typeof buildVisualAuditRow>[0] {
  return {
    recordId: partial.recordId ?? "record-1",
    scheduleId: partial.scheduleId ?? null,
    commissionPersonId: partial.commissionPersonId ?? "person-gislene",
    commissionPersonName: partial.commissionPersonName ?? "GISLENE LIMA",
    customerName: partial.customerName ?? "Cliente Teste",
    orderCode: partial.orderCode ?? "PED-1",
    nfeNumber: partial.nfeNumber ?? "NF-1",
    nomusNfeId: partial.nomusNfeId ?? 100,
    confirmedAt: partial.confirmedAt ?? "2026-06-01T00:00:00.000Z",
    documentKey: partial.documentKey ?? "person-gislene:100",
    documentBaseAmount: partial.documentBaseAmount ?? 1000,
    documentCommissionTotal: partial.documentCommissionTotal ?? 20,
    itemBaseAmount: partial.itemBaseAmount ?? 1000,
    itemCommissionAmount: partial.itemCommissionAmount ?? 20,
    productCode: partial.productCode ?? "A",
    nomusReceivableId: partial.nomusReceivableId ?? 1,
    installmentNumber: partial.installmentNumber ?? 1,
    dueDate: partial.dueDate ?? "2026-06-15T00:00:00.000Z",
    settlementDate: partial.settlementDate ?? "2026-06-15T00:00:00.000Z",
    receivableAmount: partial.receivableAmount ?? 1000,
    receivedAmount: partial.receivedAmount ?? 1000,
    openBalance: partial.openBalance ?? 0,
    allocationPercent: partial.allocationPercent ?? 100,
    commissionExpected: partial.commissionExpected ?? 20,
    commissionReleased: partial.commissionReleased ?? 20,
    hasArLink: partial.hasArLink ?? true,
    hasSchedule: partial.hasSchedule ?? false,
    customerNoCommission: partial.customerNoCommission ?? false,
    isCommissionable: partial.isCommissionable ?? true,
    exclusionReason: partial.exclusionReason ?? null,
    exclusionRuleId: partial.exclusionRuleId ?? null,
    itemRatePercent: partial.itemRatePercent ?? 2,
    ...partial,
  };
}

function legacyDetailFromAudit(
  nomusReceivableId: number,
  released: number
): CommissionMonthlyPayableDetailLine {
  const row = buildVisualAuditRow(
    auditInput({
      lineId: `legacy-${nomusReceivableId}`,
      nomusReceivableId,
      receivedAmount: 500,
      receivableAmount: 500,
      itemBaseAmount: 500,
      documentBaseAmount: 500,
      commissionExpected: released,
      commissionReleased: released,
    })
  );
  return {
    lineId: row.lineId,
    sellerId: row.commissionPersonId,
    sellerName: row.commissionPersonName,
    month: "2026-06",
    nomusReceivableId: row.nomusReceivableId,
    installmentNumber: row.installmentNumber,
    orderCode: row.orderCode,
    nfeNumber: row.nfeNumber,
    nomusNfeId: row.nomusNfeId,
    customerName: row.customerName,
    productCode: row.productCode,
    confirmedAt: null,
    dueDate: null,
    settlementDate: row.settlementDate,
    receivedAmount: row.receivedAmount,
    receivableAmount: row.receivableAmount,
    allocatedBaseAmount: row.allocatedBaseAmount,
    expectedCommissionAmount: row.commissionExpected,
    releasedCommissionAmount: row.commissionReleased,
    pendingCommissionAmount: row.commissionPending,
    itemRatePercent: row.itemRatePercent,
    alerts: row.alerts,
  };
}

describe("commissionReceiptClosingValidation", () => {
  it("parcela em junho e julho — só junho entra no recorte", () => {
    const preview = buildCommissionReceiptPreview(
      previewCtx([
        receivable(1, 500, "2026-06-15T00:00:00.000Z"),
        receivable(2, 300, "2026-07-10T00:00:00.000Z"),
      ])
    );
    assert.equal(preview.lines.length, 1);
    assert.equal(preview.lines[0]?.nomusReceivableId, 1);
  });

  it("cliente excluído zera comissão", () => {
    const preview = buildCommissionReceiptPreview(
      previewCtx([receivable(1, 1000, "2026-06-10T00:00:00.000Z")], {
        exclusionRules: [exclusionRule({ id: "ex-1", reason: "Exclusão teste" })],
      })
    );
    assert.equal(preview.lines[0]?.status, "CUSTOMER_EXCLUDED");
    assert.equal(preview.lines[0]?.releasedCommissionAmount, 0);
    assert.ok(buildTopExceptions(preview.lines).length >= 1);
  });

  it("sem vínculo NF gera NO_SALES_LINK", () => {
    const preview = buildCommissionReceiptPreview({
      ...previewCtx([receivable(1, 1000, "2026-06-10T00:00:00.000Z")]),
      ordersByNfeId: new Map(),
    });
    assert.equal(preview.lines[0]?.status, "NO_SALES_LINK");
  });

  it("vendedor alias resolve canônico GISLENE", () => {
    const preview = buildCommissionReceiptPreview(
      previewCtx([receivable(1, 1000, "2026-06-10T00:00:00.000Z")], {
        seller: "GISLENE",
      })
    );
    assert.equal(preview.lines[0]?.canonicalSellerName, "GISLENE LIMA");
    const filtered = buildCommissionReceiptPreview(
      previewCtx([receivable(1, 1000, "2026-06-10T00:00:00.000Z")], {
        seller: "INEXISTENTE",
      })
    );
    assert.equal(filtered.lines.length, 0);
  });

  it("baixa parcial libera comissão proporcional", () => {
    const preview = buildCommissionReceiptPreview(
      previewCtx([receivable(1, 250, "2026-06-10T00:00:00.000Z", 1000)])
    );
    const line = preview.lines[0];
    assert.ok(line);
    assert.equal(line.receivedAmount, 250);
    assert.ok(line.releasedCommissionAmount > 0);
    assert.equal(line.commissionableBaseAmount, 250);
    assert.equal(line.releasedCommissionAmount, 5);
    assert.equal(line.expectedCommissionAmount, line.releasedCommissionAmount);
  });

  it("sem regra gera NO_RULE", () => {
    const preview = buildCommissionReceiptPreview({
      ...previewCtx([receivable(1, 1000, "2026-06-10T00:00:00.000Z")]),
      rules: [],
      itemRateOverrides: new Map(),
    });
    assert.equal(preview.lines[0]?.status, "NO_RULE");
  });

  it("relatório compara novo x legado e Nomus", () => {
    const preview = buildCommissionReceiptPreview(
      previewCtx([receivable(1, 1000, "2026-06-10T00:00:00.000Z")])
    );
    const hash = buildReceiptClosingHashFromPreview(preview);
    const legacyRows = [
      buildVisualAuditRow(
        auditInput({
          lineId: "l1",
          settlementDate: "2026-06-10T00:00:00.000Z",
          commissionExpected: 15,
          commissionReleased: 10,
        })
      ),
    ];
    const legacySummary = aggregateMonthlyPayableFromRows(legacyRows, { year: 2026, month: 6 });

    const report = buildCommissionReceiptClosingValidationReport({
      year: 2026,
      month: 6,
      seller: null,
      customer: null,
      preview,
      calculationHash: hash,
      legacySummary,
      closedLedger: null,
      nomusBase: 808107.32,
      nomusCommission: 20926.56,
      includeLines: true,
    });

    assert.equal(report.previewOnly, true);
    assert.ok(report.diffNewVsLegacy);
    assert.ok(report.nomusComparison);
    assert.ok(report.breakdownByStatus.length > 0);
    assert.ok(report.lines && report.lines.length > 0);

    const diff = diffPayableSummaries(summaryFromPreview(preview, hash), report.summaryLegacy!);
    assert.notEqual(diff.releasedCommissionDiff, 0);

    const csv = buildValidationCsv(report.lines!, report);
    for (const col of VALIDATION_CSV_HEADERS) {
      assert.match(csv, new RegExp(col));
    }
  });

  it("buildValidationCompareLines destaca diferença por linha", () => {
    const preview = buildCommissionReceiptPreview(
      previewCtx([receivable(1, 1000, "2026-06-10T00:00:00.000Z")])
    );
    const lines = buildValidationCompareLines({
      year: 2026,
      month: 6,
      previewLines: preview.lines,
      legacyDetails: [legacyDetailFromAudit(1, 5)],
      calculationHash: "hash-test",
      nomusReference: null,
    });
    assert.equal(lines.length, 1);
    assert.notEqual(lines[0]?.differenceAmount, 0);
  });

  it("buildBreakdownByStatus agrega exceções", () => {
    const preview = buildCommissionReceiptPreview({
      ...previewCtx([receivable(1, 1000, "2026-06-10T00:00:00.000Z")]),
      ordersByNfeId: new Map(),
    });
    const rows = buildBreakdownByStatus(preview.lines);
    assert.ok(rows.some((r) => r.status === "NO_SALES_LINK"));
  });
});
