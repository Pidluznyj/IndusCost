import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAdmissionBeforeTermination,
  assertClassification,
  assertContractType,
  assertCorporateEmailAppUserConflict,
  assertCorporateEmailFormat,
  assertCorporateEmailUnique,
  assertStatusTerminationConsistency,
  describeCorporateEmailAppUserHint,
  EmployeeRegistrationError,
  formatManagerDisplayName,
  normalizeCorporateEmail,
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
    assert.equal(assertContractType("Prestador legado"), "Prestador legado");
  });

  it("nome canônico do gestor", () => {
    assert.equal(formatManagerDisplayName({ name: "Ana Silva", socialName: "Ana" }), "Ana");
    assert.equal(formatManagerDisplayName({ name: "Ana Silva", socialName: null }), "Ana Silva");
  });
});
