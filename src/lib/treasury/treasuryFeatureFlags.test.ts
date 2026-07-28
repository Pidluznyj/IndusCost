import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canShowTreasuryNavigation,
  getTreasuryFeatureFlagsMap,
  isTreasuryFeatureFlagEnabled,
  isTreasuryModuleEnabled,
  listEnabledTreasuryFeatureFlags,
  TREASURY_ENABLED_ENV,
  TREASURY_FEATURE_FLAG_DEFAULT_ENABLED,
  TREASURY_FEATURE_FLAG_ENV,
  TREASURY_FEATURE_FLAG_IDS,
} from "./treasuryFeatureFlags.js";
import { TREASURY_ROLLOUT_ACTIVATION_ORDER } from "./treasuryRollout.js";

const ALL_SUBMODULE_ENV = {
  TREASURY_MODULE_ENABLED: "1",
  TREASURY_ACCOUNTS_ENABLED: "1",
  TREASURY_BALANCES_ENABLED: "1",
  TREASURY_DASHBOARD_ENABLED: "1",
  TREASURY_RECEIVABLES_ENABLED: "1",
  TREASURY_PAYABLES_ENABLED: "1",
  TREASURY_PROJECTION_ENABLED: "1",
  TREASURY_PROMISES_ENABLED: "1",
  TREASURY_PAYABLES_PROGRAMMING_ENABLED: "1",
  TREASURY_TRANSFERS_ENABLED: "1",
  TREASURY_EXCEPTIONS_ENABLED: "1",
  TREASURY_DAILY_CLOSING_ENABLED: "1",
  TREASURY_RECONCILIATION_ENABLED: "1",
  TREASURY_OFX_IMPORT_ENABLED: "1",
  TREASURY_REPORTS_ENABLED: "1",
} as const;

const ALL_OFF_ENV = Object.fromEntries(
  Object.values(TREASURY_FEATURE_FLAG_ENV).map((k) => [k, "0"])
) as Record<string, string>;

describe("treasuryFeatureFlags", () => {
  it("ativação: catálogo default-on quando env ausente", () => {
    assert.equal(TREASURY_FEATURE_FLAG_DEFAULT_ENABLED, true);
    assert.equal(isTreasuryModuleEnabled({}), true);
    assert.equal(isTreasuryFeatureFlagEnabled("treasury.accounts.enabled", {}), true);
    assert.equal(isTreasuryFeatureFlagEnabled("treasury.reports.enabled", {}), true);
  });

  it("opt-out emergencial: mestra=0 desliga tudo", () => {
    assert.equal(isTreasuryModuleEnabled({ TREASURY_MODULE_ENABLED: "0" }), false);
    assert.equal(
      isTreasuryFeatureFlagEnabled("treasury.accounts.enabled", {
        TREASURY_MODULE_ENABLED: "0",
        TREASURY_ACCOUNTS_ENABLED: "1",
      }),
      false
    );
  });

  it("mestra habilita com valores conhecidos", () => {
    for (const value of ["1", "true", "YES", "on", "enabled"]) {
      assert.equal(
        isTreasuryModuleEnabled({ [TREASURY_ENABLED_ENV]: value }),
        true,
        value
      );
    }
  });

  it("rejeita valores desconhecidos na mestra (fail-closed)", () => {
    assert.equal(isTreasuryModuleEnabled({ [TREASURY_ENABLED_ENV]: "maybe" }), false);
  });

  it("subflag exige mestra (AND)", () => {
    assert.equal(
      isTreasuryFeatureFlagEnabled("treasury.accounts.enabled", {
        TREASURY_MODULE_ENABLED: "0",
        TREASURY_ACCOUNTS_ENABLED: "1",
      }),
      false
    );
    assert.equal(
      isTreasuryFeatureFlagEnabled("treasury.accounts.enabled", {
        TREASURY_MODULE_ENABLED: "1",
        TREASURY_ACCOUNTS_ENABLED: "1",
      }),
      true
    );
  });

  it("cada submódulo do rollout tem flag e env 1:1", () => {
    const required = [
      "treasury.enabled",
      "treasury.accounts.enabled",
      "treasury.balances.enabled",
      "treasury.dashboard.enabled",
      "treasury.receivables.enabled",
      "treasury.payables.enabled",
      "treasury.projection.enabled",
      "treasury.promises.enabled",
      "treasury.dailyClosing.enabled",
      "treasury.ofxImport.enabled",
      "treasury.reconciliation.enabled",
      "treasury.reports.enabled",
    ] as const;
    for (const id of required) {
      assert.ok(TREASURY_FEATURE_FLAG_IDS.includes(id), id);
      assert.ok(TREASURY_FEATURE_FLAG_ENV[id], id);
    }
  });

  it("flag desconhecida é negada (fail-closed)", () => {
    assert.equal(
      isTreasuryFeatureFlagEnabled("treasury.unknown.enabled", {
        TREASURY_MODULE_ENABLED: "1",
      }),
      false
    );
  });

  it("lista só flags conhecidas habilitadas (opt-out das demais)", () => {
    const enabled = listEnabledTreasuryFeatureFlags({
      ...ALL_OFF_ENV,
      TREASURY_MODULE_ENABLED: "1",
      TREASURY_OFX_IMPORT_ENABLED: "1",
      TREASURY_UNKNOWN: "1",
    });
    assert.deepEqual(enabled, ["treasury.enabled", "treasury.ofxImport.enabled"]);
    assert.ok(TREASURY_FEATURE_FLAG_IDS.includes("treasury.reconciliation.enabled"));
  });

  it("snapshot: mestra ligada + subflags ausentes = ativação completa", () => {
    const map = getTreasuryFeatureFlagsMap({ TREASURY_MODULE_ENABLED: "1" });
    assert.equal(map["treasury.enabled"], true);
    assert.equal(map["treasury.accounts.enabled"], true);
    assert.equal(map["treasury.reports.enabled"], true);
    assert.equal(Object.keys(map).length, TREASURY_FEATURE_FLAG_IDS.length);

    const allOn = getTreasuryFeatureFlagsMap(ALL_SUBMODULE_ENV);
    for (const id of TREASURY_FEATURE_FLAG_IDS) {
      assert.equal(allOn[id], true, id);
    }
  });

  it("desligar subflag não implica apagar dados (só bloqueio)", () => {
    assert.equal(
      isTreasuryFeatureFlagEnabled("treasury.receivables.enabled", {
        TREASURY_MODULE_ENABLED: "1",
        TREASURY_RECEIVABLES_ENABLED: "0",
      }),
      false
    );
    assert.equal(
      isTreasuryFeatureFlagEnabled("treasury.receivables.enabled", {
        TREASURY_MODULE_ENABLED: "1",
        TREASURY_RECEIVABLES_ENABLED: "1",
      }),
      true
    );
  });

  it("ordem de ativação cobre o catálogo de rollout", () => {
    for (const id of TREASURY_ROLLOUT_ACTIVATION_ORDER) {
      assert.ok(TREASURY_FEATURE_FLAG_IDS.includes(id), id);
    }
    assert.equal(TREASURY_ROLLOUT_ACTIVATION_ORDER[0], "treasury.enabled");
  });

  it("nav exige flag e permissão", () => {
    assert.equal(
      canShowTreasuryNavigation({ featureEnabled: true, hasTreasuryViewAccess: true }),
      true
    );
    assert.equal(
      canShowTreasuryNavigation({ featureEnabled: true, hasTreasuryViewAccess: false }),
      false
    );
    assert.equal(
      canShowTreasuryNavigation({ featureEnabled: false, hasTreasuryViewAccess: true }),
      false
    );
  });
});
