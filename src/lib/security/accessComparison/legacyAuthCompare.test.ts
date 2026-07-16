/**
 * Testes — comparador legado × novo (P20).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFixtureComparisonSubjects,
  compareAccessForSubject,
  runAccessComparison,
  toSafeJsonReport,
  toUserSummaryCsv,
} from "./index.ts";
import { fixtureLeticiaAccountsPayableOnly } from "@/src/lib/security/effectiveAccess/fixtures.ts";
import { evaluateLegacyBagOr } from "./legacyEval.ts";
import { isLegacyBleedGrant } from "./bleedDetection.ts";

describe("accessComparison — bleed detection", () => {
  it("finance.accountsPayable.view é bleed em finance shell e conciliação", () => {
    assert.equal(
      isLegacyBleedGrant("finance.accountsPayable.view", "finance", "view"),
      true
    );
    assert.equal(
      isLegacyBleedGrant(
        "finance.accountsPayable.view",
        "finance.portfolio_reconciliation",
        "view"
      ),
      true
    );
    assert.equal(
      isLegacyBleedGrant("finance.accountsPayable.view", "finance.accounts_payable", "view"),
      false
    );
  });

  it("costs.view é bleed em admin.employees", () => {
    assert.equal(isLegacyBleedGrant("costs.view", "admin.employees", "view"), true);
    assert.equal(isLegacyBleedGrant("costs.view", "finance.opex", "view"), false);
  });
});

describe("accessComparison — cenário Leticia", () => {
  const subject = buildFixtureComparisonSubjects().find(
    (s) => s.scenarioTag === "leticia-ap-only"
  )!;

  it("AP preservado; bleed finance/conciliação classificado mega_key_bleed", () => {
    const report = compareAccessForSubject(subject);
    assert.equal(report.lockoutRiskCount, 0);

    const ap = report.diffs.find(
      (d) => d.resourceKey === "finance.accounts_payable" && d.action === "view"
    );
    assert.equal(ap, undefined, "AP alinhado — não entra em diffs");

    const financeShell = report.diffs.filter(
      (d) =>
        d.category === "mega_key_bleed" &&
        (d.resourceKey === "finance" || d.resourceKey === "finance.portfolio_reconciliation")
    );
    assert.ok(financeShell.length >= 2, JSON.stringify(report.diffs, null, 2));

    for (const d of financeShell) {
      assert.equal(d.legacyAllow, true);
      assert.equal(d.newAllow, false);
      assert.ok(d.legacyBleedKeys.length > 0);
      assert.equal(d.legacyDedicatedKeys.length, 0);
    }
  });

  it("bleed nunca conta como preserved_intentional", () => {
    const legacy = evaluateLegacyBagOr({
      role: "VIEWER",
      legacyPermissions: ["finance.accountsPayable.view"],
      resourceKey: "finance",
      action: "view",
    });
    assert.ok(legacy.bleedKeys.includes("finance.accountsPayable.view"));
    assert.equal(legacy.dedicatedKeys.length, 0);

    const report = compareAccessForSubject(subject);
    const preservedWithBleed = report.diffs.filter(
      (d) => d.category === "preserved_intentional" && d.legacyBleedKeys.length > 0
    );
    assert.equal(preservedWithBleed.length, 0);
  });
});

describe("accessComparison — SUPER_ADMIN", () => {
  it("legado e novo permitem em probes migrados", () => {
    const subject = buildFixtureComparisonSubjects().find(
      (s) => s.scenarioTag === null && s.input.role === "SUPER_ADMIN"
    )!;
    const report = compareAccessForSubject(subject);
    assert.equal(report.lockoutRiskCount, 0);
    assert.equal(report.megaKeyBleedCount, 0);
    assert.ok(report.categoryCounts.preserved_intentional > 0);
  });
});

describe("accessComparison — deny vence allow", () => {
  it("override deny classifica removed_by_deny quando legado bag teria allow", () => {
    const base = buildFixtureComparisonSubjects().find((s) => s.scenarioTag === "deny-wins")!;
    const subject = {
      ...base,
      input: {
        ...base.input,
        legacyPermissions: ["finance.accountsPayable.view"],
        legacyCompatMode: true,
      },
    };
    const report = compareAccessForSubject(subject);
    const apDeny = report.diffs.find(
      (d) =>
        d.resourceKey === "finance.accounts_payable" &&
        d.action === "view" &&
        d.category === "removed_by_deny"
    );
    assert.ok(apDeny, JSON.stringify(report.diffs));
  });
});

describe("accessComparison — mega-key legacy", () => {
  it("costs.view não abre RH via novo resolvedor; bleed reportado", () => {
    const subject = buildFixtureComparisonSubjects().find(
      (s) => s.scenarioTag === "legacy-mega-key"
    )!;
    const report = compareAccessForSubject(subject);
    const rh = report.diffs.find(
      (d) => d.resourceKey === "admin.employees" && d.action === "view"
    );
    if (rh) {
      assert.equal(rh.category, "mega_key_bleed");
    }
    const ap = report.diffs.find(
      (d) => d.resourceKey === "finance.accounts_payable" && d.action === "view"
    );
    assert.equal(ap, undefined, "AP 1:1 preservado");
  });
});

describe("accessComparison — idempotência / exportação segura", () => {
  it("reexecução produz mesmo subjectRef e contagens", () => {
    const subjects = buildFixtureComparisonSubjects();
    const a = runAccessComparison(subjects);
    const b = runAccessComparison(subjects);
    assert.deepEqual(a.categoryCounts, b.categoryCounts);
    assert.equal(a.users.length, b.users.length);
    for (let i = 0; i < a.users.length; i++) {
      assert.equal(a.users[i]!.subjectRef, b.users[i]!.subjectRef);
    }
  });

  it("JSON seguro não inclui userId nem e-mail", () => {
    const report = runAccessComparison(buildFixtureComparisonSubjects());
    const json = JSON.stringify(toSafeJsonReport(report));
    assert.ok(!json.includes("leticia-p03"));
    assert.ok(!json.includes("@"));
    assert.ok(json.includes("subjectRef"));
  });

  it("CSV summary contém cenário Leticia por tag", () => {
    const csv = toUserSummaryCsv(runAccessComparison(buildFixtureComparisonSubjects()));
    assert.ok(csv.includes("leticia-ap-only"));
  });
});

describe("accessComparison — alias 1:1", () => {
  it("finance.accountsPayable.view projeta AP em compat", () => {
    const input = fixtureLeticiaAccountsPayableOnly();
    input.legacyCompatMode = true;
    const subject = {
      subjectId: "alias-test",
      role: input.role,
      scenarioTag: "alias-test",
      input,
    };
    const report = compareAccessForSubject(subject);
    assert.equal(report.lockoutRiskCount, 0);
  });
});
