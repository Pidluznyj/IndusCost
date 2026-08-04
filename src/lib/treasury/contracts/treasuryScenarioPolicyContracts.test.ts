/**
 * Regressão — validação pura de TreasuryScenarioPolicyPatch.
 * Trava: nenhum atraso negativo/absurdo entra pela porta lateral.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TREASURY_SCENARIO_POLICY_DEFAULTS,
  assertValidTreasuryScenarioPolicyPatch,
} from "./treasuryScenarioPolicyContracts.js";

describe("TreasuryScenarioPolicy — validação", () => {
  it("defaults são consistentes: pessimista habilitado com 15 dias de atraso", () => {
    assert.equal(TREASURY_SCENARIO_POLICY_DEFAULTS.pessimisticEnabled, true);
    assert.equal(
      TREASURY_SCENARIO_POLICY_DEFAULTS.pessimisticReceivableDelayDays,
      15
    );
    assert.equal(
      TREASURY_SCENARIO_POLICY_DEFAULTS.optimisticReceivableAdvanceLimitDays,
      0
    );
    assert.equal(
      TREASURY_SCENARIO_POLICY_DEFAULTS.optimisticPayableDelayLimitDays,
      0
    );
  });

  it("patch vazio passa", () => {
    assert.doesNotThrow(() => assertValidTreasuryScenarioPolicyPatch({}));
  });

  it("valores válidos passam", () => {
    assert.doesNotThrow(() =>
      assertValidTreasuryScenarioPolicyPatch({
        pessimisticReceivableDelayDays: 30,
        optimisticPayableDelayLimitDays: 5,
        pessimisticEnabled: false,
      })
    );
  });

  it("valor negativo é rejeitado", () => {
    assert.throws(
      () =>
        assertValidTreasuryScenarioPolicyPatch({
          pessimisticReceivableDelayDays: -1,
        }),
      /inteiro/
    );
  });

  it("valor não inteiro é rejeitado", () => {
    assert.throws(
      () =>
        assertValidTreasuryScenarioPolicyPatch({
          pessimisticReceivableDelayDays: 15.5,
        }),
      /inteiro/
    );
  });

  it("valor absurdo (>365) é rejeitado", () => {
    assert.throws(
      () =>
        assertValidTreasuryScenarioPolicyPatch({
          pessimisticReceivableDelayDays: 400,
        }),
      /365/
    );
  });

  it("string é rejeitada mesmo que 'pareça' número", () => {
    assert.throws(
      () =>
        assertValidTreasuryScenarioPolicyPatch({
          // @ts-expect-error — teste de guarda em runtime
          pessimisticReceivableDelayDays: "15",
        }),
      /numérico/
    );
  });

  it("boolean nos campos boolean passa", () => {
    assert.doesNotThrow(() =>
      assertValidTreasuryScenarioPolicyPatch({
        pessimisticEnabled: false,
        pessimisticTreatBrokenPromiseAsDelayed: false,
        useCustomerBehaviorHistory: true,
      })
    );
  });
});
