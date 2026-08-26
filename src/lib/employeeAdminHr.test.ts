import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmployeeRegistrationError } from "./employeeRegistration.ts";
import {
  auditEpiAdminNotesSummary,
  normalizeEpiSize,
  prepareEmployeeAdminReferenceFields,
  prepareEmployeeEpiFields,
  prepareEmployeeNotesFields,
  redactEmployeeAdminForApi,
  validateEmployeeEpiAdminNotesForm,
  MAX_ADMIN_NOTES_LEN,
} from "./employeeAdminHr.ts";
import { EPI_TOP_SIZE_OPTIONS } from "./employeeHrUi.ts";

const TOP = new Set<string>(EPI_TOP_SIZE_OPTIONS);

describe("employeeAdminHr — EPI preferência", () => {
  it("aceita tamanho oficial", () => {
    assert.equal(normalizeEpiSize("M", TOP, "Camiseta"), "M");
  });

  it("rejeita tamanho arbitrário", () => {
    assert.throws(
      () => normalizeEpiSize("XXXL", TOP, "Camiseta"),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "INVALID_EPI_SIZE"
    );
  });

  it("preserva legado inalterado", () => {
    assert.equal(
      normalizeEpiSize("custom-old", TOP, "Camiseta", {
        allowLegacy: true,
        previous: "custom-old",
      }),
      "custom-old"
    );
  });

  it("prepare preenche tamanhos e notas", () => {
    const r = prepareEmployeeEpiFields({
      shirtSize: "G",
      pantsSize: "42",
      jacketSize: "",
      gloveSize: "Único",
      shoeSize: "41",
      epiNotes: "  precisa reforço  ",
    });
    assert.equal(r.shirtSize, "G");
    assert.equal(r.epiNotes, "precisa reforço");
  });
});

describe("employeeAdminHr — referência administrativa", () => {
  it("valida faixa salarial/jornada/produtividade", () => {
    const r = prepareEmployeeAdminReferenceFields({
      salary: 3500.5,
      monthlyHours: 220,
      productivity: 100,
    });
    assert.equal(r.monthlyHours, 220);
    assert.throws(
      () =>
        prepareEmployeeAdminReferenceFields({
          salary: -1,
          monthlyHours: 220,
          productivity: 100,
        }),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "INVALID_SALARY"
    );
    assert.throws(
      () =>
        prepareEmployeeAdminReferenceFields({
          salary: 1,
          monthlyHours: 0,
          productivity: 100,
        }),
      (e: unknown) =>
        e instanceof EmployeeRegistrationError && e.code === "INVALID_MONTHLY_HOURS"
    );
  });
});

describe("employeeAdminHr — notas e redação", () => {
  it("trunca notas longas", () => {
    const long = "x".repeat(MAX_ADMIN_NOTES_LEN + 50);
    const notes = prepareEmployeeNotesFields({
      professionalNotes: "ok",
      adminNotes: long,
    });
    assert.equal(notes.adminNotes?.length, MAX_ADMIN_NOTES_LEN);
  });

  it("redige salário e custos sem revelar", () => {
    const redacted = redactEmployeeAdminForApi(
      {
        salary: 5000,
        productivity: 100,
        adminNotes: "segredo",
        costs: { salary: 5000, totalMonthlyCost: 7000 },
        EmployeePayrollComponent: [
          {
            PayrollComponent: {
              id: "11111111-1111-4111-8111-111111111111",
              name: "VT",
              type: "BENEFIT",
              calculationType: "FIXED",
              value: 200,
            },
          },
        ],
      },
      { reveal: false }
    );
    assert.equal("salary" in redacted, false);
    assert.equal("costs" in redacted, false);
    assert.equal("productivity" in redacted, false);
    assert.equal("EmployeePayrollComponent" in redacted, false);
    assert.equal(redacted.adminNotes, null);
    assert.equal(redacted.compensationRedacted, true);
    const json = JSON.stringify(redacted);
    assert.ok(!json.includes("5000"));
    assert.ok(!json.includes("7000"));
    assert.ok(!json.includes("\"salary\""));
  });

  it("auditoria não inclui salário numérico", () => {
    const audit = auditEpiAdminNotesSummary({
      epi: {
        shirtSize: "M",
        pantsSize: null,
        jacketSize: null,
        gloveSize: null,
        shoeSize: null,
        epiNotes: null,
      },
      notes: {
        professionalNotes: "p",
        adminNotes: "conta 123456789",
      },
      admin: { salary: 99999.12, monthlyHours: 220, productivity: 100 },
      payrollComponentCount: 2,
    });
    const dump = JSON.stringify(audit);
    assert.equal(audit.hasSalaryReference, true);
    assert.ok(!dump.includes("99999"));
    assert.ok(!dump.includes("conta 123456789"));
  });

  it("validate form espelha erro", () => {
    const msg = validateEmployeeEpiAdminNotesForm({
      shirtSize: "ZZZ",
      salary: 1,
      monthlyHours: 220,
      productivity: 100,
    });
    assert.ok(msg && /tamanho/i.test(msg));
  });
});
