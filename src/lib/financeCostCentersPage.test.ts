import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("financeCostCentersPage", () => {
  it("aba Financeiro → Centros de Custo existe", () => {
    assert.match(read("src/lib/financeNavigation.ts"), /cost-centers/);
    assert.match(read("src/lib/financeNavigation.ts"), /Centros de Custo/);
    assert.match(read("src/components/FinanceModule.tsx"), /FinanceCostCentersPage/);
    assert.match(read("src/components/FinanceModule.tsx"), /cost-centers/);
  });

  it("rota /finance/cost-centers existe", () => {
    assert.equal(read("src/lib/financeNavigation.ts").includes('"/finance/cost-centers"'), true);
  });

  it("abas internas existem", () => {
    const types = read("src/lib/financeCostCentersPageTypes.ts");
    const page = read("src/components/finance/cost-centers/FinanceCostCentersPage.tsx");
    assert.match(types, /Visão Geral/);
    assert.match(types, /Regras de Classificação/);
    assert.match(types, /Títulos sem Classificação/);
    assert.match(page, /FINANCE_COST_CENTERS_TABS/);
    assert.match(page, /FinanceDetailTabs/);
    assert.match(types, /overview/);
    assert.match(types, /unclassified/);
  });

  it("componentes de abas existem", () => {
    assert.match(read("src/components/finance/cost-centers/FinanceCostCenterOverviewTab.tsx"), /finance-cost-centers-overview-tab/);
    assert.match(read("src/components/finance/cost-centers/FinanceCostCentersCrudTab.tsx"), /finance-cost-centers-crud-tab/);
    assert.match(read("src/components/finance/cost-centers/FinanceSuppliersTab.tsx"), /finance-cost-centers-suppliers-tab/);
    assert.match(read("src/components/finance/cost-centers/FinanceSupplierRulesTab.tsx"), /finance-cost-centers-rules-tab/);
    assert.match(read("src/components/finance/cost-centers/FinanceUnclassifiedPayablesTab.tsx"), /finance-cost-centers-unclassified-tab/);
    assert.match(read("src/components/finance/cost-centers/FinanceCostCenterAuditTab.tsx"), /finance-cost-centers-audit-tab/);
  });

  it("permissões escondem tela", () => {
    const mod = read("src/components/FinanceModule.tsx");
    const perms = read("src/lib/financeCostCentersPermissions.ts");
    assert.match(mod, /canViewFinanceCostCenters/);
    assert.match(perms, /finance\.cost_centers\.view/);
    assert.match(perms, /canViewFinanceCostCenters/);
  });

  it("estados vazios existem", () => {
    const overview = read("src/components/finance/cost-centers/FinanceCostCenterOverviewTab.tsx");
    const crud = read("src/components/finance/cost-centers/FinanceCostCentersCrudTab.tsx");
    const unclassified = read("src/components/finance/cost-centers/FinanceUnclassifiedPayablesTab.tsx");
    assert.match(overview, /FinanceModuleEmptyState/);
    assert.match(crud, /Nenhum centro de custo cadastrado/);
    assert.match(unclassified, /Nenhum título sem classificação/);
  });

  it("botões principais existem", () => {
    const crud = read("src/components/finance/cost-centers/FinanceCostCentersCrudTab.tsx");
    const rules = read("src/components/finance/cost-centers/FinanceSupplierRulesTab.tsx");
    const unclassified = read("src/components/finance/cost-centers/FinanceUnclassifiedPayablesTab.tsx");
    assert.match(crud, /finance-cost-centers-create-button/);
    assert.match(rules, /finance-rules-create-button/);
    assert.match(rules, /finance-rules-preview-button/);
    assert.match(unclassified, /finance-unclassified-batch-apply-button/);
    assert.match(unclassified, /FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT/);
  });

  it("não importa Prisma no frontend", () => {
    const files = [
      "src/components/finance/cost-centers/FinanceCostCentersPage.tsx",
      "src/components/finance/cost-centers/FinanceCostCenterOverviewTab.tsx",
      "src/components/finance/cost-centers/FinanceCostCentersCrudTab.tsx",
      "src/components/finance/cost-centers/FinanceSuppliersTab.tsx",
      "src/components/finance/cost-centers/FinanceSupplierRulesTab.tsx",
      "src/components/finance/cost-centers/FinanceUnclassifiedPayablesTab.tsx",
      "src/components/finance/cost-centers/FinanceCostCenterAuditTab.tsx",
    ];
    for (const file of files) {
      const src = read(file);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /from ["'].*prisma/i);
    }
  });

  it("não quebra outras abas financeiras", () => {
    const mod = read("src/components/FinanceModule.tsx");
    assert.match(mod, /FinanceAccountsPayablePage/);
    assert.match(mod, /FinanceAccountsReceivablePage/);
    assert.match(mod, /FinanceCashFlowPage/);
    assert.match(mod, /FinanceBillingPage/);
    assert.match(mod, /FinanceSalesOrdersPage/);
    assert.match(mod, /FinanceExecutiveReportPage/);
    const nav = read("src/lib/financeNavigation.ts");
    assert.match(nav, /accounts-payable/);
    assert.match(nav, /Contas a Pagar/);
  });

  it("header executivo e drawer de auditoria", () => {
    const page = read("src/components/finance/cost-centers/FinanceCostCentersPage.tsx");
    assert.match(page, /FinanceExecutivePageHeader/);
    assert.match(page, /FinanceBiFilterPanel/);
    assert.match(page, /FinanceDataAuditDrawer/);
    assert.match(page, /title="Centros de Custo"/);
    assert.match(page, /buildFinanceTabLoadError/);
  });
});
