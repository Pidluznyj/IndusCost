import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceAuditItemsFromChips,
  buildFinanceBillingAuditSections,
} from "./financeDataAudit.js";
import {
  extractFinanceExecutiveHeaderBlock,
  extractFinanceMainContentExcludingAuditDrawer,
  financeAuditDrawerIncludes,
} from "./financePageSourceAudit.js";

const pagePath = join(process.cwd(), "src", "components", "finance", "FinanceBillingPage.tsx");

describe("financeBillingUx", () => {
  it("header principal não exibe badge técnica de fonte NF-e", () => {
    const page = readFileSync(pagePath, "utf8");
    const header = extractFinanceExecutiveHeaderBlock(page);
    const main = extractFinanceMainContentExcludingAuditDrawer(page);

    assert.equal(header.includes("FinanceBillingSourceBadge"), false);
    assert.equal(main.includes("Comparativo: SalesOrder"), false);
    assert.equal(main.includes("Sincronização NF-e Nomus"), false);
    assert.equal(main.includes("FINANCE_SYNC_GLOBAL_SCOPE"), false);
  });

  it("header mantém título, subtítulo executivo e botões principais", () => {
    const page = readFileSync(pagePath, "utf8");
    assert.ok(page.includes("FinanceExecutivePageHeader"));
    assert.ok(page.includes('title="Faturamento"'));
    assert.ok(page.includes("FINANCE_BILLING_EXECUTIVE_SUBTITLE"));
    assert.ok(page.includes("FINANCE_HEADER_ACTION_REFRESH"));
    assert.ok(page.includes('label: "Exportar composição"'));
    assert.ok(page.includes('label: "Exportar CSV NF-e"'));
    assert.ok(page.includes("FinanceDataAuditButton"));
  });

  it("drawer contém sync NF-e, auditoria e comparativo explicado", () => {
    const page = readFileSync(pagePath, "utf8");
    assert.ok(page.includes("buildFinanceBillingAuditSections"));
    assert.ok(financeAuditDrawerIncludes(page, "FinanceBillingNfeSyncPanel"));
    assert.ok(financeAuditDrawerIncludes(page, "embedded"));
    assert.ok(financeAuditDrawerIncludes(page, "Auditar base do faturamento"));
    assert.ok(financeAuditDrawerIncludes(page, "FinanceBillingAuditPanel"));

    const sections = buildFinanceBillingAuditSections({
      generatedAt: new Date(2026, 5, 18, 13, 59).toISOString(),
      lastInvoicedAt: new Date(2026, 5, 17).toISOString(),
      periodLabel: "Jun/2026",
      appliedFilterItems: buildFinanceAuditItemsFromChips([]),
    });
    const ids = sections.map((s) => s.id);
    assert.ok(ids.includes("sources"));
    assert.ok(ids.includes("comparison"));
    assert.ok(ids.includes("sync"));
    assert.ok(ids.includes("rules"));
  });

  it("filtros permanecem no painel, não no header", () => {
    const page = readFileSync(pagePath, "utf8");
    const header = extractFinanceExecutiveHeaderBlock(page);
    assert.ok(page.includes("FinanceBiFilterPanel"));
    assert.ok(page.includes("filterStatus={filterStatus}"));
    assert.equal(header.includes("filterStatus"), false);
    assert.equal(page.includes("SalesOrder aparece apenas"), false);
  });

  it("fonte NF-e padrão preservada na query do dashboard", () => {
    const page = readFileSync(pagePath, "utf8");
    assert.ok(page.includes("FINANCE_BILLING_SOURCE_DEFAULT"));
    assert.ok(page.includes("buildFinanceBillingDashboardQuery"));
  });

  it("não renderiza grid de Detalhamento; comparativo/auditoria alimentam Centro de Ações", () => {
    const page = readFileSync(pagePath, "utf8");
    assert.equal(page.includes("Grid explicativo dos cards"), false);
    assert.equal(page.includes("FinanceBillingNfeDetailsTable"), false);
    assert.equal(page.includes("FINANCE_BILLING_EXECUTIVE_TABS"), false);
    assert.ok(page.includes("FinanceBillingActionCenter"));
    assert.match(page, /if \(comparison != null\) return;/);
    assert.match(page, /if \(audit != null\) return;/);
    assert.match(page, /void loadComparison\(\);/);
    assert.match(page, /void loadAudit\(\);/);
  });
});
