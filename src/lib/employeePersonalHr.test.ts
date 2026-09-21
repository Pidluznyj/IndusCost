import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Employee } from "../types/employee.ts";
import {
  MAX_WORK_SCHEDULE_LEN,
  normalizeEmployeeWorkSchedule,
} from "./employeeAdminHr.ts";
import {
  BRAZIL_UF_OPTIONS,
  createEmptyEmployeeForm,
  EMPLOYEE_FICHA_RECORD_TABS,
  EMPLOYEE_FICHA_TABS,
  employeeToFormData,
  MARITAL_STATUS_OPTIONS,
} from "./employeeHrUi.ts";
import { EmployeeRegistrationError } from "./employeeRegistration.ts";
import {
  assertEmergencyContactConsistency,
  auditPersonalHrSummary,
  BRAZIL_UF_CODES,
  formatPhoneBrMask,
  formatZipCodeMask,
  MAX_CITY_LEN,
  MAX_MARITAL_STATUS_LEN,
  MAX_STATE_LEN,
  MAX_ZIP_CODE_LEN,
  normalizeEmployeeCpf,
  normalizeEmployeePhone,
  normalizeEmployeeState,
  normalizeEmployeeZipCode,
  normalizePersonalEmail,
  prepareEmployeePersonalHrFields,
  redactEmployeePersonalEmergencyForApi,
  validateEmployeePersonalHrForm,
} from "./employeePersonalHr.ts";
import { diffEmployeeSnapshots, type SnapshotForDiff } from "./peopleProfileHistory.ts";

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
      maritalStatus: null,
      city: null,
      state: null,
      zipCode: null,
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

describe("employeePersonalHr — estado civil / cidade / UF / CEP", () => {
  const isCode = (code: string) => (e: unknown) =>
    e instanceof EmployeeRegistrationError && e.code === code;

  it("lista oficial tem 27 UFs únicas de 2 letras maiúsculas", () => {
    assert.equal(BRAZIL_UF_CODES.length, 27);
    assert.equal(new Set<string>(BRAZIL_UF_CODES).size, 27);
    assert.ok(BRAZIL_UF_CODES.every((uf) => /^[A-Z]{2}$/.test(uf)));
    assert.ok(BRAZIL_UF_CODES.includes("PR"));
    assert.ok(BRAZIL_UF_CODES.includes("DF"));
    assert.deepEqual([...BRAZIL_UF_OPTIONS], [...BRAZIL_UF_CODES]);
  });

  it("UF normaliza para maiúsculas e vazio vira null", () => {
    assert.equal(normalizeEmployeeState(" pr "), "PR");
    assert.equal(normalizeEmployeeState("SP"), "SP");
    assert.equal(normalizeEmployeeState(""), null);
    assert.equal(normalizeEmployeeState("   "), null);
    assert.equal(normalizeEmployeeState(null), null);
    assert.equal(normalizeEmployeeState(undefined), null);
  });

  it("UF fora da lista ou com tamanho errado rejeita", () => {
    assert.throws(() => normalizeEmployeeState("XX"), isCode("INVALID_STATE"));
    assert.throws(() => normalizeEmployeeState("Paraná"), isCode("INVALID_STATE"));
    assert.throws(() => normalizeEmployeeState("P"), isCode("INVALID_STATE"));
  });

  it("UF legada inalterada permanece só na edição", () => {
    assert.equal(
      normalizeEmployeeState("Paraná", { allowLegacy: true, previous: "Paraná" }),
      "Paraná"
    );
    assert.throws(
      () => normalizeEmployeeState("Parana", { allowLegacy: true, previous: "Paraná" }),
      isCode("INVALID_STATE")
    );
    assert.throws(
      () => normalizeEmployeeState("Paraná", { allowLegacy: false, previous: "Paraná" }),
      isCode("INVALID_STATE")
    );
  });

  it("CEP normaliza para 00000-000", () => {
    assert.equal(normalizeEmployeeZipCode("80000000"), "80000-000");
    assert.equal(normalizeEmployeeZipCode("80000-000"), "80000-000");
    assert.equal(normalizeEmployeeZipCode(" 80.000-000 "), "80000-000");
    assert.equal(normalizeEmployeeZipCode(80000000), "80000-000");
    assert.equal(normalizeEmployeeZipCode(""), null);
    assert.equal(normalizeEmployeeZipCode(null), null);
  });

  it("CEP inválido rejeita", () => {
    assert.throws(() => normalizeEmployeeZipCode("8000-000"), isCode("INVALID_ZIP_CODE"));
    assert.throws(() => normalizeEmployeeZipCode("800000000"), isCode("INVALID_ZIP_CODE"));
    assert.throws(() => normalizeEmployeeZipCode("abcde-fgh"), isCode("INVALID_ZIP_CODE"));
    assert.throws(() => normalizeEmployeeZipCode("CEP 80000-000"), isCode("INVALID_ZIP_CODE"));
  });

  it("CEP legado inalterado permanece só na edição", () => {
    assert.equal(
      normalizeEmployeeZipCode("8000", { allowLegacy: true, previous: "8000" }),
      "8000"
    );
    assert.throws(
      () => normalizeEmployeeZipCode("8001", { allowLegacy: true, previous: "8000" }),
      isCode("INVALID_ZIP_CODE")
    );
    assert.throws(() => normalizeEmployeeZipCode("8000"), isCode("INVALID_ZIP_CODE"));
  });

  it("máscara de CEP para input", () => {
    assert.equal(formatZipCodeMask("800"), "800");
    assert.equal(formatZipCodeMask("80000"), "80000");
    assert.equal(formatZipCodeMask("800001"), "80000-1");
    assert.equal(formatZipCodeMask("80000-0001234"), "80000-000");
  });

  it("prepare devolve os novos campos; vazio → null; respeita tamanhos máximos", () => {
    const r = prepareEmployeePersonalHrFields({
      maritalStatus: "  Casado(a) ",
      city: " Curitiba ",
      state: "pr",
      zipCode: "80000000",
    });
    assert.equal(r.maritalStatus, "Casado(a)");
    assert.equal(r.city, "Curitiba");
    assert.equal(r.state, "PR");
    assert.equal(r.zipCode, "80000-000");

    const empty = prepareEmployeePersonalHrFields({
      maritalStatus: "",
      city: "   ",
      state: "",
      zipCode: "",
    });
    assert.equal(empty.maritalStatus, null);
    assert.equal(empty.city, null);
    assert.equal(empty.state, null);
    assert.equal(empty.zipCode, null);

    const absent = prepareEmployeePersonalHrFields({});
    assert.equal(absent.maritalStatus, null);
    assert.equal(absent.zipCode, null);

    const long = prepareEmployeePersonalHrFields({
      maritalStatus: "x".repeat(MAX_MARITAL_STATUS_LEN + 25),
      city: "y".repeat(MAX_CITY_LEN + 25),
    });
    assert.equal(long.maritalStatus?.length, MAX_MARITAL_STATUS_LEN);
    assert.equal(long.city?.length, MAX_CITY_LEN);
    assert.equal(MAX_MARITAL_STATUS_LEN, 40);
    assert.equal(MAX_CITY_LEN, 80);
    assert.equal(MAX_STATE_LEN, 2);
    assert.equal(MAX_ZIP_CODE_LEN, 9);
  });

  it("prepare na edição tolera UF/CEP legados inalterados", () => {
    const r = prepareEmployeePersonalHrFields(
      { state: "Paraná", zipCode: "8000" },
      { allowLegacy: true, previous: { state: "Paraná", zipCode: "8000" } }
    );
    assert.equal(r.state, "Paraná");
    assert.equal(r.zipCode, "8000");
  });

  it("validateEmployeePersonalHrForm cobre UF e CEP (mensagem cai na guia Pessoal)", () => {
    const ufMsg = validateEmployeePersonalHrForm({ state: "XX" });
    assert.ok(ufMsg && /UF/.test(ufMsg) && !/emergência/i.test(ufMsg));
    const cepMsg = validateEmployeePersonalHrForm({ zipCode: "123" });
    assert.ok(cepMsg && /CEP/.test(cepMsg) && !/emergência/i.test(cepMsg));
    assert.equal(
      validateEmployeePersonalHrForm({
        maritalStatus: "Solteiro(a)",
        city: "Curitiba",
        state: "PR",
        zipCode: "80000-000",
      }),
      null
    );
    assert.equal(
      validateEmployeePersonalHrForm(
        { state: "Paraná" },
        { allowLegacy: true, previous: { state: "Paraná" } }
      ),
      null
    );
  });

  it("redação trata estado civil/cidade/UF/CEP como o endereço", () => {
    const row = {
      id: "e1",
      name: "Ana",
      maritalStatus: "Casado(a)",
      city: "Curitiba",
      state: "PR",
      zipCode: "80000-000",
      workSchedule: "Seg–Sex 07:30–17:18",
      emergencyContactName: "Bob",
    };
    const redacted = redactEmployeePersonalEmergencyForApi(row, {
      revealPersonal: false,
      revealEmergency: true,
    });
    assert.equal(redacted.maritalStatus, null);
    assert.equal(redacted.city, null);
    assert.equal(redacted.state, null);
    assert.equal(redacted.zipCode, null);
    assert.equal(redacted.hasPersonalPii, true);
    assert.equal(redacted.personalPiiRedacted, true);
    // Jornada é dado profissional: nunca redigida.
    assert.equal(redacted.workSchedule, "Seg–Sex 07:30–17:18");
    assert.equal(redacted.emergencyContactName, "Bob");

    const full = redactEmployeePersonalEmergencyForApi(row, { reveal: true });
    assert.equal(full.city, "Curitiba");
    assert.equal(full.zipCode, "80000-000");
    assert.equal(full.personalPiiRedacted, false);
  });

  it("auditoria só leva booleanos dos novos campos", () => {
    const audit = auditPersonalHrSummary({
      cpf: null,
      rg: null,
      birthDate: null,
      phone: null,
      personalEmail: null,
      address: null,
      maritalStatus: "Casado(a)",
      city: "Cidade Secreta",
      state: "PR",
      zipCode: "80000-000",
      emergencyContactName: null,
      emergencyContactPhone: null,
      emergencyContactRelationship: null,
    });
    assert.equal(audit.hasMaritalStatus, true);
    assert.equal(audit.hasCityState, true);
    assert.equal(audit.hasZipCode, true);
    const json = JSON.stringify(audit);
    assert.ok(!json.includes("Cidade Secreta"));
    assert.ok(!json.includes("80000-000"));
    assert.ok(!json.includes("Casado"));
  });
});

describe("employeeHrUi — cadastro: guias e formulário", () => {
  it("guias na ordem do contrato, com rótulos pt-BR", () => {
    assert.deepEqual(
      EMPLOYEE_FICHA_TABS.map((t) => [t.id, t.label]),
      [
        ["professional", "Profissional"],
        ["personal", "Pessoal"],
        ["emergency", "Emergência"],
        ["career", "Carreira"],
        ["compensation", "Remuneração"],
        ["benefits", "Benefícios"],
        ["absences", "Férias & afastamentos"],
        ["epi", "EPI / Uniformes"],
        ["documents", "Documentos"],
        ["admin", "Referência administrativa"],
        ["notes", "Observações"],
        ["links", "Vínculos no sistema"],
      ]
    );
    assert.deepEqual(
      [...EMPLOYEE_FICHA_RECORD_TABS],
      ["career", "compensation", "benefits", "absences", "documents"]
    );
    const ids = new Set(EMPLOYEE_FICHA_TABS.map((t) => t.id));
    assert.ok(EMPLOYEE_FICHA_RECORD_TABS.every((id) => ids.has(id)));
  });

  it("opções de estado civil", () => {
    assert.deepEqual(
      [...MARITAL_STATUS_OPTIONS],
      [
        "Solteiro(a)",
        "Casado(a)",
        "União estável",
        "Divorciado(a)",
        "Separado(a)",
        "Viúvo(a)",
      ]
    );
    assert.ok(MARITAL_STATUS_OPTIONS.every((o) => o.length <= MAX_MARITAL_STATUS_LEN));
  });

  it("formulário vazio e edição mapeiam os novos campos", () => {
    const empty = createEmptyEmployeeForm("role-1");
    assert.equal(empty.maritalStatus, "");
    assert.equal(empty.city, "");
    assert.equal(empty.state, "");
    assert.equal(empty.zipCode, "");
    assert.equal(empty.workSchedule, "");

    const base = {
      id: "e1",
      name: "Ana",
      roleId: "role-1",
      department: "Produção",
      costCenter: "CC",
      classification: "DIRETO",
      salary: 1000,
      monthlyHours: 220,
      productivity: 100,
      status: "ACTIVE",
      EmployeePayrollComponent: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as unknown as Employee;

    const form = employeeToFormData({
      ...base,
      maritalStatus: "Casado(a)",
      city: "Curitiba",
      state: "PR",
      zipCode: "80000000",
      workSchedule: "Seg–Sex 07:30–17:18",
    });
    assert.equal(form.maritalStatus, "Casado(a)");
    assert.equal(form.city, "Curitiba");
    assert.equal(form.state, "PR");
    assert.equal(form.zipCode, "80000-000");
    assert.equal(form.workSchedule, "Seg–Sex 07:30–17:18");

    const blank = employeeToFormData({ ...base, zipCode: null, workSchedule: null });
    assert.equal(blank.maritalStatus, "");
    assert.equal(blank.zipCode, "");
    assert.equal(blank.workSchedule, "");

    // CEP legado fora do padrão não é reescrito pela máscara (servidor tolera inalterado).
    assert.equal(employeeToFormData({ ...base, zipCode: "8000" }).zipCode, "8000");
  });
});

describe("employeeAdminHr — jornada descritiva (workSchedule)", () => {
  it("texto livre aparado; vazio → null; máximo 80", () => {
    assert.equal(
      normalizeEmployeeWorkSchedule("  Seg–Sex 07:30–17:18 "),
      "Seg–Sex 07:30–17:18"
    );
    assert.equal(normalizeEmployeeWorkSchedule(""), null);
    assert.equal(normalizeEmployeeWorkSchedule("   "), null);
    assert.equal(normalizeEmployeeWorkSchedule(null), null);
    assert.equal(normalizeEmployeeWorkSchedule(undefined), null);
    assert.equal(normalizeEmployeeWorkSchedule(42), null);
    assert.equal(MAX_WORK_SCHEDULE_LEN, 80);
    assert.equal(
      normalizeEmployeeWorkSchedule("z".repeat(200))?.length,
      MAX_WORK_SCHEDULE_LEN
    );
  });
});

describe("histórico — jornada gravada pelo PUT gera WORK_SCHEDULE_CHANGE", () => {
  const snapshot = (workSchedule: string | null): SnapshotForDiff => ({
    roleId: "role-1",
    roleName: "Operador",
    departmentId: null,
    department: "Produção",
    costCenterId: null,
    costCenter: "CC",
    managerId: null,
    managerName: null,
    contractType: "CLT",
    workSchedule,
    status: "ACTIVE",
    salary: 1000,
    admissionDate: null,
    terminationDate: null,
  });

  it("mudança de workSchedule vira exatamente um evento", () => {
    const next = normalizeEmployeeWorkSchedule(" Seg–Sex 07:30–17:18 ");
    const events = diffEmployeeSnapshots(snapshot(null), snapshot(next));
    assert.deepEqual(
      events.map((e) => e.eventType),
      ["WORK_SCHEDULE_CHANGE"]
    );
    assert.equal(events[0]?.previousWorkSchedule, null);
    assert.equal(events[0]?.newWorkSchedule, "Seg–Sex 07:30–17:18");
  });

  it("limpar a jornada também registra; inalterada não gera evento", () => {
    const cleared = diffEmployeeSnapshots(
      snapshot("Seg–Sex 07:30–17:18"),
      snapshot(normalizeEmployeeWorkSchedule(""))
    );
    assert.deepEqual(
      cleared.map((e) => e.eventType),
      ["WORK_SCHEDULE_CHANGE"]
    );
    assert.deepEqual(
      diffEmployeeSnapshots(snapshot("Seg–Sex"), snapshot(normalizeEmployeeWorkSchedule("Seg–Sex "))),
      []
    );
  });
});

describe("server.ts — POST/PUT persistem as colunas novas (source-text)", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "server.ts"),
    "utf8"
  );
  const start = src.indexOf("function buildEmployeeHrProfileData(");
  const end = src.indexOf("const employeeApiInclude", start);
  const builder = src.slice(start, end);

  it("buildEmployeeHrProfileData grava os 5 campos só quando enviados", () => {
    assert.ok(start > 0 && end > start);
    for (const key of ["maritalStatus", "city", "state", "zipCode", "workSchedule"]) {
      assert.ok(builder.includes(`sent("${key}")`), key);
    }
    assert.ok(builder.includes("normalizeEmployeeWorkSchedule(body.workSchedule, {"));
    // Jornada legada intocada não é cortada no PUT (sem WORK_SCHEDULE_CHANGE falso).
    assert.ok(builder.includes("previous: opts?.previousWorkSchedule"));
  });

  it("POST e PUT passam pelo mesmo builder; PUT tolera UF/CEP legados", () => {
    const postIdx = src.indexOf('app.post("/api/employees",');
    const putIdx = src.indexOf('app.put("/api/employees/:id",');
    const deleteIdx = src.indexOf('app.delete("/api/employees/:id",');
    assert.ok(postIdx > 0 && putIdx > postIdx && deleteIdx > putIdx);
    assert.ok(src.slice(postIdx, putIdx).includes("buildEmployeeHrProfileData("));
    const put = src.slice(putIdx, deleteIdx);
    assert.ok(put.includes("buildEmployeeHrProfileData("));
    assert.ok(put.includes("state: existingEmployee.state"));
    assert.ok(put.includes("zipCode: existingEmployee.zipCode"));
    // Snapshot anterior com workSchedule → diff gera WORK_SCHEDULE_CHANGE.
    assert.ok(put.includes("workSchedule: existingEmployee.workSchedule"));
    assert.ok(put.includes("previousWorkSchedule: existingEmployee.workSchedule"));
    assert.ok(put.includes("recordHistoryAfterEmployeeWrite("));
  });
});
