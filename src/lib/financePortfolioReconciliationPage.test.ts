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
  it("item Financeiro > Conciliação de Carteira aparece no menu com grant dedicado", () => {
    const nav = buildAccessibleSidebarNavigation(
      checker(["finance.portfolioReconciliation.view"])
    );
    const financeiro = nav.groups.find((g) => g.id === "financeiro");
    assert.ok(financeiro);
    assert.ok(financeiro!.items.some((i) => i.itemId === "portfolio-reconciliation"));
    assert.equal(
      financeiro!.items.find((i) => i.itemId === "portfolio-reconciliation")?.path,
      "/finance/portfolio-reconciliation"
    );
    assert.equal(
      canAccessModule(
        "portfolio-reconciliation",
        checker(["finance.portfolioReconciliation.view"])
      ),
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
      { label: MODULE_LABELS["portfolio-reconciliation"] },
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
    // Abas visíveis (2026-07 em diante): somente Status Pedidos + Auditoria Pedido → Caixa.
    assert.match(page, /portfolio-tab-order-to-cash-audit/);
    assert.match(page, /portfolio-tab-order-status-pedidos/);
    assert.match(page, /OrderStatusTab/);
    assert.match(page, /OrderToCashAuditTab/);
    assert.match(page, /PORTFOLIO_RECONCILIATION_UI_TABS/);
    assert.match(page, /PortfolioReconciliationVisibleTabId/);
    assert.match(page, /isPortfolioReconciliationVisibleTabId/);
    // Abas ocultas não podem mais aparecer no JSX nem em data-testids.
    assert.doesNotMatch(page, /portfolio-tab-intelligence/);
    assert.doesNotMatch(page, /portfolio-tab-conciliation/);
    assert.doesNotMatch(page, /<PortfolioIntelligenceSection\b/);
    assert.doesNotMatch(page, /<PortfolioReconciliationOrdersTable\b/);
    assert.doesNotMatch(page, /<PortfolioReconciliationOrderDrawer\b/);
    assert.doesNotMatch(page, /<PortfolioReconciliationSummaryCardsView\b/);
    assert.doesNotMatch(page, /<PortfolioReconciliationComparisonPanel\b/);
    assert.doesNotMatch(page, /PORTFOLIO_RECONCILIATION_BUSINESS_ANSWERS_BANNER/);
    // Filtro global legado removido — filtros ficam nas abas.
    assert.doesNotMatch(page, /FinanceBiFilterPanel/);
    assert.doesNotMatch(page, /Fonte da previsão/);
    assert.doesNotMatch(page, /Run de conciliação/);
    assert.doesNotMatch(page, /Apenas divergências \/ alertas/);
    assert.match(page, /portfolio-reconciliation-run-meta/);
    // Permissões continuam declaradas em `PORTFOLIO_RECONCILIATION_UI_TABS` (não removemos backend).
    const clientPerms = read("src/lib/permissionsClient.ts");
    assert.match(clientPerms, /Inteligência da Carteira/);
    assert.match(clientPerms, /Auditoria Pedido → Caixa/);
    assert.match(clientPerms, /PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS/);
    assert.match(client, new RegExp(PORTFOLIO_RECONCILIATION_PARALLEL_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // Página carrega meta da run; listagem global não é mais filtrada no shell.
    assert.match(page, /\/api\/finance\/portfolio-reconciliation\/runs/);
    assert.match(page, /usePermissions/);
    assert.match(page, /PermissionGate/);
    assert.match(page, /ProtectedTab/);
    assert.match(page, /portfolio-reconciliation-empty-permission|PERMISSION_EMPTY_TABS_MESSAGE/);
  });

  it("aba default = Status Pedidos e fallback via useAuthorizedTabs (PERM-37)", () => {
    const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
    assert.match(page, /useAuthorizedTabs/);
    assert.match(page, /"order-status-pedidos"/);
    assert.match(page, /canViewModule\s*\(\s*"portfolio-reconciliation"\s*\)/);
  });

  it("abre Auditoria 360º via deep link auditOrderId (OP-73)", () => {
    const page = read("src/components/finance/FinancePortfolioReconciliationPage.tsx");
    assert.match(page, /auditOrderId/);
    assert.match(page, /OrderFullAuditDialog/);
    assert.match(page, /useSearchParams/);
  });

  it("whitelist visível declara somente Status Pedidos + Auditoria Pedido → Caixa (nessa ordem)", () => {
    const clientPerms = read("src/lib/permissionsClient.ts");
    const match = clientPerms.match(
      /PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS[\s\S]*?=\s*\[([^\]]+)\]/
    );
    assert.ok(match, "PORTFOLIO_RECONCILIATION_VISIBLE_TAB_IDS não encontrado");
    const body = match![1]!;
    assert.match(body, /"order-status-pedidos"/);
    assert.match(body, /"order-to-cash-audit"/);
    assert.doesNotMatch(body, /"conciliation"/);
    assert.doesNotMatch(body, /"intelligence"/);
    // Ordem canônica.
    const idxStatus = body.indexOf('"order-status-pedidos"');
    const idxAudit = body.indexOf('"order-to-cash-audit"');
    assert.ok(idxStatus >= 0 && idxAudit >= 0 && idxStatus < idxAudit);
    // Helper de guard + API listVisiblePortfolioReconciliationTabs.
    assert.match(clientPerms, /export function isPortfolioReconciliationVisibleTabId/);
    assert.match(clientPerms, /listVisiblePortfolioReconciliationTabs/);
  });

  it("permissões espelham a API e query não recalcula fatos", () => {
    // P17: OR legado esvaziado — AR não concede Conciliação de Carteira.
    assert.equal(
      canViewFinancePortfolioReconciliation(checker(["finance.accountsReceivable.view"])),
      false
    );
    assert.equal(
      canViewFinancePortfolioReconciliation(
        checker(["finance.portfolioReconciliation.view"])
      ),
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

  it("drawer/tabela da aba Conciliação continuam disponíveis para reuso interno", () => {
    // A tabela + drawer não são mais renderizados pela página (aba oculta em
    // 2026-07), mas os arquivos permanecem no repositório porque são
    // reusáveis por Auditoria 360º e por scripts internos.
    const table = read(
      "src/components/finance/portfolio-reconciliation/PortfolioReconciliationOrdersTable.tsx"
    );
    const drawer = read(
      "src/components/finance/portfolio-reconciliation/PortfolioReconciliationOrderDrawer.tsx"
    );
    assert.match(table, /disabled=\{!canOpen\}/);
    assert.match(drawer, /if \(!open \|\| !salesOrderId/);
    assert.match(drawer, /\/api\/finance\/portfolio-reconciliation\/orders\//);
  });
});
