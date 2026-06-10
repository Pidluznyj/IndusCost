import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canManageProjects,
  canViewProjects,
  isOfficialConversionEnabled,
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
});
