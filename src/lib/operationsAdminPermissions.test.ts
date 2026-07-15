import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import { createPermissionsApi, ResourceKeys } from "@/src/lib/permissionsClient.js";
import { buildResourceAwareSidebarNavigation, canViewModule } from "@/src/lib/resourceNavigationAccess.js";
import {
  canEditMachines,
  canManageMaintenance,
  canViewEmployeeCompensation,
  canViewEmployeeEmergencyContacts,
  canViewEmployees,
  canViewFleet,
  canViewGuide,
  canViewInventory,
  canViewMachines,
  listVisibleInventoryTabIds,
} from "./operationsAdminPermissions.ts";

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (list) => list.some((p) => set.has(p)),
    authUser: { effectivePermissions: perms },
  };
}

function user(role: AuthUser["role"], permissions: string[] = []): AuthUser {
  return {
    id: "u1",
    name: "Test",
    email: "t@example.com",
    role,
    permissions,
    effectivePermissions: permissions,
    accessProfileId: null,
    accessProfileName: null,
    isActive: true,
    externalSellerId: null,
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("operationsAdminPermissions — operações", () => {
  it("estoque: view módulo e abas finas", () => {
    const check = {
      ...checker(["inventory.view"]),
      canViewResource: createPermissionsApi(user("VIEWER", ["inventory.view"])).canView,
    };
    assert.equal(canViewInventory(check), true);
    const tabs = listVisibleInventoryTabIds(
      ["overview", "items", "warehouses", "movements", "counts", "balances"],
      check
    );
    assert.ok(tabs.includes("overview"));
    assert.ok(tabs.includes("items"));
  });

  it("máquinas: edit exige machines.edit", () => {
    assert.equal(canEditMachines(checker(["machines.view"])), false);
    assert.equal(canEditMachines(checker(["machines.edit"])), true);
    const check = {
      ...checker(["machines.view", "costs.view"]),
      canViewResource: createPermissionsApi(
        user("VIEWER", ["machines.view", "costs.view"])
      ).canView,
    };
    assert.equal(canViewMachines(check), true);
  });

  it("manutenção manage e frota view", () => {
    assert.equal(canManageMaintenance(checker(["maintenance.view"])), false);
    assert.equal(canManageMaintenance(checker(["maintenance.manage"])), true);
    const fleet = {
      ...checker(["fleet.view"]),
      canViewResource: createPermissionsApi(user("VIEWER", ["fleet.view"])).canView,
    };
    assert.equal(canViewFleet(fleet), true);
  });
});

describe("operationsAdminPermissions — admin / RH sensível", () => {
  it("costs.view vê RH mas não salário/emergência", () => {
    const check = {
      ...checker(["costs.view"]),
      canViewResource: createPermissionsApi(user("VIEWER", ["costs.view"])).canView,
    };
    assert.equal(canViewEmployees(check), true);
    assert.equal(canViewEmployeeCompensation(check), false);
    assert.equal(canViewEmployeeEmergencyContacts(check), false);
  });

  it("employees.edit libera dados sensíveis", () => {
    const check = checker(["employees.edit"]);
    assert.equal(canViewEmployeeCompensation(check), true);
    assert.equal(canViewEmployeeEmergencyContacts(check), true);
  });

  it("guia e sidebar ops/admin para ADMIN", () => {
    const u = user("ADMIN", []);
    const ctx = { user: u, checker: checker([]) };
    assert.equal(canViewModule("inventory", ctx), true);
    assert.equal(canViewModule("employees", ctx), true);
    assert.equal(canViewModule("guide", ctx), true);
    assert.equal(canViewModule("fleet", ctx), true);
    assert.equal(canViewModule("settings", ctx), true);
    const nav = buildResourceAwareSidebarNavigation(ctx);
    assert.ok(nav.flatAccessibleItems.some((i) => i.id === "inventory"));
    assert.ok(nav.flatAccessibleItems.some((i) => i.id === "employees"));
    assert.ok(nav.groups.some((g) => g.id === "operacoes") || nav.flatAccessibleItems.some((i) => i.id === "fleet"));
    assert.equal(createPermissionsApi(u).canView(ResourceKeys.OPERACOES_ESTOQUE), true);
    assert.equal(canViewGuide({ ...ctx.checker, canViewResource: createPermissionsApi(u).canView }), true);
  });

  it("SUPER_ADMIN mantém ops/admin", () => {
    const u = user("SUPER_ADMIN", []);
    const ctx = { user: u, checker: checker([]) };
    assert.equal(canViewModule("machines", ctx), true);
    assert.equal(canViewModule("maintenance", ctx), true);
    assert.equal(createPermissionsApi(u).canView(ResourceKeys.ADMIN_PESSOAS), true);
  });
});
