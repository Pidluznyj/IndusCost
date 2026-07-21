import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEmployeeSystemLinksCapsFromPermissions,
  canCreateEmployees,
  canDeleteEmployee,
  canListEmployees,
  canManageEmployeeEpi,
  canManageEmployeeLinks,
  canManageEmployeeUserLink,
  canUpdateEmployees,
  canViewEmployeeAdministrativeData,
  canViewEmployeeLinks,
  canViewEmployeePersonalData,
  canViewEmployeeSensitiveData,
  assertEmployeesDeleteSuperAdmin,
  EmployeesAccessError,
} from "./employeesPermissions.ts";

function check(perms: string[]) {
  const set = new Set(perms);
  return {
    hasPermission: (p: string) => set.has(p),
    hasAnyPermission: (list: readonly string[]) => list.some((p) => set.has(p)),
  };
}

describe("employeesPermissions — acesso efetivo legado", () => {
  it("employees.edit cobre create/update/facetas", () => {
    const c = check(["employees.edit"]);
    assert.equal(canCreateEmployees(c), true);
    assert.equal(canUpdateEmployees(c), true);
    assert.equal(canViewEmployeePersonalData(c), true);
    assert.equal(canViewEmployeeSensitiveData(c), true);
    assert.equal(canViewEmployeeAdministrativeData(c), true);
    assert.equal(canViewEmployeeLinks(c), true);
    assert.equal(canManageEmployeeLinks(c), true);
    assert.equal(canManageEmployeeUserLink(c), true);
    assert.equal(canManageEmployeeEpi(c), true);
  });

  it("somente leitura: lista sem PII/salário/vínculo manage", () => {
    const c = check(["employees.view"]);
    assert.equal(canListEmployees(c), true);
    assert.equal(canCreateEmployees(c), false);
    assert.equal(canViewEmployeePersonalData(c), false);
    assert.equal(canViewEmployeeSensitiveData(c), false);
    assert.equal(canManageEmployeeLinks(c), false);
    assert.equal(canViewEmployeeLinks(c), true);
  });

  it("deny específico de vínculos mantém view e barra manage", () => {
    const c = check(["employees.view", "employees.links.view"]);
    assert.equal(canViewEmployeeLinks(c), true);
    assert.equal(canManageEmployeeLinks(c), false);
  });

  it("faceta fina sem edit", () => {
    const c = check(["employees.view", "employees.personal_data.view"]);
    assert.equal(canViewEmployeePersonalData(c), true);
    assert.equal(canViewEmployeeSensitiveData(c), false);
  });

  it("P09: costs.view NÃO lista RH", () => {
    assert.equal(canListEmployees(check(["costs.view"])), false);
    assert.equal(canListEmployees(check(["employees.view"])), true);
  });
});

describe("employeesPermissions — caps system-links", () => {
  it("sem commissions.view não vê comercial", () => {
    const caps = buildEmployeeSystemLinksCapsFromPermissions(["employees.view"]);
    assert.equal(caps.canViewCommissions, false);
    assert.equal(caps.canViewCustomers, false);
    assert.equal(caps.canManagePersonLink, false);
  });

  it("ADMIN bypass", () => {
    const caps = buildEmployeeSystemLinksCapsFromPermissions([], "ADMIN");
    assert.equal(caps.canViewPii, true);
    assert.equal(caps.canViewEmployees, true);
  });
});

describe("employeesPermissions — exclusão SUPER_ADMIN", () => {
  it("canDeleteEmployee só para super admin", () => {
    assert.equal(canDeleteEmployee({ isSuperAdmin: () => true }), true);
    assert.equal(canDeleteEmployee({ isSuperAdmin: () => false }), false);
  });

  it("assertEmployeesDeleteSuperAdmin bloqueia não-super-admin", () => {
    assert.throws(
      () => assertEmployeesDeleteSuperAdmin({ role: "ADMIN" }),
      (err: unknown) =>
        err instanceof EmployeesAccessError &&
        /super administrador/i.test((err as Error).message)
    );
    assert.throws(() => assertEmployeesDeleteSuperAdmin(null), EmployeesAccessError);
    assert.doesNotThrow(() =>
      assertEmployeesDeleteSuperAdmin({ role: "SUPER_ADMIN" })
    );
  });
});
