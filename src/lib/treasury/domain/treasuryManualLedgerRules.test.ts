import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertTreasuryManualLedgerCreateable,
  assertTreasuryManualLedgerNotOfficialSettlement,
  assertTreasuryManualLedgerReversible,
  oppositeTreasuryLedgerDirection,
} from "./treasuryManualLedgerRules.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

describe("treasuryManualLedgerRules", () => {
  it("aceita create MANUAL com valor positivo", () => {
    assert.doesNotThrow(() =>
      assertTreasuryManualLedgerCreateable({
        amount: "10.00",
        nature: "MANUAL",
      })
    );
  });

  it("rejeita amount <= 0 e nature REVERSAL no create", () => {
    assert.throws(
      () =>
        assertTreasuryManualLedgerCreateable({
          amount: "0.00",
          nature: "MANUAL",
        }),
      TreasuryDomainError
    );
    assert.throws(
      () =>
        assertTreasuryManualLedgerCreateable({
          amount: "1.00",
          nature: "REVERSAL",
        }),
      /MANUAL ou ADJUSTMENT/
    );
  });

  it("reverse exige ACTIVE e versão; inverte direção", () => {
    assert.equal(oppositeTreasuryLedgerDirection("DEBIT"), "CREDIT");
    assert.equal(oppositeTreasuryLedgerDirection("CREDIT"), "DEBIT");
    assert.throws(
      () =>
        assertTreasuryManualLedgerReversible({
          status: "REVERSED",
          nature: "MANUAL",
          expectedVersion: 1,
          currentVersion: 1,
        }),
      /ACTIVE/
    );
    assert.throws(
      () =>
        assertTreasuryManualLedgerReversible({
          status: "ACTIVE",
          nature: "MANUAL",
          expectedVersion: 1,
          currentVersion: 2,
        }),
      /Versão/
    );
    assert.doesNotThrow(() =>
      assertTreasuryManualLedgerReversible({
        status: "ACTIVE",
        nature: "MANUAL",
        expectedVersion: 1,
        currentVersion: 1,
      })
    );
  });

  it("bloqueia simulação de baixa oficial", () => {
    assert.throws(
      () =>
        assertTreasuryManualLedgerNotOfficialSettlement({
          counterpartRef: null,
          memo: "Baixa Nomus indevida",
        }),
      /baixa oficial/
    );
  });
});
