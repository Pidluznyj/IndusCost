import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertEmployeeEligibleForUserLink,
  EmployeeUserLinkError,
  filterEligibleEmployeesForUserLink,
  resolveEmployeeDisplayName,
  resolveLoginEmailForNewUser,
} from "@/src/lib/adminUserEmployeeLink";

const EMP_A = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ana Silva",
  socialName: null,
  personalEmail: "ana@empresa.com",
  department: "Comercial",
  status: "ACTIVE",
};

const EMP_B = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Bruno Costa",
  socialName: "Bruno",
  personalEmail: null,
  department: "Produção",
  status: "INACTIVE",
};

describe("adminUserEmployeeLink", () => {
  it("resolveEmployeeDisplayName prefires nome social", () => {
    assert.equal(resolveEmployeeDisplayName(EMP_B), "Bruno");
    assert.equal(resolveEmployeeDisplayName(EMP_A), "Ana Silva");
  });

  it("filterEligibleEmployeesForUserLink remove inativos e já vinculados", () => {
    const list = filterEligibleEmployeesForUserLink(
      [EMP_A, EMP_B, { ...EMP_B, id: "33333333-3333-4333-8333-333333333333", status: "ACTIVE", name: "Carla" }],
      new Set([EMP_A.id])
    );
    assert.equal(list.length, 1);
    assert.equal(list[0]?.name, "Carla");
  });

  it("assertEmployeeEligibleForUserLink exige pessoa ativa sem usuário", () => {
    assert.throws(
      () =>
        assertEmployeeEligibleForUserLink({
          employeeId: "",
          employee: null,
        }),
      (err: unknown) => err instanceof EmployeeUserLinkError && err.code === "INVALID_EMPLOYEE_ID"
    );
    assert.throws(
      () =>
        assertEmployeeEligibleForUserLink({
          employeeId: EMP_B.id,
          employee: EMP_B,
        }),
      (err: unknown) => err instanceof EmployeeUserLinkError && err.code === "EMPLOYEE_INACTIVE"
    );
    assert.throws(
      () =>
        assertEmployeeEligibleForUserLink({
          employeeId: EMP_A.id,
          employee: EMP_A,
          alreadyLinkedUserId: "user-1",
        }),
      (err: unknown) => err instanceof EmployeeUserLinkError && err.code === "EMPLOYEE_ALREADY_LINKED"
    );
    const ok = assertEmployeeEligibleForUserLink({
      employeeId: EMP_A.id,
      employee: EMP_A,
    });
    assert.equal(ok.id, EMP_A.id);
  });

  it("resolveLoginEmailForNewUser prioriza e-mail corporativo sobre pessoal", () => {
    assert.equal(
      resolveLoginEmailForNewUser({
        requestedEmail: "  ",
        corporateEmail: " Corp@Empresa.com ",
        personalEmail: "ana@empresa.com",
      }),
      "corp@empresa.com"
    );
    assert.equal(
      resolveLoginEmailForNewUser({
        requestedEmail: "  ",
        corporateEmail: null,
        personalEmail: "ana@empresa.com",
      }),
      "ana@empresa.com"
    );
    assert.equal(
      resolveLoginEmailForNewUser({
        requestedEmail: "login@empresa.com",
        corporateEmail: "corp@empresa.com",
        personalEmail: "ana@empresa.com",
      }),
      "login@empresa.com"
    );
  });
});
