import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import type { DiagnosticFinding } from "./chatgptDiagnosticTypes.js";
import { resolveDiagnosticBundleOutputPaths } from "./diagnosticBundleBuilder.server.js";
import {
  assertChatGptDiagnosticReportBundleValid,
  buildChatGptDiagnosticReportSummary,
  formatChatGptDiagnosticReportHumanSummary,
  generateChatGptDiagnosticReport,
  parseChatGptDiagnosticReportCliArgs,
  resolveDiagnosticReportStatus,
  scopeRequiresDatabase,
} from "./generateChatGptDiagnosticReport.server.js";
import { redactionMask } from "./sanitizeDiagnosticPayload.server.js";

function sampleFinding(severity: DiagnosticFinding["severity"]): DiagnosticFinding {
  return {
    id: "f1",
    severity,
    code: "TEST",
    title: "Test",
    message: "msg",
    businessImpact: "—",
    technicalImpact: "—",
    evidenceRefs: [],
    sourceRefs: [],
    suggestedNextSteps: [],
  };
}

describe("generateChatGptDiagnosticReport", () => {
  it("parseia args SYSTEM e flags opcionais", () => {
    const args = parseChatGptDiagnosticReportCliArgs([
      "--scope=SYSTEM",
      "--json-summary",
      "--include-logs=false",
      "--include-api-trace=false",
    ]);
    assert.equal(args.scope, "SYSTEM");
    assert.equal(args.jsonSummary, true);
    assert.equal(args.includeLogs, false);
    assert.equal(args.includeApiTrace, false);
  });

  it("parseia COST_TO_CASH com sku e período", () => {
    const args = parseChatGptDiagnosticReportCliArgs([
      "--scope=COST_TO_CASH",
      "--sku=618.08AA",
      "--year=2026",
      "--month=6",
    ]);
    assert.equal(args.sku, "618.08AA");
    assert.equal(args.year, 2026);
    assert.equal(args.month, 6);
  });

  it("rejeita escopo inválido", () => {
    assert.throws(
      () => parseChatGptDiagnosticReportCliArgs(["--scope=INVALID"]),
      /Escopo inválido/
    );
  });

  it("resolveDiagnosticReportStatus PASS/WARNING/ERROR", () => {
    assert.equal(resolveDiagnosticReportStatus([sampleFinding("info")]), "PASS");
    assert.equal(resolveDiagnosticReportStatus([sampleFinding("warning")]), "WARNING");
    assert.equal(resolveDiagnosticReportStatus([sampleFinding("error")]), "ERROR");
    assert.equal(resolveDiagnosticReportStatus([sampleFinding("critical")]), "ERROR");
  });

  it("output-dir deve ficar em tmp/", () => {
    assert.throws(
      () => resolveDiagnosticBundleOutputPaths("SYSTEM", "2026-07-06T00:00:00.000Z", "dist/out"),
      /tmp\//
    );
    const paths = resolveDiagnosticBundleOutputPaths(
      "SYSTEM",
      "2026-07-06T00:00:00.000Z",
      "tmp/diagnostic-bundles/cli-test-run"
    );
    assert.equal(paths.outputDir, "tmp/diagnostic-bundles/cli-test-run");
    assert.equal(paths.zipPath, "tmp/diagnostic-bundles/cli-test-run.zip");
  });

  it("scopeRequiresDatabase identifica escopos com Prisma", () => {
    assert.equal(scopeRequiresDatabase("SYSTEM"), false);
    assert.equal(scopeRequiresDatabase("PRODUCT_ENGINEERING"), true);
    assert.equal(scopeRequiresDatabase("COST_TO_CASH"), true);
  });

  it("gera SYSTEM — ZIP válido, JSON parseável, sanitizado, git limpo", async () => {
    const args = parseChatGptDiagnosticReportCliArgs(["--scope=SYSTEM"]);
    const report = await generateChatGptDiagnosticReport(null, args);

    assertChatGptDiagnosticReportBundleValid(report.result);
    assert.match(report.summary.zipPath.replace(/\\/g, "/"), /^tmp\/diagnostic-bundles\//);
    assert.ok(report.summary.fileCount > 0);
    assert.ok(report.summary.findingCount >= 1);
    assert.equal(report.summary.readOnly, true);
    assert.equal(typeof report.summary.gitWorkingTreeClean, "boolean");

    const logs = report.result.bundle.entries["12_LOGS_SANITIZED.log"] ?? "";
    assert.doesNotMatch(logs, /postgresql:\/\//);

    const snapshot = JSON.parse(report.result.bundle.entries["06_SYSTEM_SNAPSHOT.json"]);
    const snapshotStr = JSON.stringify(snapshot);
    if (process.env.DATABASE_URL) {
      assert.doesNotMatch(snapshotStr, new RegExp(process.env.DATABASE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(snapshotStr, /postgresql:\/\/[^"]+:[^"]+@/);

    const redaction = JSON.parse(report.result.bundle.entries["15_REDACTION_REPORT.json"]);
    assert.equal(report.summary.redactedFieldsCount, redaction.redactedFieldsCount);
    assert.ok(report.summary.filesSanitizedCount >= 1);

    for (const path of Object.keys(report.result.bundle.entries)) {
      if (!path.endsWith(".json")) continue;
      assert.doesNotThrow(() => JSON.parse(report.result.bundle.entries[path]), path);
    }

    assert.ok(existsSync(report.summary.zipPath));

    const human = formatChatGptDiagnosticReportHumanSummary(report.summary);
    assert.match(human, /ZIP:/);
    assert.match(human, /Status:/);

    const summaryAgain = buildChatGptDiagnosticReportSummary(args, report.result);
    assert.equal(summaryAgain.bundleId, report.summary.bundleId);
  });

  it("ZIP SYSTEM gerado passa validateChatGptDiagnosticZip", async () => {
    const { validateChatGptDiagnosticZip } = await import(
      "../../../scripts/validate-chatgpt-diagnostic-zip.ts"
    );
    const args = parseChatGptDiagnosticReportCliArgs(["--scope=SYSTEM"]);
    const report = await generateChatGptDiagnosticReport(null, args);
    const validation = await validateChatGptDiagnosticZip(report.summary.zipPath);
    assert.equal(validation.ok, true, validation.errors.join("; "));
    assert.equal(validation.missingRequired.length, 0);
    assert.equal(validation.findingsValid, true);
    assert.equal(validation.redactionReportPresent, true);
    assert.ok(validation.sizeBytes < 25 * 1024 * 1024);
    assert.ok(validation.executiveSummarySections.length >= 3);
  });

  it("PRODUCT_ENGINEERING exige sku ou product-id", async () => {
    await assert.rejects(
      () =>
        generateChatGptDiagnosticReport({} as never, {
          ...parseChatGptDiagnosticReportCliArgs(["--scope=PRODUCT_ENGINEERING"]),
          includeLogs: true,
          includeApiTrace: true,
          jsonSummary: false,
        }),
      /sku ou --product-id/
    );
  });

  it("COMMISSION_RECEIPT_CLOSING exige year e month", async () => {
    await assert.rejects(
      () =>
        generateChatGptDiagnosticReport({} as never, {
          scope: "COMMISSION_RECEIPT_CLOSING",
          includeLogs: true,
          includeApiTrace: true,
          jsonSummary: false,
        }),
      /year e --month/
    );
  });

  it("sanitização mascara segredos conhecidos", () => {
    assert.equal(redactionMask("DATABASE_URL"), "[REDACTED:DATABASE_URL]");
  });
});

describe("generateChatGptDiagnosticReport CLI script", () => {
  it("script existe e referencia generateChatGptDiagnosticReport", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("scripts/generate-chatgpt-diagnostic-report.ts", "utf8");
    assert.match(src, /generateChatGptDiagnosticReport/);
    assert.match(src, /read-only/i);
    assert.doesNotMatch(src, /apply-commission-receipt-closing/);
  });
});
