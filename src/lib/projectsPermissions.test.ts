import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppAuthContext } from "./appAuth.js";
import {
  assertProjectsDeleteSuperAdmin,
  canDeleteProject,
  canManageProjects,
  canViewProjects,
  isOfficialConversionEnabled,
  PROJECTS_LOOKUP_PERMISSIONS,
  ProjectsAccessError,
} from "./projectsPermissions.js";
import type { PermissionChecker } from "./modulePermissions.js";

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (list) => list.some((p) => set.has(p)),
  };
}

describe("projectsPermissions", () => {
  it("projects.view permite visualizar", () => {
    assert.equal(canViewProjects(checker(["projects.view"])), true);
    assert.equal(canViewProjects(checker(["projects.manage"])), false);
  });

  it("projects.manage permite criar/editar", () => {
    assert.equal(canManageProjects(checker(["projects.manage"])), true);
    assert.equal(canManageProjects(checker(["projects.view"])), false);
  });

  it("conversão oficial permanece desabilitada", () => {
    assert.equal(isOfficialConversionEnabled(), false);
  });

  it("lookup inclui projects.view e projects.manage", () => {
    assert.ok(PROJECTS_LOOKUP_PERMISSIONS.includes("projects.view"));
    assert.ok(PROJECTS_LOOKUP_PERMISSIONS.includes("projects.manage"));
  });

  it("somente super admin pode excluir projeto", () => {
    const superAdmin = {
      isSuperAdmin: () => true,
    };
    const admin = {
      isSuperAdmin: () => false,
    };
    assert.equal(canDeleteProject(superAdmin), true);
    assert.equal(canDeleteProject(admin), false);
  });

  it("assertProjectsDeleteSuperAdmin bloqueia não-super-admin", () => {
    const user = {
      id: "u1",
      role: "ADMIN",
    } as AppAuthContext;
    assert.throws(
      () => assertProjectsDeleteSuperAdmin(user),
      (e: unknown) => e instanceof ProjectsAccessError
    );
    assert.doesNotThrow(() =>
      assertProjectsDeleteSuperAdmin({ ...user, role: "SUPER_ADMIN" } as AppAuthContext)
    );
  });
});
