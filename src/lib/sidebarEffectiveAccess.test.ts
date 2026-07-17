/**
 * P10 — sidebar só DTO efetivo (personas + regras de grupo/parent).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import {
  buildResourceAwareSidebarNavigation,
  canViewModule,
} from "@/src/lib/resourceNavigationAccess.js";
import {
  buildSidebarNavigationFromEffectiveAccess,
  canViewSidebarModuleFromDto,
  listSidebarModulesMissingContractMap,
  projectSidebarContractKeysFromLegacyBag,
  resolveSidebarEffectiveAccessDto,
  SIDEBAR_MODULE_CONTRACT_KEYS,
} from "@/src/lib/sidebarEffectiveAccess.js";
import { SIDEBAR_MODULE_ORDER } from "@/src/lib/modulePermissions.js";

function user(partial: {
  role: AuthUser["role"];
  permissions?: string[];
  isActive?: boolean;
}): AuthUser {
  const permissions = partial.permissions ?? [];
  return {
    id: "sidebar-p10",
    name: "P10",
    email: "p10@example.com",
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
  return {
    user: u,
    checker: {
      hasPermission: (p: string) => permissions.includes(p),
      hasAnyPermission: (list: string[]) => list.some((p) => permissions.includes(p)),
      authUser: { effectivePermissions: permissions },
    },
  };
}

describe("sidebarEffectiveAccess — mapa completo", () => {
  it("todos os módulos da sidebar têm contract keys", () => {
    assert.deepEqual(listSidebarModulesMissingContractMap(), []);
    for (const id of SIDEBAR_MODULE_ORDER) {
      assert.ok(
        (SIDEBAR_MODULE_CONTRACT_KEYS[id]?.length ?? 0) > 0,
        `faltando mapa para ${id}`
      );
    }
  });
});

describe("sidebarEffectiveAccess — personas", () => {
  it("Leticia só AP: finance shell + sem portfolio/RH/engenharia/comercial", () => {
    const c = ctx("VIEWER", ["finance.accountsPayable.view"]);
    assert.equal(canViewModule("finance", c), true);
    assert.equal(canViewModule("portfolio-reconciliation", c), false);
    assert.equal(canViewModule("employees", c), false);
    assert.equal(canViewModule("products", c), false);
    assert.equal(canViewModule("sales-orders", c), false);
    assert.equal(canViewModule("crm-commercial", c), false);
    assert.equal(canViewModule("dashboard", c), false);
    const nav = buildResourceAwareSidebarNavigation(c);
    const ids = nav.flatAccessibleItems.map((i) => i.id);
    assert.ok(ids.includes("finance"));
    assert.equal(ids.includes("portfolio-reconciliation"), false);
    assert.equal(ids.includes("employees"), false);
  });

  it("VIEWER vazio: sidebar vazia", () => {
    const c = ctx("VIEWER", []);
    const nav = buildResourceAwareSidebarNavigation(c);
    assert.equal(nav.flatAccessibleItems.length, 0);
    assert.equal(nav.groups.length, 0);
    assert.equal(canViewModule("dashboard", c), false);
  });

  it("SUPER_ADMIN: árvore completa", () => {
    const c = ctx("SUPER_ADMIN", []);
    const nav = buildResourceAwareSidebarNavigation(c);
    assert.equal(nav.flatAccessibleItems.length, SIDEBAR_MODULE_ORDER.length);
  });

  it("financeiro amplo: finance + filhos autorizados; sem RH", () => {
    const c = ctx("VIEWER", [
      "dashboard.view",
      "finance.view",
      "finance.accountsPayable.view",
      "finance.accountsReceivable.view",
      "finance.portfolioReconciliation.view",
      "finance.suppliers.view",
    ]);
    assert.equal(canViewModule("finance", c), true);
    assert.equal(canViewModule("portfolio-reconciliation", c), true);
    assert.equal(canViewModule("suppliers", c), true);
    assert.equal(canViewModule("employees", c), false);
  });

  it("RH: employees + guide; sem finance", () => {
    const c = ctx("VIEWER", ["dashboard.view", "employees.view", "guide.view"]);
    assert.equal(canViewModule("employees", c), true);
    assert.equal(canViewModule("guide", c), true);
    assert.equal(canViewModule("finance", c), false);
  });

  it("engenharia: products/projects; sem finance comercial", () => {
    const c = ctx("VIEWER", [
      "dashboard.view",
      "products.view",
      "projects.view",
      "simulations.view",
    ]);
    assert.equal(canViewModule("products", c), true);
    assert.equal(canViewModule("projects", c), true);
    assert.equal(canViewModule("finance", c), false);
    assert.equal(canViewModule("sales-orders", c), false);
  });

  it("deny individual via DTO /me: AP allow + portfolio deny explícito no payload", () => {
    const dto: EffectiveAccessMeDto = {
      permissionsVersion: 1,
      role: "VIEWER",
      isSuperAdmin: false,
      allowedResources: ["finance.accounts_payable"],
      actionsByResource: { "finance.accounts_payable": ["view"] },
      navigationReveal: ["finance.accounts_payable"],
      capabilities: {
        "finance.accounts_payable": {
          canView: true,
          canExecute: false,
          canManage: false,
        },
      },
      compatibility: {
        mode: "shadow",
        legacyBagAuthoritative: false,
        legacyPermissionsPresent: true,
        legacyCompatApplied: false,
      },
    };
    assert.equal(canViewSidebarModuleFromDto(dto, "finance"), true);
    assert.equal(canViewSidebarModuleFromDto(dto, "portfolio-reconciliation"), false);
    const nav = buildSidebarNavigationFromEffectiveAccess(dto);
    assert.ok(nav.flatAccessibleItems.some((i) => i.id === "finance"));
    assert.equal(
      nav.flatAccessibleItems.some((i) => i.id === "portfolio-reconciliation"),
      false
    );
  });

  it("usuário legado compatível: opex/taxes/reports/materials via primary", () => {
    const keys = projectSidebarContractKeysFromLegacyBag([
      "dashboard.view",
      "opex.view",
      "taxes.view",
      "reports.view",
      "materials.view",
    ]);
    assert.ok(keys.includes("dashboard"));
    assert.ok(keys.includes("finance.opex"));
    assert.ok(keys.includes("finance.taxes"));
    assert.ok(keys.includes("finance.reports"));
    assert.ok(keys.includes("engineering.materials"));
    assert.equal(keys.includes("finance.portfolio_reconciliation"), false);
  });

  it("/me DTO tem precedência sobre bag", () => {
    const u = user({
      role: "VIEWER",
      permissions: ["finance.view", "crm.view", "sales_orders.view"],
    });
    const fromMe: EffectiveAccessMeDto = {
      permissionsVersion: 2,
      role: "VIEWER",
      isSuperAdmin: false,
      allowedResources: ["finance.accounts_payable"],
      actionsByResource: { "finance.accounts_payable": ["view"] },
      navigationReveal: ["finance.accounts_payable"],
      capabilities: {
        "finance.accounts_payable": {
          canView: true,
          canExecute: false,
          canManage: false,
        },
      },
      compatibility: {
        mode: "shadow",
        legacyBagAuthoritative: false,
        legacyPermissionsPresent: true,
        legacyCompatApplied: false,
      },
    };
    const dto = resolveSidebarEffectiveAccessDto({
      user: u,
      effectiveAccessFromMe: fromMe,
    });
    assert.equal(dto, fromMe);
    assert.equal(canViewSidebarModuleFromDto(dto, "crm-commercial"), false);
    assert.equal(canViewSidebarModuleFromDto(dto, "finance"), true);
  });

  it("grupo só aparece com filho visível; sales_orders não abre finance shell", () => {
    const c = ctx("VIEWER", ["sales_orders.view"]);
    assert.equal(canViewModule("sales-orders", c), true);
    assert.equal(canViewModule("finance", c), false);
    const nav = buildResourceAwareSidebarNavigation(c);
    assert.ok(nav.groups.some((g) => g.items.some((i) => i.itemId === "sales-orders")));
    assert.equal(
      nav.flatAccessibleItems.some((i) => i.id === "finance"),
      false
    );
  });

  it("Fornecedores allow NÃO abre menu Financeiro via navigationReveal do pai", () => {
    const dto: EffectiveAccessMeDto = {
      permissionsVersion: 1,
      role: "ADMIN",
      isSuperAdmin: false,
      allowedResources: ["finance.suppliers"],
      actionsByResource: { "finance.suppliers": ["view"] },
      // Reveal virtual do ancestral (como o resolvedor emite) — não deve liberar shell.
      navigationReveal: ["finance", "finance.suppliers"],
      capabilities: {
        "finance.suppliers": {
          canView: true,
          canExecute: false,
          canManage: false,
        },
      },
      compatibility: {
        mode: "shadow",
        legacyBagAuthoritative: false,
        legacyPermissionsPresent: false,
        legacyCompatApplied: false,
      },
    };
    assert.equal(canViewSidebarModuleFromDto(dto, "suppliers"), true);
    assert.equal(canViewSidebarModuleFromDto(dto, "finance"), false);
    const nav = buildSidebarNavigationFromEffectiveAccess(dto);
    assert.ok(nav.flatAccessibleItems.some((i) => i.id === "suppliers"));
    assert.equal(
      nav.flatAccessibleItems.some((i) => i.id === "finance"),
      false
    );
  });

  it("Suprimentos allow NÃO abre Produtos via reveal de engineering", () => {
    const dto: EffectiveAccessMeDto = {
      permissionsVersion: 1,
      role: "ADMIN",
      isSuperAdmin: false,
      allowedResources: ["engineering.materials"],
      actionsByResource: { "engineering.materials": ["view"] },
      navigationReveal: ["engineering", "engineering.materials"],
      capabilities: {
        "engineering.materials": {
          canView: true,
          canExecute: false,
          canManage: false,
        },
      },
      compatibility: {
        mode: "shadow",
        legacyBagAuthoritative: false,
        legacyPermissionsPresent: false,
        legacyCompatApplied: false,
      },
    };
    assert.equal(canViewSidebarModuleFromDto(dto, "materials"), true);
    assert.equal(canViewSidebarModuleFromDto(dto, "products"), false);
    const nav = buildSidebarNavigationFromEffectiveAccess(dto);
    assert.ok(nav.flatAccessibleItems.some((i) => i.id === "materials"));
    assert.equal(
      nav.flatAccessibleItems.some((i) => i.id === "products"),
      false
    );
  });
});
