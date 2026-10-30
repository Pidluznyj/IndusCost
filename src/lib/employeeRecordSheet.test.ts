import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPLOYEE_SHEET_MASK,
  buildEmployeeRecordSheet,
  maskSensitiveValuesInText,
  type EmployeeRecordSheetInput,
} from "./employeeRecordSheet.js";

const summary: EmployeeRecordSheetInput["summary"] = {
  identity: {
    fullName: "Adão Rogério Rodrigues",
    socialName: "Adão Rodrigues",
    registrationId: "MAT-1",
    statusLabel: "Ativo",
    photoUrl: null,
    roleName: "Auxiliar de Produção",
    department: "Fabricação",
    costCenterLabel: "CC_FOLHA",
    managerName: "Alex",
    contractType: "CLT",
    workSchedule: "220 h/mês",
    corporateEmail: null,
    classification: null,
  },
  kpis: { admissionDate: "2024-10-24", tenureLabel: "2 anos" },
};

const full: EmployeeRecordSheetInput = {
  summary,
  personal: { fullName: "Adão Rogério Rodrigues", cpf: "123.456.789-00", birthDate: "1990-01-02" },
  emergency: { contacts: [{ name: "Maria", phone: "41999990000", relationship: "Esposa" }] },
  professional: { roleName: "Auxiliar de Produção", statusLabel: "Ativo", professionalNotes: "Salário de 3500 combinado" },
  career: { items: [{ effectiveDate: "2025-01-10", eventLabel: "Promoção", summary: "Auxiliar → Operador", reason: "Mérito" }] },
  compensation: {
    currentSalary: 4321.09,
    items: [
      {
        effectiveDate: "2025-02-01",
        typeLabel: "Mérito",
        percentage: 7.77,
        previousAmount: 4010.5,
        newAmount: 4321.09,
        differenceAmount: 310.59,
        reason: "Ajuste de 4010 para 4321",
      },
    ],
  } as never,
  benefits: { items: [{ kind: "official", name: "Vale alimentação", typeLabel: "Benefício", amount: 888.88, percentage: 66.66 }] },
  absences: { items: [{ startDate: "2025-03-01", endDate: "2025-03-30", type: "VACATION", status: "COMPLETED", reason: "Férias" }] },
  epi: {
    sizes: { shirtSize: "M" },
    events: [{ deliveredAt: "2025-01-01", items: [{ item: "Luva", itemCaNumber: "123", quantity: 2, size: "G", status: "ACTIVE" }] }],
  },
  documents: { items: [{ displayName: "Contrato", documentType: "CONTRATO", createdAt: "2024-10-24" }] },
  certificates: { items: [{ title: "NR-12", issuer: "Lazarios", completedOn: "2025-01-01" }] },
  competencies: { associated: [{ competencyName: "Solda", category: "Técnica", currentLevel: 3 }] },
  evaluations: { items: [{ shortLabel: "45 dias", statusLabel: "Concluída", averageLabel: "3,5" }] },
  history: {
    items: [
      { eventType: "COMPENSATION_ADJUSTMENT", eventLabel: "Reajuste", effectiveDate: "2025-02-01", summary: "+7,77% · R$ 4.010,50 → R$ 4.321,09" },
      { eventType: "BENEFIT_CHANGE", eventLabel: "Alteração de benefício", effectiveDate: "2025-02-02", summary: "Vale R$ 888,88" },
      { eventType: "NOTE_ADDED", eventLabel: "Observação registrada", effectiveDate: "2025-02-03", summary: "Texto restrito sigiloso" },
    ],
  },
  notes: {
    notes: [
      { category: "GERAL", body: "Recebeu bônus de 1500", createdAt: "2025-01-01", createdByName: "RH" },
      { category: "RESTRITA", body: "Nota sigilosa", createdAt: "2025-01-02" },
    ],
  },
};

describe("ficha completa do colaborador", () => {
  it("nenhum valor de remuneração chega ao documento, nem com todos os campos preenchidos", () => {
    const json = JSON.stringify(buildEmployeeRecordSheet(full));
    for (const leak of ["4321", "4.321", "4010", "4.010", "310", "7,77", "7.77", "888", "66,66", "66.66", "1500", "3500"]) {
      assert.ok(!json.includes(leak), `vazou ${leak}`);
    }
    assert.ok(json.includes(EMPLOYEE_SHEET_MASK));
  });

  it("salário, reajuste e benefício aparecem como XXXXXXXX", () => {
    const sheet = buildEmployeeRecordSheet(full);
    const compensation = sheet.sections.find((row) => row.id === "compensation")!;
    assert.deepEqual(compensation.fields, [{ label: "Salário atual", value: "XXXXXXXX", span: 4, masked: true }]);
    const row = compensation.tables![0]!.rows[0]!;
    assert.deepEqual(row.slice(2, 5), ["XXXXXXXX", "XXXXXXXX", "XXXXXXXX"]);
    assert.equal(row[5], "Ajuste de XXXXXXXX para XXXXXXXX");
    const benefit = sheet.sections.find((row) => row.id === "benefits")!.tables![0]!.rows[0]!;
    assert.equal(benefit[0], "Vale alimentação");
    assert.equal(benefit[3], "XXXXXXXX");
  });

  it("observação restrita e texto de nota no histórico ficam fora", () => {
    const json = JSON.stringify(buildEmployeeRecordSheet(full));
    assert.ok(!json.includes("sigilos"));
  });

  it("seção sem permissão ou com falha avisa em vez de parecer vazia", () => {
    const sheet = buildEmployeeRecordSheet({ summary, personal: { error: "Erro 500" } });
    assert.match(sheet.sections.find((row) => row.id === "personal")!.unavailable!, /Erro 500/);
    assert.match(sheet.sections.find((row) => row.id === "compensation")!.unavailable!, /Sem permissão/);
    assert.equal(sheet.sections.some((row) => row.id === "competencies"), false);
    const redacted = buildEmployeeRecordSheet({ summary, personal: { redacted: true } });
    assert.equal(redacted.sections.find((row) => row.id === "personal")!.unavailable, "Informação restrita.");
  });

  it("dados não salariais continuam legíveis", () => {
    const json = JSON.stringify(buildEmployeeRecordSheet(full));
    for (const kept of ["123.456.789-00", "41999990000", "02/01/1990", "Auxiliar → Operador", "NR-12", "Solda"]) {
      assert.ok(json.includes(kept), kept);
    }
  });

  it("máscara de texto livre", () => {
    const cases: Array<[string, string]> = [
      ["Pago R$ 1.234,56 em maio", "Pago XXXXXXXX em maio"],
      ["aumento de 10%", "aumento de XXXXXXXX"],
      ["valor 2.500,00", "valor XXXXXXXX"],
      ["valor 2.500", "valor XXXXXXXX"],
      ["salário: 3200", "salário: XXXXXXXX"],
      ["ganha 3 mil", "ganha XXXXXXXX"],
      ["Turno 2, sala 15", "Turno 2, sala 15"],
      ["CPF 123.456.789-00", "CPF 123.456.789-00"],
      ["CNPJ 14.055.501/0001-80", "CNPJ 14.055.501/0001-80"],
    ];
    for (const [input, expected] of cases) assert.equal(maskSensitiveValuesInText(input), expected);
  });
});
