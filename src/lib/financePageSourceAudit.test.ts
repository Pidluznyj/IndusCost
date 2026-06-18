import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  extractFinanceAuditDrawerBlock,
  extractFinanceComponentJsx,
  extractFinanceMainContentExcludingAuditDrawer,
} from "./financePageSourceAudit.js";

describe("financePageSourceAudit", () => {
  it("ignora helpers locais ao extrair JSX da página AP", () => {
    const ap = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceAccountsPayablePage.tsx"),
      "utf8"
    );
    const jsx = extractFinanceComponentJsx(ap);
    assert.ok(jsx.includes("<FinanceBiDashboardShell"));
    assert.ok(jsx.includes("<FinanceExecutivePageHeader"));
    assert.equal(jsx.includes("export function FilterInput"), false);
  });

  it("separa drawer e corpo principal em AP", () => {
    const ap = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceAccountsPayablePage.tsx"),
      "utf8"
    );
    const main = extractFinanceMainContentExcludingAuditDrawer(ap);
    const drawer = extractFinanceAuditDrawerBlock(ap);
    assert.equal(main.includes("<FinanceAccountsPayableSyncPanel"), false);
    assert.ok(drawer.includes("<FinanceAccountsPayableSyncPanel"));
  });
});
