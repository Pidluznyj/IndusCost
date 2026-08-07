import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("financeAccountsPayableAnalyticalTitles UI", () => {
  it("página AP expõe abas Visão Geral e Títulos (mesma ideia da AR)", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsPayablePage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("FINANCE_AP_PAGE_VIEWS"));
    assert.ok(page.includes("FinanceApAnalyticalTitlesTab"));
    assert.ok(page.includes('pageView === "titles-analytical"'));
  });

  it("aba analítica chama endpoint titles com filtros e exportações", () => {
    const tab = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceApAnalyticalTitlesTab.tsx"),
      "utf8"
    );
    assert.ok(tab.includes("/api/finance/accounts-payable/titles?"));
    assert.ok(tab.includes("/api/finance/accounts-payable/export?"));
    assert.ok(tab.includes("buildFinanceApTitlesQuery"));
    assert.ok(tab.includes("buildFinanceApExportQuery"));
    assert.ok(tab.includes("Exportar CSV"));
    assert.ok(tab.includes("Exportar PDF"));
    assert.ok(tab.includes("Limpar filtros"));
    assert.ok(tab.includes("dueDateFrom"));
    assert.ok(tab.includes('data-testid="finance-ap-analytical-titles"'));
  });
});
