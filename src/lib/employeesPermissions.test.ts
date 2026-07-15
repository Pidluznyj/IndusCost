import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEmployeeSystemLinksCapsFromPermissions,
  canCreateEmployees,
  canListEmployees,
  canManageEmployeeEpi,
  canManageEmployeeLinks,
  canManageEmployeeUserLink,
  canUpdateEmployees,
  canViewEmployeeAdministrativeData,
  canViewEmployeeLinks,
  canViewEmployeePersonalData,
  canViewEmployeeSensitiveData,
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

  it("costs.view lista RH", () => {
    assert.equal(canListEmployees(check(["costs.view"])), true);
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
