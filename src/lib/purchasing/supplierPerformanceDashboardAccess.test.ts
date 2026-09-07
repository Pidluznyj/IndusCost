/**
 * Compras → Performance — acesso por URL usa a mesma autoridade do módulo
 * Compras (RequirePathViewAccess → módulo `purchases`). Sem permission key nova.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import { resolveModuleIdFromPath } from "@/src/lib/modulePermissions.js";
import { isPurchasesModulePath } from "@/src/lib/navigationGroups.js";
import { canAccessPath, evaluatePathViewAccess } from "@/src/lib/resourceNavigationAccess.js";

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (list) => list.some((p) => set.has(p)),
    authUser: { effectivePermissions: perms },
  };
}

function user(role: AuthUser["role"], permissions: string[]): AuthUser {
  return {
    id: "u1",
    name: "Test",
    email: "t@example.com",
    role,
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
  } as AuthUser;
}

function ctx(role: AuthUser["role"], permissions: string[] = []) {
  return { user: user(role, permissions), checker: checker(permissions) };
}

describe("acesso à URL /purchases/performance", () => {
  it("é reconhecida como rota do módulo Compras", () => {
    assert.equal(resolveModuleIdFromPath("/purchases/performance"), "purchases");
    assert.equal(isPurchasesModulePath("/purchases/performance"), true);
  });

  it("usuário sem acesso a Compras é negado (deny > allow, unknown = deny)", () => {
    const denied = ctx("VIEWER", ["dashboard.view", "finance.view"]);
    assert.equal(canAccessPath("/purchases/performance", denied), false);
    assert.equal(evaluatePathViewAccess("/purchases/performance", denied).reason, "denied");
    const nobody = ctx("VIEWER", []);
    assert.equal(canAccessPath("/purchases/performance", nobody), false);
  });

  it("usuário com Compras acessa; SUPER_ADMIN acessa; abas antigas continuam com a mesma decisão", () => {
    const allowed = ctx("VIEWER", ["purchases.view"]);
    assert.equal(canAccessPath("/purchases/performance", allowed), true);
    assert.equal(canAccessPath("/purchases/nomus-orders", allowed), true);
    assert.equal(canAccessPath("/purchases/supplier-evaluation", allowed), true);
    assert.equal(evaluatePathViewAccess("/purchases/performance", ctx("SUPER_ADMIN")).reason, "super_admin");
  });

  it("loading e erro de sessão bloqueiam", () => {
    const base = ctx("VIEWER", ["purchases.view"]);
    assert.equal(evaluatePathViewAccess("/purchases/performance", { ...base, authLoading: true }).allowed, false);
    assert.equal(evaluatePathViewAccess("/purchases/performance", { ...base, authError: "x" }).allowed, false);
  });
});
