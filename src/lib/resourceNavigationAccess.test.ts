import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import { ResourceKeys } from "@/src/lib/permissionsClient.js";
import {
  buildResourceAwareSidebarNavigation,
  canAccessPath,
  canViewModule,
  canViewResource,
  evaluatePathViewAccess,
  filterTabsByView,
  getSafeFirstAllowedPath,
  pickAllowedTabId,
  resolveSafeNavigateTarget,
} from "./resourceNavigationAccess.ts";

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (list) => list.some((p) => set.has(p)),
    authUser: { effectivePermissions: perms },
  };
}

function user(partial: {
  role: AuthUser["role"];
  permissions?: string[];
  isActive?: boolean;
}): AuthUser {
  const permissions = partial.permissions ?? [];
  return {
    id: "u1",
    name: "Test",
    email: "t@example.com",
    role: partial.role,
    permissions,
    effectivePermissions: permissions,
    accessProfileId: null,
    accessProfileName: null,
    employeeId: null,
    employeeName: null,
    employeeDepartment: null,
    isActive: partial.isActive ?? true,
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function ctx(role: AuthUser["role"], permissions: string[] = []) {
  const u = user({ role, permissions });
  return { user: u, checker: checker(permissions) };
}

describe("resourceNavigationAccess — perfis", () => {
  it("SUPER_ADMIN acessa qualquer módulo mapeado e path", () => {
    const c = ctx("SUPER_ADMIN", []);
    assert.equal(canViewModule("finance", c), true);
    assert.equal(canViewModule("fleet", c), true);
    assert.equal(canAccessPath("/finance", c), true);
    assert.equal(canAccessPath("/fleet", c), true);
    assert.equal(evaluatePathViewAccess("/crm-commercial", c).reason, "super_admin");
    assert.equal(getSafeFirstAllowedPath(c), "/dashboard");
  });

  it("ADMIN com matriz de role vê CRM / financeiro resource-key", () => {
    const c = ctx("ADMIN", []);
    assert.equal(canViewResource(c.user, ResourceKeys.COMERCIAL_CRM), true);
    assert.equal(canViewModule("crm-commercial", c), true);
    assert.equal(canAccessPath("/crm-commercial", c), true);
    assert.equal(canAccessPath("/finance", c), true);
  });

  it("gestor comercial: CRM e pedidos; sem financeiro por resource", () => {
    const c = ctx("COMMERCIAL_MANAGER", []);
    assert.equal(canViewModule("crm-commercial", c), true);
    assert.equal(canViewModule("sales-orders", c), true);
    assert.equal(canViewModule("finance", c), false);
    assert.equal(canAccessPath("/finance", c), false);
    assert.equal(evaluatePathViewAccess("/finance", c).reason, "denied");
  });

  it("vendedor: CRM + pedidos; sem settings", () => {
    const c = ctx("SELLER", ["crm.view", "sales_orders.view", "dashboard.view"]);
    assert.equal(canViewModule("crm-commercial", c), true);
    assert.equal(canViewModule("sales-orders", c), true);
    assert.equal(canViewModule("settings", c), false);
    assert.equal(canAccessPath("/settings", c), false);
  });

  it("viewer: pedidos pela matriz; CRM negado", () => {
    const c = ctx("VIEWER", []);
    assert.equal(canViewModule("sales-orders", c), true);
    assert.equal(canViewModule("crm-commercial", c), false);
    assert.equal(canAccessPath("/crm-commercial", c), false);
  });

  it("deny específico: sem aliases de financeiro → path financeiro negado", () => {
    const c = ctx("VIEWER", ["dashboard.view", "sales_orders.view"]);
    assert.equal(canAccessPath("/finance", c), false);
    assert.equal(canAccessPath("/finance/portfolio-reconciliation", c), false);
    assert.equal(canAccessPath("/dashboard", c), true);
  });

  it("usuário legado: só permissions[] (sem role matrix útil) via aliases", () => {
    const c = ctx("VIEWER", [
      "finance.portfolioReconciliation.view",
      "finance.portfolioReconciliation.orderStatusPedidos.view",
    ]);
    assert.equal(canViewModule("portfolio-reconciliation", c), true);
    assert.equal(canAccessPath("/finance/portfolio-reconciliation", c), true);
    // finance pai MENU: sem elevação só por filho — sidebar/route finance sobe por alias do filho?
    // createSidebarCanViewResource: MENU elevateFromDescendants=false → /finance pode falhar
    // mas portfolio path é o mapeado — OK
    const nav = buildResourceAwareSidebarNavigation(c);
    assert.ok(nav.flatAccessibleItems.some((i) => i.id === "portfolio-reconciliation"));
  });

  it("módulo com resourceKey usa fonte resource (fleet); legado ainda cobre checks", () => {
    const withFleet = ctx("VIEWER", ["fleet.view"]);
    assert.equal(canViewModule("fleet", withFleet), true);
    assert.equal(evaluatePathViewAccess("/fleet", withFleet).source, "resource");

    const noFleet = ctx("VIEWER", ["dashboard.view"]);
    assert.equal(canViewModule("fleet", noFleet), false);
  });

  it("módulo sem resourceKey no mapa residual usa fallback legado (opex)", () => {
    const withOpex = ctx("VIEWER", ["opex.view"]);
    assert.equal(canViewModule("opex", withOpex), true);
    assert.equal(evaluatePathViewAccess("/opex", withOpex).source, "legacy");

    const noOpex = ctx("VIEWER", ["dashboard.view"]);
    assert.equal(canViewModule("opex", noOpex), false);
  });
  it("bag parcial (só AP): não libera menus de ROLE_MATRIX do VIEWER", () => {
    const c = ctx("VIEWER", [
      "dashboard.view",
      "finance.view",
      "finance.accountsPayable.view",
    ]);
    assert.equal(canViewModule("finance", c), true);
    assert.equal(canViewModule("products", c), false);
    assert.equal(canViewModule("sales-orders", c), false);
    assert.equal(canViewModule("customers", c), false);
    assert.equal(canViewModule("crm-commercial", c), false);
    assert.equal(canViewModule("settings", c), false);
    assert.equal(canAccessPath("/products", c), false);
    assert.equal(canAccessPath("/finance", c), true);
  });

  it("VIEWER com bag vazia ainda usa ROLE_MATRIX (defaults do papel)", () => {
    const c = ctx("VIEWER", []);
    assert.equal(canViewModule("sales-orders", c), true);
    assert.equal(canViewModule("products", c), true);
  });
});

describe("resourceNavigationAccess — rota e navegação segura", () => {
  it("path unmapped não bloqueia (sem loop)", () => {
    const c = ctx("SELLER", ["crm.view"]);
    const d = evaluatePathViewAccess("/area-inexistente/deep", c);
    assert.equal(d.allowed, true);
    assert.equal(d.reason, "unmapped");
  });

  it("URL direta negada → safe target ou null", () => {
    const c = ctx("SELLER", ["crm.view", "sales_orders.view", "dashboard.view"]);
    const denied = resolveSafeNavigateTarget("/settings", c);
    assert.equal(denied.deniedDesired, true);
    assert.ok(denied.path === "/dashboard" || denied.path === "/crm-commercial" || denied.path === "/sales-orders");
    assert.equal(canAccessPath(denied.path!, c), true);

    const empty = ctx("VIEWER", []);
    // VIEWER role matrix ainda libera dashboard + sales-orders
    const home = getSafeFirstAllowedPath(empty);
    assert.ok(home);
  });

  it("sem nenhuma área: null (não redireciona em loop)", () => {
    const inactive = {
      user: user({ role: "VIEWER", permissions: ["dashboard.view", "reports.view"], isActive: false }),
      checker: checker(["dashboard.view", "reports.view"]),
    };
    assert.equal(getSafeFirstAllowedPath(inactive), null);
    const target = resolveSafeNavigateTarget("/dashboard", inactive);
    assert.equal(target.path, null);
  });
});

describe("resourceNavigationAccess — abas", () => {
  it("filtra abas sem view; pickAllowed evita aba ilegal", () => {
    const tabs = [
      { id: "a" as const, resourceKey: ResourceKeys.COMERCIAL_CRM_TAB_GESTAO_GERAL },
      { id: "b" as const, resourceKey: ResourceKeys.COMERCIAL_CRM_TAB_GESTAO_VENDEDOR },
    ];
    const seller = ctx("SELLER", []);
    const canView = (key: string) => canViewResource(seller.user, key);
    const visible = filterTabsByView(tabs, canView, {
      parentResourceKey: ResourceKeys.COMERCIAL_CRM,
    });
    assert.deepEqual(
      visible.map((t) => t.id),
      ["b"]
    );
    assert.equal(pickAllowedTabId("a", visible.map((t) => t.id)), "b");
    assert.equal(pickAllowedTabId("b", visible.map((t) => t.id)), "b");
    assert.equal(pickAllowedTabId("a", []), null);
  });

  it("pai sem view → nenhuma aba (filho depende do pai)", () => {
    const viewer = ctx("VIEWER", []);
    const tabs = [
      { id: "x", resourceKey: ResourceKeys.COMERCIAL_CRM_TAB_GESTAO_GERAL },
    ];
    const canView = (key: string) => canViewResource(viewer.user, key);
    assert.deepEqual(
      filterTabsByView(tabs, canView, { parentResourceKey: ResourceKeys.COMERCIAL_CRM }),
      []
    );
  });
});
