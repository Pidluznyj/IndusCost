/**
 * PERM-38 — catálogo de ações + view vs CRUD + 403 no backend.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import {
  ACTION_PERMISSION_SURFACES,
  PERMISSIONS_CHANGED_SESSION_MESSAGE,
  listActionPermissionSurfaces,
  resolveSurfaceAction,
} from "@/src/lib/actionPermissionCatalog.js";
import { UI_ACTION_TO_DTO_ACTION } from "@/src/lib/actionPermissionAccess.js";
import {
  canCreateCustomers,
  canCreateProducts,
  canDeleteProducts,
  canEditCustomers,
  canEditProducts,
} from "@/src/lib/commercialEngineeringPermissions.js";
import {
  canCreateProposal,
  canEditProposal,
  canPrintProposal,
} from "@/src/lib/modulePermissions.js";
import {
  canManageFinanceSuppliers,
  canViewFinanceSuppliers,
} from "@/src/lib/financeCostCentersPermissions.js";
import { canPerformAction } from "@/src/lib/resourceNavigationAccess.js";
import { authorizeRequireResource } from "@/src/lib/security/requireResource.js";

function dto(
  actionsByResource: EffectiveAccessMeDto["actionsByResource"],
  isSuperAdmin = false
): EffectiveAccessMeDto {
  const allowed = Object.keys(actionsByResource);
  const capabilities: EffectiveAccessMeDto["capabilities"] = {};
  for (const [k, actions] of Object.entries(actionsByResource)) {
    capabilities[k] = {
      canView: actions.includes("view"),
      canExecute: actions.includes("execute") || actions.includes("export"),
      canManage:
        actions.includes("manage") ||
        actions.includes("create") ||
        actions.includes("update") ||
        actions.includes("delete"),
    };
  }
  return {
    permissionsVersion: 1,
    role: isSuperAdmin ? "SUPER_ADMIN" : "VIEWER",
    isSuperAdmin,
    allowedResources: allowed,
    actionsByResource,
    navigationReveal: allowed,
    capabilities,
    compatibility: {
      mode: "shadow",
      legacyBagAuthoritative: false,
      legacyPermissionsPresent: false,
      legacyCompatApplied: false,
    },
  };
}

function authCtx(actionsByResource: EffectiveAccessMeDto["actionsByResource"]) {
  const access = dto(actionsByResource);
  const user: AuthUser = {
    id: "u-p38",
    name: "P38",
    email: "p38@example.com",
    role: "VIEWER",
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
  return {
    user,
    checker: {
      hasPermission: () => false,
      hasAnyPermission: () => false,
      authUser: null,
    },
    effectiveAccess: access,
    authLoading: false,
    authError: null,
  };
}

function appAuth(permissions: string[]): AppAuthContext {
  return {
    id: "u-p38-be",
    name: "P38",
    email: "p38be@example.com",
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
    sessionId: "sess-p38",
  };
}

describe("PERM-38 — catálogo de ações", () => {
  it("lista superfícies do inventário §7", () => {
    const surfaces = listActionPermissionSurfaces();
    assert.ok(surfaces.length >= 8);
    assert.ok(surfaces.some((s) => s.id === "finance-suppliers"));
    assert.ok(surfaces.some((s) => s.id === "products"));
    assert.ok(surfaces.some((s) => s.id === "customers"));
    assert.ok(surfaces.some((s) => s.id === "proposals"));
  });

  it("aliases edit/print/configure/audit mapeiam para DTO", () => {
    assert.equal(UI_ACTION_TO_DTO_ACTION.edit, "update");
    assert.equal(UI_ACTION_TO_DTO_ACTION.print, "export");
    assert.equal(UI_ACTION_TO_DTO_ACTION.configure, "manage");
    assert.equal(UI_ACTION_TO_DTO_ACTION.audit, "view");
  });

  it("fornecedores: create/edit resolvem para manage", () => {
    const create = resolveSurfaceAction("finance-suppliers", "create");
    const edit = resolveSurfaceAction("finance-suppliers", "edit");
    assert.equal(create?.action, "manage");
    assert.equal(edit?.action, "manage");
  });

  it("mensagem de sessão está definida", () => {
    assert.match(PERMISSIONS_CHANGED_SESSION_MESSAGE, /permissões foram atualizadas/i);
  });
});

describe("PERM-38 — FE view vs CRUD", () => {
  it("produtos: view-only não cria/edita/exclui", () => {
    const ctx = authCtx({
      "engineering.products": ["view"],
    });
    const can = (resourceKey: string, action: string) =>
      canPerformAction(resourceKey, action as "view", ctx);
    const check = {
      hasPermission: () => false,
      hasAnyPermission: () => false,
      canPerformAction: can,
    };
    assert.equal(canCreateProducts(check), false);
    assert.equal(canEditProducts(check), false);
    assert.equal(canDeleteProducts(check), false);
  });

  it("produtos: CRUD completo libera create/update/delete", () => {
    const ctx = authCtx({
      "engineering.products": ["view", "create", "update", "delete", "export"],
    });
    const can = (resourceKey: string, action: string) =>
      canPerformAction(resourceKey, action as "create", ctx);
    const check = {
      hasPermission: () => false,
      hasAnyPermission: () => false,
      canPerformAction: can,
    };
    assert.equal(canCreateProducts(check), true);
    assert.equal(canEditProducts(check), true);
    assert.equal(canDeleteProducts(check), true);
  });

  it("clientes: view-only vs create/edit", () => {
    const viewCtx = authCtx({ "commercial.customers": ["view"] });
    const viewCan = (rk: string, a: string) =>
      canPerformAction(rk, a as "view", viewCtx);
    assert.equal(
      canCreateCustomers({
        hasPermission: () => false,
        hasAnyPermission: () => false,
        canPerformAction: viewCan,
      }),
      false
    );

    const crudCtx = authCtx({
      "commercial.customers": ["view", "create", "update"],
    });
    const crudCan = (rk: string, a: string) =>
      canPerformAction(rk, a as "create", crudCtx);
    assert.equal(
      canCreateCustomers({
        hasPermission: () => false,
        hasAnyPermission: () => false,
        canPerformAction: crudCan,
      }),
      true
    );
    assert.equal(
      canEditCustomers({
        hasPermission: () => false,
        hasAnyPermission: () => false,
        canPerformAction: crudCan,
      }),
      true
    );
  });

  it("propostas: print usa export no DTO", () => {
    const ctx = authCtx({
      "commercial.proposals": ["view", "export"],
    });
    const can = (rk: string, a: string) => canPerformAction(rk, a as "export", ctx);
    assert.equal(
      canPrintProposal({
        hasPermission: () => false,
        hasAnyPermission: () => false,
        canPerformAction: can,
      }),
      true
    );
    assert.equal(
      canCreateProposal({
        hasPermission: () => false,
        hasAnyPermission: () => false,
        canPerformAction: can,
      }),
      false
    );
    assert.equal(
      canEditProposal({
        hasPermission: () => false,
        hasAnyPermission: () => false,
        canPerformAction: can,
      }),
      false
    );
  });

  it("fornecedores: view sem manage", () => {
    const viewCtx = authCtx({ "finance.suppliers": ["view"] });
    const viewCan = (rk: string, a: string) =>
      canPerformAction(rk, a as "view", viewCtx);
    const viewCheck = {
      hasPermission: () => false,
      hasAnyPermission: () => false,
      canPerformAction: viewCan,
    };
    assert.equal(canViewFinanceSuppliers(viewCheck), true);
    assert.equal(canManageFinanceSuppliers(viewCheck), false);

    const manageCtx = authCtx({
      "finance.suppliers": ["view", "manage"],
    });
    const manageCan = (rk: string, a: string) =>
      canPerformAction(rk, a as "manage", manageCtx);
    assert.equal(
      canManageFinanceSuppliers({
        hasPermission: () => false,
        hasAnyPermission: () => false,
        canPerformAction: manageCan,
      }),
      true
    );
  });

  it("UI de produtos/propostas/clientes/fornecedores usa canPerformAction", () => {
    const product = readFileSync(
      join(process.cwd(), "src/components/ProductModule.tsx"),
      "utf8"
    );
    const proposal = readFileSync(
      join(process.cwd(), "src/components/ProposalModule.tsx"),
      "utf8"
    );
    const customer = readFileSync(
      join(process.cwd(), "src/components/CustomerModule.tsx"),
      "utf8"
    );
    const suppliers = readFileSync(
      join(process.cwd(), "src/components/finance/FinanceSuppliersPage.tsx"),
      "utf8"
    );
    assert.match(product, /canCreateProducts|canPerformAction/);
    assert.match(proposal, /canPerformAction/);
    assert.match(customer, /canPerformAction/);
    assert.match(suppliers, /canPerformAction/);
    assert.match(
      readFileSync(join(process.cwd(), "src/contexts/AuthContext.tsx"), "utf8"),
      /permissionsChangedNotice|PERMISSIONS_CHANGED_SESSION_MESSAGE/
    );
    assert.match(
      readFileSync(join(process.cwd(), "src/components/layout/Layout.tsx"), "utf8"),
      /permissions-changed-notice/
    );
  });
});

describe("PERM-38 — BE 403 para ação negada", () => {
  it("products create: view-only → 403; com create → allow", () => {
    // Bag legada só entra com legacyCompatMode (default OFF no BE canônico).
    const denied = authorizeRequireResource(
      appAuth(["products.view"]),
      "engineering.products",
      "create",
      { legacyCompatMode: true }
    );
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.status, 403);

    const allowed = authorizeRequireResource(
      appAuth(["products.view", "products.create"]),
      "engineering.products",
      "create",
      { legacyCompatMode: true }
    );
    assert.equal(allowed.ok, true);
  });

  it("customers update: view-only → 403", () => {
    const denied = authorizeRequireResource(
      appAuth(["customers.view"]),
      "commercial.customers",
      "update"
    );
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.status, 403);
  });

  it("proposals delete: sem delete → 403", () => {
    const denied = authorizeRequireResource(
      appAuth(["proposals.view", "proposals.edit"]),
      "commercial.proposals",
      "delete"
    );
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.status, 403);
  });

  it("suppliers manage: view-only → 403", () => {
    const denied = authorizeRequireResource(
      appAuth(["finance.suppliers.view"]),
      "finance.suppliers",
      "manage",
      { legacyCompatMode: true }
    );
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.status, 403);

    const allowed = authorizeRequireResource(
      appAuth(["finance.suppliers.view", "finance.suppliers.manage"]),
      "finance.suppliers",
      "manage",
      { legacyCompatMode: true }
    );
    assert.equal(allowed.ok, true);
  });

  it("SUPER_ADMIN passa em mutações do catálogo", () => {
    const sa = appAuth([]);
    sa.role = "SUPER_ADMIN";
    for (const surface of ACTION_PERMISSION_SURFACES.slice(0, 6)) {
      for (const ep of surface.writeEndpoints) {
        const decision = authorizeRequireResource(sa, surface.resourceKey, ep.action);
        assert.equal(decision.ok, true, `${surface.id} ${ep.action}`);
      }
    }
  });
});
