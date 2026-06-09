import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceApDashboardQuery,
  createDefaultFinanceApUiFilters,
  hasPendingFinanceApFilterChanges,
  isDefaultFinanceApUiFilters,
  normalizeFinanceApUiFilters,
} from "./financeAccountsPayableDashboardTypes.js";

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

describe("financeAccountsPayablePageFilters", () => {
  it("página possui botões Aplicar e Limpar filtros no padrão de Contas a Receber", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsPayablePage.tsx"),
      "utf8"
    );
    const receivable = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsReceivablePage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("Aplicar filtros"));
    assert.ok(page.includes("Limpar filtros"));
    assert.ok(page.includes("draftFilters"));
    assert.ok(page.includes("appliedFilters"));
    assert.ok(page.includes("hasPendingFinanceApFilterChanges"));
    assert.ok(!page.includes("useDebouncedValue"));
    assert.ok(receivable.includes("Aplicar filtros"));
    assert.ok(page.includes("Há alterações nos filtros ainda não aplicadas."));
  });

  it("alterar rascunho não altera query aplicada até aplicar manualmente", () => {
    const defaults = normalizeFinanceApUiFilters(createDefaultFinanceApUiFilters(REF));
    const draft = { ...defaults, personName: "Fornecedor X" };
    assert.equal(hasPendingFinanceApFilterChanges(draft, defaults), true);
    assert.ok(!buildFinanceApDashboardQuery(defaults).includes("personName"));
    const applied = normalizeFinanceApUiFilters(draft);
    assert.ok(buildFinanceApDashboardQuery(applied).includes("personName=Fornecedor"));
    assert.equal(hasPendingFinanceApFilterChanges(applied, applied), false);
  });

  it("limpar filtros volta para padrão seguro com ano corrente", () => {
    const defaults = createDefaultFinanceApUiFilters(REF);
    assert.equal(defaults.year, "2026");
    assert.equal(isDefaultFinanceApUiFilters(defaults, REF), true);
    const cleared = normalizeFinanceApUiFilters(defaults);
    assert.equal(buildFinanceApDashboardQuery(cleared), "year=2026");
  });

  it("aplicar filtros monta query com ano, mês e documento", () => {
    const applied = normalizeFinanceApUiFilters({
      ...createDefaultFinanceApUiFilters(REF),
      month: "6",
      documentQuery: "NF-100",
      status: "overdue",
    });
    const qs = buildFinanceApDashboardQuery(applied);
    assert.ok(qs.includes("year=2026"));
    assert.ok(qs.includes("month=6"));
    assert.ok(qs.includes("documentQuery=NF-100"));
    assert.ok(qs.includes("status=overdue"));
  });

  it("FinanceModule mantém rotas absolutas após alinhamento de filtros", () => {
    const mod = readFileSync(join(process.cwd(), "src", "components", "FinanceModule.tsx"), "utf8");
    assert.ok(mod.includes('path: FINANCE_SECTION_PATHS["accounts-receivable"]'));
    assert.ok(mod.includes('path: FINANCE_SECTION_PATHS["accounts-payable"]'));
    assert.ok(!mod.includes('to: "accounts-payable"'));
  });
});
