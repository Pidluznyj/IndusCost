import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAdmissionBeforeTermination,
  assertClassification,
  assertContractType,
  assertCorporateEmailAppUserConflict,
  assertCorporateEmailFormat,
  assertCorporateEmailUnique,
  assertManagerAssignable,
  assertStatusTerminationConsistency,
  describeCorporateEmailAppUserHint,
  EmployeeRegistrationError,
  formatManagerDisplayName,
  normalizeCorporateEmail,
  resolveFinancialCostCenterLabel,
  resolveUserLinkStatus,
} from "./employeeRegistration.ts";
import {
  assertCorporateEmailFormat as assertFormatPure,
  CorporateEmailError,
  isValidCorporateEmailInput,
} from "./employeeCorporateEmail.ts";

describe("employeeCorporateEmail — puro", () => {
  it("trim + lowercase", () => {
    assert.equal(normalizeCorporateEmail("  Foo.Bar@Empresa.COM "), "foo.bar@empresa.com");
    assert.equal(normalizeCorporateEmail("   "), null);
  });

  it("formato", () => {
    assert.throws(
      () => assertFormatPure("nao-email"),
      (e: unknown) => e instanceof CorporateEmailError && e.code === "INVALID_CORPORATE_EMAIL"
    );
    assert.equal(isValidCorporateEmailInput("a@b.co"), true);
    assert.equal(isValidCorporateEmailInput("x"), false);
    assert.equal(isValidCorporateEmailInput(""), true);
  });
});

describe("employeeRegistration — e-mail corporativo", () => {
  it("formato inválido vira EmployeeRegistrationError", () => {
    assert.throws(
      () => assertCorporateEmailFormat("nao-email"),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "INVALID_CORPORATE_EMAIL"
    );
  });

  it("formato válido passa", () => {
    assert.doesNotThrow(() => assertCorporateEmailFormat("a@b.co"));
    assert.doesNotThrow(() => assertCorporateEmailFormat(null));
  });

  it("unicidade case-insensitive", async () => {
    const prisma = {
      employee: {
        findFirst: async () => ({ id: "e2", name: "Outro" }),
      },
    } as never;
    await assert.rejects(
      () => assertCorporateEmailUnique(prisma, "A@B.COM", "e1"),
      (e: unknown) =>
        e instanceof EmployeeRegistrationError && e.code === "DUPLICATE_CORPORATE_EMAIL"
    );
  });

  it("unicidade libera quando é o próprio colaborador", async () => {
    const prisma = {
      employee: {
        findFirst: async () => null,
      },
    } as never;
    await assert.doesNotReject(() => assertCorporateEmailUnique(prisma, "a@b.com", "e1"));
  });

  it("AppUser vinculado a outro colaborador bloqueia", async () => {
    const prisma = {
      appUser: {
        findFirst: async () => ({
          id: "u1",
          email: "a@b.com",
          employeeId: "other",
        }),
      },
    } as never;
    await assert.rejects(
      () => assertCorporateEmailAppUserConflict(prisma, "a@b.com", "e1"),
      (e: unknown) =>
        e instanceof EmployeeRegistrationError && e.code === "CORPORATE_EMAIL_APPUSER_CONFLICT"
    );
  });

  it("AppUser livre gera available_match (não bloqueia)", async () => {
    const prisma = {
      appUser: {
        findFirst: async () => ({
          id: "u1",
          email: "a@b.com",
          employeeId: null,
        }),
      },
    } as never;
    const r = await assertCorporateEmailAppUserConflict(prisma, "a@b.com", null);
    assert.equal(r.status, "available_match");
    assert.ok(describeCorporateEmailAppUserHint(r)?.includes("usuário"));
  });

  it("AppUser já deste colaborador = linked_here", async () => {
    const prisma = {
      appUser: {
        findFirst: async () => ({
          id: "u1",
          email: "a@b.com",
          employeeId: "e1",
        }),
      },
    } as never;
    const r = await assertCorporateEmailAppUserConflict(prisma, "a@b.com", "e1");
    assert.equal(r.status, "linked_here");
  });

  it("null email não consulta AppUser", async () => {
    let called = false;
    const prisma = {
      appUser: {
        findFirst: async () => {
          called = true;
          return null;
        },
      },
    } as never;
    const r = await assertCorporateEmailAppUserConflict(prisma, null, "e1");
    assert.equal(r.status, "none");
    assert.equal(called, false);
  });
});

describe("employeeRegistration — vínculo usuário", () => {
  it("linked", () => {
    const r = resolveUserLinkStatus({
      linkedUser: { id: "u1", email: "a@b.co" },
      matchingUserByEmail: null,
    });
    assert.equal(r.status, "linked");
  });

  it("available_match", () => {
    const r = resolveUserLinkStatus({
      linkedUser: null,
      matchingUserByEmail: { id: "u2", email: "a@b.co", employeeId: null },
    });
    assert.equal(r.status, "available_match");
  });

  it("conflict quando usuário já tem outra pessoa", () => {
    const r = resolveUserLinkStatus({
      linkedUser: null,
      matchingUserByEmail: { id: "u2", email: "a@b.co", employeeId: "other" },
    });
    assert.equal(r.status, "conflict");
  });

  it("none sem match", () => {
    const r = resolveUserLinkStatus({ linkedUser: null, matchingUserByEmail: null });
    assert.equal(r.status, "none");
  });
});

describe("employeeRegistration — datas e enums", () => {
  it("admissão > desligamento falha", () => {
    assert.throws(
      () =>
        assertAdmissionBeforeTermination(
          new Date("2024-06-01T12:00:00.000Z"),
          new Date("2024-01-01T12:00:00.000Z")
        ),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "INVALID_DATE_RANGE"
    );
  });

  it("ativo com desligamento falha", () => {
    assert.throws(
      () =>
        assertStatusTerminationConsistency({
          status: "ACTIVE",
          terminationDate: new Date("2024-01-01T12:00:00.000Z"),
        }),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "ACTIVE_WITH_TERMINATION"
    );
  });

  it("classificação e contrato", () => {
    assert.equal(assertClassification("direto"), "DIRETO");
    assert.equal(assertContractType("clt"), "CLT");
    assert.equal(assertContractType(""), null);
    assert.equal(
      assertContractType("Prestador legado", {
        allowLegacy: true,
        previousValue: "Prestador legado",
      }),
      "Prestador legado"
    );
    assert.throws(
      () => assertContractType("Prestador legado", { allowLegacy: false }),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "INVALID_CONTRACT_TYPE"
    );
    assert.throws(
      () =>
        assertContractType("Outro legado", {
          allowLegacy: true,
          previousValue: "Prestador legado",
        }),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "INVALID_CONTRACT_TYPE"
    );
  });

  it("nome canônico do gestor", () => {
    assert.equal(formatManagerDisplayName({ name: "Ana Silva", socialName: "Ana" }), "Ana");
    assert.equal(formatManagerDisplayName({ name: "Ana Silva", socialName: null }), "Ana Silva");
  });
});

const CC_ID = "11111111-1111-4111-8111-111111111111";
const EMP_A = "22222222-2222-4222-8222-222222222222";
const EMP_B = "33333333-3333-4333-8333-333333333333";
const EMP_C = "44444444-4444-4444-8444-444444444444";

describe("employeeRegistration — centro de custo financeiro", () => {
  it("ID inexistente falha", async () => {
    const prisma = {
      financialCostCenter: { findUnique: async () => null },
    } as never;
    await assert.rejects(
      () => resolveFinancialCostCenterLabel(prisma, CC_ID),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "COST_CENTER_NOT_FOUND"
    );
  });

  it("inativo bloqueado salvo preservação", async () => {
    const prisma = {
      financialCostCenter: {
        findUnique: async () => ({
          id: CC_ID,
          code: "CC01",
          name: "Ops",
          status: "INACTIVE",
        }),
      },
    } as never;
    await assert.rejects(
      () => resolveFinancialCostCenterLabel(prisma, CC_ID, { requireActive: true }),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "COST_CENTER_INACTIVE"
    );
    const ok = await resolveFinancialCostCenterLabel(prisma, CC_ID, {
      requireActive: true,
      preserveId: CC_ID,
    });
    assert.equal(ok?.id, CC_ID);
  });
});

describe("employeeRegistration — gestor", () => {
  it("self bloqueado", async () => {
    const prisma = { employee: { findUnique: async () => null } } as never;
    await assert.rejects(
      () =>
        assertManagerAssignable(prisma, {
          employeeId: EMP_A,
          managerId: EMP_A,
        }),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "MANAGER_SELF"
    );
  });

  it("ciclo direto A↔B", async () => {
    const prisma = {
      employee: {
        findUnique: async ({ where: { id } }: { where: { id: string } }) => {
          if (id === EMP_B) {
            return {
              id: EMP_B,
              name: "B",
              socialName: null,
              status: "ACTIVE",
              managerId: EMP_A,
            };
          }
          return null;
        },
      },
    } as never;
    await assert.rejects(
      () =>
        assertManagerAssignable(prisma, {
          employeeId: EMP_A,
          managerId: EMP_B,
        }),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "MANAGER_CYCLE"
    );
  });

  it("ciclo indireto A→B→C→A", async () => {
    const prisma = {
      employee: {
        findUnique: async ({ where: { id } }: { where: { id: string } }) => {
          if (id === EMP_B) {
            return {
              id: EMP_B,
              name: "B",
              socialName: null,
              status: "ACTIVE",
              managerId: EMP_C,
            };
          }
          if (id === EMP_C) {
            return { managerId: EMP_A };
          }
          return null;
        },
      },
    } as never;
    await assert.rejects(
      () =>
        assertManagerAssignable(prisma, {
          employeeId: EMP_A,
          managerId: EMP_B,
        }),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "MANAGER_CYCLE"
    );
  });

  it("gestor inativo histórico preservado", async () => {
    const prisma = {
      employee: {
        findUnique: async () => ({
          id: EMP_B,
          name: "B",
          socialName: null,
          status: "INACTIVE",
          managerId: null,
        }),
      },
    } as never;
    const m = await assertManagerAssignable(prisma, {
      employeeId: EMP_A,
      managerId: EMP_B,
      preserveManagerId: EMP_B,
      requireActive: true,
    });
    assert.equal(m?.id, EMP_B);
  });
});
