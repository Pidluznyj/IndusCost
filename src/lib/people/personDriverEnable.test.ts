import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDriverFleetFields, planDriverEnable } from "./personDriverEnable.ts";

const P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CPF = "52998224725";
const person = { id: P, status: "ACTIVE", cpfNormalized: CPF };

describe("planDriverEnable — uma identidade, um motorista ativo", () => {
  it("sem motorista com o CPF → CREATE", () => {
    assert.deepEqual(planDriverEnable({ person, duplicatePersonCount: 0, drivers: [] }), { action: "CREATE", driverId: null, blockers: [] });
  });
  it("motorista ativo com o mesmo CPF e sem Pessoa → LINK (nunca segunda identidade)", () => {
    const r = planDriverEnable({ person, duplicatePersonCount: 0, drivers: [{ id: "d1", name: "M", status: "PENDING", personId: null, cpf: "529.982.247-25" }] });
    assert.equal(r.action, "LINK");
    assert.equal(r.driverId, "d1");
  });
  it("motorista INACTIVE com o mesmo CPF → REACTIVATE em vez de duplicar", () => {
    const r = planDriverEnable({ person, duplicatePersonCount: 0, drivers: [{ id: "d1", name: "M", status: "INACTIVE", personId: null, cpf: CPF }] });
    assert.equal(r.action, "REACTIVATE");
  });
  it("já há motorista não-INACTIVE ligado à Pessoa → ALREADY_ENABLED", () => {
    const r = planDriverEnable({ person, duplicatePersonCount: 0, drivers: [{ id: "d1", name: "M", status: "AUTHORIZED", personId: P, cpf: CPF }] });
    assert.equal(r.action, "ALREADY_ENABLED");
  });
  it("motorista ativo com o CPF ligado a OUTRA Pessoa → CONFLICT (corrigir em Pessoas 360°)", () => {
    const r = planDriverEnable({ person, duplicatePersonCount: 0, drivers: [{ id: "d1", name: "M", status: "AUTHORIZED", personId: OTHER, cpf: CPF }] });
    assert.equal(r.action, "CONFLICT");
    assert.ok(r.blockers.some((b) => b.code === "OTHER_PERSON_LINKED"));
  });
  it("bloqueios: CPF inválido/ausente, Pessoa MERGED/INACTIVE, CPF duplicado entre Pessoas", () => {
    assert.ok(planDriverEnable({ person: { ...person, cpfNormalized: null }, duplicatePersonCount: 0, drivers: [] }).blockers.some((b) => b.code === "CPF_INVALID"));
    assert.ok(planDriverEnable({ person: { ...person, cpfNormalized: "11111111111" }, duplicatePersonCount: 0, drivers: [] }).blockers.some((b) => b.code === "CPF_INVALID"));
    assert.ok(planDriverEnable({ person: { ...person, status: "MERGED" }, duplicatePersonCount: 0, drivers: [] }).blockers.some((b) => b.code === "PERSON_MERGED"));
    assert.ok(planDriverEnable({ person: { ...person, status: "INACTIVE" }, duplicatePersonCount: 0, drivers: [] }).blockers.some((b) => b.code === "PERSON_INACTIVE"));
    const dup = planDriverEnable({ person, duplicatePersonCount: 1, drivers: [] });
    assert.equal(dup.action, "BLOCKED");
    assert.ok(dup.blockers.some((b) => b.code === "DUPLICATE_PERSON_CPF"));
  });
});

describe("parseDriverFleetFields — só campos da Frota", () => {
  it("ignora nome/CPF/telefone/e-mail do corpo (são da Pessoa) e valida categoria/data", () => {
    const f = parseDriverFleetFields({ name: "hack", cpf: "000", cnhNumber: " 123 ", cnhCategory: "ab", cnhExpirationDate: "2030-01-01", unit: "Matriz" });
    assert.deepEqual(Object.keys(f).sort(), ["cnhCategory", "cnhExpirationDate", "cnhNumber", "costCenter", "notes", "unit"]);
    assert.equal(f.cnhNumber, "123");
    assert.equal(f.cnhCategory, "AB");
    assert.throws(() => parseDriverFleetFields({ cnhCategory: "Z" }), /Categoria/);
    assert.throws(() => parseDriverFleetFields({ cnhExpirationDate: "ontem" }), /validade/);
  });
});
