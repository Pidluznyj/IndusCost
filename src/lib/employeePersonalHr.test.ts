import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmployeeRegistrationError } from "./employeeRegistration.ts";
import {
  assertEmergencyContactConsistency,
  auditPersonalHrSummary,
  formatPhoneBrMask,
  normalizeEmployeeCpf,
  normalizeEmployeePhone,
  normalizePersonalEmail,
  prepareEmployeePersonalHrFields,
  redactEmployeePersonalEmergencyForApi,
  validateEmployeePersonalHrForm,
} from "./employeePersonalHr.ts";

/** CPF válido conhecido (check digits). */
const VALID_CPF = "52998224725";

describe("employeePersonalHr — normalização", () => {
  it("CPF válido normaliza só dígitos", () => {
    assert.equal(normalizeEmployeeCpf("529.982.247-25"), VALID_CPF);
  });

  it("CPF inválido rejeita", () => {
    assert.throws(
      () => normalizeEmployeeCpf("11111111111"),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "INVALID_CPF"
    );
  });

  it("CPF legado inalterado permanece", () => {
    assert.equal(
      normalizeEmployeeCpf("123", { allowLegacy: true, previous: "123" }),
      "123"
    );
  });

  it("telefone exige 10/11 dígitos", () => {
    assert.equal(normalizeEmployeePhone("(11) 98888-7777"), "11988887777");
    assert.throws(
      () => normalizeEmployeePhone("1234"),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "INVALID_PHONE"
    );
  });

  it("e-mail pessoal lowercase", () => {
    assert.equal(normalizePersonalEmail("  Foo@Bar.COM "), "foo@bar.com");
  });

  it("máscara telefone BR", () => {
    assert.equal(formatPhoneBrMask("11988887777"), "(11) 98888-7777");
  });
});

describe("employeePersonalHr — emergência", () => {
  it("parcial falha", () => {
    assert.throws(
      () =>
        assertEmergencyContactConsistency({
          name: null,
          phone: "11988887777",
          relationship: null,
        }),
      (e: unknown) =>
        e instanceof EmployeeRegistrationError && e.code === "EMERGENCY_NAME_REQUIRED"
    );
  });

  it("completo passa", () => {
    assert.doesNotThrow(() =>
      assertEmergencyContactConsistency({
        name: "Maria",
        phone: "11988887777",
        relationship: "Mãe",
      })
    );
  });
});

describe("employeePersonalHr — prepare + redação", () => {
  it("prepare grava CPF e emergência", () => {
    const r = prepareEmployeePersonalHrFields({
      cpf: "529.982.247-25",
      phone: "(11) 3333-4444",
      personalEmail: "a@b.co",
      birthDate: "1990-01-15",
      address: "Rua A, 1",
      emergencyContactName: "Contato",
      emergencyContactPhone: "11999998888",
      emergencyContactRelationship: "Pai",
    });
    assert.equal(r.cpf, VALID_CPF);
    assert.equal(r.phone, "1133334444");
    assert.equal(r.personalEmail, "a@b.co");
    assert.equal(r.emergencyContactPhone, "11999998888");
  });

  it("redação omite PII e marca flags", () => {
    const redacted = redactEmployeePersonalEmergencyForApi(
      {
        id: "e1",
        name: "Ana",
        cpf: VALID_CPF,
        address: "Rua X",
        emergencyContactName: "Bob",
        emergencyContactPhone: "11999998888",
        salary: 1000,
      },
      { reveal: false }
    );
    assert.equal(redacted.cpf, null);
    assert.equal(redacted.address, null);
    assert.equal(redacted.emergencyContactName, null);
    assert.equal(redacted.salary, 1000);
    assert.equal(redacted.personalPiiRedacted, true);
    assert.equal(redacted.hasPersonalPii, true);
    assert.equal(redacted.hasEmergencyContact, true);
  });

  it("reveal=true mantém campos", () => {
    const full = redactEmployeePersonalEmergencyForApi(
      { cpf: VALID_CPF, emergencyContactName: "Bob" },
      { reveal: true }
    );
    assert.equal(full.cpf, VALID_CPF);
    assert.equal(full.personalPiiRedacted, false);
  });

  it("auditoria não contém CPF completo", () => {
    const audit = auditPersonalHrSummary({
      cpf: VALID_CPF,
      rg: null,
      birthDate: null,
      phone: "11988887777",
      personalEmail: "secret@x.com",
      address: "Rua Segredo",
      emergencyContactName: "X",
      emergencyContactPhone: "11988887777",
      emergencyContactRelationship: null,
    });
    assert.equal(audit.hasCpf, true);
    assert.ok(audit.cpfMasked && !audit.cpfMasked.includes(VALID_CPF));
    assert.ok(!JSON.stringify(audit).includes("Rua Segredo"));
    assert.ok(!JSON.stringify(audit).includes("secret@x.com"));
  });

  it("validateEmployeePersonalHrForm mensagem", () => {
    const msg = validateEmployeePersonalHrForm({ cpf: "11111111111" });
    assert.ok(msg && /CPF/i.test(msg));
  });
});
