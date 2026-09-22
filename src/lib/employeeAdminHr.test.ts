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
import {
  canonicalEpiSize,
  EPI_DELIVERY_SIZE_SUGGESTIONS,
  EPI_GLOVE_SIZE_OPTIONS,
  EPI_LETTER_SIZE_SCALE,
  EPI_PANTS_SIZE_OPTIONS,
  EPI_SHOE_SIZE_OPTIONS,
  EPI_TOP_SIZE_OPTIONS,
  employeeToFormData,
  groupEpiSizeOptions,
} from "./employeeHrUi.ts";

const TOP = new Set<string>(EPI_TOP_SIZE_OPTIONS);
const PANTS = new Set<string>(EPI_PANTS_SIZE_OPTIONS);
const GLOVE = new Set<string>(EPI_GLOVE_SIZE_OPTIONS);

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
describe("employeeHrUi — escala de tamanhos de EPI (PP a 5XG)", () => {
  const LETTERS = ["PP", "P", "M", "G", "GG", "XG", "2XG", "3XG", "4XG", "5XG"];

  it("escala de letras vai de PP a 5XG, na ordem", () => {
    assert.deepEqual([...EPI_LETTER_SIZE_SCALE], LETTERS);
  });

  it("camiseta/jaqueta e calça trazem a escala inteira; calça mantém a numeração", () => {
    for (const size of LETTERS) {
      assert.ok(TOP.has(size), `camiseta sem ${size}`);
      assert.ok(PANTS.has(size), `calça sem ${size}`);
    }
    for (const n of ["34", "42", "60"]) assert.ok(PANTS.has(n), `calça sem ${n}`);
    assert.ok(PANTS.has("Sob medida") && PANTS.has("Não se aplica"));
    assert.equal(new Set(EPI_PANTS_SIZE_OPTIONS).size, EPI_PANTS_SIZE_OPTIONS.length);
    // Calçado é numeração: letra não faz sentido.
    assert.ok(!(EPI_SHOE_SIZE_OPTIONS as readonly string[]).some((s) => LETTERS.includes(s)));
  });

  it("luva usa a mesma escala até 2XG", () => {
    assert.ok(GLOVE.has("6 / PP"));
    assert.ok(GLOVE.has("11 / XG"));
    assert.ok(GLOVE.has("12 / 2XG"));
    assert.ok(!GLOVE.has("11 / XGG"));
  });

  it("servidor aceita a escala nova em cada campo", () => {
    const r = prepareEmployeeEpiFields({
      shirtSize: "5XG",
      pantsSize: "PP",
      jacketSize: "3XG",
      gloveSize: "12 / 2XG",
      shoeSize: "44",
    });
    assert.equal(r.shirtSize, "5XG");
    assert.equal(r.pantsSize, "PP");
    assert.equal(r.jacketSize, "3XG");
    assert.equal(r.gloveSize, "12 / 2XG");
    assert.equal(normalizeEpiSize("2XG", PANTS, "Calça"), "2XG");
    assert.throws(
      () => normalizeEpiSize("6XG", PANTS, "Calça"),
      (e: unknown) => e instanceof EmployeeRegistrationError && e.code === "INVALID_EPI_SIZE"
    );
  });

  it("rótulos da escala anterior viram a escala atual (leitura, gravação e ficha)", () => {
    assert.equal(canonicalEpiSize("XGG"), "XG");
    assert.equal(canonicalEpiSize("EXGG"), "2XG");
    assert.equal(canonicalEpiSize("11 / XGG"), "11 / XG");
    assert.equal(canonicalEpiSize(" M "), "M");
    assert.equal(canonicalEpiSize(null), "");
    assert.equal(canonicalEpiSize("custom-old"), "custom-old");
    // Servidor: rótulo antigo é aceito sem allowLegacy e gravado com o novo.
    assert.equal(normalizeEpiSize("XGG", TOP, "Camiseta"), "XG");
    assert.equal(normalizeEpiSize("EXGG", TOP, "Jaqueta"), "2XG");
    assert.equal(normalizeEpiSize("11 / XGG", GLOVE, "Luva"), "11 / XG");
    // Formulário abre já na escala atual (baseline e formData iguais: não fica "sujo").
    const form = employeeToFormData({
      shirtSize: "XGG",
      jacketSize: "EXGG",
      gloveSize: "11 / XGG",
      pantsSize: "42",
      shoeSize: null,
      EmployeePayrollComponent: [],
    } as never);
    assert.equal(form.shirtSize, "XG");
    assert.equal(form.jacketSize, "2XG");
    assert.equal(form.gloveSize, "11 / XG");
    assert.equal(form.pantsSize, "42");
    assert.equal(form.shoeSize, "");
  });

  it("conversão só no campo que tem o rótulo novo: luva/calçado \"XGG\" legado não trava o salvar", () => {
    // Luva e calçado já foram texto livre: "XGG" / "EXGG" podem estar gravados ali.
    assert.equal(canonicalEpiSize("XGG", EPI_GLOVE_SIZE_OPTIONS), "XGG");
    assert.equal(canonicalEpiSize("EXGG", EPI_SHOE_SIZE_OPTIONS), "EXGG");
    assert.equal(canonicalEpiSize("11 / XGG", EPI_TOP_SIZE_OPTIONS), "11 / XGG");
    assert.equal(canonicalEpiSize("XGG", EPI_PANTS_SIZE_OPTIONS), "XG");
    assert.equal(canonicalEpiSize("11 / XGG", EPI_GLOVE_SIZE_OPTIONS), "11 / XG");

    const stored = {
      shirtSize: "11 / XGG",
      pantsSize: "EXGG",
      jacketSize: "XGG",
      gloveSize: "XGG",
      shoeSize: "EXGG",
    };
    const form = employeeToFormData({ ...stored, EmployeePayrollComponent: [] } as never);
    assert.equal(form.gloveSize, "XGG");
    assert.equal(form.shoeSize, "EXGG");
    assert.equal(form.shirtSize, "11 / XGG");
    assert.equal(form.pantsSize, "2XG");
    assert.equal(form.jacketSize, "XG");
    // PUT: valores legados inalterados passam; os convertidos gravam o rótulo novo.
    const saved = prepareEmployeeEpiFields(form as never, { previous: stored, allowLegacy: true });
    assert.deepEqual(
      [saved.shirtSize, saved.pantsSize, saved.jacketSize, saved.gloveSize, saved.shoeSize],
      ["11 / XGG", "2XG", "XG", "XGG", "EXGG"]
    );
    // Validação do cliente (mesma função) também não acusa erro.
    assert.equal(
      validateEmployeeEpiAdminNotesForm(
        { ...form, salary: 1000, monthlyHours: 220, productivity: 100 },
        { previousEpi: stored, allowLegacyEpi: true }
      ),
      null
    );
  });

  it("select da calça agrupa Letra / Numeração / Outros; os demais ficam num grupo só", () => {
    const pants = groupEpiSizeOptions(EPI_PANTS_SIZE_OPTIONS);
    assert.deepEqual(
      pants.map((g) => g.label),
      ["Letra (PP a 5XG)", "Numeração", "Outros"]
    );
    assert.deepEqual(pants[0].options, LETTERS);
    assert.equal(pants[1].options[0], "34");
    assert.deepEqual(pants[2].options, ["Sob medida", "Não se aplica"]);
    const top = groupEpiSizeOptions(EPI_TOP_SIZE_OPTIONS);
    assert.equal(top.length, 1);
    assert.equal(top[0].label, "");
    assert.deepEqual(top[0].options, [...EPI_TOP_SIZE_OPTIONS]);
    assert.equal(groupEpiSizeOptions(EPI_SHOE_SIZE_OPTIONS).length, 1);
  });

  it("entrega de EPI sugere a escala (texto livre continua valendo)", () => {
    for (const size of LETTERS) assert.ok((EPI_DELIVERY_SIZE_SUGGESTIONS as readonly string[]).includes(size));
    assert.ok((EPI_DELIVERY_SIZE_SUGGESTIONS as readonly string[]).includes("Único"));
  });
});
