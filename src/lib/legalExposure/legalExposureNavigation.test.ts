import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAccessModule, MODULE_LABELS, SIDEBAR_MODULE_ORDER } from "@/src/lib/modulePermissions.js";
import { getModulePath, resolveNavigationGroupIdForModule } from "@/src/lib/navigationGroups.js";
import {
  canViewSidebarModuleFromDto,
  SIDEBAR_MODULE_CONTRACT_KEYS,
} from "@/src/lib/sidebarEffectiveAccess.js";
import { resolveSidebarModuleResourceKey } from "@/src/lib/sidebarMenuResources.js";
import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";

function checker(permissions: string[]) {
  const set = new Set(permissions);
  return {
    hasPermission: (key: string) => set.has(key),
    hasAnyPermission: (keys: string[]) => keys.some((key) => set.has(key)),
  };
}

function dto(resource: string | null): EffectiveAccessMeDto {
  return {
    permissionsVersion: 0,
    role: "VIEWER",
    isSuperAdmin: false,
    allowedResources: resource ? [resource] : [],
    actionsByResource: resource ? { [resource]: ["view"] } : {},
    navigationReveal: [],
    capabilities: resource
      ? { [resource]: { canView: true, canExecute: false, canManage: false } }
      : {},
    compatibility: {
      mode: "session",
      legacyBagAuthoritative: true,
      legacyPermissionsPresent: true,
      legacyCompatApplied: true,
    },
  };
}

describe("exposure navigation", () => {
  it("entra no menu, no path e no grupo Administração", () => {
    assert.equal(SIDEBAR_MODULE_ORDER.includes("exposure"), true);
    assert.equal(MODULE_LABELS.exposure, "Exposure");
    assert.equal(getModulePath("exposure"), "/exposure");
    assert.equal(resolveNavigationGroupIdForModule("exposure"), "administracao");
    assert.deepEqual(SIDEBAR_MODULE_CONTRACT_KEYS.exposure, ["admin.exposure"]);
    assert.equal(resolveSidebarModuleResourceKey("exposure"), "admin.exposure");
  });

  it("permissão própria mostra; settings, finance e employees não mostram", () => {
    assert.equal(canAccessModule("exposure", checker(["legal.exposure.view"])), true);
    assert.equal(canViewSidebarModuleFromDto(dto("admin.exposure"), "exposure"), true);
    for (const permission of ["settings.view", "finance.view", "employees.view"]) {
      assert.equal(canAccessModule("exposure", checker([permission])), false, permission);
    }
    assert.equal(canViewSidebarModuleFromDto(dto("admin.settings"), "exposure"), false);
    assert.equal(canViewSidebarModuleFromDto(dto(null), "exposure"), false);
  });
});
