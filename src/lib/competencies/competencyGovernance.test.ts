import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approvalReason, decideLevelWrite, validateDecision } from "./competencyGovernance";

describe("competencyGovernance — quando exige aprovação", () => {
  it("avaliação formal e treinamento nunca exigem", () => {
    assert.equal(approvalReason({ source: "ASSESSMENT", from: 0, to: 4, critical: true }), null);
    assert.equal(approvalReason({ source: "TRAINING", from: 0, to: 4, critical: true }), null);
  });

  it("subir para 3 ou 4 por ajuste/importação exige; até 2 não", () => {
    assert.equal(approvalReason({ source: "MANUAL", from: 2, to: 3, critical: false }), "GOVERNED_LEVEL");
    assert.equal(approvalReason({ source: "IMPORT", from: 0, to: 4, critical: false }), "GOVERNED_LEVEL");
    assert.equal(approvalReason({ source: "MANUAL", from: 0, to: 2, critical: false }), null);
  });

  it("competência crítica: qualquer subida exige", () => {
    assert.equal(approvalReason({ source: "MANUAL", from: 0, to: 1, critical: true }), "CRITICAL_COMPETENCY");
    assert.equal(approvalReason({ source: "IMPORT", from: 2, to: 4, critical: true }), "CRITICAL_COMPETENCY");
  });

  it("rebaixar ou manter nunca exige", () => {
    assert.equal(approvalReason({ source: "MANUAL", from: 4, to: 3, critical: true }), null);
    assert.equal(approvalReason({ source: "IMPORT", from: 3, to: 3, critical: true }), null);
  });
});

describe("competencyGovernance — decisão de gravação", () => {
  it("aprovador grava direto (aprovado na origem); demais geram solicitação", () => {
    assert.deepEqual(decideLevelWrite({ source: "MANUAL", from: 1, to: 3, critical: false, actorCanApprove: true }), {
      kind: "APPLY",
      selfApproved: "GOVERNED_LEVEL",
    });
    assert.deepEqual(decideLevelWrite({ source: "MANUAL", from: 1, to: 3, critical: false, actorCanApprove: false }), {
      kind: "REQUEST",
      reason: "GOVERNED_LEVEL",
    });
    assert.deepEqual(decideLevelWrite({ source: "MANUAL", from: 1, to: 2, critical: false, actorCanApprove: false }), {
      kind: "APPLY",
      selfApproved: null,
    });
  });

  it("rejeitar exige justificativa; ninguém decide a própria solicitação", () => {
    assert.equal(validateDecision({ decision: "REJECT", note: " ", requestedByUserId: "a", deciderUserId: "b" }).ok, false);
    assert.equal(validateDecision({ decision: "REJECT", note: "Sem evidência", requestedByUserId: "a", deciderUserId: "b" }).ok, true);
    assert.equal(validateDecision({ decision: "APPROVE", note: null, requestedByUserId: "a", deciderUserId: "b" }).ok, true);
    const self = validateDecision({ decision: "APPROVE", note: null, requestedByUserId: "a", deciderUserId: "a" });
    assert.deepEqual(self.ok === false && self.code, "SELF_DECISION");
  });
});
