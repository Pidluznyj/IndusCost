import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceApDashboardQuery,
  buildFinanceApExportQuery,
  createDefaultFinanceApUiFilters,
  hasPendingFinanceApFilterChanges,
  isDefaultFinanceApUiFilters,
  normalizeFinanceApUiFilters,
} from "./financeAccountsPayableDashboardTypes.js";

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

describe("financeAccountsPayablePageFilters", () => {
  it("página possui botões Aplicar e Limpar filtros no padrão executivo", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsPayablePage.tsx"),
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
    assert.ok(page.includes("hasPendingFinanceApFilterChanges"));
    assert.ok(page.includes("resolveFinanceBiFilterStatus"));
    assert.ok(!page.includes("useDebouncedValue"));
    assert.ok(page.includes("showAdvancedFilters"));
  });

  it("página possui estrutura executiva do dashboard", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsPayablePage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("Total a pagar"));
    assert.ok(page.includes("Pago no mês"));
    assert.ok(page.includes("Vencido gerencial"));
    assert.ok(page.includes("Centro de Ações"));
    assert.ok(page.includes("Títulos Críticos"));
    assert.ok(page.includes("Detalhamento"));
    assert.ok(page.includes("Resumo executivo"));
    assert.ok(page.includes("FinanceApAgingChart"));
    assert.ok(page.includes("FinanceApTopDebtorsChart"));
    assert.ok(page.includes("FinanceDetailTabs"));
    assert.ok(page.includes("FINANCE_AP_EXECUTIVE_TABS"));
    assert.ok(page.includes("Atualizar"));
    assert.ok(page.includes("Exportar CSV"));
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

  it("página exibe banner e KPIs com escopo de filtros aplicados", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsPayablePage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("filterScopeNote"));
    assert.ok(page.includes("FinanceDataAuditDrawer"));
    assert.ok(page.includes("FinanceBiDashboardShell"));
    assert.ok(page.includes("FinanceBiFilterPanel"));
    assert.ok(page.includes("alwaysVisible"));
    assert.ok(page.includes("FINANCE_KPI_AP_PAID_THIS_MONTH"));
    assert.ok(page.includes("Resumo executivo"));
    assert.ok(page.includes("withAppliedFilterSub"));
    assert.ok(page.includes("titlesLocalFilter"));
    const applied = normalizeFinanceApUiFilters({
      ...createDefaultFinanceApUiFilters(REF),
      status: "open",
    });
    const qs = buildFinanceApDashboardQuery(applied);
    assert.ok(buildFinanceApExportQuery(applied).includes(qs));
    assert.ok(buildFinanceApExportQuery(applied).includes("format=csv"));
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
    const nav = readFileSync(join(process.cwd(), "src", "lib", "financeNavigation.ts"), "utf8");
    assert.ok(mod.includes("FINANCE_SECTIONS"));
    assert.ok(mod.includes("to={section.path}"));
    assert.ok(mod.includes('path="accounts-payable"'));
    assert.ok(mod.includes("resolveFinanceCanonicalPath"));
    assert.ok(!mod.includes('to: "accounts-receivable"'));
    assert.ok(!mod.includes('to: "accounts-payable"'));
    assert.ok(!mod.includes('to: "billing"'));
    assert.ok(nav.includes('"/finance/accounts-receivable"'));
    assert.ok(nav.includes('"/finance/accounts-payable"'));
    assert.ok(nav.includes('"/finance/billing"'));
  });
});
