import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("financeAccountsReceivableAnalyticalTitles UI", () => {
  it("página AR expõe abas Visão Geral e Títulos", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsReceivablePage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("FINANCE_AR_PAGE_VIEWS"));
    assert.ok(page.includes("FinanceArAnalyticalTitlesTab"));
    assert.ok(page.includes('pageView === "titles-analytical"'));
  });

  it("aba analítica chama endpoint titles com filtros e exportações", () => {
    const tab = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceArAnalyticalTitlesTab.tsx"),
      "utf8"
    );
    assert.ok(tab.includes("/api/finance/accounts-receivable/titles?"));
    assert.ok(tab.includes("/api/finance/accounts-receivable/titles/export.xlsx"));
    assert.ok(tab.includes("buildFinanceArAnalyticalTitlesQuery"));
    assert.ok(tab.includes("Exportar Excel"));
    assert.ok(tab.includes("Exportar PDF"));
    assert.ok(tab.includes("Limpar filtros"));
    assert.ok(tab.includes("issueDateFrom"));
    assert.ok(tab.includes("dueDateFrom"));
    assert.ok(tab.includes("data-testid=\"finance-ar-analytical-titles\""));
  });

  it("rotas expõem export.xlsx de títulos", () => {
    const routes = readFileSync(
      join(process.cwd(), "src", "lib", "financeAccountsReceivableRoutes.ts"),
      "utf8"
    );
    assert.ok(routes.includes("/api/finance/accounts-receivable/titles/export.xlsx"));
  });
});
