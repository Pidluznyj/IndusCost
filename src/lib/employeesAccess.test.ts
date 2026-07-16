import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPLOYEES_ACTIONS,
  EMPLOYEES_FORBIDDEN_FINANCE_KEYS,
  EMPLOYEES_PILOT_ENDPOINTS,
  EMPLOYEES_RESOURCE_KEYS,
} from "./employeesAccess.ts";
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
import {
  EMPLOYEES_CREATE_PERMISSIONS,
  EMPLOYEES_UPDATE_PERMISSIONS,
  EMPLOYEES_VIEW_PERMISSIONS,
} from "./employeesPermissions.ts";

function auth(partial: {
  role: AppAuthContext["role"];
  permissions?: string[];
}): AppAuthContext {
  const permissions = partial.permissions ?? [];
  return {
    id: "u-rh",
    name: "RH Test",
    email: "rh@example.com",
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

describe("employeesAccess — matriz piloto P15", () => {
  it("resourceKeys e actions reais do contrato", () => {
    assert.equal(EMPLOYEES_RESOURCE_KEYS.module, "admin.employees");
    assert.equal(EMPLOYEES_RESOURCE_KEYS.personalData, "admin.employees.personal_data");
    assert.equal(
      EMPLOYEES_RESOURCE_KEYS.administrativeData,
      "admin.employees.administrative_data"
    );
    assert.equal(EMPLOYEES_RESOURCE_KEYS.sensitiveData, "admin.employees.sensitive_data");
    assert.equal(EMPLOYEES_RESOURCE_KEYS.links, "admin.employees.links");
    assert.equal(EMPLOYEES_RESOURCE_KEYS.userLink, "admin.employees.user_link");
    assert.equal(EMPLOYEES_RESOURCE_KEYS.epi, "admin.employees.epi");
    assert.deepEqual(Object.values(EMPLOYEES_ACTIONS).sort(), [
      "create",
      "manage",
      "update",
      "view",
    ]);
  });

  it("endpoints piloto cobrem CRUD + lookups + vínculos", () => {
    assert.ok(
      EMPLOYEES_PILOT_ENDPOINTS.some(
        (e) => e.method === "GET" && e.path === "/api/employees" && e.action === "view"
      )
    );
    assert.ok(
      EMPLOYEES_PILOT_ENDPOINTS.some(
        (e) => e.method === "POST" && e.path === "/api/employees" && e.action === "create"
      )
    );
    assert.ok(
      EMPLOYEES_PILOT_ENDPOINTS.some(
        (e) => e.path.includes("/status") && e.action === "update"
      )
    );
    assert.ok(
      EMPLOYEES_PILOT_ENDPOINTS.some(
        (e) => e.resourceKey === "admin.employees.user_link" && e.action === "manage"
      )
    );
    assert.ok(
      EMPLOYEES_PILOT_ENDPOINTS.some(
        (e) => e.resourceKey === "admin.employees.links" && e.action === "view"
      )
    );
  });

  it("bags RH não incluem costs.view nem chaves financeiras", () => {
    for (const bag of [
      EMPLOYEES_VIEW_PERMISSIONS,
      EMPLOYEES_CREATE_PERMISSIONS,
      EMPLOYEES_UPDATE_PERMISSIONS,
    ]) {
      for (const key of EMPLOYEES_FORBIDDEN_FINANCE_KEYS) {
        assert.equal((bag as readonly string[]).includes(key), false, key);
      }
    }
  });
});

describe("Pessoas/RH — Leticia / finance deny / SA", () => {
  it("Leticia (AP only) não acessa admin.employees nem facetas", () => {
    const result = resolveEffectiveAccess(fixtureLeticiaAccountsPayableOnly());
    assert.equal(canEffectiveAccess(result, "admin.employees", "view"), false);
    assert.equal(canEffectiveAccess(result, "admin.employees", "create"), false);
    assert.equal(canEffectiveAccess(result, "admin.employees", "update"), false);
    assert.equal(
      canEffectiveAccess(result, "admin.employees.personal_data", "view"),
      false
    );
    assert.equal(
      canEffectiveAccess(result, "admin.employees.administrative_data", "view"),
      false
    );
    assert.equal(canEffectiveAccess(result, "admin.employees.links", "view"), false);
    assert.equal(canEffectiveAccess(result, "admin.employees.user_link", "manage"), false);
    assert.equal(canEffectiveAccess(result, "admin.employees.epi", "manage"), false);
  });

  it("API direta: costs.view / AP / finance NÃO abrem RH", () => {
    for (const key of EMPLOYEES_FORBIDDEN_FINANCE_KEYS) {
      const decision = authorizeRequireResource(
        auth({ role: "VIEWER", permissions: [key] }),
        EMPLOYEES_RESOURCE_KEYS.module,
        "view",
        { legacyCompatMode: true }
      );
      assert.equal(decision.ok, false, key);
    }
  });

  it("API direta: employees.view abre view; create/update exigem chaves", () => {
    const viewOnly = authorizeRequireResource(
      auth({ role: "VIEWER", permissions: ["employees.view"] }),
      EMPLOYEES_RESOURCE_KEYS.module,
      "view",
      { legacyCompatMode: true }
    );
    assert.equal(viewOnly.ok, true);

    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["employees.view"] }),
        EMPLOYEES_RESOURCE_KEYS.module,
        "create",
        { legacyCompatMode: true }
      ).ok,
      false
    );

    assert.equal(
      authorizeRequireResource(
        auth({ role: "ADMIN", permissions: ["employees.create"] }),
        EMPLOYEES_RESOURCE_KEYS.module,
        "create",
        { legacyCompatMode: true }
      ).ok,
      true
    );

    assert.equal(
      authorizeRequireResource(
        auth({ role: "ADMIN", permissions: ["employees.edit"] }),
        EMPLOYEES_RESOURCE_KEYS.module,
        "update",
        { legacyCompatMode: true }
      ).ok,
      true
    );
  });

  it("facetas: personalData / administrativeData / epi / userLink", () => {
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["employees.personal_data.view"] }),
        EMPLOYEES_RESOURCE_KEYS.personalData,
        "view",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "ADMIN", permissions: ["employees.epi.manage"] }),
        EMPLOYEES_RESOURCE_KEYS.epi,
        "manage",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "ADMIN", permissions: ["employees.user_link.manage"] }),
        EMPLOYEES_RESOURCE_KEYS.userLink,
        "manage",
        { legacyCompatMode: true }
      ).ok,
      true
    );
  });

  it("SUPER_ADMIN libera RH", () => {
    const result = resolveEffectiveAccess(fixtureSuperAdmin());
    assert.equal(canEffectiveAccess(result, "admin.employees", "view"), true);
    assert.equal(canEffectiveAccess(result, "admin.employees", "create"), true);
    assert.equal(canEffectiveAccess(result, "admin.employees", "update"), true);
    assert.equal(canEffectiveAccess(result, "admin.employees.epi", "manage"), true);
  });
});
