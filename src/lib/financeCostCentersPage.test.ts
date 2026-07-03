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
    assert.match(read("src/components/finance/cost-centers/financeUnclassifiedModalUi.tsx"), /CostCenterDialog/);
    assert.match(read("src/lib/financeUnclassifiedPayablesUi.ts"), /UNCLASSIFIED_CAUSE_LABEL/);
    assert.match(read("src/components/finance/cost-centers/FinanceCostCenterAuditTab.tsx"), /finance-cost-centers-audit-tab/);
  });

  it("permissões escondem tela", () => {
    const mod = read("src/components/FinanceModule.tsx");
    const perms = read("src/lib/financeCostCentersPermissions.ts");
    assert.match(mod, /canViewFinanceCostCenters/);
    assert.match(perms, /finance\.cost_centers\.view/);
    assert.match(perms, /canViewFinanceCostCenters/);
    assert.match(perms, /canManageFinanceSuppliers/);
    assert.match(perms, /canDeleteFinanceSupplier/);
  });

  it("estados vazios existem", () => {
    const overview = read("src/components/finance/cost-centers/FinanceCostCenterOverviewTab.tsx");
    const crud = read("src/components/finance/cost-centers/FinanceCostCentersCrudTab.tsx");
    const unclassified = read("src/components/finance/cost-centers/FinanceUnclassifiedPayablesTab.tsx");
    assert.match(overview, /FinanceModuleEmptyState/);
    assert.match(crud, /Nenhum centro de custo cadastrado/);
    assert.match(unclassified, /Nenhum título sem classificação/);
  });

  it("grids padronizados com busca, ordenação e paginação", () => {
    const kit = read("src/lib/financeCostCenterGridKit.ts");
    const ui = read("src/components/finance/cost-centers/FinanceCostCenterGridKit.tsx");
    const crud = read("src/components/finance/cost-centers/FinanceCostCentersCrudTab.tsx");
    const suppliers = read("src/components/finance/cost-centers/FinanceSuppliersTab.tsx");
    const rules = read("src/components/finance/cost-centers/FinanceSupplierRulesTab.tsx");
    const unclassified = read("src/components/finance/cost-centers/FinanceUnclassifiedPayablesTab.tsx");
    const audit = read("src/components/finance/cost-centers/FinanceCostCenterAuditTab.tsx");
    assert.match(kit, /prepareCostCenterCrudGridRows/);
    assert.match(kit, /prepareSupplierGridRows/);
    assert.match(kit, /prepareUnclassifiedGroupedRows/);
    assert.match(ui, /FinanceCostCenterSortableTh/);
    assert.match(ui, /FinanceCostCenterGridPagination/);
    assert.match(crud, /FinanceCostCenterSortableTh/);
    assert.match(crud, /finance-cost-centers-crud-search/);
    assert.match(suppliers, /finance-suppliers-search/);
    assert.match(rules, /finance-rules-search/);
    assert.match(unclassified, /finance-unclassified-search/);
    assert.match(audit, /finance-audit-search/);
    assert.match(crud, /useSearchParams/);
    assert.match(unclassified, /groupUnclassifiedPayablesBySupplier/);
  });

  it("visão geral explica escopo e sem classificação real", () => {
    const overview = read("src/components/finance/cost-centers/FinanceCostCenterOverviewTab.tsx");
    const page = read("src/components/finance/cost-centers/FinanceCostCentersPage.tsx");
    assert.match(overview, /finance-cost-centers-overview-scope-hint/);
    assert.match(overview, /Sem classificação/);
    assert.match(overview, /resolveCostCenterClassificationScopeLabel/);
    assert.match(overview, /Títulos sem alocação completa no escopo filtrado/);
    assert.match(overview, /Fornecedor sem regra/);
    assert.match(overview, /Indicador auxiliar/);
    assert.match(overview, /FinanceCostCenterAnnualSpendingChart/);
    assert.match(overview, /annualSpendingChart/);
    assert.match(page, /Diagnóstico de classificação/);
  });

  it("botões principais existem", () => {
    const crud = read("src/components/finance/cost-centers/FinanceCostCentersCrudTab.tsx");
    const rules = read("src/components/finance/cost-centers/FinanceSupplierRulesTab.tsx");
    const unclassified = read("src/components/finance/cost-centers/FinanceUnclassifiedPayablesTab.tsx");
    const suppliers = read("src/components/finance/cost-centers/FinanceSuppliersTab.tsx");
    assert.match(crud, /finance-cost-centers-create-button/);
    assert.match(rules, /finance-rules-create-button/);
    assert.match(rules, /finance-rules-preview-button/);
    assert.match(unclassified, /finance-unclassified-batch-apply-button/);
    assert.match(unclassified, /FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT/);
    assert.match(suppliers, /finance-suppliers-view-paid-titles-button/);
    assert.match(suppliers, /FinanceSupplierPaidTitlesModal/);
    assert.match(read("src/components/finance/cost-centers/FinanceSupplierPaidTitlesModal.tsx"), /supplier-payment-titles/);
  });

  it("não importa Prisma no frontend", () => {
    const files = [
      "src/components/finance/cost-centers/FinanceCostCentersPage.tsx",
      "src/components/finance/cost-centers/FinanceCostCenterOverviewTab.tsx",
      "src/components/finance/cost-centers/FinanceCostCentersCrudTab.tsx",
      "src/components/finance/cost-centers/FinanceSuppliersTab.tsx",
      "src/components/finance/cost-centers/FinanceSupplierPaidTitlesModal.tsx",
      "src/components/finance/cost-centers/FinanceSupplierCadastroDrawer.tsx",
      "src/components/finance/cost-centers/FinanceSupplierRulesTab.tsx",
      "src/components/finance/cost-centers/FinanceUnclassifiedPayablesTab.tsx",
      "src/components/finance/cost-centers/FinanceCostCenterAuditTab.tsx",
      "src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx",
      "src/components/finance/cost-centers/FinanceCostCenterAnnualSpendingChart.tsx",
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

  describe("aba Títulos sem Classificação — ação Classificar fornecedor", () => {
    const tab = () =>
      read("src/components/finance/cost-centers/FinanceUnclassifiedPayablesTab.tsx");

    it("o clique em Classificar fornecedor abre a modal (não navega para regras)", () => {
      const src = tab();
      assert.match(src, /data-testid="finance-unclassified-classify-supplier-button"/);
      assert.match(src, /onClick=\{\(\) => openClassifyModal\(row\)\}/);
      assert.match(src, /testId="finance-unclassified-classify-modal"/);
    });

    it("a modal mostra causa, contagem, valor e fornecedor vinculado", () => {
      const src = tab();
      assert.match(src, /classifyGroup\.cause/);
      assert.match(src, /classifyGroup\.titlesCount/);
      assert.match(src, /formatFinanceCurrency\(classifyGroup\.amount\)/);
      assert.match(src, /Fornecedor gerencial/);
      assert.match(src, /data-testid="finance-unclassified-cost-center-select"/);
      assert.match(src, /Percentual padrão 100%/);
    });

    it("fornecedor não casado: autocomplete antes de escolher o centro de custo", () => {
      const src = tab();
      const autocomplete = read("src/components/finance/cost-centers/FinanceSupplierAutocomplete.tsx");
      assert.match(src, /needsSupplierLink/);
      assert.match(src, /FinanceSupplierAutocomplete/);
      assert.match(src, /testIdPrefix="finance-unclassified-supplier"/);
      assert.match(autocomplete, /\/api\/finance\/suppliers\/search/);
    });

    it("confirmar cria a regra e aplica por fornecedor com confirmação", () => {
      const src = tab();
      assert.match(src, /data-testid="finance-unclassified-classify-confirm"/);
      assert.match(src, /"\/api\/finance\/supplier-cost-center-rules"/);
      assert.match(src, /replaceExisting: true/);
      assert.match(src, /autoApply: true/);
      assert.match(src, /classify-batch-apply/);
      assert.match(src, /filters: \{ unclassifiedOnly: true, supplierId \}/);
      assert.match(src, /FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT/);
      // exige confirmação explícita (checkbox) antes de aplicar
      assert.match(src, /modalConfirmChecked/);
      assert.match(src, /data-testid="finance-unclassified-confirm-checkbox"/);
    });

    it("preserva classificação manual bloqueada", () => {
      const src = tab();
      assert.match(src, /skippedManualLocked/);
      assert.match(src, /manuais bloqueadas não serão sobrescritas/);
    });

    it("atualiza a lista após sucesso", () => {
      const src = tab();
      assert.match(src, /closeClassifyModal\(true\);\s*await load\(\);\s*onApplied\?\.\(\);/);
      assert.match(src, /data-testid="finance-unclassified-notice"/);
    });

    it("não usa UUID como campo principal visível e respeita permissão de regra", () => {
      const src = tab();
      assert.match(src, /canManageRules/);
      assert.match(src, /onNavigateTab\("rules"\)/); // fallback quando sem permissão
      assert.doesNotMatch(src, /placeholder="[^"]*UUID/i);
      const page = read("src/components/finance/cost-centers/FinanceCostCentersPage.tsx");
      assert.match(page, /canManageRules=\{canManageRules\}/);
      assert.match(page, /appliedFilters=\{appliedFilters\}/);
    });
  });

  describe("aba Títulos sem Classificação — exportar/importar planilha", () => {
    const tab = () =>
      read("src/components/finance/cost-centers/FinanceUnclassifiedPayablesTab.tsx");
    const modalUi = () =>
      read("src/components/finance/cost-centers/financeUnclassifiedModalUi.tsx");

    it("botões de exportar e importar existem", () => {
      const src = tab();
      assert.match(src, /data-testid="finance-unclassified-export-button"/);
      assert.match(src, /data-testid="finance-unclassified-import-button"/);
      assert.match(src, /Exportar planilha/);
      assert.match(src, /Importar planilha/);
    });

    it("exportar baixa o arquivo do endpoint de export", () => {
      const src = tab();
      assert.match(src, /\/api\/finance\/cost-centers\/unclassified\/export/);
      assert.match(src, /anchor\.download = "titulos-sem-classificacao\.xlsx"/);
    });

    it("importar abre modal com upload, preview e botão de aplicar", () => {
      const src = tab();
      assert.match(src, /testId="finance-unclassified-import-modal"/);
      assert.match(src, /data-testid="finance-unclassified-import-file"/);
      assert.match(src, /data-testid="finance-unclassified-import-preview"/);
      assert.match(src, /data-testid="finance-unclassified-import-apply-button"/);
      assert.match(src, /import\/preview/);
      assert.match(src, /import\/apply/);
    });

    it("aplicar importação atualiza a lista e exige confirmação de sensíveis", () => {
      const src = tab();
      assert.match(src, /requiredConfirmationText/);
      assert.match(src, /confirmSensitive/);
      assert.match(modalUi(), /finance-unclassified-import-confirm-sensitive/);
      assert.match(src, /finishImportSuccess/);
      assert.match(src, /await load\(\);\s*onApplied\?\.\(\);/);
    });

    it("erros por linha são exibidos", () => {
      const src = tab();
      assert.match(src, /Erros por linha/);
      assert.match(src, /line\.errors/);
    });

    it("frontend não importa a lib de servidor (prisma/xlsx)", () => {
      const src = tab();
      assert.doesNotMatch(src, /financeUnclassifiedImport"/);
      assert.doesNotMatch(src, /from ["'].*xlsx/i);
    });
  });
});
