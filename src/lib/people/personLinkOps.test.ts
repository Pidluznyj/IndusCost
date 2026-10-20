import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideRelink, mergeEvidence, planPersonMerge, type IdentityForMerge } from "@/src/lib/people/personLinkOps";

const base = (over: Partial<IdentityForMerge>): IdentityForMerge => ({
  id: "A",
  displayName: "A",
  status: "ACTIVE",
  cpfNormalized: null,
  corporateEmail: null,
  employeeIds: [],
  activeUserIds: [],
  inactiveUserIds: [],
  fleetDriverIds: [],
  commissionPersonIds: [],
  customerIdentityIds: [],
  customerContactIds: [],
  ...over,
});

describe("unificação de Pessoas — plano puro", () => {
  it("caso real: A (CPF + colaborador) absorve B (só a conta): move a conta, sem bloqueios, evidência manual", () => {
    const winner = base({ id: "A", cpfNormalized: "52998224725", employeeIds: ["e1"] });
    const loser = base({ id: "B", activeUserIds: ["u1"] });
    const plan = planPersonMerge(winner, loser);
    assert.deepEqual(plan.blockers, []);
    assert.deepEqual(plan.moves, [{ entityKind: "app_user", entityId: "u1" }]);
    assert.equal(plan.evidence, "MANUAL");
    assert.deepEqual(plan.fillFromLoser, []);
  });

  it("CPF validado divergente bloqueia sempre", () => {
    const plan = planPersonMerge(base({ id: "A", cpfNormalized: "52998224725" }), base({ id: "B", cpfNormalized: "11144477735" }));
    assert.ok(plan.blockers.some((b) => b.code === "CPF_DIVERGENT"));
  });

  it("dois colaboradores ou duas contas bloqueiam (cardinalidade 1:1)", () => {
    const p1 = planPersonMerge(base({ id: "A", employeeIds: ["e1"] }), base({ id: "B", employeeIds: ["e2"] }));
    assert.ok(p1.blockers.some((b) => b.code === "TWO_EMPLOYEES"));
    const p2 = planPersonMerge(base({ id: "A", activeUserIds: ["u1"] }), base({ id: "B", inactiveUserIds: ["u2"] }));
    assert.ok(p2.blockers.some((b) => b.code === "TWO_USERS"));
  });

  it("pessoa já unificada não participa", () => {
    const p = planPersonMerge(base({ id: "A", status: "MERGED" }), base({ id: "B" }));
    assert.ok(p.blockers.some((b) => b.code === "WINNER_MERGED"));
  });

  it("preenche na vencedora só o que ela não tem (CPF/e-mail), nunca sobrescreve", () => {
    const p = planPersonMerge(base({ id: "A", corporateEmail: "a@x" }), base({ id: "B", cpfNormalized: "52998224725", corporateEmail: "b@x" }));
    assert.deepEqual(p.fillFromLoser, ["cpfNormalized"]);
  });

  it("evidência: CPF igual > e-mail igual > manual; nome nunca conta", () => {
    assert.equal(mergeEvidence(base({ cpfNormalized: "1" }), base({ cpfNormalized: "1" })), "CPF_EXACT");
    assert.equal(mergeEvidence(base({ corporateEmail: "X@y" }), base({ corporateEmail: "x@Y" })), "EMAIL_EXACT");
    assert.equal(mergeEvidence(base({ displayName: "Igual" }), base({ displayName: "Igual" })), "MANUAL");
  });
});

describe("vínculo/correção — decisão pura", () => {
  const ok = { entityKind: "app_user" as const, currentPersonId: "B", expectedCurrentPersonId: "B", targetPersonId: "A", targetStatus: "ACTIVE", targetHasEmployee: true, targetHasUser: false };
  it("corrigir conta de B para A: RELINK com origem B", () => {
    assert.deepEqual(decideRelink(ok), { ok: true, kind: "RELINK", fromPersonId: "B" });
  });
  it("registro mudou entre prévia e confirmação: STALE", () => {
    const d = decideRelink({ ...ok, expectedCurrentPersonId: null });
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.code, "STALE");
  });
  it("alvo já tem conta / já tem colaborador", () => {
    const d1 = decideRelink({ ...ok, targetHasUser: true });
    assert.equal(d1.ok, false);
    const d2 = decideRelink({ ...ok, entityKind: "employee", currentPersonId: null, expectedCurrentPersonId: null });
    assert.equal(d2.ok, false);
    if (!d2.ok) assert.equal(d2.code, "TARGET_HAS_EMPLOYEE");
  });
  it("alvo MERGED é recusado; mesmo alvo é no-op", () => {
    const d = decideRelink({ ...ok, targetStatus: "MERGED" });
    assert.equal(d.ok, false);
    const same = decideRelink({ ...ok, currentPersonId: "A", expectedCurrentPersonId: "A" });
    assert.equal(same.ok, false);
  });
});
