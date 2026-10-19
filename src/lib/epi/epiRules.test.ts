import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeReplacementDueDate,
  countByBand,
  describeDue,
  epiDueBand,
  epiItemCode,
  sortReplacementRows,
  validateEpiDeliveryInput,
  validateEpiItemInput,
  validateStatusReason,
} from "./epiRules";

describe("catálogo de EPIs e uniformes", () => {
  it("código automático por tipo e número sequencial", () => {
    assert.equal(epiItemCode("EPI", 7), "EPI-0007");
    assert.equal(epiItemCode("UNIFORM", 12), "UNI-0012");
  });

  it("descrição e tipo obrigatórios; CA não é exigido para uniforme; prazo é inteiro positivo opcional", () => {
    const uniform = validateEpiItemInput({ description: "  Camisa   polo  ", type: "UNIFORM" });
    assert.equal(uniform.ok, true);
    if (uniform.ok) {
      assert.equal(uniform.value.description, "Camisa polo");
      assert.equal(uniform.value.caNumber, null);
      assert.equal(uniform.value.unit, "UNIT");
      assert.equal(uniform.value.replacementDays, null);
    }
    const epi = validateEpiItemInput({ description: "Luva nitrílica", type: "EPI", caNumber: "CA 12345", unit: "PAIR", replacementDays: "30" });
    assert.ok(epi.ok && epi.value.caNumber === "12345" && epi.value.replacementDays === 30);
    for (const bad of [
      { description: "", type: "EPI" },
      { description: "Luva", type: "OUTRO" },
      { description: "Luva", type: "EPI", unit: "CAIXA" },
      { description: "Luva", type: "EPI", replacementDays: 0 },
      { description: "Luva", type: "EPI", replacementDays: 1.5 },
      { description: "Luva", type: "EPI", caNumber: "12 34 !" },
    ]) {
      assert.equal(validateEpiItemInput(bad).ok, false, JSON.stringify(bad));
    }
  });

  it("edição parcial mantém o que não veio", () => {
    const current = { description: "Botina", type: "EPI" as const, caNumber: "1", unit: "PAIR" as const, replacementDays: 365, notes: null };
    const r = validateEpiItemInput({ replacementDays: null }, current);
    assert.ok(r.ok && r.value.description === "Botina" && r.value.replacementDays === null && r.value.caNumber === "1");
  });
});

describe("próxima troca e faixas de vencimento", () => {
  it("data prevista = entrega + prazo (datas de calendário)", () => {
    assert.equal(computeReplacementDueDate("2026-10-16", 180), "2027-04-14");
    assert.equal(computeReplacementDueDate("2024-02-28", 1), "2024-02-29");
    assert.equal(computeReplacementDueDate("2026-10-16", null), null);
  });

  it("faixas mutuamente exclusivas: vencido < 0, 0–30, 31–60, fora > 60", () => {
    const today = "2026-10-16";
    assert.equal(epiDueBand("2026-10-15", today), "OVERDUE");
    assert.equal(epiDueBand("2026-10-16", today), "DUE_30");
    assert.equal(epiDueBand("2026-11-15", today), "DUE_30"); // 30 dias
    assert.equal(epiDueBand("2026-11-16", today), "DUE_60"); // 31 dias
    assert.equal(epiDueBand("2026-12-15", today), "DUE_60"); // 60 dias
    assert.equal(epiDueBand("2026-12-16", today), null); // 61 dias
    assert.equal(epiDueBand(null, today), null);
    assert.equal(describeDue(null, today), "Sem troca programada");
    assert.match(describeDue("2026-10-10", today), /Vencido há 6 dia/);
  });

  it("ordena mais atrasados e depois os mais próximos; conta pendências (não colaboradores)", () => {
    const rows = [
      { daysLeft: 20, employeeName: "Bruno", band: "DUE_30" as const },
      { daysLeft: -3, employeeName: "Ana", band: "OVERDUE" as const },
      { daysLeft: -10, employeeName: "Ana", band: "OVERDUE" as const },
      { daysLeft: 45, employeeName: "Carla", band: "DUE_60" as const },
    ];
    assert.deepEqual(sortReplacementRows(rows).map((r) => r.daysLeft), [-10, -3, 20, 45]);
    assert.deepEqual(countByBand(rows), { OVERDUE: 2, DUE_30: 1, DUE_60: 1 });
  });
});

describe("validação da entrega", () => {
  const ctx = { todayIso: "2026-10-16", catalogReplacementDays: 180 };
  const base = { itemId: "i1", deliveredOn: "2026-10-16", quantity: 1 };
  it("aplica o prazo do cadastro sem pedir justificativa", () => {
    const r = validateEpiDeliveryInput(base, ctx);
    assert.ok(r.ok && r.value.replacementDays === 180 && r.value.replacementDueDate === "2027-04-14" && r.value.adjustReason === null);
  });
  it("prazo ou data diferente do cadastro exige justificativa", () => {
    assert.equal(validateEpiDeliveryInput({ ...base, replacementDays: 90 }, ctx).ok, false);
    assert.equal(validateEpiDeliveryInput({ ...base, replacementDueDate: "2027-01-01" }, ctx).ok, false);
    const ok = validateEpiDeliveryInput({ ...base, replacementDueDate: "2027-01-01", adjustReason: "Desgaste acelerado na lixadeira" }, ctx);
    assert.ok(ok.ok && ok.value.replacementDueDate === "2027-01-01" && ok.value.adjustReason?.includes("lixadeira"));
    // Tirar a troca programada também é ajuste.
    assert.equal(validateEpiDeliveryInput({ ...base, replacementDays: null }, ctx).ok, false);
  });
  it("data futura, quantidade e data prevista anterior à entrega são recusadas", () => {
    assert.equal(validateEpiDeliveryInput({ ...base, deliveredOn: "2026-10-17" }, ctx).ok, false);
    assert.equal(validateEpiDeliveryInput({ ...base, quantity: 0 }, ctx).ok, false);
    assert.equal(
      validateEpiDeliveryInput({ ...base, replacementDueDate: "2026-10-16", adjustReason: "Justificativa qualquer" }, ctx).ok,
      false,
    );
  });
  it("motivo de cancelamento/encerramento com no mínimo 10 caracteres", () => {
    assert.equal(validateStatusReason("erro").ok, false);
    assert.equal(validateStatusReason("Lançado em duplicidade").ok, true);
  });
});
