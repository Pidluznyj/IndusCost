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

  it("AP e Faturamento usam drawer de dados e auditoria", () => {
    const ap = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceAccountsPayablePage.tsx"),
      "utf8"
    );
    const billing = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceBillingPage.tsx"),
      "utf8"
    );
    assert.ok(ap.includes("FinanceDataAuditDrawer"));
    assert.ok(ap.includes("FinanceDataAuditButton"));
    assert.ok(billing.includes("FinanceDataAuditDrawer"));
    assert.ok(billing.includes("FinanceDataAuditButton"));
  });

  it("Faturamento usa header executivo limpo sem badge técnica no topo", () => {
    const billing = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceBillingPage.tsx"),
      "utf8"
    );
    assert.ok(billing.includes("FinanceExecutivePageHeader"));
    assert.ok(billing.includes("FINANCE_BILLING_EXECUTIVE_SUBTITLE"));
    assert.equal(billing.includes("FinanceBiExecutiveHeader"), false);
    assert.equal(billing.includes("FinanceBillingSourceBadge"), false);
    assert.equal(billing.includes("filterStatus={filterStatus}"), false);
    assert.equal(billing.includes("FINANCE_SYNC_GLOBAL_SCOPE"), false);
    assert.equal(billing.includes("Sincronização NF-e Nomus"), false);
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
