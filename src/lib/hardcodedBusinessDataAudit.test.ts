import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  assertNoNaNInSummary,
  findFrontendPrismaImports,
  getProductionRiskFindings,
  isAllowlistedProductionFile,
  isTestSourceFile,
  scanFileContentForHardcodedBusinessData,
  scanProductionSources,
  summarizeHardcodedFindings,
} from "./hardcodedBusinessDataAudit.js";

test("fixtures em .test.ts são ignoradas pelo scanner", () => {
  const fixture = `
    const MEXICHEM_CNPJ = "33.081.704/0001-00";
    const amount = 98000;
    personName: "MEXICHEM BRASIL LTDA",
  `;
  const findings = scanFileContentForHardcodedBusinessData(
    "src/lib/financeAccountsReceivableOverdue.test.ts",
    fixture
  );
  assert.equal(findings.length, 0);
});

test("isTestSourceFile reconhece .test.ts e .test.tsx", () => {
  assert.equal(isTestSourceFile("src/lib/foo.test.ts"), true);
  assert.equal(isTestSourceFile("src/components/Bar.test.tsx"), true);
  assert.equal(isTestSourceFile("src/lib/foo.ts"), false);
});

test("hardcode de cliente/CNPJ em produção é detectado como risco", () => {
  const prod = `
    if (customerName.includes("MEXICHEM")) return false;
    const total = 98000;
  `;
  const findings = scanFileContentForHardcodedBusinessData("src/lib/exampleRule.ts", prod);
  const risks = findings.filter((f) => !f.allowed && f.severity === "high");
  assert.ok(risks.some((f) => f.kind === "customer"));
  assert.ok(risks.some((f) => f.kind === "value"));
});

test("allowlist marca CNPJs do grupo como permitidos", () => {
  assert.equal(isAllowlistedProductionFile("src/lib/financeInternalGroupExclusions.ts"), true);
  const content = readFileSync(
    join(process.cwd(), "src/lib/financeInternalGroupExclusions.ts"),
    "utf8"
  );
  const findings = scanFileContentForHardcodedBusinessData(
    "src/lib/financeInternalGroupExclusions.ts",
    content
  );
  assert.ok(findings.every((f) => f.allowed));
});

test("achados de hardcode em produção são classificados", () => {
  const all = scanProductionSources();
  assert.ok(Array.isArray(all));
  for (const f of all) {
    assert.ok(["customer", "cnpj", "product", "value", "target", "mock", "fallback", "other"].includes(f.kind));
    assert.ok(["low", "medium", "high"].includes(f.severity));
    assert.equal(typeof f.allowed, "boolean");
    assert.ok(f.reason.length > 0);
  }
});

test("nenhum risco high de cliente/CNPJ/valor em produção fora da allowlist", () => {
  const risks = getProductionRiskFindings();
  const forbiddenHigh = risks.filter(
    (f) =>
      f.severity === "high" &&
      (f.kind === "customer" || f.kind === "cnpj" || f.kind === "value")
  );
  assert.equal(
    forbiddenHigh.length,
    0,
    forbiddenHigh.map((f) => `${f.file}:${f.lineHint} ${f.reason}`).join("\n")
  );
});

test("frontend não importa Prisma", () => {
  const violations = findFrontendPrismaImports();
  assert.deepEqual(violations, []);
});

test("valores financeiros fixos suspeitos em produção são detectados pelo scanner", () => {
  const sample = `export const x = 98000;`;
  const findings = scanFileContentForHardcodedBusinessData("src/lib/tempCheck.ts", sample);
  assert.ok(findings.some((f) => f.kind === "value" && !f.allowed));
});

test("relatório não usa NaN/Infinity", () => {
  const summary = summarizeHardcodedFindings(scanProductionSources());
  assert.ok(assertNoNaNInSummary([summary.total, summary.allowed, summary.risks]));
  assert.ok(assertNoNaNInSummary(Object.values(summary.byKind)));
  assert.ok(assertNoNaNInSummary(Object.values(summary.bySeverity)));
});

test("scanner roda sem acessar banco", () => {
  const findings = scanProductionSources();
  const summary = summarizeHardcodedFindings(findings);
  assert.ok(summary.total >= 0);
});

test("mock em produção é detectado", () => {
  const prod = `const mockCustomers = [{ name: "Acme" }];`;
  const findings = scanFileContentForHardcodedBusinessData("src/components/Foo.tsx", prod);
  assert.ok(findings.some((f) => f.kind === "mock"));
});
