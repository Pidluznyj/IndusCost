import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceArDashboardQuery,
  buildFinanceArExportQuery,
  createDefaultFinanceArUiFilters,
  EMPTY_FINANCE_AR_UI_FILTERS,
  isDefaultFinanceArUiFilters,
  normalizeFinanceArUiFilters,
} from "./financeAccountsReceivableDashboardTypes.js";

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

describe("financeAccountsReceivablePageFilters", () => {
  it("página possui draft/applied e banner de escopo de filtros", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsReceivablePage.tsx"),
      "utf8"
    );
    const filterPanel = readFileSync(
      join(process.cwd(), "src", "components", "finance", "bi", "FinanceBiFilterPanel.tsx"),
      "utf8"
    );
    assert.ok(filterPanel.includes("Aplicar filtros"));
    assert.ok(filterPanel.includes("Limpar"));
    assert.ok(page.includes("draftFilters"));
    assert.ok(page.includes("appliedFilters"));
    assert.ok(page.includes("FinanceFilterScopeBanner"));
    assert.ok(page.includes("FinanceBiDashboardShell"));
    assert.ok(page.includes("FinanceBiFilterPanel"));
    assert.ok(page.includes("alwaysVisible"));
    assert.ok(page.includes("FinanceDetailTabs"));
    assert.ok(page.includes("totalAmountReceivable"));
    assert.ok(page.includes("resolveFinanceBiFilterStatus"));
    assert.ok(page.includes("withAppliedFilterSub"));
    assert.ok(!page.includes("useDebouncedValue"));
  });

  it("portfolio NF aplica filtro imediatamente (draft + applied)", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsReceivablePage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("handleFilterInvoiceIssued"));
    assert.ok(page.includes("setAppliedFilters(normalizeFinanceArUiFilters(nextDraft))"));
  });

  it("limpar filtros volta para padrão seguro com ano corrente", () => {
    const defaults = createDefaultFinanceArUiFilters(REF);
    assert.equal(defaults.year, "2026");
    assert.equal(isDefaultFinanceArUiFilters(defaults, REF), true);
    const cleared = normalizeFinanceArUiFilters(defaults);
    assert.equal(buildFinanceArDashboardQuery(cleared), "year=2026");
  });

  it("alterar rascunho não altera query aplicada até aplicar manualmente", () => {
    const defaults = normalizeFinanceArUiFilters(createDefaultFinanceArUiFilters(REF));
    const draft = normalizeFinanceArUiFilters({
      ...createDefaultFinanceArUiFilters(REF),
      personName: "Cliente X",
    });
    assert.notEqual(
      buildFinanceArDashboardQuery(draft),
      buildFinanceArDashboardQuery(defaults)
    );
    assert.ok(!buildFinanceArDashboardQuery(defaults).includes("personName"));
    assert.ok(buildFinanceArDashboardQuery(draft).includes("personName=Cliente"));
    assert.equal(
      buildFinanceArDashboardQuery(draft),
      buildFinanceArDashboardQuery(draft)
    );
  });

  it("export usa mesma query dos filtros aplicados", () => {
    const applied = normalizeFinanceArUiFilters({
      ...createDefaultFinanceArUiFilters(REF),
      month: "6",
      status: "overdue",
      invoiceIssued: "yes",
    });
    const qs = buildFinanceArDashboardQuery(applied);
    assert.ok(buildFinanceArExportQuery(applied).includes(qs));
    assert.ok(buildFinanceArExportQuery(applied).includes("format=csv"));
    assert.ok(qs.includes("year=2026"));
    assert.ok(qs.includes("month=6"));
    assert.ok(qs.includes("status=overdue"));
    assert.ok(qs.includes("invoiceIssued=yes"));
  });

  it("KPIs e gráficos carregam via dashboard com filtros aplicados", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsReceivablePage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("createDefaultFinanceArUiFilters"));
    assert.ok(page.includes("buildFinanceArDashboardQuery(appliedFilters)"));
    assert.ok(page.includes("FinanceArAgingChart"));
    assert.ok(page.includes("FinanceArTopDebtorsChart"));
    assert.ok(page.includes("Exportar CSV"));
  });
});
