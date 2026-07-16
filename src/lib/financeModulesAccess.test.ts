import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FINANCE_AP_RESOURCE_KEY_REF,
  FINANCE_LETICIA_DENIED_RESOURCE_KEYS,
  FINANCE_MODULE_ACTIONS,
  FINANCE_MODULE_PILOT_ENDPOINTS,
  FINANCE_MODULE_RESOURCE_KEYS,
  FINANCE_SIBLING_ISOLATION_KEYS,
} from "./financeModulesAccess.ts";
import { FINANCE_AP_RESOURCE_KEY } from "./financeAccountsPayableAccess.ts";
import { authorizeRequireResource } from "./security/requireResource.ts";
import {
  fixtureLeticiaAccountsPayableOnly,
  fixtureSuperAdmin,
} from "./security/effectiveAccess/fixtures.ts";
import {
  canEffectiveAccess,
  resolveEffectiveAccess,
} from "./security/effectiveAccess/index.ts";
import type { AppAuthContext } from "./appAuth.ts";
import { FINANCE_CASH_FLOW_VIEW_PERMISSIONS } from "./financeCashFlowRoutes.ts";
import { FINANCE_PORTFOLIO_RECONCILIATION_LEGACY_VIEW_PERMISSIONS } from "./financePortfolioReconciliationPermissions.ts";

function auth(partial: {
  role: AppAuthContext["role"];
  permissions?: string[];
}): AppAuthContext {
  const permissions = partial.permissions ?? [];
  return {
    id: "u-fin",
    name: "Fin Test",
    email: "fin@example.com",
    role: partial.role,
    permissions,
    effectivePermissions: permissions,
    accessProfileId: null,
    accessProfileName: null,
    employeeId: null,
    employeeName: null,
    employeeDepartment: null,
    isActive: true,
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "s1",
  };
}

describe("financeModulesAccess — matriz P17", () => {
  it("resourceKeys reais (AP separado)", () => {
    assert.equal(FINANCE_MODULE_RESOURCE_KEYS.cashFlow, "finance.cash_flow");
    assert.equal(FINANCE_MODULE_RESOURCE_KEYS.accountsReceivable, "finance.accounts_receivable");
    assert.equal(FINANCE_MODULE_RESOURCE_KEYS.portfolio, "finance.portfolio_reconciliation");
    assert.equal(FINANCE_AP_RESOURCE_KEY_REF, FINANCE_AP_RESOURCE_KEY);
    assert.ok(FINANCE_MODULE_PILOT_ENDPOINTS.some((e) => e.path.includes("cash-flow")));
    assert.ok(FINANCE_MODULE_PILOT_ENDPOINTS.some((e) => e.path.includes("portfolio")));
  });

  it("bags fluxo e portfolio não incluem AP", () => {
    assert.equal(
      (FINANCE_CASH_FLOW_VIEW_PERMISSIONS as readonly string[]).includes(
        "finance.accountsPayable.view"
      ),
      false
    );
    assert.equal(FINANCE_PORTFOLIO_RECONCILIATION_LEGACY_VIEW_PERMISSIONS.length, 0);
    assert.ok(FINANCE_SIBLING_ISOLATION_KEYS.includes("finance.accountsPayable.view"));
  });
});

describe("Financeiro P17 — Leticia AP-only / deny irmãos / SA", () => {
  it("Leticia: AP view; todos os demais finance deny", () => {
    const result = resolveEffectiveAccess(fixtureLeticiaAccountsPayableOnly());
    assert.equal(canEffectiveAccess(result, FINANCE_AP_RESOURCE_KEY, "view"), true);
    for (const key of FINANCE_LETICIA_DENIED_RESOURCE_KEYS) {
      assert.equal(canEffectiveAccess(result, key, "view"), false, key);
    }
  });

  it("API direta: AP.view NÃO abre fluxo / AR / billing / portfolio / executive", () => {
    for (const resource of [
      FINANCE_MODULE_RESOURCE_KEYS.cashFlow,
      FINANCE_MODULE_RESOURCE_KEYS.accountsReceivable,
      FINANCE_MODULE_RESOURCE_KEYS.billing,
      FINANCE_MODULE_RESOURCE_KEYS.salesOrders,
      FINANCE_MODULE_RESOURCE_KEYS.executiveReport,
      FINANCE_MODULE_RESOURCE_KEYS.portfolio,
      FINANCE_MODULE_RESOURCE_KEYS.portfolioOrderStatus,
      FINANCE_MODULE_RESOURCE_KEYS.portfolioOrderToCashAudit,
      FINANCE_MODULE_RESOURCE_KEYS.costCenters,
      FINANCE_MODULE_RESOURCE_KEYS.suppliers,
      FINANCE_MODULE_RESOURCE_KEYS.opex,
      FINANCE_MODULE_RESOURCE_KEYS.taxes,
      FINANCE_MODULE_RESOURCE_KEYS.reports,
    ]) {
      const decision = authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["finance.accountsPayable.view"] }),
        resource,
        "view",
        { legacyCompatMode: true }
      );
      assert.equal(decision.ok, false, resource);
    }
  });

  it("AR export exige .export; fluxo chave dedicada; finance.view não abre tudo; portfolio própria", () => {
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["finance.accountsReceivable.view"] }),
        FINANCE_MODULE_RESOURCE_KEYS.accountsReceivable,
        "export",
        { legacyCompatMode: true }
      ).ok,
      false
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["finance.accountsReceivable.export"] }),
        FINANCE_MODULE_RESOURCE_KEYS.accountsReceivable,
        "export",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    // finance.view é mega/secundário nos filhos — não abre fluxo via requireResource
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["finance.view"] }),
        FINANCE_MODULE_RESOURCE_KEYS.cashFlow,
        "view",
        { legacyCompatMode: true }
      ).ok,
      false
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["finance.cashFlow.view"] }),
        FINANCE_MODULE_RESOURCE_KEYS.cashFlow,
        "view",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    // finance.view canônico no parent Home
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["finance.view"] }),
        FINANCE_MODULE_RESOURCE_KEYS.home,
        "view",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["finance.view"] }),
        FINANCE_MODULE_RESOURCE_KEYS.portfolio,
        "view",
        { legacyCompatMode: true }
      ).ok,
      false
    );
    assert.equal(
      authorizeRequireResource(
        auth({
          role: "VIEWER",
          permissions: ["finance.portfolioReconciliation.view"],
        }),
        FINANCE_MODULE_RESOURCE_KEYS.portfolio,
        "view",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["finance.billing.view"] }),
        FINANCE_MODULE_RESOURCE_KEYS.billing,
        "view",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["finance.executiveReport.view"] }),
        FINANCE_MODULE_RESOURCE_KEYS.executiveReport,
        "view",
        { legacyCompatMode: true }
      ).ok,
      true
    );
  });

  it("SUPER_ADMIN libera módulos financeiros", () => {
    const result = resolveEffectiveAccess(fixtureSuperAdmin());
    assert.equal(canEffectiveAccess(result, FINANCE_AP_RESOURCE_KEY, "view"), true);
    assert.equal(
      canEffectiveAccess(result, FINANCE_MODULE_RESOURCE_KEYS.cashFlow, "view"),
      true
    );
    assert.equal(
      canEffectiveAccess(result, FINANCE_MODULE_RESOURCE_KEYS.portfolio, "view"),
      true
    );
    assert.equal(
      canEffectiveAccess(result, FINANCE_MODULE_RESOURCE_KEYS.accountsReceivable, "export"),
      true
    );
  });

  it("actions exportadas", () => {
    assert.ok(Object.values(FINANCE_MODULE_ACTIONS).includes("view"));
    assert.ok(Object.values(FINANCE_MODULE_ACTIONS).includes("export"));
    assert.ok(Object.values(FINANCE_MODULE_ACTIONS).includes("manage"));
  });
});
