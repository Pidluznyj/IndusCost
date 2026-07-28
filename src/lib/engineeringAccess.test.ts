import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ENGINEERING_ACTIONS,
  ENGINEERING_FORBIDDEN_BLEED_KEYS,
  ENGINEERING_PILOT_ENDPOINTS,
  ENGINEERING_RESOURCE_KEYS,
} from "./engineeringAccess.ts";
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
    id: "u-eng",
    name: "Eng Test",
    email: "eng@example.com",
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

describe("engineeringAccess — matriz P19", () => {
  it("resourceKeys e actions reais", () => {
    assert.equal(ENGINEERING_RESOURCE_KEYS.products, "engineering.products");
    assert.equal(ENGINEERING_RESOURCE_KEYS.materials, "engineering.materials");
    assert.equal(
      ENGINEERING_RESOURCE_KEYS.marketIntelligenceQuotes,
      "engineering.materials.market_intelligence.quotes"
    );
    assert.equal(ENGINEERING_RESOURCE_KEYS.projects, "engineering.projects");
    assert.ok(Object.values(ENGINEERING_ACTIONS).includes("approve"));
    assert.ok(ENGINEERING_PILOT_ENDPOINTS.some((e) => e.path.includes("bom")));
    assert.ok(
      ENGINEERING_PILOT_ENDPOINTS.some(
        (e) =>
          e.method === "POST" &&
          e.path === "/api/materials/stock-tablet/conference" &&
          e.resourceKey === "engineering.materials" &&
          e.action === "update"
      )
    );
    assert.ok(
      ENGINEERING_PILOT_ENDPOINTS.some(
        (e) =>
          e.method === "PATCH" &&
          e.path === "/api/materials/stock-tablet/:materialId/parameters" &&
          e.resourceKey === "engineering.materials" &&
          e.action === "update"
      )
    );
    assert.ok(
      ENGINEERING_PILOT_ENDPOINTS.some(
        (e) =>
          e.method === "GET" &&
          e.path === "/api/materials/stock-tablet/:materialId/history" &&
          e.resourceKey === "engineering.materials" &&
          e.action === "view"
      )
    );
  });

  it("Leticia AP-only: engenharia deny", () => {
    const result = resolveEffectiveAccess(fixtureLeticiaAccountsPayableOnly());
    for (const key of [
      ENGINEERING_RESOURCE_KEYS.products,
      ENGINEERING_RESOURCE_KEYS.materials,
      ENGINEERING_RESOURCE_KEYS.simulations,
      ENGINEERING_RESOURCE_KEYS.projects,
      ENGINEERING_RESOURCE_KEYS.transformationSimulator,
    ]) {
      assert.equal(canEffectiveAccess(result, key, "view"), false, key);
    }
  });

  it("API direta: costs.view / finance NÃO abrem produtos/materiais/projetos", () => {
    for (const resource of [
      ENGINEERING_RESOURCE_KEYS.products,
      ENGINEERING_RESOURCE_KEYS.materials,
      ENGINEERING_RESOURCE_KEYS.projects,
    ]) {
      for (const perm of ENGINEERING_FORBIDDEN_BLEED_KEYS) {
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

  it("chaves dedicadas: products.view / materials.view / quote approve", () => {
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["products.view"] }),
        ENGINEERING_RESOURCE_KEYS.products,
        "view",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["materials.view"] }),
        ENGINEERING_RESOURCE_KEYS.materials,
        "view",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "ADMIN", permissions: ["materials.market_quote.approve"] }),
        ENGINEERING_RESOURCE_KEYS.marketIntelligenceQuotes,
        "approve",
        { legacyCompatMode: true }
      ).ok,
      true
    );
  });

  it("SUPER_ADMIN libera engenharia", () => {
    const result = resolveEffectiveAccess(fixtureSuperAdmin());
    assert.equal(canEffectiveAccess(result, ENGINEERING_RESOURCE_KEYS.products, "view"), true);
    assert.equal(
      canEffectiveAccess(result, ENGINEERING_RESOURCE_KEYS.marketIntelligenceQuotes, "approve"),
      true
    );
  });
});
