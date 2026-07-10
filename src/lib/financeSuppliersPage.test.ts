import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildAccessibleSidebarNavigation,
  resolveActiveModuleFromPath,
} from "./sidebarNavigation.js";
import { resolveAppHeaderBreadcrumb } from "./sidebarLabels.js";
import {
  canAccessModule,
  MODULE_LABELS,
  resolveModuleIdFromPath,
  type PermissionChecker,
} from "./modulePermissions.js";
import {
  FINANCE_SECTION_PATHS,
  isFinanceCanonicalPath,
} from "./financeNavigation.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (list) => list.some((p) => set.has(p)),
  };
}

describe("finance suppliers menu + route", () => {
  it("item Financeiro > Fornecedores aparece no menu para perfis autorizados", () => {
    const nav = buildAccessibleSidebarNavigation(
      checker(["finance.suppliers.view"])
    );
    const financeiro = nav.groups.find((g) => g.id === "financeiro");
    assert.ok(financeiro);
    assert.ok(financeiro!.items.some((i) => i.itemId === "suppliers"));
    assert.equal(
      financeiro!.items.find((i) => i.itemId === "suppliers")?.path,
      "/finance/suppliers"
    );
    assert.equal(canAccessModule("suppliers", checker(["finance.suppliers.view"])), true);
    assert.equal(canAccessModule("suppliers", checker(["dashboard.view"])), false);
  });

  it("rota /finance/suppliers é canônica e resolve módulo suppliers", () => {
    assert.equal(FINANCE_SECTION_PATHS.suppliers, "/finance/suppliers");
    assert.equal(isFinanceCanonicalPath("/finance/suppliers"), true);
    assert.equal(resolveModuleIdFromPath("/finance/suppliers"), "suppliers");
    assert.equal(resolveActiveModuleFromPath("/finance/suppliers"), "suppliers");
  });

  it("breadcrumb Financeiro > Fornecedores", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/finance/suppliers"), [
      { label: "Financeiro" },
      { label: MODULE_LABELS.suppliers, path: "/finance/suppliers" },
    ]);
  });

  it("aba Centro de Custos > Fornecedores continua existindo", () => {
    const types = read("src/lib/financeCostCentersPageTypes.ts");
    const page = read("src/components/finance/cost-centers/FinanceCostCentersPage.tsx");
    const tab = read("src/components/finance/cost-centers/FinanceSuppliersTab.tsx");
    assert.match(types, /suppliers/);
    assert.match(types, /Fornecedores/);
    assert.match(page, /FinanceSuppliersTab/);
    assert.match(tab, /SuppliersManagementView/);
    assert.match(tab, /cost-center-tab/);
  });

  it("os dois caminhos usam o mesmo componente e as mesmas APIs", () => {
    const shared = read("src/components/finance/cost-centers/SuppliersManagementView.tsx");
    const page = read("src/components/finance/FinanceSuppliersPage.tsx");
    const tab = read("src/components/finance/cost-centers/FinanceSuppliersTab.tsx");
    const mod = read("src/components/FinanceModule.tsx");
    assert.match(shared, /\/api\/finance\/suppliers\/search/);
    assert.match(shared, /\/api\/finance\/suppliers\/rebuild-from-ap-preview/);
    assert.match(shared, /\/api\/finance\/supplier-cost-center-rules/);
    assert.match(shared, /FinanceSupplierCadastroDrawer/);
    assert.match(page, /SuppliersManagementView/);
    assert.match(page, /finance-menu/);
    assert.match(tab, /SuppliersManagementView/);
    assert.match(mod, /FinanceSuppliersPage/);
    assert.match(mod, /path="suppliers"/);
  });

  it("página standalone tem título, subtítulo e aviso de base compartilhada", () => {
    const page = read("src/components/finance/FinanceSuppliersPage.tsx");
    assert.match(page, /Fornecedores/);
    assert.match(
      page,
      /Cadastro financeiro de fornecedores usado nas regras de alocação e centros de custo/
    );
    assert.match(page, /mesma base utilizada em Centro de Custos/);
    assert.match(page, /finance-suppliers-shared-base-notice/);
  });

  it("filtros de status e permissões de view/manage permanecem", () => {
    const shared = read("src/components/finance/cost-centers/SuppliersManagementView.tsx");
    const perms = read("src/lib/financeCostCentersPermissions.ts");
    assert.match(shared, /finance-suppliers-status-filter/);
    assert.match(shared, /Ativo/);
    assert.match(shared, /Inativo/);
    assert.match(perms, /canViewFinanceSuppliers/);
    assert.match(perms, /canManageFinanceSuppliers/);
    assert.match(perms, /finance\.suppliers\.view/);
  });

  it("nenhuma migration criada nesta feature", () => {
    assert.equal(existsSync(join(process.cwd(), "prisma", "migrations")), true);
    const page = read("src/components/finance/FinanceSuppliersPage.tsx");
    assert.doesNotMatch(page, /prisma\.migrate|CREATE TABLE/i);
    const shared = read("src/components/finance/cost-centers/SuppliersManagementView.tsx");
    assert.doesNotMatch(shared, /model FinancialSupplier/);
  });
});
