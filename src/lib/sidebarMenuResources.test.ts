import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import { createSidebarCanViewResource, ResourceKeys } from "./permissionsClient.ts";
import { buildAccessibleSidebarNavigation } from "./sidebarNavigation.ts";
import {
  SIDEBAR_GROUP_RESOURCE_KEYS,
  SIDEBAR_MODULE_RESOURCE_KEYS,
} from "./sidebarMenuResources.ts";
import type { PermissionChecker } from "./modulePermissions.ts";

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (list) => list.some((p) => set.has(p)),
  };
}

function user(partial: {
  role: AuthUser["role"];
  permissions?: string[];
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
    isActive: true,
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function navFor(authUser: AuthUser) {
  return buildAccessibleSidebarNavigation(checker(authUser.effectivePermissions), undefined, {
    canViewResource: createSidebarCanViewResource(authUser),
  });
}

describe("sidebar menu resourceKeys", () => {
  it("mapa central cobre menus principais", () => {
    assert.equal(SIDEBAR_MODULE_RESOURCE_KEYS.dashboard, ResourceKeys.DASHBOARD);
    assert.equal(SIDEBAR_MODULE_RESOURCE_KEYS.finance, ResourceKeys.FINANCEIRO);
    assert.equal(
      SIDEBAR_MODULE_RESOURCE_KEYS["portfolio-reconciliation"],
      ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA
    );
    assert.equal(SIDEBAR_MODULE_RESOURCE_KEYS.commissions, ResourceKeys.COMISSOES);
    assert.equal(SIDEBAR_MODULE_RESOURCE_KEYS.materials, ResourceKeys.SUPRIMENTOS);
    assert.equal(SIDEBAR_MODULE_RESOURCE_KEYS.settings, ResourceKeys.CONFIGURACOES);
    assert.equal(SIDEBAR_MODULE_RESOURCE_KEYS.customers, ResourceKeys.COMERCIAL_CLIENTES);
    assert.equal(SIDEBAR_MODULE_RESOURCE_KEYS.proposals, ResourceKeys.COMERCIAL_PROPOSTAS);
    assert.equal(SIDEBAR_MODULE_RESOURCE_KEYS.pricing, ResourceKeys.COMERCIAL_FORMACAO_PRECO);
    assert.equal(SIDEBAR_MODULE_RESOURCE_KEYS.products, ResourceKeys.ENGENHARIA_PRODUTOS);
    assert.equal(SIDEBAR_MODULE_RESOURCE_KEYS.projects, ResourceKeys.ENGENHARIA_PROJETOS);
    assert.equal(SIDEBAR_MODULE_RESOURCE_KEYS.inventory, ResourceKeys.OPERACOES_ESTOQUE);
    assert.equal(SIDEBAR_MODULE_RESOURCE_KEYS.employees, ResourceKeys.ADMIN_PESSOAS);
    assert.equal(SIDEBAR_MODULE_RESOURCE_KEYS.guide, ResourceKeys.ADMIN_GUIA);
    assert.equal(SIDEBAR_MODULE_RESOURCE_KEYS.fleet, ResourceKeys.OPERACOES_FROTA);
    assert.equal(SIDEBAR_GROUP_RESOURCE_KEYS.financeiro, ResourceKeys.FINANCEIRO);
    assert.equal(SIDEBAR_GROUP_RESOURCE_KEYS.comercial, ResourceKeys.COMERCIAL);
    assert.equal(SIDEBAR_GROUP_RESOURCE_KEYS.administracao, ResourceKeys.ADMIN);
    assert.equal(SIDEBAR_GROUP_RESOURCE_KEYS.engenharia, ResourceKeys.ENGENHARIA);
    assert.equal(SIDEBAR_GROUP_RESOURCE_KEYS.operacoes, ResourceKeys.OPERACOES);
  });

  it("usuário sem financeiro não vê grupo Financeiro", () => {
    const nav = navFor(user({ role: "SELLER", permissions: ["crm.view"] }));
    assert.ok(!nav.groups.some((g) => g.id === "financeiro"));
    assert.ok(!nav.flatAccessibleItems.some((i) => i.id === "finance"));
    assert.ok(!nav.flatAccessibleItems.some((i) => i.id === "portfolio-reconciliation"));
  });

  it("usuário só com Conciliação vê Financeiro > Conciliação, sem outras opções resource-key", () => {
    const nav = navFor(
      user({
        role: "VIEWER",
        permissions: [
          "finance.portfolioReconciliation.view",
          "finance.portfolioReconciliation.conciliation.view",
        ],
      })
    );
    const financeiro = nav.groups.find((g) => g.id === "financeiro");
    assert.ok(financeiro);
    assert.deepEqual(
      financeiro!.items.map((i) => i.itemId),
      ["portfolio-reconciliation"]
    );
    assert.equal(
      financeiro!.items[0]?.resourceKey,
      ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA
    );
  });

  it("usuário sem Admin/settings não vê Administração", () => {
    const nav = navFor(user({ role: "SELLER", permissions: ["crm.view", "sales_orders.view"] }));
    assert.ok(!nav.groups.some((g) => g.id === "administracao"));
    assert.ok(!nav.flatAccessibleItems.some((i) => i.id === "settings"));
  });

  it("SUPER_ADMIN vê tudo mapeado", () => {
    const nav = navFor(user({ role: "SUPER_ADMIN", permissions: [] }));
    assert.ok(nav.groups.some((g) => g.id === "financeiro"));
    assert.ok(nav.groups.some((g) => g.id === "comercial"));
    assert.ok(nav.groups.some((g) => g.id === "administracao"));
    assert.ok(nav.flatAccessibleItems.some((i) => i.id === "portfolio-reconciliation"));
    assert.ok(nav.flatAccessibleItems.some((i) => i.id === "commissions"));
    assert.ok(nav.flatAccessibleItems.some((i) => i.id === "materials"));
    assert.ok(nav.flatAccessibleItems.some((i) => i.id === "settings"));
  });

  it("itens sem resourceKey continuam no fallback canAccessModule", () => {
    const nav = navFor(user({ role: "VIEWER", permissions: ["products.view"] }));
    assert.ok(nav.flatAccessibleItems.some((i) => i.id === "products"));
  });
});
