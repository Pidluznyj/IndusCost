/**
 * Testes P02 — validador de consistência.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  baselineKey,
  buildBaselineIndex,
  isBaselinedFinding,
  listStaleBaselineEntries,
  PERMISSION_CONSISTENCY_BASELINE,
  formatPermissionConsistencyMarkdown,
  formatPermissionConsistencyText,
  runPermissionConsistency,
  type PermissionConsistencyFinding,
} from "./index.ts";
import { collectPermissionConsistencySources } from "./collectSources.ts";
import { runCrossCatalogChecks } from "./checks.ts";

describe("permissionConsistency baseline", () => {
  it("baseline não cobre mais admin.employees (fechado em P08)", () => {
    assert.equal(
      isBaselinedFinding("FE_RESOURCE_MISSING_FROM_SEED", "admin.employees"),
      false
    );
    assert.ok(PERMISSION_CONSISTENCY_BASELINE.length >= 40);
  });

  it("isBaselinedFinding distingue subjects", () => {
    assert.equal(
      isBaselinedFinding("FE_RESOURCE_MISSING_FROM_SEED", "fantasma.nunca"),
      false
    );
  });

  it("listStaleBaselineEntries detecta entrada órfã", () => {
    const stale = listStaleBaselineEntries(
      [{ code: "FE_RESOURCE_MISSING_FROM_SEED", subject: "admin.employees" }],
      [
        {
          code: "FE_RESOURCE_MISSING_FROM_SEED",
          subject: "admin.employees",
          reason: "ok",
        },
        {
          code: "FE_RESOURCE_MISSING_FROM_SEED",
          subject: "orphaned.key",
          reason: "stale",
        },
      ]
    );
    assert.equal(stale.length, 1);
    assert.equal(stale[0]!.subject, "orphaned.key");
  });

  it("baselineKey estável", () => {
    assert.equal(
      baselineKey("ALIAS_WIDE", "commissions.view"),
      "ALIAS_WIDE::commissions.view"
    );
    assert.ok(buildBaselineIndex().has("ALIAS_WIDE::commissions.view"));
  });
});

describe("permissionConsistency checks", () => {
  it("FE admin.employees e engineering.* estão no seed (P08)", () => {
    const sources = collectPermissionConsistencySources();
    assert.ok(sources.frontendKeys.has("admin.employees"));
    assert.ok(sources.seedKeys.has("admin.employees"));
    assert.ok(sources.seedKeys.has("engineering"));
    assert.ok(sources.seedKeys.has("engineering.products"));
    const findings = runCrossCatalogChecks(sources);
    const hit = findings.find(
      (f) =>
        f.code === "FE_RESOURCE_MISSING_FROM_SEED" &&
        f.subject === "admin.employees"
    );
    assert.equal(hit, undefined);
  });

  it("fontes têm volumes mínimos", () => {
    const s = collectPermissionConsistencySources();
    assert.ok(s.contractKeys.size >= 60);
    assert.ok(s.seedKeys.size >= 80);
    assert.ok(s.frontendKeys.size >= 50);
    assert.ok(s.catalogLegacyKeys.size >= 100);
  });
});

describe("permissionConsistency run", () => {
  it("modo report sempre ok e formata saída", () => {
    const report = runPermissionConsistency({
      mode: "report",
      includeAudit: false,
    });
    assert.equal(report.summary.ok, true);
    assert.ok(report.findings.length >= 50);
    assert.equal(report.summary.newFindingCount, 0);
    const text = formatPermissionConsistencyText(report);
    assert.ok(text.includes("check:permission-consistency"));
    const md = formatPermissionConsistencyMarkdown(report);
    assert.ok(md.includes("consistência de permissões"));
  });

  it("modo strict verde no baseline atual", () => {
    const report = runPermissionConsistency({
      mode: "strict",
      includeAudit: true,
    });
    assert.equal(report.summary.newFindingCount, 0);
    assert.equal(report.summary.ok, true);
  });

  it("finding fora do baseline falha strict", () => {
    const synthetic: PermissionConsistencyFinding = {
      code: "FE_RESOURCE_MISSING_FROM_SEED",
      severity: "error",
      message: "synthetic",
      subject: "__synthetic_new_gap__",
    };
    assert.equal(isBaselinedFinding(synthetic.code, synthetic.subject), false);
    // Simula política strict: new = !baselined
    const wouldFail = !isBaselinedFinding(synthetic.code, synthetic.subject);
    assert.equal(wouldFail, true);
  });
});
