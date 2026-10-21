import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isEffectiveTermination,
  parseTerminationRevokesAccessFlag,
  planTerminationAccessRevocation,
  userAuditSnapshot,
} from "@/src/lib/security/userAccessLifecycle";

const active = { id: "u1", isActive: true, role: "VIEWER" };

describe("E1 — revogação de acesso no desligamento (regras puras)", () => {
  it("só ACTIVE → INACTIVE com data de desligamento é desligamento efetivo", () => {
    assert.equal(isEffectiveTermination({ previousStatus: "ACTIVE", nextStatus: "INACTIVE", terminationDate: "2026-10-20" }), true);
    assert.equal(isEffectiveTermination({ previousStatus: null, nextStatus: "INACTIVE", terminationDate: new Date() }), true);
    assert.equal(isEffectiveTermination({ previousStatus: "INACTIVE", nextStatus: "INACTIVE", terminationDate: "2026-10-20" }), false, "desligamento repetido");
    assert.equal(isEffectiveTermination({ previousStatus: "ACTIVE", nextStatus: "ACTIVE", terminationDate: null }), false);
    assert.equal(isEffectiveTermination({ previousStatus: "ACTIVE", nextStatus: "INACTIVE", terminationDate: null }), false, "sem data não é desligamento");
  });

  it("com a flag ligada e conta vinculada ativa: inativa", () => {
    const d = planTerminationAccessRevocation({ enabled: true, previousStatus: "ACTIVE", nextStatus: "INACTIVE", terminationDate: "2026-10-20", linkedUser: active });
    assert.deepEqual(d, { action: "DEACTIVATE", userId: "u1" });
  });

  it("flag desligada: nada muda (homologação)", () => {
    const d = planTerminationAccessRevocation({ enabled: false, previousStatus: "ACTIVE", nextStatus: "INACTIVE", terminationDate: "2026-10-20", linkedUser: active });
    assert.deepEqual(d, { action: "SKIP", reason: "FLAG_DISABLED" });
  });

  it("funcionário sem conta: nada a fazer; só relatório", () => {
    const d = planTerminationAccessRevocation({ enabled: true, previousStatus: "ACTIVE", nextStatus: "INACTIVE", terminationDate: "2026-10-20", linkedUser: null });
    assert.deepEqual(d, { action: "SKIP", reason: "NO_LINKED_USER" });
  });

  it("conta já inativa: não repete", () => {
    const d = planTerminationAccessRevocation({ enabled: true, previousStatus: "ACTIVE", nextStatus: "INACTIVE", terminationDate: "2026-10-20", linkedUser: { ...active, isActive: false } });
    assert.deepEqual(d, { action: "SKIP", reason: "ALREADY_INACTIVE" });
  });

  it("conta SUPER_ADMIN vinculada também é inativada (o papel não isenta)", () => {
    const d = planTerminationAccessRevocation({ enabled: true, previousStatus: "ACTIVE", nextStatus: "INACTIVE", terminationDate: "2026-10-20", linkedUser: { ...active, role: "SUPER_ADMIN" } });
    assert.equal(d.action, "DEACTIVATE");
  });

  it("recontratação (INACTIVE → ACTIVE) nunca é desligamento e nunca reativa conta", () => {
    const d = planTerminationAccessRevocation({ enabled: true, previousStatus: "INACTIVE", nextStatus: "ACTIVE", terminationDate: null, linkedUser: { ...active, isActive: false } });
    assert.deepEqual(d, { action: "SKIP", reason: "NOT_A_TERMINATION" });
  });

  it("flag aceita 1/true/yes e nada mais", () => {
    assert.equal(parseTerminationRevokesAccessFlag("1"), true);
    assert.equal(parseTerminationRevokesAccessFlag("TRUE"), true);
    assert.equal(parseTerminationRevokesAccessFlag("yes"), true);
    assert.equal(parseTerminationRevokesAccessFlag("0"), false);
    assert.equal(parseTerminationRevokesAccessFlag(undefined), false);
  });

  it("snapshot de auditoria nunca carrega credenciais", () => {
    const snap = userAuditSnapshot({ id: "u", name: "N", email: "n@x", role: "ADMIN" });
    assert.deepEqual(Object.keys(snap).sort(), ["userEmail", "userId", "userName", "userRole"]);
  });
});
