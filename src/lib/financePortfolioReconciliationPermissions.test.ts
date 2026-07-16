import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FINANCE_PORTFOLIO_RECONCILIATION_CONCILIATION_API_PERMISSIONS,
  FINANCE_PORTFOLIO_RECONCILIATION_INTELLIGENCE_API_PERMISSIONS,
  FINANCE_PORTFOLIO_RECONCILIATION_ORDER_TO_CASH_AUDIT_API_PERMISSIONS,
  FINANCE_PORTFOLIO_RECONCILIATION_VIEW,
  canViewFinancePortfolioReconciliation,
  canViewPortfolioConciliationTab,
  canViewPortfolioIntelligenceTab,
  canViewPortfolioOrderToCashAuditTab,
  listVisiblePortfolioReconciliationTabs,
  resolveDefaultPortfolioReconciliationTab,
} from "./financePortfolioReconciliationPermissions.js";
import { ALL_PERMISSION_KEYS } from "./permissionCatalog.js";
import { canAccessModule, type PermissionChecker } from "./modulePermissions.js";

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (list) => list.some((p) => set.has(p)),
  };
}

describe("financePortfolioReconciliationPermissions", () => {
  it("chaves dedicadas existem no catálogo", () => {
    assert.ok(ALL_PERMISSION_KEYS.includes(FINANCE_PORTFOLIO_RECONCILIATION_VIEW));
    assert.ok(
      ALL_PERMISSION_KEYS.includes("finance.portfolioReconciliation.conciliation.view")
    );
    assert.ok(
      ALL_PERMISSION_KEYS.includes("finance.portfolioReconciliation.intelligence.view")
    );
    assert.ok(
      ALL_PERMISSION_KEYS.includes("finance.portfolioReconciliation.orderToCashAudit.view")
    );
  });

  it("P17: finance.view NÃO libera helpers de portfolio (chave própria)", () => {
    const auth = checker(["finance.view"]);
    assert.equal(canViewFinancePortfolioReconciliation(auth), false);
    assert.equal(canViewPortfolioConciliationTab(auth), false);
    assert.equal(canViewPortfolioIntelligenceTab(auth), false);
    assert.equal(canViewPortfolioOrderToCashAuditTab(auth), false);
    assert.equal(canAccessModule("portfolio-reconciliation", auth), false);
  });

  it("chave dedicada de módulo libera todas as abas", () => {
    const auth = checker([FINANCE_PORTFOLIO_RECONCILIATION_VIEW]);
    assert.equal(canViewFinancePortfolioReconciliation(auth), true);
    assert.deepEqual(listVisiblePortfolioReconciliationTabs(auth), [
      "conciliation",
      "intelligence",
      "order-to-cash-audit",
    ]);
  });

  it("aba isolada só libera a aba correspondente (sem legado)", () => {
    const auth = checker([
      "finance.portfolioReconciliation.intelligence.view",
    ]);
    assert.equal(canViewFinancePortfolioReconciliation(auth), true);
    assert.equal(canAccessModule("portfolio-reconciliation", auth), true);
    assert.equal(canViewPortfolioConciliationTab(auth), false);
    assert.equal(canViewPortfolioIntelligenceTab(auth), true);
    assert.equal(canViewPortfolioOrderToCashAuditTab(auth), false);
    assert.deepEqual(listVisiblePortfolioReconciliationTabs(auth), ["intelligence"]);
    assert.equal(resolveDefaultPortfolioReconciliationTab(auth), "intelligence");
  });

  it("P09/P12: Contas a Pagar não libera portfolio (sem bleed)", () => {
    const auth = checker(["finance.accountsPayable.view"]);
    assert.equal(canViewFinancePortfolioReconciliation(auth), false);
    assert.deepEqual(listVisiblePortfolioReconciliationTabs(auth), []);
    assert.equal(canAccessModule("portfolio-reconciliation", auth), false);
  });

  it("sem permissão não vê nada", () => {
    const auth = checker(["dashboard.view"]);
    assert.equal(canViewFinancePortfolioReconciliation(auth), false);
    assert.deepEqual(listVisiblePortfolioReconciliationTabs(auth), []);
    assert.equal(resolveDefaultPortfolioReconciliationTab(auth), null);
    assert.equal(canAccessModule("portfolio-reconciliation", auth), false);
  });

  it("APIs por aba incluem chave dedicada + módulo (sem legado/AP)", () => {
    assert.ok(
      FINANCE_PORTFOLIO_RECONCILIATION_CONCILIATION_API_PERMISSIONS.includes(
        "finance.portfolioReconciliation.conciliation.view"
      )
    );
    assert.ok(
      FINANCE_PORTFOLIO_RECONCILIATION_INTELLIGENCE_API_PERMISSIONS.includes(
        "finance.portfolioReconciliation.intelligence.view"
      )
    );
    assert.ok(
      FINANCE_PORTFOLIO_RECONCILIATION_ORDER_TO_CASH_AUDIT_API_PERMISSIONS.includes(
        "finance.portfolioReconciliation.orderToCashAudit.view"
      )
    );
    assert.equal(
      (FINANCE_PORTFOLIO_RECONCILIATION_CONCILIATION_API_PERMISSIONS as readonly string[]).includes(
        "finance.view"
      ),
      false
    );
    assert.equal(
      (
        FINANCE_PORTFOLIO_RECONCILIATION_CONCILIATION_API_PERMISSIONS as readonly string[]
      ).includes("finance.accountsPayable.view"),
      false
    );
  });
});
