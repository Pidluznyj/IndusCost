import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPayableProgrammingAmountAllowed,
  assertPayableProgrammingVersionMatch,
  computeTreasuryPayableProgrammingImpact,
  hasActiveLocalPayableProgramming,
  resolveTreasuryPayableProgrammingStatus,
} from "./treasuryPayableProgrammingRules.js";
import { TreasuryDomainError } from "./treasuryErrors.js";
import type { TreasuryTitleOperationalComplementRow } from "../mappers/treasuryTitleOperationalComplementMappers.js";

describe("treasuryPayableProgrammingRules", () => {
  it("permite valor parcial e exige justificativa acima do saldo", () => {
    assert.doesNotThrow(() =>
      assertPayableProgrammingAmountAllowed({
        scheduledAmount: "40.00",
        openBalance: "100.00",
        justification: null,
      })
    );
    assert.throws(
      () =>
        assertPayableProgrammingAmountAllowed({
          scheduledAmount: "120.00",
          openBalance: "100.00",
          justification: "",
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "REQUIRED_FIELD"
    );
    assert.doesNotThrow(() =>
      assertPayableProgrammingAmountAllowed({
        scheduledAmount: "120.00",
        openBalance: "100.00",
        justification: "Antecipação negociada",
      })
    );
  });

  it("detecta conflito de versão (optimistic lock)", () => {
    assert.throws(
      () =>
        assertPayableProgrammingVersionMatch({
          expectedVersion: 1,
          actualVersion: 2,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
  });

  it("calcula impacto na conta/consolidado e alerta saldo negativo", () => {
    const impact = computeTreasuryPayableProgrammingImpact({
      accountId: "acc-1",
      accountBalanceBefore: "50.00",
      consolidatedBalanceBefore: "80.00",
      scheduledAmount: "60.00",
      accountIncludedInConsolidated: true,
    });
    assert.equal(impact.accountBalanceAfter, "-10.00");
    assert.equal(impact.consolidatedBalanceAfter, "20.00");
    assert.equal(impact.createsNegativeAccountBalance, true);
    assert.equal(impact.createsNegativeConsolidatedBalance, false);
    assert.ok(impact.alerts.some((a) => /negativo na conta/i.test(a)));

    const consolidatedNeg = computeTreasuryPayableProgrammingImpact({
      accountId: "acc-1",
      accountBalanceBefore: "10.00",
      consolidatedBalanceBefore: "15.00",
      scheduledAmount: "20.00",
      accountIncludedInConsolidated: true,
    });
    assert.equal(consolidatedNeg.createsNegativeConsolidatedBalance, true);
  });

  it("reconhece programação local ativa e status AUTHORIZED", () => {
    assert.equal(resolveTreasuryPayableProgrammingStatus("AUTHORIZED"), "AUTHORIZED");
    assert.equal(resolveTreasuryPayableProgrammingStatus(null), "PROGRAMMED");
    const row = {
      scheduledDate: new Date("2026-08-01T00:00:00.000Z"),
      scheduledAmount: "10.00",
      status: "ACTIVE",
      cancelledAt: null,
    } as TreasuryTitleOperationalComplementRow;
    assert.equal(hasActiveLocalPayableProgramming(row), true);
    assert.equal(
      hasActiveLocalPayableProgramming({
        ...row,
        status: "CANCELLED",
        cancelledAt: new Date(),
      }),
      false
    );
  });
});
