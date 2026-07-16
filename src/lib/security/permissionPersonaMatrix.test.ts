/**
 * Matriz oficial de personas — RC Prompt 16.
 * Cobre expectativas de navegação (view) e negações críticas.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import { canAccessModule } from "@/src/lib/modulePermissions.js";
import { ResourceKeys } from "@/src/lib/permissionsClient.js";
import {
  canAccessPath,
  canViewModule,
  canViewResource,
  evaluatePathViewAccess,
  type NavigationAccessContext,
} from "@/src/lib/resourceNavigationAccess.js";
import {
  PERMISSION_PERSONA_MATRIX,
  type PersonaSpec,
} from "@/src/lib/security/permissionPersonaMatrix.js";

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
    id: `persona-${role}`,
    name: "Persona",
    email: "persona@example.com",
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
  };
}

function ctx(role: AuthUser["role"], permissions: string[]): NavigationAccessContext {
  const u = user(role, permissions);
  return { user: u, checker: checker(permissions) };
}

export function buildPersonaContext(spec: PersonaSpec): NavigationAccessContext {
  return ctx(spec.role, spec.permissions);
}

describe("permissionPersonaMatrix — navegação por persona", () => {
  for (const persona of PERMISSION_PERSONA_MATRIX) {
    it(`${persona.id}: view/deny módulos alinhados`, () => {
      const c = buildPersonaContext(persona);
      for (const mod of persona.expectViewModules) {
        assert.equal(
          canViewModule(mod, c),
          true,
          `${persona.id} deveria ver ${mod}`
        );
      }
      for (const mod of persona.expectDenyModules) {
        assert.equal(
          canViewModule(mod, c),
          false,
          `${persona.id} não deveria ver ${mod}`
        );
      }
      for (const path of persona.expectDenyPaths ?? []) {
        assert.equal(canAccessPath(path, c), false, `${persona.id} path ${path}`);
        assert.equal(evaluatePathViewAccess(path, c).allowed, false);
      }
    });
  }

  it("SUPER_ADMIN: canViewResource irrestrito", () => {
    const c = buildPersonaContext(PERMISSION_PERSONA_MATRIX[0]!);
    assert.equal(canViewResource(c.user, ResourceKeys.FINANCEIRO), true);
    assert.equal(canViewResource(c.user, ResourceKeys.ADMIN_USUARIOS), true);
  });

  it("legado: opex via DTO efetivo (P10)", () => {
    const persona = PERMISSION_PERSONA_MATRIX.find(
      (p) => p.id === "legado_sem_grants_estruturados"
    )!;
    const c = buildPersonaContext(persona);
    assert.equal(evaluatePathViewAccess("/opex", c).source, "effective_dto");
    assert.equal(canAccessModule("opex", c.checker), true);
    assert.equal(canViewModule("opex", c), true);
  });

  it("parent negado: bag sem finance.view não abre /finance", () => {
    const c = ctx("VIEWER", ["dashboard.view", "sales_orders.view"]);
    assert.equal(canViewModule("finance", c), false);
    assert.equal(canAccessPath("/finance", c), false);
  });
});
