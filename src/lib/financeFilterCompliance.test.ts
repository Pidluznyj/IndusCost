import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FINANCE_BILLING_COMPARISON_SCOPE,
  FINANCE_BILLING_FORECAST_SCOPE,
  FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE,
  FINANCE_BILLING_MULTI_YEAR_SCOPE,
  FINANCE_BILLING_NFE_LIST_SCOPE,
  FINANCE_BILLING_PROJECTION_SCOPE,
  FINANCE_BILLING_YTD_SCOPE,
  FINANCE_FILTER_APPLIED_SCOPE,
  FINANCE_SYNC_GLOBAL_SCOPE,
  withAppliedFilterSub,
} from "./financeFilterScope.js";
import {
  buildFinanceArDashboardQuery,
  buildFinanceArExportQuery,
  createDefaultFinanceArUiFilters,
  EMPTY_FINANCE_AR_UI_FILTERS,
  normalizeFinanceArUiFilters,
} from "./financeAccountsReceivableDashboardTypes.js";
import {
  buildFinanceApDashboardQuery,
  buildFinanceApExportQuery,
  createDefaultFinanceApUiFilters,
  normalizeFinanceApUiFilters,
} from "./financeAccountsPayableDashboardTypes.js";
import { buildFinanceBillingDashboardQuery } from "./financeBillingDashboardTypes.js";
import { buildFinanceBillingNfeQuery } from "./financeBillingNfeFiltersTypes.js";

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

function readPage(rel: string): string {
  return readFileSync(join(process.cwd(), "src", "components", "finance", rel), "utf8");
}

describe("financeFilterCompliance", () => {
  it("withAppliedFilterSub acrescenta sufixo quando filtros ativos", () => {
    assert.equal(withAppliedFilterSub("3 títulos", true), "3 títulos · filtros aplicados");
    assert.equal(withAppliedFilterSub(undefined, true), "· filtros aplicados");
    assert.equal(withAppliedFilterSub("3 títulos", false), "3 títulos");
  });

  it("constantes de escopo documentam exceções YTD e comparativo", () => {
    assert.match(FINANCE_BILLING_YTD_SCOPE, /YTD/);
    assert.match(FINANCE_BILLING_YTD_SCOPE, /não o mês/i);
    assert.match(FINANCE_BILLING_MULTI_YEAR_SCOPE, /multi-ano|histórico/i);
    assert.match(FINANCE_BILLING_COMPARISON_SCOPE, /Comparativo/i);
    assert.match(FINANCE_BILLING_PROJECTION_SCOPE, /Projeção/i);
    assert.match(FINANCE_BILLING_FORECAST_SCOPE, /expectedDeliveryDate|previsão/i);
    assert.match(FINANCE_SYNC_GLOBAL_SCOPE, /global/i);
    assert.match(FINANCE_FILTER_APPLIED_SCOPE, /filtros aplicados/i);
  });

  it("Contas a Receber: dashboard e export usam appliedFilters", () => {
    const page = readPage("FinanceAccountsReceivablePage.tsx");
    assert.ok(page.includes("buildFinanceArDashboardQuery(appliedFilters)"));
    assert.ok(page.includes("buildFinanceArExportQuery(appliedFilters)"));
    assert.ok(page.includes("createDefaultFinanceArUiFilters"));
    assert.ok(page.includes("isDefaultFinanceArUiFilters"));
    assert.ok(page.includes("FinanceFilterScopeBanner"));
    assert.ok(page.includes("withAppliedFilterSub"));
    assert.ok(page.includes("setAppliedFilters(normalizeFinanceArUiFilters(nextDraft))"));
    assert.ok(page.includes("draftFilters"));
    assert.ok(page.includes("appliedFilters"));
  });

  it("Contas a Pagar: dashboard e export usam appliedFilters", () => {
    const page = readPage("FinanceAccountsPayablePage.tsx");
    assert.ok(page.includes("buildFinanceApDashboardQuery(appliedFilters)"));
    assert.ok(page.includes("buildFinanceApExportQuery(appliedFilters)"));
    assert.ok(page.includes("FinanceFilterScopeBanner"));
    assert.ok(page.includes("withAppliedFilterSub"));
    assert.ok(page.includes("draftFilters"));
    assert.ok(page.includes("appliedFilters"));
  });

  it("Faturamento: painel executivo e NF-e usam filtros aplicados distintos", () => {
    const page = readPage("FinanceBillingPage.tsx");
    assert.ok(page.includes("buildFinanceBillingDashboardQuery(appliedYear"));
    assert.ok(page.includes("billingSource"));
    assert.ok(page.includes("buildFinanceBillingNfeQuery(appliedNfeFilters)"));
    assert.ok(page.includes("loadingComparison"));
    assert.ok(page.includes("FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE"));
    assert.ok(page.includes("FINANCE_SYNC_GLOBAL_SCOPE"));

    const views = readFileSync(
      join(process.cwd(), "src", "components", "finance", "billing", "FinanceBillingExecutiveViews.tsx"),
      "utf8"
    );
    assert.ok(views.includes("FINANCE_BILLING_YTD_SCOPE"));
    assert.ok(views.includes("FINANCE_BILLING_MULTI_YEAR_SCOPE"));
    assert.ok(views.includes("FINANCE_BILLING_PROJECTION_SCOPE"));
    assert.ok(views.includes("FinanceFilterScopeNote"));

    const comparison = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "billing",
        "FinanceBillingComparisonPanel.tsx"
      ),
      "utf8"
    );
    assert.ok(comparison.includes("FINANCE_BILLING_COMPARISON_SCOPE"));

    const nfeTable = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "billing",
        "FinanceBillingNfeDetailsTable.tsx"
      ),
      "utf8"
    );
    assert.ok(nfeTable.includes("FINANCE_BILLING_NFE_LIST_SCOPE"));
  });

  it("queries AR/AP refletem filtros aplicados (ano, mês, status)", () => {
    const arApplied = normalizeFinanceArUiFilters({
      ...createDefaultFinanceArUiFilters(REF),
      month: "6",
      status: "overdue",
      personName: "Cliente",
    });
    const arQs = buildFinanceArDashboardQuery(arApplied);
    assert.ok(arQs.includes("year=2026"));
    assert.ok(arQs.includes("month=6"));
    assert.ok(arQs.includes("status=overdue"));
    assert.ok(arQs.includes("personName=Cliente"));
    assert.ok(buildFinanceArExportQuery(arApplied).includes(arQs));
    assert.ok(buildFinanceArExportQuery(arApplied).includes("format=csv"));

    const apApplied = normalizeFinanceApUiFilters({
      ...createDefaultFinanceApUiFilters(REF),
      month: "6",
      status: "open",
      personName: "Fornecedor",
    });
    const apQs = buildFinanceApDashboardQuery(apApplied);
    assert.ok(apQs.includes("year=2026"));
    assert.ok(apQs.includes("month=6"));
    assert.ok(apQs.includes("status=open"));
    assert.ok(apQs.includes("personName=Fornecedor"));
    assert.ok(buildFinanceApExportQuery(apApplied).includes(apQs));
    assert.ok(buildFinanceApExportQuery(apApplied).includes("format=csv"));
  });

  it("Faturamento: dashboard por ano e NF-e por filtros aplicados", () => {
    assert.equal(buildFinanceBillingDashboardQuery("2025"), "year=2025&billingSource=nfe");
    const nfeQs = buildFinanceBillingNfeQuery({
      year: "2025",
      month: "3",
      customerCnpj: "12345678000190",
      documentNumber: "123",
      classification: "market",
      status: "authorized",
    });
    assert.ok(nfeQs.includes("year=2025"));
    assert.ok(nfeQs.includes("month=3"));
    assert.ok(nfeQs.includes("customerCnpj"));
    assert.ok(nfeQs.includes("classification=market"));
    assert.ok(nfeQs.includes("status=authorized"));
  });

  it("exceção YTD rotulada na aba Acumulado", () => {
    const views = readFileSync(
      join(process.cwd(), "src", "components", "finance", "billing", "FinanceBillingExecutiveViews.tsx"),
      "utf8"
    );
    assert.ok(views.includes("FINANCE_BILLING_YTD_SCOPE"));
    assert.ok(views.includes("FinanceBillingAccumulatedView"));
    assert.ok(views.includes("Acumulado YTD"));
    assert.ok(views.includes("FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE"));
  });
});
