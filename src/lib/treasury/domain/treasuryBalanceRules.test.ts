import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertTreasuryIdempotencyKey,
  computeTreasuryBalanceSnapshotAmounts,
  normalizeTreasuryBalanceComponents,
} from "./treasuryBalanceRules.js";
import { TreasuryDomainError } from "./treasuryErrors.js";
import {
  canTreasuryActorMutateAccountBalance,
  canTreasuryActorViewAccountBalance,
  type TreasuryAccountActor,
} from "./treasuryAccountRules.js";

describe("treasuryBalanceRules — Decimal", () => {
  it("normaliza componentes sem float e calcula observado separado do operacional", () => {
    const amounts = computeTreasuryBalanceSnapshotAmounts({
      availableBalance: "1000.1",
      blockedBalance: "200.20",
      investmentsBalance: "50",
      usedLimit: "10.5",
    });
    assert.equal(amounts.operationalAvailableBalance, "1000.10");
    assert.equal(amounts.blockedBalance, "200.20");
    assert.equal(amounts.investmentsBalance, "50.00");
    assert.equal(amounts.usedLimit, "10.50");
    assert.equal(amounts.observedBalance, "1250.30");
  });

  it("rejeita money inválido e exige Idempotency-Key", () => {
    assert.throws(
      () =>
        normalizeTreasuryBalanceComponents({
          availableBalance: "10,50",
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "INVALID_MONEY"
    );
    assert.throws(
      () => assertTreasuryIdempotencyKey(""),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "REQUIRED_FIELD"
    );
    assert.equal(assertTreasuryIdempotencyKey(" key-1 "), "key-1");
  });
});

describe("treasuryBalanceRules — autorização", () => {
  const viewer: TreasuryAccountActor = {
    userId: "u1",
    role: "USER",
    isSuperAdmin: false,
    canViewAccounts: true,
    canManageAccounts: false,
    canManageBalances: false,
  };

  const balancer: TreasuryAccountActor = {
    userId: "u2",
    role: "USER",
    isSuperAdmin: false,
    canViewAccounts: true,
    canManageAccounts: false,
    canManageBalances: true,
  };

  it("nega consulta sem acesso à conta e mutação sem manageBalances", () => {
    assert.equal(canTreasuryActorViewAccountBalance(viewer, null), false);
    assert.equal(
      canTreasuryActorViewAccountBalance(viewer, {
        userId: "u1",
        accessLevel: "VIEW",
        isActive: true,
        canViewBalance: true,
      }),
      true
    );
    assert.equal(
      canTreasuryActorViewAccountBalance(viewer, {
        userId: "u1",
        accessLevel: "VIEW",
        isActive: true,
        canViewBalance: false,
      }),
      false
    );
    assert.equal(
      canTreasuryActorMutateAccountBalance(viewer, {
        userId: "u1",
        accessLevel: "MANAGE",
        isActive: true,
        canMutateBalance: true,
      }),
      false
    );
    assert.equal(
      canTreasuryActorMutateAccountBalance(balancer, {
        userId: "u2",
        accessLevel: "OPERATE",
        isActive: true,
        canMutateBalance: true,
      }),
      true
    );
    assert.equal(canTreasuryActorMutateAccountBalance(balancer, null), false);
  });
});
