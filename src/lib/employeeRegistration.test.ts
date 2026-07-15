import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAdmissionBeforeTermination,
  assertClassification,
  assertContractType,
  assertCorporateEmailFormat,
  assertStatusTerminationConsistency,
  EmployeeRegistrationError,
  formatManagerDisplayName,
  normalizeCorporateEmail,
  resolveUserLinkStatus,
} from "./employeeRegistration.ts";

describe("employeeRegistration — e-mail corporativo", () => {
  it("trim + lowercase", () => {
    assert.equal(normalizeCorporateEmail("  Foo.Bar@Empresa.COM "), "foo.bar@empresa.com");
    assert.equal(normalizeCorporateEmail("   "), null);
  });

  it("formato inválido", () => {
    assert.throws(
      () => assertCorporateEmailFormat("nao-email"),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "INVALID_CORPORATE_EMAIL"
    );
  });

  it("formato válido passa", () => {
    assert.doesNotThrow(() => assertCorporateEmailFormat("a@b.co"));
    assert.doesNotThrow(() => assertCorporateEmailFormat(null));
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
