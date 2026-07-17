/**
 * Garantia: usuário só acessa o que o perfil/overrides atribuíram.
 * Cobre API (requireResource), DTO (/me), menu e UI seeds sem duplicata.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizeRequireResource,
  isRequireResourceLegacyCompatEnabled,
} from "@/src/lib/security/requireResource.ts";
import {
  buildCanonicalEffectiveAccessInput,
  projectAccessProfilePermissionsToSnapshot,
  resolveCanonicalAccessFromParts,
} from "@/src/lib/security/effectiveAccess/canonicalEffectiveAccess.ts";
import { canCanonicalAccess } from "@/src/lib/security/effectiveAccess/canonicalEffectiveAccess.ts";
import { mapSeedAxisOverridesToContract } from "@/src/lib/security/effectiveAccessDto/mapOverrides.ts";
import { buildEffectiveAccessDto } from "@/src/lib/security/effectiveAccessDto/buildEffectiveAccessDto.ts";
import { listPermissionSeedsForAdminUi } from "@/src/lib/permissionAdminUiSeeds.ts";
import { buildAccessProfileMatrixModel } from "@/src/lib/accessProfilesMatrix.ts";
import { buildEditablePermissionTree } from "@/src/lib/security/userPermissionAdminService.ts";
import { legacyPermissionGrantedByDto } from "@/src/lib/canAccessFromEffectiveAccess.ts";
import {
  buildSidebarNavigationFromEffectiveAccess,
  canViewSidebarModuleFromDto,
} from "@/src/lib/sidebarEffectiveAccess.ts";
import type { AppAuthContext } from "@/src/lib/appAuth.ts";

function auth(partial: {
  role?: AppAuthContext["role"];
  permissions?: string[];
}): AppAuthContext {
  return {
    id: "u-guarantee",
    name: "Guarantee",
    email: "g@example.com",
    role: partial.role ?? "VIEWER",
    permissions: partial.permissions ?? [],
    effectivePermissions: partial.permissions ?? [],
    permissionsVersion: 1,
    accessProfileId: "ap-1",
    accessProfileName: "Restrito",
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
    sessionId: "s-g",
  };
}

describe("garantia — só o atribuído", () => {
  it("REQUIRE_RESOURCE_LEGACY_COMPAT default OFF", () => {
    const prev = process.env.REQUIRE_RESOURCE_LEGACY_COMPAT;
    delete process.env.REQUIRE_RESOURCE_LEGACY_COMPAT;
    try {
      assert.equal(isRequireResourceLegacyCompatEnabled(), false);
    } finally {
      if (prev === undefined) delete process.env.REQUIRE_RESOURCE_LEGACY_COMPAT;
      else process.env.REQUIRE_RESOURCE_LEGACY_COMPAT = prev;
    }
  });

  it("bag larga NÃO libera finance se perfil só tem dashboard", () => {
    const profileSnapshot = projectAccessProfilePermissionsToSnapshot([
      "dashboard.view",
    ]);
    const decision = authorizeRequireResource(
      auth({
        role: "ADMIN",
        permissions: ["finance.view", "crm.view", "users.manage", "dashboard.view"],
      }),
      "finance",
      "view",
      { profileSnapshot, legacyCompatMode: false }
    );
    assert.equal(decision.ok, false);

    const dash = authorizeRequireResource(
      auth({ role: "ADMIN", permissions: ["finance.view"] }),
      "dashboard",
      "view",
      { profileSnapshot, legacyCompatMode: false }
    );
    assert.equal(dash.ok, true);
  });

  it("override DENY vence alias legado allow no mesmo contrato", () => {
    const mapped = mapSeedAxisOverridesToContract([
      { resourceKey: "comercial", canView: true },
      { resourceKey: "commercial", canView: false },
    ]);
    assert.equal(mapped.commercial?.view, "deny");
  });

  it("DTO + sidebar: perfil só dashboard → sem Comercial/Financeiro", () => {
    const profileSnapshot = projectAccessProfilePermissionsToSnapshot([
      "dashboard.view",
    ]);
    const result = resolveCanonicalAccessFromParts({
      userId: "u-guarantee",
      role: "VIEWER",
      profileSnapshot,
      overrides: {},
      legacyCompatMode: false,
    });
    const dto = buildEffectiveAccessDto({
      permissionsVersion: 1,
      result,
      legacyBagAuthoritative: false,
    });
    assert.ok(dto.allowedResources.includes("dashboard"));
    assert.ok(!dto.allowedResources.includes("finance"));
    assert.ok(!dto.allowedResources.includes("commercial"));
    assert.equal(canViewSidebarModuleFromDto(dto, "finance"), false);
    assert.equal(canViewSidebarModuleFromDto(dto, "crm-commercial"), false);
    assert.equal(legacyPermissionGrantedByDto(dto, "finance.view"), false);
    assert.equal(legacyPermissionGrantedByDto(dto, "crm.view"), false);
    assert.equal(legacyPermissionGrantedByDto(dto, "dashboard.view"), true);

    const nav = buildSidebarNavigationFromEffectiveAccess(dto);
    const ids = nav.flatAccessibleItems.map((i) => i.id);
    assert.ok(!ids.includes("finance"));
    assert.ok(!ids.includes("crm-commercial"));
    assert.ok(!ids.includes("sales-orders"));
  });

  it("árvore admin UI não duplica Comercial/Financeiro", () => {
    const seeds = listPermissionSeedsForAdminUi();
    const labels = seeds.filter((s) => s.parentKey == null).map((s) => s.label);
    const comercialCount = labels.filter((l) => l === "Comercial").length;
    const financeiroCount = labels.filter((l) => l === "Financeiro").length;
    assert.equal(comercialCount, 1, `Comercial roots: ${labels.join(",")}`);
    assert.equal(financeiroCount, 1, `Financeiro roots: ${labels.join(",")}`);
    assert.ok(seeds.some((s) => s.key === "commercial"));
    assert.ok(seeds.some((s) => s.key === "finance"));
    assert.ok(!seeds.some((s) => s.key === "comercial"));
    assert.ok(!seeds.some((s) => s.key === "financeiro"));

    const profileTree = buildAccessProfileMatrixModel(["dashboard.view"], "VIEWER");
    const rootLabels = profileTree.tree.map((n) => n.label);
    assert.equal(rootLabels.filter((l) => l === "Comercial").length, 1);
    assert.equal(rootLabels.filter((l) => l === "Financeiro").length, 1);

    const userTree = buildEditablePermissionTree("VIEWER", []);
    assert.equal(userTree.filter((n) => n.label === "Comercial").length, 1);
    assert.equal(userTree.filter((n) => n.label === "Financeiro").length, 1);
  });

  it("input canônico ignora bag sem legacyCompatMode", () => {
    const input = buildCanonicalEffectiveAccessInput({
      userId: "u",
      role: "ADMIN",
      profileSnapshot: projectAccessProfilePermissionsToSnapshot(["dashboard.view"]),
      legacyPermissions: ["finance.view", "users.manage"],
      legacyCompatMode: false,
    });
    assert.deepEqual(input.legacyPermissions, []);
    const result = resolveCanonicalAccessFromParts({
      userId: "u",
      role: "ADMIN",
      profileSnapshot: projectAccessProfilePermissionsToSnapshot(["dashboard.view"]),
      legacyPermissions: ["finance.view"],
      legacyCompatMode: false,
    });
    assert.equal(canCanonicalAccess(result, "finance", "view"), false);
    assert.equal(canCanonicalAccess(result, "dashboard", "view"), true);
  });
});
