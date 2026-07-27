import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeDivergence,
  computeTreasuryAccountFinancialPosition,
  consolidateTreasuryFinancialPositions,
  netOfficialMovements,
  type TreasuryOfficialRealizedMovement,
  type TreasuryPositionAccountInput,
} from "./treasuryFinancialPositionRules.js";

function account(
  partial: Partial<TreasuryPositionAccountInput> &
    Pick<TreasuryPositionAccountInput, "id" | "code">
): TreasuryPositionAccountInput {
  return {
    name: partial.code,
    accountType: "CHECKING",
    includeInConsolidated: true,
    liquidity: "IMMEDIATE",
    allowNegativeBalance: false,
    isActive: true,
    ...partial,
  };
}

describe("treasuryFinancialPositionRules", () => {
  it("calcula observado, operacional, bloqueado, aplicações e limite do snapshot", () => {
    const pos = computeTreasuryAccountFinancialPosition({
      account: account({ id: "a1", code: "CX1" }),
      snapshot: {
        id: "s1",
        accountId: "a1",
        referenceAt: new Date("2026-07-20T12:00:00.000Z"),
        availableBalance: "100.00",
        blockedBalance: "25.00",
        investmentsBalance: "50.00",
        usedLimit: "10.00",
        origin: "MANUAL",
      },
      movements: [],
    });
    assert.equal(pos.observedBalance, "175.00");
    assert.equal(pos.operationalAvailableBalance, "100.00");
    assert.equal(pos.blockedBalance, "25.00");
    assert.equal(pos.investmentsBalance, "50.00");
    assert.equal(pos.usedLimit, "10.00");
    assert.equal(pos.origins.observed.origin, "BALANCE_SNAPSHOT");
    assert.equal(pos.calculatedBalance, "175.00");
    assert.equal(pos.hasDivergence, false);
    assert.equal(pos.reconciledBalance, null);
    assert.equal(pos.origins.reconciled.origin, "MISSING");
    assert.ok(pos.alerts.some((a) => /conciliado ausente/i.test(a)));
  });

  it("aplica movimentos oficiais após snapshot e expõe divergência", () => {
    const movements: TreasuryOfficialRealizedMovement[] = [
      {
        id: "m1",
        accountId: "a1",
        occurredAt: new Date("2026-07-21T10:00:00.000Z"),
        amount: "40.00",
        direction: "DEBIT",
        status: "ACTIVE",
        source: "OFFICIAL",
      },
      {
        id: "m2",
        accountId: "a1",
        occurredAt: new Date("2026-07-19T10:00:00.000Z"),
        amount: "999.00",
        direction: "CREDIT",
        status: "ACTIVE",
        source: "OFFICIAL",
      },
    ];
    const pos = computeTreasuryAccountFinancialPosition({
      account: account({ id: "a1", code: "CX1" }),
      snapshot: {
        id: "s1",
        accountId: "a1",
        referenceAt: new Date("2026-07-20T12:00:00.000Z"),
        availableBalance: "200.00",
        blockedBalance: "0.00",
        investmentsBalance: "0.00",
        usedLimit: "0.00",
        origin: "MANUAL",
      },
      movements,
    });
    assert.equal(pos.officialMovementCount, 1);
    assert.equal(pos.officialMovementNet, "-40.00");
    assert.equal(pos.calculatedBalance, "160.00");
    assert.equal(pos.divergence, "40.00");
    assert.equal(pos.hasDivergence, true);
    assert.equal(
      pos.origins.calculated.origin,
      "SNAPSHOT_PLUS_OFFICIAL_MOVEMENTS"
    );
    assert.ok(pos.alerts.some((a) => /Divergência observado vs calculado/i.test(a)));
  });

  it("ausência de saldo: observed null e calculado baseline/movimentos", () => {
    const empty = computeTreasuryAccountFinancialPosition({
      account: account({ id: "a1", code: "CX1" }),
      snapshot: null,
      movements: [],
    });
    assert.equal(empty.observedBalance, null);
    assert.equal(empty.hasSnapshot, false);
    assert.equal(empty.origins.observed.origin, "MISSING");
    assert.equal(empty.calculatedBalance, "0.00");
    assert.equal(empty.origins.calculated.origin, "ZERO_BASELINE");
    assert.ok(empty.alerts.some((a) => /Ausência de saldo/i.test(a)));

    const withMov = computeTreasuryAccountFinancialPosition({
      account: account({ id: "a1", code: "CX1" }),
      snapshot: null,
      movements: [
        {
          id: "m1",
          accountId: "a1",
          occurredAt: new Date("2026-07-21T10:00:00.000Z"),
          amount: "30.00",
          direction: "CREDIT",
          status: "ACTIVE",
          source: "OFFICIAL",
        },
      ],
    });
    assert.equal(withMov.calculatedBalance, "30.00");
    assert.equal(withMov.origins.calculated.origin, "OFFICIAL_MOVEMENTS_ONLY");
  });

  it("conta negativa e aplicação com liquidez", () => {
    const neg = computeTreasuryAccountFinancialPosition({
      account: account({
        id: "a1",
        code: "CX1",
        allowNegativeBalance: false,
      }),
      snapshot: {
        id: "s1",
        accountId: "a1",
        referenceAt: new Date("2026-07-20T12:00:00.000Z"),
        availableBalance: "-15.00",
        blockedBalance: "0.00",
        investmentsBalance: "0.00",
        usedLimit: "0.00",
        origin: "MANUAL",
      },
      movements: [],
    });
    assert.equal(neg.isNegative, true);
    assert.ok(neg.alerts.some((a) => /saldo negativo/i.test(a)));

    const inv = computeTreasuryAccountFinancialPosition({
      account: account({
        id: "a2",
        code: "APL1",
        accountType: "INVESTMENT",
        liquidity: "D_PLUS_N",
      }),
      snapshot: {
        id: "s2",
        accountId: "a2",
        referenceAt: new Date("2026-07-20T12:00:00.000Z"),
        availableBalance: "0.00",
        blockedBalance: "0.00",
        investmentsBalance: "500.00",
        usedLimit: "0.00",
        origin: "MANUAL",
      },
      movements: [],
    });
    assert.equal(inv.investmentsBalance, "500.00");
    assert.equal(inv.liquidity, "D_PLUS_N");
    assert.ok(inv.alerts.some((a) => /liquidez/i.test(a)));
  });

  it("consolida múltiplas contas e exclui fora do consolidado", () => {
    const a = computeTreasuryAccountFinancialPosition({
      account: account({ id: "in1", code: "IN1", includeInConsolidated: true }),
      snapshot: {
        id: "s1",
        accountId: "in1",
        referenceAt: new Date("2026-07-20T12:00:00.000Z"),
        availableBalance: "100.00",
        blockedBalance: "0.00",
        investmentsBalance: "0.00",
        usedLimit: "0.00",
        origin: "MANUAL",
      },
      movements: [],
    });
    const b = computeTreasuryAccountFinancialPosition({
      account: account({
        id: "out1",
        code: "OUT1",
        includeInConsolidated: false,
      }),
      snapshot: {
        id: "s2",
        accountId: "out1",
        referenceAt: new Date("2026-07-20T12:00:00.000Z"),
        availableBalance: "999.00",
        blockedBalance: "0.00",
        investmentsBalance: "0.00",
        usedLimit: "0.00",
        origin: "MANUAL",
      },
      movements: [],
    });
    const c = computeTreasuryAccountFinancialPosition({
      account: account({ id: "in2", code: "IN2", includeInConsolidated: true }),
      snapshot: null,
      movements: [],
    });
    const cons = consolidateTreasuryFinancialPositions([a, b, c]);
    assert.equal(cons.includedAccountCount, 2);
    assert.equal(cons.excludedAccountCount, 1);
    assert.equal(cons.accountsMissingSnapshot, 1);
    assert.equal(cons.observedBalance, "100.00");
    assert.ok(cons.alerts.some((x) => /fora do consolidado/i.test(x)));
    assert.ok(cons.alerts.some((x) => /sem snapshot/i.test(x)));
  });

  it("netOfficialMovements e computeDivergence não escondem diferença", () => {
    assert.equal(
      netOfficialMovements([
        {
          id: "1",
          accountId: "a",
          occurredAt: new Date(),
          amount: "10.00",
          direction: "CREDIT",
          status: "ACTIVE",
          source: "X",
        },
        {
          id: "2",
          accountId: "a",
          occurredAt: new Date(),
          amount: "3.00",
          direction: "DEBIT",
          status: "REVERSED",
          source: "X",
        },
      ]),
      "10.00"
    );
    const d = computeDivergence("10.00", "10.00");
    assert.equal(d.hasDivergence, false);
    assert.equal(d.divergence, "0.00");
    const d2 = computeDivergence("10.00", "8.00");
    assert.equal(d2.hasDivergence, true);
    assert.equal(d2.divergence, "2.00");
    assert.equal(computeDivergence(null, "1.00").divergence, null);
  });
});
