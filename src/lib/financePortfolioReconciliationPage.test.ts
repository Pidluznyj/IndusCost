import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  FINANCE_SECTIONS,
  FINANCE_STANDALONE_PATHS,
  isFinanceCanonicalPath,
  isFinancePortfolioReconciliationStandalonePath,
} from "./financeNavigation.js";
import {
  buildPortfolioReconciliationListQuery,
  createDefaultPortfolioReconciliationUiFilters,
  PORTFOLIO_RECONCILIATION_PARALLEL_NOTICE,
} from "./financePortfolioReconciliationClient.js";
import { canViewFinancePortfolioReconciliation } from "./financePortfolioReconciliationPermissions.js";

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

describe("finance portfolio reconciliation menu + page", () => {
  it("item Financeiro > Conciliação de Carteira aparece no menu", () => {
    const nav = buildAccessibleSidebarNavigation(checker(["finance.view"]));
    const financeiro = nav.groups.find((g) => g.id === "financeiro");
    assert.ok(financeiro);
    assert.ok(financeiro!.items.some((i) => i.itemId === "portfolio-reconciliation"));
    assert.equal(
      financeiro!.items.find((i) => i.itemId === "portfolio-reconciliation")?.path,
      "/finance/portfolio-reconciliation"
    );
    assert.equal(
      canAccessModule("portfolio-reconciliation", checker(["finance.view"])),
      true
    );
    assert.equal(
      canAccessModule("portfolio-reconciliation", checker(["dashboard.view"])),
      false
    );
  });

  it("rota standalone resolve módulo e não entra nas abas do FinanceModule", () => {
    assert.equal(
      FINANCE_STANDALONE_PATHS["portfolio-reconciliation"],
      "/finance/portfolio-reconciliation"
    );
    assert.equal(isFinanceCanonicalPath("/finance/portfolio-reconciliation"), true);
    assert.equal(
      isFinancePortfolioReconciliationStandalonePath("/finance/portfolio-reconciliation"),
      true
    );
    assert.equal(
      resolveModuleIdFromPath("/finance/portfolio-reconciliation"),
      "portfolio-reconciliation"
    );
    assert.equal(
      resolveActiveModuleFromPath("/finance/portfolio-reconciliation"),
      "portfolio-reconciliation"
    );
    assert.ok(!FINANCE_SECTIONS.some((s) => s.id === "portfolio-reconciliation"));
  });

  it("breadcrumb Financeiro > Conciliação de Carteira", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/finance/portfolio-reconciliation"), [
      { label: "Financeiro" },
      {
        label: MODULE_LABELS["portfolio-reconciliation"],
        path: "/finance/portfolio-reconciliation",
      },
    ]);
  });

  it("App registra rota antes de finance/* e FinanceModule não inclui a tela", () => {
    const app = read("src/App.tsx");
    const mod = read("src/components/FinanceModule.tsx");
    const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
    assert.match(app, /path="finance\/portfolio-reconciliation"/);
    assert.match(app, /FinancePortfolioReconciliationPage/);
    assert.doesNotMatch(mod, /portfolio-reconciliation/);
    assert.doesNotMatch(mod, /FinancePortfolioReconciliationPage/);
    assert.doesNotMatch(page, /finance-module-tabs/);
    assert.doesNotMatch(page, /getFinanceSectionPath/);
    assert.doesNotMatch(page, /Navigate to="\/finance\/accounts-receivable"/);
  });

  it("página deixa claro que é visão paralela e consome API read-only", () => {
    const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
    const client = read("src/lib/financePortfolioReconciliationClient.ts");
    assert.match(page, /portfolio-reconciliation-parallel-notice/);
    assert.match(page, /PORTFOLIO_RECONCILIATION_PARALLEL_NOTICE/);
    assert.match(page, /PORTFOLIO_RECONCILIATION_BUSINESS_ANSWERS_BANNER/);
    assert.match(page, /businessAnswers/);
    assert.match(page, /PortfolioReconciliationComparisonPanel/);
    assert.match(page, /comparison/);
    assert.match(page, /PortfolioIntelligenceSection/);
    assert.match(page, /portfolio-tab-intelligence/);
    assert.match(page, /Inteligência da Carteira/);
    assert.match(page, /portfolio-tab-order-to-cash-audit/);
    assert.match(page, /Auditoria Pedido → Caixa/);
    assert.match(page, /OrderToCashAuditTab/);
    assert.match(client, new RegExp(PORTFOLIO_RECONCILIATION_PARALLEL_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(page, /\/api\/finance\/portfolio-reconciliation/);
    assert.match(page, /\/api\/finance\/portfolio-reconciliation\/runs/);
    assert.match(page, /canViewFinancePortfolioReconciliation/);
    assert.match(page, /PortfolioReconciliationOrderDrawer/);
  });

  it("permissões espelham a API e query não recalcula fatos", () => {
    assert.equal(
      canViewFinancePortfolioReconciliation(checker(["finance.accountsReceivable.view"])),
      true
    );
    assert.equal(canViewFinancePortfolioReconciliation(checker(["dashboard.view"])), false);
    const filters = {
      ...createDefaultPortfolioReconciliationUiFilters(),
      customerExternalId: "200",
      onlyIssues: true,
      page: 2,
    };
    const qs = buildPortfolioReconciliationListQuery(filters);
    assert.match(qs, /customerExternalId=200/);
    assert.match(qs, /onlyIssues=true/);
    assert.match(qs, /page=2/);
  });

  it("drawer só abre com salesOrderId e tabela desabilita ação sem id", () => {
    const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
    const table = read(
      "src/components/finance/portfolio-reconciliation/PortfolioReconciliationOrdersTable.tsx"
    );
    const drawer = read(
      "src/components/finance/portfolio-reconciliation/PortfolioReconciliationOrderDrawer.tsx"
    );
    assert.match(page, /if \(!salesOrderId\.trim\(\)\) return/);
    assert.match(table, /disabled=\{!canOpen\}/);
    assert.match(drawer, /if \(!open \|\| !salesOrderId/);
    assert.match(drawer, /\/api\/finance\/portfolio-reconciliation\/orders\//);
  });
});
