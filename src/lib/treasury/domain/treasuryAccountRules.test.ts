import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertTreasuryAccountHardDeleteAllowed,
  assertTreasuryTransferAccountsDistinct,
  canRevealTreasuryBankIdentifiers,
  canTreasuryActorAccessAccount,
  maskTreasuryBankIdentifierForViewer,
  type TreasuryAccountActor,
} from "./treasuryAccountRules.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

const viewer: TreasuryAccountActor = {
  userId: "u-view",
  role: "VIEWER",
  isSuperAdmin: false,
  canViewAccounts: true,
  canManageAccounts: false,
};

const manager: TreasuryAccountActor = {
  userId: "u-mgr",
  role: "ADMIN",
  isSuperAdmin: false,
  canViewAccounts: true,
  canManageAccounts: true,
};

const superAdmin: TreasuryAccountActor = {
  userId: "u-sa",
  role: "SUPER_ADMIN",
  isSuperAdmin: true,
  canViewAccounts: true,
  canManageAccounts: true,
};

describe("treasuryAccountRules — unit", () => {
  it("impede origem e destino iguais", () => {
    assert.throws(
      () => assertTreasuryTransferAccountsDistinct("acc-1", "acc-1"),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "VALIDATION_ERROR"
    );
    assert.doesNotThrow(() =>
      assertTreasuryTransferAccountsDistinct("acc-1", "acc-2")
    );
  });

  it("não expõe conta sem autorização; SUPER_ADMIN vê tudo", () => {
    assert.equal(canTreasuryActorAccessAccount(superAdmin, null), true);
    assert.equal(canTreasuryActorAccessAccount(manager, null), true);
    assert.equal(canTreasuryActorAccessAccount(viewer, null), false);
    assert.equal(
      canTreasuryActorAccessAccount(viewer, {
        userId: "u-view",
        accessLevel: "VIEW",
        isActive: true,
      }),
      true
    );
  });

  it("mascara identificadores conforme permissão", () => {
    assert.equal(
      maskTreasuryBankIdentifierForViewer("****1234", true),
      "****1234"
    );
    assert.equal(
      maskTreasuryBankIdentifierForViewer("****1234", false),
      "****34"
    );
    assert.equal(
      canRevealTreasuryBankIdentifiers(viewer, {
        userId: "u-view",
        accessLevel: "VIEW",
        isActive: true,
      }),
      false
    );
    assert.equal(
      canRevealTreasuryBankIdentifiers(viewer, {
        userId: "u-view",
        accessLevel: "OPERATE",
        isActive: true,
      }),
      true
    );
  });

  it("bloqueia exclusão física com histórico", () => {
    assert.throws(
      () =>
        assertTreasuryAccountHardDeleteAllowed({
          snapshotCount: 1,
          auditCount: 0,
          accessCount: 0,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError &&
        /histórico/.test((err as Error).message)
    );
    assert.throws(
      () =>
        assertTreasuryAccountHardDeleteAllowed({
          snapshotCount: 0,
          auditCount: 0,
          accessCount: 0,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError &&
        /desativação/.test((err as Error).message)
    );
  });
});
