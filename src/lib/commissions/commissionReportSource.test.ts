import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLegacyPayableMeta,
  buildReceiptClosedMeta,
  buildReceiptPreviewMeta,
  formatReportSourceCsvHeaders,
  formatReportSourceLabel,
  mergeReportWarnings,
  parseCommissionReportSourceMode,
  RECEIPT_PREVIEW_WARNING,
} from "./commissionReportSource.js";
import {
  enrichMonthlyPayableSummaryWithReportMeta,
  resolveLegacyPayableDeprecation,
} from "./commissionMonthlyPayable.js";
import type { CommissionMonthlyPayableSummary } from "./commissionMonthlyPayable.js";

function emptySummary(): CommissionMonthlyPayableSummary {
  return {
    year: 2026,
    month: 6,
    monthKey: "2026-06",
    monthLabelPt: "Junho/2026",
    payableCommissionTotal: 100,
    receivedAmountTotal: 1000,
    allocatedBaseAmountTotal: 800,
    expectedCommissionAmountTotal: 100,
    pendingCommissionAmountTotal: 0,
    uniqueReceivablesCount: 1,
    uniqueSellersCount: 1,
    averageCommissionRate: 12.5,
    receivedVsBaseDiff: 200,
    warnings: [],
    sellers: [],
    details: [],
    reportSource: "LEGACY_VISUAL_AUDIT",
    reportStatus: "LEGADO",
    reportDeprecationNotice: null,
    closingId: null,
    calculationHash: null,
  };
}

describe("commissionReportSource", () => {
  it("parseCommissionReportSourceMode aceita auto/receipt/legacy", () => {
    assert.equal(parseCommissionReportSourceMode("auto"), "auto");
    assert.equal(parseCommissionReportSourceMode("receipt"), "receipt");
    assert.equal(parseCommissionReportSourceMode("legacy"), "legacy");
    assert.throws(() => parseCommissionReportSourceMode("invalid"));
  });

  it("buildReceiptClosedMeta marca FECHADO", () => {
    const meta = buildReceiptClosedMeta({
      sourceMode: "auto",
      closingId: "c1",
      calculationHash: "hash",
    });
    assert.equal(meta.reportStatus, "FECHADO");
    assert.equal(meta.dataSource, "RECEIPT_CLOSED");
  });

  it("buildReceiptPreviewMeta marca PREVIEW com aviso", () => {
    const meta = buildReceiptPreviewMeta("auto");
    assert.equal(meta.reportStatus, "PREVIEW");
    assert.match(meta.warnings.join(" "), /Prévia não fechada/);
  });

  it("resolveLegacyPayableDeprecation adiciona aviso legado", () => {
    const summary = resolveLegacyPayableDeprecation(emptySummary(), "legacy");
    assert.equal(summary.reportStatus, "LEGADO");
    assert.match(summary.reportDeprecationNotice ?? "", /legado/);
  });

  it("enrichMonthlyPayableSummaryWithReportMeta mescla warnings", () => {
    const summary = enrichMonthlyPayableSummaryWithReportMeta(emptySummary(), buildReceiptPreviewMeta("auto"));
    assert.equal(summary.reportStatus, "PREVIEW");
    assert.ok(summary.warnings.some((w) => w.includes(RECEIPT_PREVIEW_WARNING.slice(0, 20))));
  });

  it("CSV headers incluem report_source e report_status", () => {
    const headers = formatReportSourceCsvHeaders(
      buildReceiptClosedMeta({ sourceMode: "auto", closingId: "x", calculationHash: "h" })
    );
    assert.ok(headers.some((h) => h.includes("report_source=RECEIPT_CLOSED")));
    assert.ok(headers.some((h) => h.includes("report_status=FECHADO")));
  });

  it("formatReportSourceLabel identifica preview/fechado/legado", () => {
    assert.match(
      formatReportSourceLabel(buildReceiptPreviewMeta("auto")),
      /PREVIEW/
    );
    assert.match(
      formatReportSourceLabel(buildLegacyPayableMeta("legacy")),
      /LEGADO/
    );
  });

  it("mergeReportWarnings inclui deprecation", () => {
    const merged = mergeReportWarnings(buildLegacyPayableMeta("legacy"), []);
    assert.ok(merged.some((w) => w.includes("legado")));
  });
});
