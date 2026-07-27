import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FINANCE_SECTION_PATHS,
  FINANCE_SECTIONS,
  getFinanceSectionPath,
  isFinanceCanonicalPath,
} from "./financeNavigation.js";

describe("financeBillingPageFilters", () => {
  it("rota /finance/billing é canônica e absoluta", () => {
    assert.equal(getFinanceSectionPath("billing"), "/finance/billing");
    assert.equal(isFinanceCanonicalPath("/finance/billing"), true);
    assert.ok(FINANCE_SECTION_PATHS.billing.startsWith("/finance/"));
  });

  it("aba Faturamento aparece na navegação Financeiro", () => {
    const sections = FINANCE_SECTIONS.map((s) => s.id);
    assert.ok(sections.includes("billing"));
    const billing = FINANCE_SECTIONS.find((s) => s.id === "billing");
    assert.equal(billing?.label, "Faturamento");
    assert.equal(billing?.path, "/finance/billing");
  });

  it("FinanceBillingPage possui Aplicar e Limpar filtros", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceBillingPage.tsx"),
      "utf8"
    );
    const filterPanel = readFileSync(
      join(process.cwd(), "src", "components", "finance", "bi", "FinanceBiFilterPanel.tsx"),
      "utf8"
    );
    const mod = readFileSync(join(process.cwd(), "src", "components", "FinanceModule.tsx"), "utf8");
    assert.ok(filterPanel.includes("Aplicar filtros"));
    assert.ok(filterPanel.includes("Limpar"));
    assert.ok(page.includes("FinanceBiFilterPanel"));
    assert.ok(page.includes("draftYear"));
    assert.ok(page.includes("appliedYear"));
    assert.ok(page.includes("FINANCE_BILLING_ANALYSIS_TABS"));
    assert.ok(page.includes("FinanceDetailTabs"));
    assert.ok(page.includes("FinanceBillingActionCenter"));
    assert.ok(page.includes("FinanceBillingOverviewView"));
    assert.ok(page.includes("FinanceBillingAccumulatedView"));
    assert.ok(page.includes("FinanceBillingMonthlyView"));
    assert.ok(page.includes("FinanceBillingProjectionView"));
    assert.ok(page.includes("FinanceBillingCustomersTab"));
    assert.equal(page.includes("FinanceBillingNfeDetailsTable"), false);
    assert.equal(page.includes("Grid explicativo dos cards"), false);
    const views = readFileSync(
      join(process.cwd(), "src", "components", "finance", "billing", "FinanceBillingExecutiveViews.tsx"),
      "utf8"
    );
    assert.ok(views.includes("FinanceBillingMonthlyComparisonChart"));
    assert.ok(views.includes("FinanceBillingAccumulatedChart"));
    assert.ok(views.includes("FinanceBillingProjectionChart"));
    assert.ok(mod.includes('path="billing"'));
    assert.ok(mod.includes("to={section.path}"));
    assert.ok(!mod.includes('to: "billing"'));
  });

  it("tela possui tabs internas de faturamento", () => {
    const types = readFileSync(
      join(process.cwd(), "src", "lib", "financeBillingDashboardTypes.ts"),
      "utf8"
    );
    assert.ok(types.includes('"documents"'));
    assert.ok(types.includes('"customers"'));
    assert.ok(types.includes('"overview"'));
    assert.ok(types.includes('"accumulated"'));
    assert.ok(types.includes('"monthly"'));
    assert.ok(types.includes('"projection"'));
    assert.ok(types.includes('"comparison"'));
    assert.ok(types.includes('"audit"'));
  });

  it("telas rotulam exceções YTD, multi-ano e comparativo", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceBillingPage.tsx"),
      "utf8"
    );
    const views = readFileSync(
      join(process.cwd(), "src", "components", "finance", "billing", "FinanceBillingExecutiveViews.tsx"),
      "utf8"
    );
    assert.ok(page.includes("FinanceBiDashboardShell"));
    assert.ok(page.includes("FinanceBiFilterPanel"));
    assert.ok(page.includes("alwaysVisible"));
    assert.ok(page.includes("Resumo executivo"));
    assert.ok(page.includes("buildFinanceBillingExportQuery"));
    assert.ok(page.includes("comparisonError"));
    assert.ok(page.includes("loadingComparison"));
    assert.ok(page.includes("FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE"));
    assert.ok(views.includes("FINANCE_BILLING_YTD_SCOPE"));
    assert.ok(views.includes("FINANCE_BILLING_MULTI_YEAR_SCOPE"));
    assert.ok(views.includes("FINANCE_BILLING_PROJECTION_SCOPE"));
  });

  it("navegação entre seções não usa paths relativos perigosos", () => {
    const nav = readFileSync(join(process.cwd(), "src", "lib", "financeNavigation.ts"), "utf8");
    assert.ok(nav.includes('billing: "/finance/billing"'));
    assert.ok(!nav.includes('to: "accounts-payable"'));
  });
});
