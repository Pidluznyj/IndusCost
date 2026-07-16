import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_FORBIDDEN_FINANCE_KEYS,
  OPERATIONS_MODULE_RESOURCE_KEYS,
  OPERATIONS_PILOT_ENDPOINTS,
  OPERATIONS_RESOURCE_KEYS,
} from "./operationsAccess.ts";
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
import { INVENTORY_VIEW_PERMISSIONS } from "./inventoryPermissions.ts";

function auth(partial: {
  role: AppAuthContext["role"];
  permissions?: string[];
}): AppAuthContext {
  const permissions = partial.permissions ?? [];
  return {
    id: "u-ops",
    name: "Ops Test",
    email: "ops@example.com",
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

describe("operationsAccess — matriz piloto P16", () => {
  it("resourceKeys reais do contrato", () => {
    assert.equal(OPERATIONS_RESOURCE_KEYS.machines, "operations.machines");
    assert.equal(OPERATIONS_RESOURCE_KEYS.inventory, "operations.inventory");
    assert.equal(OPERATIONS_RESOURCE_KEYS.purchases, "operations.purchases");
    assert.equal(OPERATIONS_RESOURCE_KEYS.performance, "operations.performance");
    assert.equal(OPERATIONS_RESOURCE_KEYS.maintenance, "operations.maintenance");
    assert.equal(OPERATIONS_RESOURCE_KEYS.fleet, "operations.fleet");
    assert.ok(OPERATIONS_MODULE_RESOURCE_KEYS.includes("operations.machines"));
  });

  it("endpoints piloto cobrem módulos prioritários", () => {
    assert.ok(
      OPERATIONS_PILOT_ENDPOINTS.some(
        (e) => e.path === "/api/machines" && e.action === "view"
      )
    );
    assert.ok(
      OPERATIONS_PILOT_ENDPOINTS.some(
        (e) => e.resourceKey === "operations.inventory.counts" && e.action === "approve"
      )
    );
    assert.ok(
      OPERATIONS_PILOT_ENDPOINTS.some(
        (e) => e.resourceKey === "operations.fleet" && e.action === "manage"
      )
    );
  });

  it("bags inventário e lista finance proibida não incluem costs.view", () => {
    assert.equal(
      (INVENTORY_VIEW_PERMISSIONS as readonly string[]).includes("costs.view"),
      false
    );
    for (const key of OPERATIONS_FORBIDDEN_FINANCE_KEYS) {
      assert.ok(typeof key === "string");
    }
  });
});

describe("Operações / Máquinas — Leticia / finance deny / SA", () => {
  it("Leticia (AP only) não acessa nenhum módulo de operações", () => {
    const result = resolveEffectiveAccess(fixtureLeticiaAccountsPayableOnly());
    for (const key of OPERATIONS_MODULE_RESOURCE_KEYS) {
      assert.equal(canEffectiveAccess(result, key, "view"), false, key);
    }
  });

  it("API direta: costs.view / AP / finance NÃO abrem máquinas nem estoque", () => {
    for (const key of OPERATIONS_FORBIDDEN_FINANCE_KEYS) {
      for (const resource of [
        OPERATIONS_RESOURCE_KEYS.machines,
        OPERATIONS_RESOURCE_KEYS.inventory,
        OPERATIONS_RESOURCE_KEYS.purchases,
        OPERATIONS_RESOURCE_KEYS.performance,
        OPERATIONS_RESOURCE_KEYS.maintenance,
        OPERATIONS_RESOURCE_KEYS.fleet,
      ]) {
        const decision = authorizeRequireResource(
          auth({ role: "VIEWER", permissions: [key] }),
          resource,
          "view",
          { legacyCompatMode: true }
        );
        assert.equal(decision.ok, false, `${key} → ${resource}`);
      }
    }
  });

  it("máquinas: view vs update; estoque approve; compras create", () => {
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["machines.view"] }),
        OPERATIONS_RESOURCE_KEYS.machines,
        "view",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["machines.view"] }),
        OPERATIONS_RESOURCE_KEYS.machines,
        "update",
        { legacyCompatMode: true }
      ).ok,
      false
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "ADMIN", permissions: ["machines.edit"] }),
        OPERATIONS_RESOURCE_KEYS.machines,
        "update",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "ADMIN", permissions: ["inventory.count.approve"] }),
        OPERATIONS_RESOURCE_KEYS.inventoryCounts,
        "approve",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "ADMIN", permissions: ["purchases.create"] }),
        OPERATIONS_RESOURCE_KEYS.purchases,
        "create",
        { legacyCompatMode: true }
      ).ok,
      true
    );
  });

  it("SUPER_ADMIN libera operações", () => {
    const result = resolveEffectiveAccess(fixtureSuperAdmin());
    for (const key of OPERATIONS_MODULE_RESOURCE_KEYS) {
      assert.equal(canEffectiveAccess(result, key, "view"), true, key);
    }
    assert.equal(
      canEffectiveAccess(result, OPERATIONS_RESOURCE_KEYS.machines, "update"),
      true
    );
  });

  it("actions exportadas são as do contrato", () => {
    assert.deepEqual(Object.values(OPERATIONS_ACTIONS).sort(), [
      "approve",
      "create",
      "delete",
      "manage",
      "update",
      "view",
    ]);
  });
});
