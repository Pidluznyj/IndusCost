import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FINANCE_SECTION_PATHS,
  getFinanceSectionPath,
  isFinanceCanonicalPath,
} from "./financeNavigation.js";

describe("financeExecutiveReportNavigation", () => {
  it("expõe rota canônica /finance/executive-report", () => {
    assert.equal(getFinanceSectionPath("executive-report"), "/finance/executive-report");
    assert.equal(FINANCE_SECTION_PATHS["executive-report"], "/finance/executive-report");
    assert.equal(isFinanceCanonicalPath("/finance/executive-report"), true);
  });

  it("FinanceModule registra aba e rota do Relatório Presidencial", () => {
    const mod = readFileSync(join(process.cwd(), "src", "components", "FinanceModule.tsx"), "utf8");
    const nav = readFileSync(join(process.cwd(), "src", "lib", "financeNavigation.ts"), "utf8");
    assert.ok(nav.includes('"executive-report"'));
    assert.ok(nav.includes("Relatório Presidencial"));
    assert.ok(mod.includes("FinanceExecutiveReportPage"));
    assert.ok(mod.includes('path="executive-report"'));
    assert.ok(mod.includes("finance-executive-report-link"));
  });

  it("FinanceExecutiveReportPage consome endpoint consolidado", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceExecutiveReportPage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("getFinanceExecutiveReportApiPath"));
    assert.ok(page.includes("fetchJsonOk<FinanceExecutiveReport>"));
    assert.ok(!page.includes("/api/finance/accounts-receivable"));
    assert.ok(!page.includes("/api/finance/accounts-payable"));
  });
});
