import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_FORBIDDEN_BLEED_KEYS,
  COMMERCIAL_PILOT_ENDPOINTS,
  COMMERCIAL_RESOURCE_KEYS,
} from "./commercialAccess.ts";
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

function auth(partial: {
  role: AppAuthContext["role"];
  permissions?: string[];
}): AppAuthContext {
  const permissions = partial.permissions ?? [];
  return {
    id: "u-com",
    name: "Com Test",
    email: "com@example.com",
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

describe("commercialAccess — matriz P19", () => {
  it("resourceKeys e actions reais", () => {
    assert.equal(COMMERCIAL_RESOURCE_KEYS.crm, "commercial.crm");
    assert.equal(COMMERCIAL_RESOURCE_KEYS.salesOrders, "commercial.sales_orders");
    assert.equal(COMMERCIAL_RESOURCE_KEYS.pricing, "commercial.pricing");
    assert.equal(COMMERCIAL_RESOURCE_KEYS.commissionsMonthlyClosing, "commercial.commissions.monthly_closing");
    assert.ok(Object.values(COMMERCIAL_ACTIONS).includes("close"));
    assert.ok(Object.values(COMMERCIAL_ACTIONS).includes("reprocess"));
    assert.ok(COMMERCIAL_PILOT_ENDPOINTS.some((e) => e.path.includes("receipt-closing")));
  });

  it("Leticia AP-only: comercial deny", () => {
    const result = resolveEffectiveAccess(fixtureLeticiaAccountsPayableOnly());
    for (const key of [
      COMMERCIAL_RESOURCE_KEYS.crm,
      COMMERCIAL_RESOURCE_KEYS.customers,
      COMMERCIAL_RESOURCE_KEYS.proposals,
      COMMERCIAL_RESOURCE_KEYS.salesOrders,
      COMMERCIAL_RESOURCE_KEYS.pricing,
      COMMERCIAL_RESOURCE_KEYS.commissions,
    ]) {
      assert.equal(canEffectiveAccess(result, key, "view"), false, key);
    }
  });

  it("API direta: finance/settings NÃO abrem CRM/pricing/comissões", () => {
    for (const resource of [
      COMMERCIAL_RESOURCE_KEYS.crm,
      COMMERCIAL_RESOURCE_KEYS.pricing,
      COMMERCIAL_RESOURCE_KEYS.commissionsMonthlyClosing,
    ]) {
      for (const perm of COMMERCIAL_FORBIDDEN_BLEED_KEYS) {
        const decision = authorizeRequireResource(
          auth({ role: "VIEWER", permissions: [perm] }),
          resource,
          "view",
          { legacyCompatMode: true }
        );
        assert.equal(decision.ok, false, `${perm} -> ${resource}`);
      }
    }
  });

  it("chaves dedicadas: customers.view / sales_orders.view / close comissão", () => {
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["customers.view"] }),
        COMMERCIAL_RESOURCE_KEYS.customers,
        "view",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["sales_orders.view"] }),
        COMMERCIAL_RESOURCE_KEYS.salesOrders,
        "view",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "ADMIN", permissions: ["commissions.payments.manage"] }),
        COMMERCIAL_RESOURCE_KEYS.commissionsMonthlyClosing,
        "close",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["commissions.view"] }),
        COMMERCIAL_RESOURCE_KEYS.commissionsMonthlyClosing,
        "close",
        { legacyCompatMode: true }
      ).ok,
      false
    );
  });

  it("SUPER_ADMIN libera comercial", () => {
    const result = resolveEffectiveAccess(fixtureSuperAdmin());
    assert.equal(canEffectiveAccess(result, COMMERCIAL_RESOURCE_KEYS.crm, "view"), true);
    assert.equal(
      canEffectiveAccess(result, COMMERCIAL_RESOURCE_KEYS.commissionsMonthlyClosing, "close"),
      true
    );
  });
});
