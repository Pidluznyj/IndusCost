import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
describe("financeExecutiveHeader", () => {
  it("Fluxo de Caixa usa header executivo limpo", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceCashFlowPage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("FinanceExecutivePageHeader"));
    assert.ok(page.includes("FINANCE_CASH_FLOW_EXECUTIVE_SUBTITLE"));
    assert.ok(page.includes('label: "Atualizar"'));
    assert.ok(page.includes('label: "Exportar"'));
    assert.ok(page.includes("FinanceDataAuditButton"));
    assert.equal(page.includes("filterStatus={filterStatus}"), false);
    assert.equal(page.includes("FinanceBiExecutiveHeader"), false);
  });

  it("badge Alterações pendentes permanece apenas no bloco de filtros", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceCashFlowPage.tsx"),
      "utf8"
    );
    const header = readFileSync(
      join(process.cwd(), "src/components/finance/shared/FinanceExecutivePageHeader.tsx"),
      "utf8"
    );
    assert.equal(header.includes("FinanceBiFilterStatusBadge"), false);
    assert.equal(header.includes("filterStatus"), false);
    assert.ok(page.includes("FinanceBiFilterPanel"));
    assert.ok(page.includes("filterStatus={filterStatus}"));
  });

  it("AR e AP usam o mesmo padrão de header executivo", () => {
    const ar = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceAccountsReceivablePage.tsx"),
      "utf8"
    );
    const ap = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceAccountsPayablePage.tsx"),
      "utf8"
    );
    assert.ok(ar.includes("FinanceExecutivePageHeader"));
    assert.ok(ap.includes("FinanceExecutivePageHeader"));
    assert.equal(ar.includes("FinanceFilterScopeBanner"), false);
    assert.equal(ap.includes("FinanceFilterScopeBanner"), false);
  });

  it("drawer de auditoria existe com testid e botão fechar", () => {
    const drawer = readFileSync(
      join(process.cwd(), "src/components/finance/shared/FinanceDataAuditDrawer.tsx"),
      "utf8"
    );
    assert.ok(drawer.includes('data-testid="finance-data-audit-drawer"'));
    assert.ok(drawer.includes('data-testid="finance-data-audit-button"') === false);
    assert.ok(drawer.includes("Fechar"));
  });
});
