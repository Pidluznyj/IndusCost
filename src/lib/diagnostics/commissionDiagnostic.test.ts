import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ReceiptClosingApiLine, ReceiptClosingPagePayload } from "../commissions/commissionReceiptClosingApi.js";
import {
  markReceivableReceivedAnchors,
} from "../commissions/commissionReceiptClosingApi.js";
import {
  REQUIRED_BUNDLE_ROOT_FILES,
  type DiagnosticFinding,
} from "./chatgptDiagnosticTypes.js";
import {
  assertRequiredBundleStructure,
  buildChatGptDiagnosticBundle,
} from "./diagnosticBundleBuilder.server.js";
import {
  buildCommissionBusinessRulesMarkdown,
  buildCommissionCalculationTrace,
  buildCommissionDatabaseEvidence,
  buildCommissionExecutiveSummaryMarkdown,
  buildCommissionFindings,
  classifyCommissionPreviewError,
  diagnoseKnownPrismaSelectError,
  evaluateCommissionAutoDiagnostics,
  parseCommissionReceiptClosingDiagnosticRequest,
  sumUniqueReceivedFromLines,
  type CommissionPreviewCapture,
} from "./commissionDiagnostic.server.js";
import { sanitizeDiagnosticLogLines } from "./sanitizeDiagnosticPayload.server.js";

function apiLine(
  partial: Partial<ReceiptClosingApiLine> & Pick<ReceiptClosingApiLine, "lineKey">
): ReceiptClosingApiLine {
  return {
    lineKey: partial.lineKey,
    nomusReceivableId: partial.nomusReceivableId ?? 100,
    receivableNumber: partial.receivableNumber ?? "CR-100",
    installmentNumber: partial.installmentNumber ?? 1,
    settlementDate: partial.settlementDate ?? "2026-06-15T00:00:00.000Z",
    dueDate: partial.dueDate ?? "2026-06-10T00:00:00.000Z",
    customerId: partial.customerId ?? "cust-1",
    customerExternalId: partial.customerExternalId ?? 10,
    customerName: partial.customerName ?? "Cliente",
    orderCode: partial.orderCode ?? "PED-1",
    localOrderId: partial.localOrderId ?? "order-1",
    nomusNfeId: partial.nomusNfeId ?? 200,
    nfeNumber: partial.nfeNumber ?? "123",
    localItemId: partial.localItemId ?? "item-1",
    nomusOrderItemId: partial.nomusOrderItemId ?? 1,
    productCode: partial.productCode ?? "618.08AA",
    productName: partial.productName ?? "Produto",
    rawSellerId: partial.rawSellerId ?? 464,
    rawSellerName: partial.rawSellerName ?? "GISLENE",
    canonicalSellerId: partial.canonicalSellerId ?? "seller-1",
    canonicalSellerName: partial.canonicalSellerName ?? "GISLENE LIMA",
    sellerResolutionStatus: partial.sellerResolutionStatus ?? "OK_CANONICAL",
    receivedAmount: partial.receivedAmount ?? 1000,
    uniqueReceivedAmount: partial.uniqueReceivedAmount ?? partial.receivedAmount ?? 1000,
    commissionableBaseAmount: partial.commissionableBaseAmount ?? 1000,
    ratePercent: partial.ratePercent ?? 2,
    expectedCommissionAmount: partial.expectedCommissionAmount ?? 20,
    releasedCommissionAmount: partial.releasedCommissionAmount ?? 20,
    grossCommissionAmount: partial.grossCommissionAmount ?? 20,
    scheduledCommissionAmount: partial.scheduledCommissionAmount ?? 20,
    commissionReceivableScheduleId: partial.commissionReceivableScheduleId ?? "sched-1",
    ruleId: partial.ruleId ?? "rule-1",
    ruleName: partial.ruleName ?? "2%",
    exclusionReason: partial.exclusionReason ?? null,
    status: partial.status ?? "COMMISSIONABLE",
    statusReason: partial.statusReason ?? null,
    source: partial.source ?? "MATERIALIZED_SCHEDULE",
  };
}

function samplePreviewJune2026(): ReceiptClosingPagePayload {
  const lines = [
    apiLine({ lineKey: "l1", nomusReceivableId: 100, receivedAmount: 5000 }),
    apiLine({
      lineKey: "l2",
      nomusReceivableId: 100,
      productCode: "618.08AA",
      receivedAmount: 5000,
      uniqueReceivedAmount: 5000,
    }),
    apiLine({
      lineKey: "l3",
      nomusReceivableId: 101,
      status: "NO_SCHEDULE",
      commissionReceivableScheduleId: null,
      source: "UNMATERIALIZED",
      releasedCommissionAmount: 0,
      expectedCommissionAmount: 0,
    }),
    apiLine({
      lineKey: "l4",
      nomusReceivableId: 102,
      status: "CUSTOMER_EXCLUDED",
      releasedCommissionAmount: 0,
      grossCommissionAmount: 15,
      exclusionReason: "Política Esmaltec",
    }),
  ];
  return {
    year: 2026,
    month: 6,
    mode: "PREVIEW",
    exportMode: "PREVIEW",
    closing: null,
    canApply: true,
    applyBlockedReason: null,
    criticalDivergence: false,
    criticalDivergenceReason: null,
    requiresCriticalConfirmation: false,
    cards: {
      totalReceivedAmount: 10000,
      receivedWithScheduleAmount: 5000,
      receivedExcludedCustomerAmount: 1000,
      receivedWithoutScheduleAmount: 1000,
      commissionableBaseAmount: 5000,
      grossCommissionAmount: 40,
      excludedCommissionAmount: 15,
      finalCommissionAmount: 20,
      nomusCommissionDiff: null,
      nomusDiffExplanation: null,
      reportStatus: "PREVIEW",
    },
    materializationSummary: {
      totalReceivablesCount: 3,
      receivablesWithScheduleCount: 1,
      receivablesWithoutScheduleCount: 1,
      excludedCustomerCount: 1,
      sellerUnresolvedCount: 0,
      staleScheduleCount: 0,
      totalReceivedAmount: 10000,
      totalExpectedCommission: 20,
      totalReleasedCommission: 20,
      pendingMaterialization: true,
      pendingMaterializationMessage: "Existem títulos sem schedule",
      rebuildScriptHint: null,
    },
    reconciliation: {
      nomusBase: null,
      nomusCommission: null,
      diffCommissionFinal: null,
      diffCommissionBeforeExclusions: null,
      diffExplanation: null,
      excludedCustomerCount: 1,
      receivablesWithoutScheduleCount: 1,
      staleScheduleCount: 0,
      divergentReceivableCount: 1,
      duplicateReceivedCount: 1,
      comparable: false,
    },
    summary: {
      totalReceivables: 3,
      totalReceivedAmount: 10000,
      totalCommissionableBase: 5000,
      totalExpectedCommission: 20,
      totalReleasedCommission: 20,
      totalExcludedAmount: 15,
      totalExceptionAmount: 0,
      countByStatus: { COMMISSIONABLE: 2, NO_SCHEDULE: 1, CUSTOMER_EXCLUDED: 1 },
    },
    bySeller: [],
    lines,
  };
}

function okCapture(preview: ReceiptClosingPagePayload): CommissionPreviewCapture {
  return {
    ok: true,
    preview,
    error: null,
    apiTrace: {
      method: "GET",
      path: "/api/commissions/receipt-closing/preview",
      query: { year: 2026, month: 6 },
      status: 200,
      durationMs: 120,
      errorMessage: null,
    },
    generatedAt: "2026-07-06T12:00:00.000Z",
  };
}

function errorCapture(message: string, classification: string): CommissionPreviewCapture {
  return {
    ok: false,
    preview: null,
    error: {
      name: "PrismaClientValidationError",
      message,
      classification,
      sanitized: { message, name: "PrismaClientValidationError" },
    },
    apiTrace: {
      method: "GET",
      path: "/api/commissions/receipt-closing/preview",
      query: { year: 2026, month: 6 },
      status: 500,
      durationMs: 50,
      errorMessage: message,
    },
    generatedAt: "2026-07-06T12:00:00.000Z",
  };
}

describe("commissionDiagnostic", () => {
  it("parseia request COMMISSION_RECEIPT_CLOSING", () => {
    const parsed = parseCommissionReceiptClosingDiagnosticRequest({
      scope: "COMMISSION_RECEIPT_CLOSING",
      context: { year: 2026, month: 6, seller: "GISLENE" },
    });
    assert.equal(parsed.context.year, 2026);
    assert.equal(parsed.context.month, 6);
    assert.equal(parsed.context.seller, "GISLENE");
  });

  it("classifica Unknown field exclusionRuleId como UNKNOWN_FIELD_IN_SELECT", () => {
    const msg =
      'Unknown field `exclusionRuleId` for select statement on model `CommissionOrderItemSnapshot`.';
    const classified = classifyCommissionPreviewError(new Error(msg));
    assert.equal(classified.code, "UNKNOWN_FIELD_IN_SELECT");
    assert.ok(diagnoseKnownPrismaSelectError(msg));
  });

  it("jun/2026 — PREVIEW_OK e NO_SCHEDULE não são erro fatal", () => {
    const preview = samplePreviewJune2026();
    const capture = okCapture(preview);
    const diagnostics = evaluateCommissionAutoDiagnostics({ capture, preview });
    assert.ok(diagnostics.some((d) => d.code === "PREVIEW_OK"));
    assert.ok(diagnostics.some((d) => d.code === "NO_SCHEDULE"));
    assert.ok(diagnostics.some((d) => d.code === "CUSTOMER_EXCLUDED"));
    assert.equal(diagnostics.find((d) => d.code === "API_500_ERROR"), undefined);
  });

  it("captura erro 500/Prisma no bundle sem quebrar geração", () => {
    const capture = errorCapture(
      "Unknown field `exclusionRuleId` for select statement on model `CommissionOrderItemSnapshot`.",
      "UNKNOWN_FIELD_IN_SELECT"
    );
    const diagnostics = evaluateCommissionAutoDiagnostics({ capture, preview: null });
    assert.ok(diagnostics.some((d) => d.code === "UNKNOWN_FIELD_IN_SELECT"));
    const findings = buildCommissionFindings(diagnostics, capture);
    assert.ok(findings.length >= 1);
    assert.ok(findings[0]?.sourceRefs.length >= 1);
  });

  it("recebido único não duplica por item", () => {
    const preview = samplePreviewJune2026();
    const anchored = markReceivableReceivedAnchors(preview.lines);
    const duplicateLines = anchored.filter((l) => l.nomusReceivableId === 100);
    assert.equal(duplicateLines.length, 2);
    const uniqueSum = sumUniqueReceivedFromLines(preview.lines);
    assert.equal(uniqueSum, 7000);
    assert.notEqual(
      duplicateLines.reduce((s, l) => s + l.receivedAmount, 0),
      uniqueSum
    );
  });

  it("executive summary responde 8 perguntas", () => {
    const preview = samplePreviewJune2026();
    const capture = okCapture(preview);
    const diagnostics = evaluateCommissionAutoDiagnostics({ capture, preview });
    const md = buildCommissionExecutiveSummaryMarkdown({
      context: { year: 2026, month: 6 },
      capture,
      preview,
      autoDiagnostics: diagnostics,
    });
    assert.match(md, /## 1\. A prévia quebrou ou rodou/);
    assert.match(md, /## 4\. Quanto foi recebido único/);
    assert.match(md, /uniqueReceivedAmount/);
  });

  it("logs sanitizados não contêm segredos", () => {
    const logs = sanitizeDiagnosticLogLines([
      "DATABASE_URL=postgresql://user:pass@host/db",
      "Authorization: Bearer secret",
      "[commission-closing] previewOk=false",
    ]);
    assert.doesNotMatch(logs, /Bearer /);
    assert.doesNotMatch(logs, /postgresql:\/\//);
    assert.match(logs, /previewOk=false/);
  });

  it("monta bundle COMMISSION_RECEIPT_CLOSING com sourceRefs", () => {
    const preview = samplePreviewJune2026();
    const capture = okCapture(preview);
    const diagnostics = evaluateCommissionAutoDiagnostics({ capture, preview });
    const bundle = buildChatGptDiagnosticBundle({
      scope: "COMMISSION_RECEIPT_CLOSING",
      context: {
        scope: "COMMISSION_RECEIPT_CLOSING",
        filters: { year: 2026, month: 6 },
        apiCalls: [capture.apiTrace],
      },
      findings: buildCommissionFindings(diagnostics, capture),
      executiveSummaryMarkdown: buildCommissionExecutiveSummaryMarkdown({
        context: { year: 2026, month: 6 },
        capture,
        preview,
        autoDiagnostics: diagnostics,
      }),
      businessRulesMarkdown: buildCommissionBusinessRulesMarkdown(preview),
      databaseEvidence: buildCommissionDatabaseEvidence(capture, preview),
      calculationTrace: buildCommissionCalculationTrace(preview, capture),
      logs: ["[commission-closing] previewOk=true"],
      evidence: [
        {
          id: "evidence_commission_trace",
          scope: "COMMISSION_RECEIPT_CLOSING",
          label: "Commission trace",
          bundlePath: "evidence/commission-trace.json",
          payload: { preview: { year: 2026, month: 6 } },
        },
      ],
      rawLimitedEvidence: { year: 2026, month: 6 },
    });

    assertRequiredBundleStructure(bundle);
    const findings = JSON.parse(bundle.entries["04_DIAGNOSTICS.json"]) as {
      findings: DiagnosticFinding[];
    };
    assert.ok(findings.findings.length >= 1);
    assert.ok(findings.findings[0]?.sourceRefs.length >= 1);

    const apiTrace = JSON.parse(bundle.entries["08_API_TRACE.json"]);
    assert.ok(apiTrace.calls?.length >= 1);

    const combined = Object.values(bundle.entries).join("\n");
    assert.doesNotMatch(combined, /Bearer /);
    assert.doesNotMatch(combined, /DATABASE_URL=/);

    assert.ok(bundle.entries["evidence/raw-limited/commission-receipt-closing-summary.json"]);
  });

  it("rotas suportam COMMISSION_RECEIPT_CLOSING", () => {
    const src = readFileSync("src/lib/diagnostics/diagnosticBundleRoutes.server.ts", "utf8");
    assert.match(src, /COMMISSION_RECEIPT_CLOSING/);
    assert.match(src, /parseCommissionReceiptClosingDiagnosticRequest/);
  });
});
