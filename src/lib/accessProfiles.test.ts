import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SYSTEM_ACCESS_PROFILE_SEEDS } from "./accessProfilesSeedData.js";
import {
  applyAccessProfileToUserFields,
  applyProfilePermissionsRaw,
  permissionsMatchProfile,
} from "./accessProfilesUtils.js";
import { canManageAccessProfiles, canViewAccessProfiles } from "./accessProfilesService.js";
import { canAccessModule } from "./modulePermissions.js";
import { ALL_PERMISSION_KEYS } from "./permissionCatalog.js";

describe("accessProfilesSeedData", () => {
  it("seeds all required system profiles", () => {
    const names = SYSTEM_ACCESS_PROFILE_SEEDS.map((s) => s.name);
    assert.ok(names.includes("Super administrador"));
    assert.ok(names.includes("Administrador"));
    assert.ok(names.includes("Gestor comercial"));
    assert.ok(names.includes("Vendedor"));
    assert.ok(names.includes("Visualizador"));
    assert.ok(names.includes("Somente Leitura"));
    assert.ok(names.includes("Compras"));
    assert.ok(names.includes("Engenharia / Custos"));
    assert.ok(names.includes("Administração do Sistema"));
    assert.ok(names.includes("Frota — Administrador"));
    assert.equal(SYSTEM_ACCESS_PROFILE_SEEDS.length, 15);
    assert.ok(SYSTEM_ACCESS_PROFILE_SEEDS.every((s) => s.isSystem));
  });

  it("admin profile includes users.manage and access profile permissions", () => {
    const admin = SYSTEM_ACCESS_PROFILE_SEEDS.find((s) => s.systemKey === "role_admin");
    assert.ok(admin);
    assert.ok(admin!.permissions.includes("users.manage"));
    assert.ok(admin!.permissions.includes("accessProfiles.manage"));
  });
});

describe("accessProfilesService helpers", () => {
  it("applyAccessProfileToUserFields normalizes super admin", () => {
    const applied = applyAccessProfileToUserFields({
      roleBase: "SUPER_ADMIN",
      permissions: ["dashboard.view"],
    });
    assert.equal(applied.role, "SUPER_ADMIN");
    assert.deepEqual(applied.permissions, []);
  });

  it("applyAccessProfileToUserFields keeps seller permissions positive", () => {
    const seller = SYSTEM_ACCESS_PROFILE_SEEDS.find((s) => s.systemKey === "role_seller");
    assert.ok(seller);
    const applied = applyAccessProfileToUserFields(seller!);
    assert.equal(applied.role, "SELLER");
    assert.ok(applied.permissions!.includes("crm.seller.own"));
  });

  it("permissionsMatchProfile detects customization", () => {
    assert.equal(
      permissionsMatchProfile(["dashboard.view", "crm.view"], ["crm.view", "dashboard.view"]),
      true
    );
    assert.equal(
      permissionsMatchProfile(["dashboard.view"], ["dashboard.view", "crm.view"]),
      false
    );
  });

  it("applyProfilePermissionsRaw expands required parents", () => {
    const perms = applyProfilePermissionsRaw(["crm.seller.own"]);
    assert.ok(perms.includes("crm.view"));
    assert.ok(perms.includes("crm.seller.own"));
  });
});

describe("accessProfiles permissions", () => {
  it("super admin can manage access profiles", () => {
    const auth = {
      role: "SUPER_ADMIN" as const,
      permissions: [],
      effectivePermissions: [...ALL_PERMISSION_KEYS],
    };
    assert.equal(canViewAccessProfiles(auth), true);
    assert.equal(canManageAccessProfiles(auth), true);
  });

  it("users.manage grants profile management", () => {
    const auth = {
      role: "ADMIN" as const,
      permissions: ["users.manage", "settings.view"],
      effectivePermissions: ["users.manage", "settings.view"],
    };
    assert.equal(canManageAccessProfiles(auth), true);
  });

  it("seller profile unlocks CRM menu modules", () => {
    const seller = SYSTEM_ACCESS_PROFILE_SEEDS.find((s) => s.systemKey === "role_seller");
    assert.ok(seller);
    const checker = {
      hasPermission: (p: string) => seller!.permissions.includes(p),
      hasAnyPermission: (ps: string[]) => ps.some((p) => seller!.permissions.includes(p)),
    };
    assert.equal(canAccessModule("crm-commercial", checker), true);
    assert.equal(canAccessModule("customers", checker), true);
  });
});
