import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canShowTreasuryNavigation,
  isTreasuryModuleEnabled,
  TREASURY_ENABLED_ENV,
} from "./treasuryFeatureFlags.js";

describe("treasuryFeatureFlags", () => {
  it("fail-closed quando env ausente", () => {
    assert.equal(isTreasuryModuleEnabled({}), false);
  });

  it("habilita com valores conhecidos", () => {
    for (const value of ["1", "true", "YES", "on", "enabled"]) {
      assert.equal(
        isTreasuryModuleEnabled({ [TREASURY_ENABLED_ENV]: value }),
        true,
        value
      );
    }
  });

  it("rejeita valores desconhecidos", () => {
    assert.equal(isTreasuryModuleEnabled({ [TREASURY_ENABLED_ENV]: "maybe" }), false);
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
