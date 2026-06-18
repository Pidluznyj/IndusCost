import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  extractFinanceExecutiveHeaderBlock,
  extractFinanceMainContentExcludingAuditDrawer,
  financeAuditDrawerIncludes,
  financeExecutiveHeaderIncludes,
  financeMainContentIncludes,
} from "./financePageSourceAudit.js";

function readFinancePage(name: string): string {
  return readFileSync(join(process.cwd(), "src/components/finance", name), "utf8");
}

describe("financeExecutiveHeader", () => {
  it("Fluxo de Caixa usa header executivo limpo", () => {
    const page = readFinancePage("FinanceCashFlowPage.tsx");
    const header = extractFinanceExecutiveHeaderBlock(page);
    assert.ok(header.includes("<FinanceExecutivePageHeader"));
    assert.ok(page.includes("FINANCE_CASH_FLOW_EXECUTIVE_SUBTITLE"));
    assert.ok(page.includes('label: "Atualizar"'));
    assert.ok(page.includes('label: "Exportar"'));
    assert.ok(page.includes("FinanceDataAuditButton"));
    assert.equal(financeExecutiveHeaderIncludes(page, "filterStatus"), false);
    assert.equal(header.includes("FinanceBiExecutiveHeader"), false);
    assert.equal(financeMainContentIncludes(page, "FinanceBiExecutiveHeader"), false);
  });

  it("badge Alterações pendentes permanece apenas no bloco de filtros", () => {
    const page = readFinancePage("FinanceCashFlowPage.tsx");
    const headerComponent = readFileSync(
      join(process.cwd(), "src/components/finance/shared/FinanceExecutivePageHeader.tsx"),
      "utf8"
    );
    assert.equal(headerComponent.includes("FinanceBiFilterStatusBadge"), false);
    assert.equal(headerComponent.includes("filterStatus"), false);
    assert.equal(financeExecutiveHeaderIncludes(page, "filterStatus"), false);
    assert.ok(page.includes("FinanceBiFilterPanel"));
    assert.ok(page.includes("filterStatus={filterStatus}"));
  });

  it("AR e AP usam o mesmo padrão de header executivo", () => {
    const ar = readFinancePage("FinanceAccountsReceivablePage.tsx");
    const ap = readFinancePage("FinanceAccountsPayablePage.tsx");
    assert.ok(ar.includes("FinanceExecutivePageHeader"));
    assert.ok(ap.includes("FinanceExecutivePageHeader"));
    assert.equal(financeMainContentIncludes(ar, "<FinanceFilterScopeBanner"), false);
    assert.equal(financeMainContentIncludes(ap, "<FinanceFilterScopeBanner"), false);
  });

  it("AP e Faturamento usam drawer de dados e auditoria", () => {
    const ap = readFinancePage("FinanceAccountsPayablePage.tsx");
    const billing = readFinancePage("FinanceBillingPage.tsx");
    assert.ok(ap.includes("FinanceDataAuditDrawer"));
    assert.ok(ap.includes("FinanceDataAuditButton"));
    assert.ok(billing.includes("FinanceDataAuditDrawer"));
    assert.ok(billing.includes("FinanceDataAuditButton"));
  });

  it("Faturamento usa header executivo limpo sem badge técnica no topo", () => {
    const billing = readFinancePage("FinanceBillingPage.tsx");
    const header = extractFinanceExecutiveHeaderBlock(billing);
    const main = extractFinanceMainContentExcludingAuditDrawer(billing);

    assert.ok(header.length > 0);
    assert.ok(billing.includes("FINANCE_BILLING_EXECUTIVE_SUBTITLE"));
    assert.equal(header.includes("FinanceBiExecutiveHeader"), false);
    assert.equal(header.includes("FinanceBillingSourceBadge"), false);
    assert.equal(financeExecutiveHeaderIncludes(billing, "filterStatus"), false);
    assert.equal(main.includes("FINANCE_SYNC_GLOBAL_SCOPE"), false);
    assert.equal(main.includes("Sincronização NF-e Nomus"), false);
    assert.equal(main.includes("Auditar base do faturamento"), false);
    assert.ok(financeAuditDrawerIncludes(billing, "FinanceBillingNfeSyncPanel"));
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
