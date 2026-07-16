/**
 * P01 — tabela-verdade do modelo alvo (executável).
 * Não altera runtime; documenta deny > allow > herança + caso Leticia.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canPerformPermissionTruth,
  canRevealPermissionNavigation,
  evaluateLeticiaAccountsPayableCase,
  leticiaAccountsPayableOnlySubject,
  listLeticiaAccountsPayableExpectations,
  resolvePermissionTruth,
  type PermissionTruthSubject,
} from "./index.ts";
import { isKnownPermissionResource } from "./helpers.ts";

describe("permissionContract truth table (P01)", () => {
  it("SUPER_ADMIN bypass em ações suportadas", () => {
    const sa: PermissionTruthSubject = { role: "SUPER_ADMIN", baseline: {}, overrides: {} };
    const r = resolvePermissionTruth(sa, "finance.accounts_payable", "view");
    assert.equal(r.decision, "allow");
    assert.equal(r.reason, "SUPER_ADMIN_BYPASS");
  });

  it("SUPER_ADMIN ainda DENY em recurso/ação desconhecida", () => {
    const sa: PermissionTruthSubject = { role: "SUPER_ADMIN" };
    assert.equal(resolvePermissionTruth(sa, "fantasma.recurso", "view").reason, "UNKNOWN_RESOURCE");
    assert.equal(
      resolvePermissionTruth(sa, "finance.accounts_payable", "approve").reason,
      "UNSUPPORTED_ACTION"
    );
  });

  it("recurso ou ação desconhecida = DENY", () => {
    const v: PermissionTruthSubject = { role: "VIEWER", baseline: {}, overrides: {} };
    assert.equal(resolvePermissionTruth(v, "x.y.z", "view").decision, "deny");
    assert.equal(resolvePermissionTruth(v, "finance", "teleport").decision, "deny");
  });

  it("VIEWER com baseline vazio = sem acesso", () => {
    const v: PermissionTruthSubject = { role: "VIEWER", baseline: {}, overrides: {} };
    assert.equal(canPerformPermissionTruth(v, "finance", "view"), false);
    assert.equal(canPerformPermissionTruth(v, "finance.accounts_payable", "view"), false);
    assert.equal(canRevealPermissionNavigation(v, "finance"), false);
  });

  it("deny > allow no mesmo recurso", () => {
    const s: PermissionTruthSubject = {
      role: "VIEWER",
      baseline: { "finance.accounts_payable": { view: true } },
      overrides: { "finance.accounts_payable": { view: "deny" } },
    };
    const r = resolvePermissionTruth(s, "finance.accounts_payable", "view");
    assert.equal(r.decision, "deny");
    assert.equal(r.reason, "OVERRIDE_DENY");
  });

  it("allow override vence ausência de baseline", () => {
    const s: PermissionTruthSubject = {
      role: "VIEWER",
      baseline: {},
      overrides: { "finance.accounts_payable": { view: "allow" } },
    };
    const r = resolvePermissionTruth(s, "finance.accounts_payable", "view");
    assert.equal(r.decision, "allow");
    assert.equal(r.reason, "OVERRIDE_ALLOW");
  });

  it("ausência de override herda baseline; sem baseline = DENY", () => {
    const withBase: PermissionTruthSubject = {
      role: "VIEWER",
      baseline: { finance: { view: true } },
      overrides: {},
    };
    assert.equal(resolvePermissionTruth(withBase, "finance", "view").reason, "BASELINE_ALLOW");

    const empty: PermissionTruthSubject = { role: "VIEWER", baseline: {}, overrides: {} };
    assert.equal(resolvePermissionTruth(empty, "finance", "view").reason, "DEFAULT_DENY");
  });

  it("parent view DENY bloqueia filho mesmo com child allow", () => {
    const s: PermissionTruthSubject = {
      role: "VIEWER",
      baseline: {},
      overrides: {
        finance: { view: "deny" },
        "finance.accounts_payable": { view: "allow" },
      },
    };
    const r = resolvePermissionTruth(s, "finance.accounts_payable", "view");
    assert.equal(r.decision, "deny");
    assert.equal(r.reason, "ANCESTOR_VIEW_DENY");
    assert.equal(canRevealPermissionNavigation(s, "finance.accounts_payable"), false);
  });

  it("filho allow NÃO concede perform no parent nem em irmãos", () => {
    const s = leticiaAccountsPayableOnlySubject();
    assert.equal(canPerformPermissionTruth(s, "finance.accounts_payable", "view"), true);
    assert.equal(canPerformPermissionTruth(s, "finance", "view"), false);
    assert.equal(canPerformPermissionTruth(s, "finance.portfolio_reconciliation", "view"), false);
    assert.equal(canPerformPermissionTruth(s, "finance.accounts_receivable", "view"), false);
  });

  it("parent virtual: revelável na navegação sem perform view", () => {
    const s = leticiaAccountsPayableOnlySubject();
    assert.equal(canRevealPermissionNavigation(s, "finance"), true);
    assert.equal(canPerformPermissionTruth(s, "finance", "view"), false);
  });

  it("configuração do filho não é apagada quando parent herda DENY (sem override deny)", () => {
    // Parent sem grant ≠ apagar override do filho
    const s: PermissionTruthSubject = {
      role: "VIEWER",
      baseline: {},
      overrides: { "finance.accounts_payable": { view: "allow" } },
    };
    assert.equal(s.overrides!["finance.accounts_payable"]!.view, "allow");
    assert.equal(canPerformPermissionTruth(s, "finance.accounts_payable", "view"), true);
  });

  it("caso Leticia: Contas a Pagar only", () => {
    for (const exp of listLeticiaAccountsPayableExpectations()) {
      assert.ok(
        isKnownPermissionResource(exp.resourceKey),
        `recurso ausente do contrato: ${exp.resourceKey}`
      );
    }
    const evaled = evaluateLeticiaAccountsPayableCase();
    assert.equal(evaled.subject.role, "VIEWER");
    assert.deepEqual(evaled.subject.baseline, {});
    for (const row of evaled.results) {
      assert.equal(
        row.ok,
        true,
        `${row.resourceKey}: perform=${row.actualPerform} (want ${row.canPerformView}), reveal=${row.actualReveal} (want ${row.canRevealNavigation})`
      );
    }
    assert.equal(evaled.allOk, true);
  });
});
