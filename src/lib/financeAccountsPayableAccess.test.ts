import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FINANCE_AP_ACTIONS,
  FINANCE_AP_DUE_DATE_AXIS_NOTE,
  FINANCE_AP_PILOT_ENDPOINTS,
  FINANCE_AP_RESOURCE_KEY,
} from "./financeAccountsPayableAccess.ts";
import {
  authorizeRequireResource,
} from "./security/requireResource.ts";
import {
  fixtureLeticiaAccountsPayableOnly,
  fixtureLeticiaLegacyCompatOnly,
  fixtureSuperAdmin,
} from "./security/effectiveAccess/fixtures.ts";
import {
  canEffectiveAccess,
  resolveEffectiveAccess,
} from "./security/effectiveAccess/index.ts";
import type { AppAuthContext } from "./appAuth.ts";

function auth(partial: {
  role: AppAuthContext["role"];
  permissions?: string[];
}): AppAuthContext {
  const permissions = partial.permissions ?? [];
  return {
    id: "u-ap",
    name: "AP Test",
    email: "ap@example.com",
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

describe("financeAccountsPayableAccess — matriz piloto", () => {
  it("resourceKey e actions reais (sem CRUD inventado)", () => {
    assert.equal(FINANCE_AP_RESOURCE_KEY, "finance.accounts_payable");
    assert.deepEqual(Object.values(FINANCE_AP_ACTIONS).sort(), [
      "execute",
      "export",
      "manage",
      "view",
    ]);
    assert.match(FINANCE_AP_DUE_DATE_AXIS_NOTE, /dueDate/);
  });

  it("lista endpoints piloto com actions", () => {
    assert.ok(FINANCE_AP_PILOT_ENDPOINTS.some((e) => e.path.includes("/export") && e.action === "export"));
    assert.ok(
      FINANCE_AP_PILOT_ENDPOINTS.some(
        (e) => e.path.includes("accounts-payable-run") && e.action === "execute"
      )
    );
    assert.ok(
      FINANCE_AP_PILOT_ENDPOINTS.every((e) =>
        ["view", "export", "manage", "execute"].includes(e.action)
      )
    );
  });
});

describe("Contas a Pagar — autorização Leticia / deny / SA", () => {
  it("Leticia (override view) acessa view; deny export/manage/execute e AR", () => {
    const result = resolveEffectiveAccess(fixtureLeticiaAccountsPayableOnly());
    assert.equal(canEffectiveAccess(result, FINANCE_AP_RESOURCE_KEY, "view"), true);
    assert.equal(canEffectiveAccess(result, FINANCE_AP_RESOURCE_KEY, "export"), false);
    assert.equal(canEffectiveAccess(result, FINANCE_AP_RESOURCE_KEY, "manage"), false);
    assert.equal(canEffectiveAccess(result, FINANCE_AP_RESOURCE_KEY, "execute"), false);
    assert.equal(canEffectiveAccess(result, "finance.accounts_receivable", "view"), false);
    assert.equal(canEffectiveAccess(result, "finance.portfolio_reconciliation", "view"), false);
    assert.equal(canEffectiveAccess(result, "admin.employees", "view"), false);
  });

  it("Leticia legacyCompat bag só view AP", () => {
    const result = resolveEffectiveAccess(fixtureLeticiaLegacyCompatOnly());
    assert.equal(canEffectiveAccess(result, FINANCE_AP_RESOURCE_KEY, "view"), true);
    assert.equal(canEffectiveAccess(result, FINANCE_AP_RESOURCE_KEY, "export"), false);
  });

  it("API direta: settings.view / reports.view NÃO abrem AP", () => {
    for (const key of ["settings.view", "reports.view", "settings.nomus.view"]) {
      const decision = authorizeRequireResource(
        auth({ role: "VIEWER", permissions: [key] }),
        FINANCE_AP_RESOURCE_KEY,
        "view",
        { legacyCompatMode: true }
      );
      assert.equal(decision.ok, false, key);
    }
  });

  it("export exige .export — view sozinho deny", () => {
    const viewOnly = authorizeRequireResource(
      auth({ role: "VIEWER", permissions: ["finance.accountsPayable.view"] }),
      FINANCE_AP_RESOURCE_KEY,
      "export",
      { legacyCompatMode: true }
    );
    assert.equal(viewOnly.ok, false);

    const withExport = authorizeRequireResource(
      auth({
        role: "ADMIN",
        permissions: ["finance.accountsPayable.view", "finance.accountsPayable.export"],
      }),
      FINANCE_AP_RESOURCE_KEY,
      "export",
      { legacyCompatMode: true }
    );
    assert.equal(withExport.ok, true);
  });

  it("manage / execute com chaves dedicadas", () => {
    assert.equal(
      authorizeRequireResource(
        auth({ role: "ADMIN", permissions: ["finance.ap_allocations.manage"] }),
        FINANCE_AP_RESOURCE_KEY,
        "manage",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["finance.accountsPayable.sync"] }),
        FINANCE_AP_RESOURCE_KEY,
        "execute",
        { legacyCompatMode: true }
      ).ok,
      true
    );
  });

  it("SUPER_ADMIN libera todas as actions AP", () => {
    const result = resolveEffectiveAccess(fixtureSuperAdmin());
    for (const action of Object.values(FINANCE_AP_ACTIONS)) {
      assert.equal(canEffectiveAccess(result, FINANCE_AP_RESOURCE_KEY, action), true);
    }
    const http = authorizeRequireResource(
      auth({ role: "SUPER_ADMIN", permissions: [] }),
      FINANCE_AP_RESOURCE_KEY,
      "manage"
    );
    assert.equal(http.ok, true);
  });

  it("sem auth → 401", () => {
    const decision = authorizeRequireResource(null, FINANCE_AP_RESOURCE_KEY, "view");
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.equal(decision.status, 401);
  });
});
