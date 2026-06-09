import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceArDashboardQuery,
  buildFinanceArExportQuery,
  normalizeFinanceArUiFilters,
} from "./financeAccountsReceivableDashboardTypes.js";

const EMPTY = {
  year: "",
  month: "",
  status: "all" as const,
  companyName: "",
  personName: "",
  personCnpj: "",
  dueDateFrom: "",
  dueDateTo: "",
  documentQuery: "",
  invoiceIssued: "all" as const,
};

describe("financeAccountsReceivablePageFilters", () => {
  it("página possui draft/applied e banner de escopo de filtros", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsReceivablePage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("Aplicar filtros"));
    assert.ok(page.includes("Limpar filtros"));
    assert.ok(page.includes("draftFilters"));
    assert.ok(page.includes("appliedFilters"));
    assert.ok(page.includes("FinanceFilterScopeBanner"));
    assert.ok(page.includes("withAppliedFilterSub"));
    assert.ok(page.includes("Não aplicados"));
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

  it("alterar rascunho não altera query aplicada até aplicar manualmente", () => {
    const defaults = normalizeFinanceArUiFilters(EMPTY);
    const draft = normalizeFinanceArUiFilters({ ...EMPTY, personName: "Cliente X" });
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
      ...EMPTY,
      year: "2026",
      month: "6",
      status: "overdue",
      invoiceIssued: "yes",
    });
    const qs = buildFinanceArDashboardQuery(applied);
    assert.equal(buildFinanceArExportQuery(applied), qs);
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
    assert.ok(page.includes("buildFinanceArDashboardQuery(appliedFilters)"));
    assert.ok(page.includes("FinanceArAgingChart"));
    assert.ok(page.includes("FinanceArTopDebtorsChart"));
    assert.ok(page.includes("Exportar CSV"));
  });
});
