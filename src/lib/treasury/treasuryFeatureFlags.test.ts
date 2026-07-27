import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canShowTreasuryNavigation,
  isTreasuryFeatureFlagEnabled,
  isTreasuryModuleEnabled,
  listEnabledTreasuryFeatureFlags,
  TREASURY_ENABLED_ENV,
  TREASURY_FEATURE_FLAG_IDS,
} from "./treasuryFeatureFlags.js";

describe("treasuryFeatureFlags", () => {
  it("fail-closed quando env ausente", () => {
    assert.equal(isTreasuryModuleEnabled({}), false);
    assert.equal(isTreasuryFeatureFlagEnabled("treasury.accounts.enabled", {}), false);
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

  it("rejeita valores desconhecidos na mestra", () => {
    assert.equal(isTreasuryModuleEnabled({ [TREASURY_ENABLED_ENV]: "maybe" }), false);
  });

  it("subflag exige mestra (AND)", () => {
    assert.equal(
      isTreasuryFeatureFlagEnabled("treasury.accounts.enabled", {
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

  it("flag desconhecida é negada", () => {
    assert.equal(
      isTreasuryFeatureFlagEnabled("treasury.unknown.enabled", {
        TREASURY_MODULE_ENABLED: "1",
      }),
      false
    );
  });

  it("lista só flags conhecidas habilitadas", () => {
    const enabled = listEnabledTreasuryFeatureFlags({
      TREASURY_MODULE_ENABLED: "1",
      TREASURY_OFX_IMPORT_ENABLED: "1",
      TREASURY_UNKNOWN: "1",
    });
    assert.deepEqual(enabled, ["treasury.enabled", "treasury.ofxImport.enabled"]);
    assert.ok(TREASURY_FEATURE_FLAG_IDS.includes("treasury.reconciliation.enabled"));
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
