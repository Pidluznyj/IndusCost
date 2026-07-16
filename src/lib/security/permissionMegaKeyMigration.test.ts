/**
 * P09 — migração mega-key / aliases 1:1.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALIAS_WIDE_ALLOWLIST,
  assertNoResidualP09Bleeds,
  buildFrontendAliasFanout,
  MEGA_KEY_MIGRATION_MAP,
  runMegaKeyMigrationDryRun,
  validateAliasOneToOnePolicy,
} from "./permissionMegaKeyMigration.ts";

describe("permissionMegaKeyMigration P09", () => {
  it("mapa cobre AP, costs e finance.view", () => {
    const keys = new Set(MEGA_KEY_MIGRATION_MAP.map((e) => e.legacyKey));
    assert.ok(keys.has("finance.accountsPayable.view"));
    assert.ok(keys.has("costs.view"));
    assert.ok(keys.has("finance.view"));
  });

  it("AP só em contas_pagar no FE", () => {
    const fanout = buildFrontendAliasFanout();
    assert.deepEqual(fanout.get("finance.accountsPayable.view"), [
      "financeiro.contas_pagar",
    ]);
  });

  it("costs.view só em finance.opex no FE (camada legado)", () => {
    const fanout = buildFrontendAliasFanout();
    assert.deepEqual(fanout.get("costs.view"), ["finance.opex"]);
  });

  it("dry-run sem residual bleed e sem policy error", () => {
    const report = runMegaKeyMigrationDryRun();
    assert.equal(report.residualBleeds.length, 0);
    assert.equal(
      report.policyFindings.filter((f) => f.severity === "error").length,
      0
    );
    assertNoResidualP09Bleeds(report);
  });

  it("aliases novos fora da allowlist falhariam a política", () => {
    const synthetic = new Map<string, string[]>([
      ["zzz.new.wide.view", ["mod.a", "mod.b"]],
    ]);
    const findings = validateAliasOneToOnePolicy(synthetic);
    assert.equal(findings[0]?.severity, "error");
    assert.equal(ALIAS_WIDE_ALLOWLIST.has("zzz.new.wide.view"), false);
  });
});
