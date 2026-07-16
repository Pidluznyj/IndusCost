import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_SETTINGS_ACTIONS,
  ADMIN_SETTINGS_FORBIDDEN_BLEED_KEYS,
  ADMIN_SETTINGS_PILOT_ENDPOINTS,
  ADMIN_SETTINGS_RESOURCE_KEYS,
  ADMIN_SETTINGS_SECURITY_ALREADY_MIGRATED,
} from "./adminSettingsAccess.ts";
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
    id: "u-adm",
    name: "Adm Test",
    email: "adm@example.com",
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

describe("adminSettingsAccess — matriz P19", () => {
  it("resourceKeys reais; security já migrado", () => {
    assert.equal(ADMIN_SETTINGS_RESOURCE_KEYS.nomusSync, "admin.settings.nomus_sync");
    assert.equal(ADMIN_SETTINGS_RESOURCE_KEYS.branding, "admin.settings.branding");
    assert.equal(ADMIN_SETTINGS_RESOURCE_KEYS.guide, "admin.guide");
    assert.equal(ADMIN_SETTINGS_SECURITY_ALREADY_MIGRATED, true);
    assert.ok(Object.values(ADMIN_SETTINGS_ACTIONS).includes("execute"));
    assert.ok(ADMIN_SETTINGS_PILOT_ENDPOINTS.some((e) => e.path.includes("nomus-sync")));
  });

  it("Leticia AP-only: settings/guide deny", () => {
    const result = resolveEffectiveAccess(fixtureLeticiaAccountsPayableOnly());
    for (const key of [
      ADMIN_SETTINGS_RESOURCE_KEYS.settings,
      ADMIN_SETTINGS_RESOURCE_KEYS.nomusSync,
      ADMIN_SETTINGS_RESOURCE_KEYS.branding,
      ADMIN_SETTINGS_RESOURCE_KEYS.globalParams,
      ADMIN_SETTINGS_RESOURCE_KEYS.operational,
      ADMIN_SETTINGS_RESOURCE_KEYS.priceTables,
      ADMIN_SETTINGS_RESOURCE_KEYS.guide,
    ]) {
      assert.equal(canEffectiveAccess(result, key, "view"), false, key);
    }
  });

  it("API direta: AP/costs NÃO abrem settings; settings.view NÃO executa sync", () => {
    for (const perm of ADMIN_SETTINGS_FORBIDDEN_BLEED_KEYS) {
      assert.equal(
        authorizeRequireResource(
          auth({ role: "VIEWER", permissions: [perm] }),
          ADMIN_SETTINGS_RESOURCE_KEYS.nomusSync,
          "view",
          { legacyCompatMode: true }
        ).ok,
        false,
        perm
      );
    }
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["settings.view"] }),
        ADMIN_SETTINGS_RESOURCE_KEYS.nomusSync,
        "execute",
        { legacyCompatMode: true }
      ).ok,
      false
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["settings.nomus.sync"] }),
        ADMIN_SETTINGS_RESOURCE_KEYS.nomusSync,
        "execute",
        { legacyCompatMode: true }
      ).ok,
      true
    );
  });

  it("branding update exige edit; guide com guide.view", () => {
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["settings.branding.view"] }),
        ADMIN_SETTINGS_RESOURCE_KEYS.branding,
        "update",
        { legacyCompatMode: true }
      ).ok,
      false
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "ADMIN", permissions: ["settings.branding.edit"] }),
        ADMIN_SETTINGS_RESOURCE_KEYS.branding,
        "update",
        { legacyCompatMode: true }
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        auth({ role: "VIEWER", permissions: ["guide.view"] }),
        ADMIN_SETTINGS_RESOURCE_KEYS.guide,
        "view",
        { legacyCompatMode: true }
      ).ok,
      true
    );
  });

  it("SUPER_ADMIN libera admin settings", () => {
    const result = resolveEffectiveAccess(fixtureSuperAdmin());
    assert.equal(canEffectiveAccess(result, ADMIN_SETTINGS_RESOURCE_KEYS.nomusSync, "execute"), true);
    assert.equal(canEffectiveAccess(result, ADMIN_SETTINGS_RESOURCE_KEYS.branding, "update"), true);
  });
});
