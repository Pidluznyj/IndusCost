import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPersonIndexes,
  classifyOrphanAgainstPersons,
  filterApplyCandidates,
  summarizeCandidates,
  type OrphanEntityRow,
  type PersonIndexRow,
} from "./canonicalPersonBackfill.ts";

/** CPF válido: 11144477735 */
const VALID_CPF = "11144477735";
const OTHER_VALID_CPF = "39053344705";

function person(partial: Partial<PersonIndexRow> & { id: string }): PersonIndexRow {
  return {
    displayName: partial.displayName ?? "Pessoa",
    corporateEmail: partial.corporateEmail ?? null,
    personalEmail: partial.personalEmail ?? null,
    cpfNormalized: partial.cpfNormalized ?? null,
    phoneNormalized: partial.phoneNormalized ?? null,
    linkedEmployeeIds: partial.linkedEmployeeIds ?? [],
    linkedAppUserIds: partial.linkedAppUserIds ?? [],
    ...partial,
  };
}

function orphan(partial: Partial<OrphanEntityRow> & { id: string }): OrphanEntityRow {
  return {
    kind: partial.kind ?? "employee",
    label: partial.label ?? "Colaborador",
    emails: partial.emails ?? [],
    cpf: partial.cpf ?? null,
    phone: partial.phone ?? null,
    officialId: partial.officialId ?? null,
    name: partial.name ?? "Colaborador",
    ...partial,
  };
}

describe("canonicalPersonBackfill — classificação", () => {
  it("CPF exato válido único → unequivocal", () => {
    const people = [person({ id: "p1", cpfNormalized: VALID_CPF, displayName: "Ana" })];
    const idx = buildPersonIndexes(people);
    const c = classifyOrphanAgainstPersons(
      orphan({ id: "e1", cpf: VALID_CPF, name: "Ana" }),
      idx
    );
    assert.equal(c.category, "unequivocal");
    assert.equal(c.autoLinkSafe, true);
    assert.equal(c.targetPersonId, "p1");
    assert.ok(c.cpfMasked?.includes("***"));
  });

  it("e-mail duplicado em duas Persons → ambiguous", () => {
    const people = [
      person({ id: "p1", corporateEmail: "a@x.com" }),
      person({ id: "p2", personalEmail: "a@x.com" }),
    ];
    const idx = buildPersonIndexes(people);
    const c = classifyOrphanAgainstPersons(
      orphan({ id: "e1", emails: ["a@x.com"] }),
      idx
    );
    assert.equal(c.category, "ambiguous");
    assert.equal(c.autoLinkSafe, false);
  });

  it("CPF duplicado em Persons → ambiguous", () => {
    const people = [
      person({ id: "p1", cpfNormalized: VALID_CPF }),
      person({ id: "p2", cpfNormalized: VALID_CPF }),
    ];
    const idx = buildPersonIndexes(people);
    const c = classifyOrphanAgainstPersons(orphan({ id: "e1", cpf: VALID_CPF }), idx);
    assert.equal(c.category, "ambiguous");
  });

  it("nome igual sozinho → probable, nunca apply", () => {
    const people = [person({ id: "p1", displayName: "Maria Silva" })];
    const idx = buildPersonIndexes(people);
    const c = classifyOrphanAgainstPersons(
      orphan({ id: "e1", name: "Maria Silva", emails: [], cpf: null }),
      idx
    );
    assert.equal(c.category, "probable");
    assert.equal(c.autoLinkSafe, false);
    assert.deepEqual(c.evidence, ["name"]);
  });

  it("telefone isolado → probable, nunca apply", () => {
    const people = [person({ id: "p1", phoneNormalized: "11999998888" })];
    const idx = buildPersonIndexes(people);
    const c = classifyOrphanAgainstPersons(
      orphan({ id: "e1", phone: "11999998888", emails: [], cpf: null }),
      idx
    );
    assert.equal(c.category, "probable");
    assert.equal(c.autoLinkSafe, false);
  });

  it("conflito: Person já tem outro Employee", () => {
    const people = [
      person({
        id: "p1",
        corporateEmail: "a@x.com",
        linkedEmployeeIds: ["other"],
      }),
    ];
    const idx = buildPersonIndexes(people);
    const c = classifyOrphanAgainstPersons(
      orphan({ id: "e1", emails: ["a@x.com"] }),
      idx
    );
    assert.equal(c.category, "conflict");
    assert.equal(c.autoLinkSafe, false);
  });

  it("conflito: CPF e e-mail apontam Persons diferentes", () => {
    const people = [
      person({ id: "p1", cpfNormalized: VALID_CPF }),
      person({ id: "p2", corporateEmail: "b@x.com" }),
    ];
    const idx = buildPersonIndexes(people);
    const c = classifyOrphanAgainstPersons(
      orphan({ id: "e1", cpf: VALID_CPF, emails: ["b@x.com"] }),
      idx
    );
    assert.equal(c.category, "conflict");
  });

  it("e-mail casa mas CPF do órfão diverge → conflict", () => {
    const people = [
      person({
        id: "p1",
        corporateEmail: "a@x.com",
        cpfNormalized: VALID_CPF,
      }),
    ];
    const idx = buildPersonIndexes(people);
    const c = classifyOrphanAgainstPersons(
      orphan({ id: "e1", emails: ["a@x.com"], cpf: OTHER_VALID_CPF }),
      idx
    );
    assert.equal(c.category, "conflict");
  });

  it("sem correspondência → no_match", () => {
    const idx = buildPersonIndexes([]);
    const c = classifyOrphanAgainstPersons(
      orphan({ id: "e1", emails: ["novo@x.com"], cpf: null }),
      idx
    );
    assert.equal(c.category, "no_match");
  });

  it("customer_contact nunca autoLinkSafe mesmo com e-mail único", () => {
    const people = [person({ id: "p1", corporateEmail: "c@x.com" })];
    const idx = buildPersonIndexes(people);
    const c = classifyOrphanAgainstPersons(
      orphan({
        id: "cust1",
        kind: "customer_contact",
        emails: ["c@x.com"],
      }),
      idx
    );
    assert.equal(c.category, "probable");
    assert.equal(c.autoLinkSafe, false);
  });
});

describe("canonicalPersonBackfill — apply filter e idempotência lógica", () => {
  it("filterApplyCandidates só unequivocal seguros", () => {
    const people = [person({ id: "p1", cpfNormalized: VALID_CPF })];
    const idx = buildPersonIndexes(people);
    const ok = classifyOrphanAgainstPersons(
      orphan({ id: "e1", cpf: VALID_CPF }),
      idx
    );
    const nameOnly = classifyOrphanAgainstPersons(
      orphan({ id: "e2", name: "X", emails: [], cpf: null }),
      idx
    );
    const selected = filterApplyCandidates([ok, nameOnly]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].entityId, "e1");
  });

  it("resumo por categoria", () => {
    const people = [person({ id: "p1", cpfNormalized: VALID_CPF })];
    const idx = buildPersonIndexes(people);
    const cands = [
      classifyOrphanAgainstPersons(orphan({ id: "e1", cpf: VALID_CPF }), idx),
      classifyOrphanAgainstPersons(
        orphan({ id: "e2", name: "Maria Silva", emails: [], cpf: null }),
        idx
      ),
    ];
    const summary = summarizeCandidates(cands);
    assert.equal(summary.byCategory.unequivocal, 1);
    assert.equal(summary.autoLinkSafeCount, 1);
  });

  it("segunda classificação após 'já vinculado' (simulado) vira conflito unique", () => {
    const people = [
      person({
        id: "p1",
        cpfNormalized: VALID_CPF,
        linkedEmployeeIds: ["e1"],
      }),
    ];
    const idx = buildPersonIndexes(people);
    const again = classifyOrphanAgainstPersons(
      orphan({ id: "e2", cpf: VALID_CPF }),
      idx
    );
    assert.equal(again.category, "conflict");
    assert.equal(filterApplyCandidates([again]).length, 0);
  });
});
