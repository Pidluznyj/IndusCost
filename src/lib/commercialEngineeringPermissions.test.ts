import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import { createPermissionsApi, ResourceKeys } from "@/src/lib/permissionsClient.js";
import { buildResourceAwareSidebarNavigation, canViewModule } from "@/src/lib/resourceNavigationAccess.js";
import {
  canCreateCustomers,
  canDeletePricingPremises,
  canEditCustomers,
  canExportSalesOrders,
  canViewProducts,
  canViewProposals,
  canViewSalesOrders,
  listVisibleProductTabIds,
} from "./commercialEngineeringPermissions.ts";

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

describe("commercialEngineeringPermissions — comercial", () => {
  it("clientes: view vs create/edit", () => {
    const viewOnly = checker(["customers.view"]);
    assert.equal(canCreateCustomers(viewOnly), false);
    assert.equal(canEditCustomers(viewOnly), false);
    assert.equal(canCreateCustomers(checker(["customers.create"])), true);
    assert.equal(canEditCustomers(checker(["customers.edit"])), true);
  });

  it("propostas / pedidos / export usam chaves oficiais", () => {
    const u = user("SELLER", ["proposals.view", "sales_orders.view"]);
    const api = createPermissionsApi(u);
    const check = { ...checker(u.effectivePermissions), canViewResource: api.canView };
    assert.equal(canViewProposals(check), true);
    assert.equal(canViewSalesOrders(check), true);
    assert.equal(canExportSalesOrders(check), true);
    assert.equal(canExportSalesOrders(checker([])), false);
  });

  it("pricing: delete exige generate/publish, não view", () => {
    assert.equal(canDeletePricingPremises(checker(["pricing.view"])), false);
    assert.equal(canDeletePricingPremises(checker(["pricing.generate_tables"])), true);
    assert.equal(canDeletePricingPremises(checker(["pricing.publish_tables"])), true);
  });
});

describe("commercialEngineeringPermissions — engenharia", () => {
  it("produtos e abas via resource + legado", () => {
    const u = user("VIEWER", ["products.view", "products.tab.bom", "products.tab.info"]);
    const api = createPermissionsApi(u);
    const check = { ...checker(u.effectivePermissions), canViewResource: api.canView };
    assert.equal(canViewProducts(check), true);
    const tabs = listVisibleProductTabIds(check);
    assert.ok(tabs.includes("bom"));
    assert.ok(tabs.includes("info"));
    assert.equal(tabs.includes("cost"), false);
  });

  it("ADMIN vê módulos comerciais/engenharia no sidebar resource-aware", () => {
    const u = user("ADMIN", []);
    const ctx = { user: u, checker: checker([]) };
    assert.equal(canViewModule("customers", ctx), true);
    assert.equal(canViewModule("proposals", ctx), true);
    assert.equal(canViewModule("pricing", ctx), true);
    assert.equal(canViewModule("products", ctx), true);
    assert.equal(canViewModule("projects", ctx), true);
    assert.equal(canViewModule("simulations", ctx), true);
    assert.equal(canViewModule("transformation-simulator", ctx), true);
    const nav = buildResourceAwareSidebarNavigation(ctx);
    assert.ok(nav.flatAccessibleItems.some((i) => i.id === "products"));
    assert.ok(nav.flatAccessibleItems.some((i) => i.id === "customers"));
  });

  it("SUPER_ADMIN não perde engenharia", () => {
    const u = user("SUPER_ADMIN", []);
    const ctx = { user: u, checker: checker([]) };
    assert.equal(canViewModule("products", ctx), true);
    assert.equal(createPermissionsApi(u).canView(ResourceKeys.ENGENHARIA_PRODUTOS_TAB_COST), true);
  });
});
