/**
 * PERM-42 — árvore oficial Operações + Administração (módulos restantes).
 *
 * Nota: o item citado como "ammonia" no planejamento = **Almoxarifados**
 * (`operations.inventory.warehouses` / aba Estoque).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import { INVENTORY_UI_TABS } from "@/src/lib/moduleTabResources.js";
import { resolveAuthorizedTabs } from "@/src/lib/authorizedTabs.js";
import {
  canAccessPath,
  canPerformAction,
  canViewModule,
  type NavigationAccessContext,
} from "@/src/lib/resourceNavigationAccess.js";
import {
  effectiveAccessDtoFromAllowedResources,
  filterOfficialSidebarByEffectiveAccess,
} from "@/src/lib/sidebarEffectiveAccess.js";
import { authorizeRequireResource } from "@/src/lib/security/requireResource.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess.js";
import {
  canCreatePurchases,
  canEditMachines,
  canManageFleet,
  canManageMaintenance,
  canViewFleet,
  canViewGuide,
  canViewInventory,
  canViewOperationsPerformance,
  canViewPurchases,
  INVENTORY_TAB_RESOURCE_KEYS,
} from "@/src/lib/operationsAdminPermissions.js";
import { ACTION_PERMISSION_SURFACES } from "@/src/lib/actionPermissionCatalog.js";
import { canAccessModule } from "@/src/lib/modulePermissions.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function user(role: AuthUser["role"] = "VIEWER"): AuthUser {
  return {
    id: "u-perm42",
    name: "P42",
    email: "p42@example.com",
    role,
    permissions: [],
    effectivePermissions: [],
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
  };
}

const OPS_ALL = [
  OPERATIONS_RESOURCE_KEYS.inventory,
  OPERATIONS_RESOURCE_KEYS.inventoryItems,
  OPERATIONS_RESOURCE_KEYS.inventoryWarehouses,
  OPERATIONS_RESOURCE_KEYS.inventoryMovements,
  OPERATIONS_RESOURCE_KEYS.inventoryCounts,
  OPERATIONS_RESOURCE_KEYS.purchases,
  OPERATIONS_RESOURCE_KEYS.machines,
  OPERATIONS_RESOURCE_KEYS.performance,
  OPERATIONS_RESOURCE_KEYS.productionOrders,
  OPERATIONS_RESOURCE_KEYS.maintenance,
  OPERATIONS_RESOURCE_KEYS.fleet,
] as const;

const ADMIN_SLICE = ["admin.employees", "admin.guide", "admin.settings"] as const;

function dtoFromKeys(
  keys: readonly string[],
  actions?: EffectiveAccessMeDto["actionsByResource"]
): EffectiveAccessMeDto {
  const base = effectiveAccessDtoFromAllowedResources(keys);
  if (!actions) return base;
  return {
    ...base,
    actionsByResource: { ...base.actionsByResource, ...actions },
    capabilities: {
      ...base.capabilities,
      ...Object.fromEntries(
        Object.entries(actions).map(([k, acts]) => [
          k,
          {
            canView: acts.includes("view"),
            canExecute: acts.some((a) =>
              ["execute", "create", "update", "manage", "approve"].includes(a)
            ),
            canManage: acts.includes("manage"),
          },
        ])
      ),
    },
  };
}

function ctx(
  keys: readonly string[],
  actions?: EffectiveAccessMeDto["actionsByResource"]
): NavigationAccessContext {
  return {
    user: user("VIEWER"),
    checker: {
      hasPermission: () => false,
      hasAnyPermission: () => false,
      authUser: null,
    },
    effectiveAccess: dtoFromKeys(keys, actions),
    authLoading: false,
    authError: null,
  };
}

function authBag(permissions: string[]): AppAuthContext {
  return {
    id: "u-perm42",
    name: "P42",
    email: "p42@example.com",
    role: "VIEWER",
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
    sessionId: "s-perm42",
  };
}

describe("PERM-42 — ammonia = Almoxarifados", () => {
  it("identifica Almoxarifados como operations.inventory.warehouses", () => {
    assert.equal(
      INVENTORY_TAB_RESOURCE_KEYS.warehouses,
      OPERATIONS_RESOURCE_KEYS.inventoryWarehouses
    );
    const tab = INVENTORY_UI_TABS.find((t) => t.id === "warehouses");
    assert.ok(tab);
    assert.equal(tab!.label, "Almoxarifados");
    assert.equal(tab!.resourceKey, "operations.inventory.warehouses");
    assert.doesNotMatch(
      read("src/lib/moduleTabResources.ts"),
      /ammonia/i
    );
  });
});

describe("PERM-42 — liberação individual de submenus Operações", () => {
  it("inventory-only: só Estoque no grupo; sem compras/frota/manutenção", () => {
    const dto = effectiveAccessDtoFromAllowedResources([
      OPERATIONS_RESOURCE_KEYS.inventory,
      OPERATIONS_RESOURCE_KEYS.inventoryWarehouses,
    ]);
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    const ops = nav.groups.find((g) => g.id === "operacoes");
    assert.ok(ops);
    assert.deepEqual(
      ops!.items.map((i) => i.itemId),
      ["inventory"]
    );
    const ids = nav.flatAccessibleItems.map((i) => i.id);
    assert.equal(ids.includes("purchases"), false);
    assert.equal(ids.includes("fleet"), false);
    assert.equal(ids.includes("maintenance"), false);
  });

  for (const [moduleId, key] of [
    ["purchases", OPERATIONS_RESOURCE_KEYS.purchases],
    ["machines", OPERATIONS_RESOURCE_KEYS.machines],
    ["operations-performance", OPERATIONS_RESOURCE_KEYS.performance],
    ["production-orders", OPERATIONS_RESOURCE_KEYS.productionOrders],
    ["maintenance", OPERATIONS_RESOURCE_KEYS.maintenance],
    ["fleet", OPERATIONS_RESOURCE_KEYS.fleet],
  ] as const) {
    it(`${moduleId}-only: path ok; irmãos ops negados`, () => {
      const c = ctx([key]);
      assert.equal(canViewModule(moduleId, c), true);
      assert.equal(canViewModule("inventory", c), false);
      if (moduleId !== "purchases") {
        assert.equal(canViewModule("purchases", c), false);
      }
      if (moduleId !== "fleet") {
        assert.equal(canViewModule("fleet", c), false);
      }
    });
  }

  it("abas Estoque: Almoxarifados liberável; sem bleed para itens sem grant fino", () => {
    const c = ctx([
      OPERATIONS_RESOURCE_KEYS.inventory,
      OPERATIONS_RESOURCE_KEYS.inventoryWarehouses,
    ]);
    const tabs = resolveAuthorizedTabs(INVENTORY_UI_TABS, c, {
      requestedId: "items",
      parentResourceKey: OPERATIONS_RESOURCE_KEYS.inventory,
      requireParentView: true,
    });
    const ids = tabs.visibleTabs.map((t) => t.id);
    assert.ok(ids.includes("warehouses"), "Almoxarifados visível");
    assert.ok(ids.includes("overview"));
    assert.equal(ids.includes("items"), false);
    assert.equal(tabs.requestedDenied, true);
  });
});

describe("PERM-42 — bleeds removidos", () => {
  it("products.view não abre Performance (DTO nem bag)", () => {
    const c = ctx(["engineering.products"]);
    assert.equal(canViewModule("operations-performance", c), false);
    assert.equal(canAccessPath("/operations-performance", c), false);
    assert.equal(
      canViewOperationsPerformance({
        hasPermission: (k) => k === "products.view",
        hasAnyPermission: (list) => list.includes("products.view"),
      }),
      false
    );
    assert.equal(
      canAccessModule("operations-performance", {
        hasPermission: (k) => k === "products.view",
        hasAnyPermission: (list) => list.includes("products.view"),
      }),
      false
    );
  });

  it("dashboard.view não abre Guia", () => {
    const c = ctx(["dashboard"]);
    assert.equal(canViewModule("guide", c), false);
    assert.equal(
      canViewGuide({
        hasPermission: (k) => k === "dashboard.view",
        hasAnyPermission: () => false,
      }),
      false
    );
    assert.equal(
      canAccessModule("guide", {
        hasPermission: (k) => k === "dashboard.view",
        hasAnyPermission: () => false,
      }),
      false
    );
  });
});

describe("PERM-42 — CRUD separado + APIs", () => {
  it("compras: view ≠ create; máquinas: view ≠ update", () => {
    const viewOnly = ctx([
      OPERATIONS_RESOURCE_KEYS.purchases,
      OPERATIONS_RESOURCE_KEYS.machines,
    ]);
    const check = {
      hasPermission: () => false,
      canPerformAction: (rk: string, a: string) =>
        canPerformAction(rk, a as "view", viewOnly),
    };
    assert.equal(canViewPurchases(check), true);
    assert.equal(canCreatePurchases(check), false);
    assert.equal(canEditMachines(check), false);

    const withCrud = ctx(OPS_ALL, {
      [OPERATIONS_RESOURCE_KEYS.purchases]: ["view", "create", "update"],
      [OPERATIONS_RESOURCE_KEYS.machines]: ["view", "update"],
      [OPERATIONS_RESOURCE_KEYS.maintenance]: ["view", "manage"],
      [OPERATIONS_RESOURCE_KEYS.fleet]: ["view", "manage"],
    });
    const can = (rk: string, a: string) =>
      canPerformAction(rk, a as "manage", withCrud);
    assert.equal(
      canCreatePurchases({ hasPermission: () => false, canPerformAction: can }),
      true
    );
    assert.equal(
      canEditMachines({ hasPermission: () => false, canPerformAction: can }),
      true
    );
    assert.equal(
      canManageMaintenance({ hasPermission: () => false, canPerformAction: can }),
      true
    );
    assert.equal(
      canManageFleet({ hasPermission: () => false, canPerformAction: can }),
      true
    );
  });

  it("API: inventory/purchases/fleet ok; commercial negado", () => {
    const a = authBag([
      "purchases.view",
      "fleet.view",
      "maintenance.view",
    ]);
    // inventory.view é multi-owner no contrato — não projeta 1:1; perfil explícito.
    const opts = {
      legacyCompatMode: true as const,
      profileSnapshot: {
        [OPERATIONS_RESOURCE_KEYS.inventory]: { view: true },
      },
    };
    assert.equal(
      authorizeRequireResource(a, OPERATIONS_RESOURCE_KEYS.inventory, "view", opts)
        .ok,
      true
    );
    assert.equal(
      authorizeRequireResource(a, OPERATIONS_RESOURCE_KEYS.purchases, "view", opts)
        .ok,
      true
    );
    assert.equal(
      authorizeRequireResource(a, OPERATIONS_RESOURCE_KEYS.fleet, "view", opts).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(a, "commercial.pricing", "view", opts).ok,
      false
    );
    const deniedCreate = authorizeRequireResource(
      a,
      OPERATIONS_RESOURCE_KEYS.purchases,
      "create",
      opts
    );
    assert.equal(deniedCreate.ok, false);
    if (!deniedCreate.ok) assert.equal(deniedCreate.status, 403);
  });

  it("admin slice: employees + guide; ops ocultos", () => {
    const dto = effectiveAccessDtoFromAllowedResources([...ADMIN_SLICE]);
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    const ids = nav.flatAccessibleItems.map((i) => i.id);
    assert.ok(ids.includes("employees"));
    assert.ok(ids.includes("guide"));
    assert.equal(ids.includes("inventory"), false);
    assert.equal(ids.includes("fleet"), false);
  });
});

describe("PERM-42 — wiring FE/BE", () => {
  it("catálogo inclui ops: inventory, purchases, machines, maintenance, fleet", () => {
    const ids = ACTION_PERMISSION_SURFACES.map((s) => s.id);
    assert.ok(ids.includes("inventory"));
    assert.ok(ids.includes("purchases"));
    assert.ok(ids.includes("machines"));
    assert.ok(ids.includes("maintenance"));
    assert.ok(ids.includes("fleet"));
    assert.ok(ids.includes("operations-performance"));
  });

  it("InventoryModule usa canViewModule DTO; sem canAccessModule bag", () => {
    const mod = read("src/components/InventoryModule.tsx");
    assert.match(mod, /canViewModule\("inventory"\)/);
    assert.doesNotMatch(mod, /canAccessModule\("inventory"/);
  });

  it("helpers DTO-first sem products.view / dashboard.view", () => {
    const src = read("src/lib/operationsAdminPermissions.ts");
    const perf = src.slice(src.indexOf("canViewOperationsPerformance"));
    const perfBody = perf.slice(0, perf.indexOf("export function", 1));
    assert.doesNotMatch(perfBody, /products\.view/);
    const guide = src.slice(src.indexOf("canViewGuide"));
    const guideBody = guide.slice(0, guide.indexOf("export function", 1));
    assert.doesNotMatch(guideBody, /dashboard\.view/);
  });

  it("inventoryPermissions e fleetPermissions usam canPerformAction", () => {
    assert.match(
      read("src/components/inventory/inventoryPermissions.ts"),
      /canPerformAction/
    );
    assert.match(
      read("src/components/fleet/fleetPermissions.ts"),
      /canPerformAction|OPERATIONS_RESOURCE_KEYS\.fleet/
    );
  });

  it("fleet view DTO sem manage; financeiro separado", () => {
    const c = ctx([OPERATIONS_RESOURCE_KEYS.fleet]);
    assert.equal(
      canViewFleet({
        hasPermission: () => false,
        canPerformAction: (rk, a) => canPerformAction(rk, a as "view", c),
      }),
      true
    );
    assert.equal(
      canManageFleet({
        hasPermission: () => false,
        canPerformAction: (rk, a) => canPerformAction(rk, a as "manage", c),
      }),
      false
    );
  });

  it("canViewInventory DTO autoritativo", () => {
    const onlyInv = ctx([OPERATIONS_RESOURCE_KEYS.inventory]);
    assert.equal(
      canViewInventory({
        hasPermission: () => false,
        canPerformAction: (rk, a) => canPerformAction(rk, a as "view", onlyInv),
      }),
      true
    );
  });
});
