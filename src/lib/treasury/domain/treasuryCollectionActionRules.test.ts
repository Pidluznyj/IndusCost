import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OfficialReceivableView } from "../contracts/treasuryOfficialTitleContracts.js";
import { TreasuryDomainError } from "./treasuryErrors.js";
import {
  assertCollectionActionCancellable,
  assertReceivableAllowsCollectionAction,
  shouldMirrorCollectionNextActionOnComplement,
} from "./treasuryCollectionActionRules.js";

function receivable(
  partial: Partial<OfficialReceivableView> & {
    cancelled?: boolean;
    openBalance?: string | null;
  } = {}
): OfficialReceivableView {
  const cancelled = partial.cancelled === true;
  return {
    id: "ar-1",
    externalId: 1,
    installmentNumber: null,
    installmentLabel: null,
    counterparty: {
      personId: 1,
      name: "Cliente",
      taxId: "00",
      role: "CUSTOMER",
    },
    description: null,
    documentNumber: null,
    salesOrderExternalId: null,
    salesOrderCode: null,
    invoice: { externalId: null, number: null },
    issuedOn: "2026-07-01",
    dueDate: "2026-07-15",
    originalAmount: "100.00",
    openBalance: partial.openBalance ?? "100.00",
    settlements: {
      settledAmount: "0.00",
      settledAt: null,
      paidAt: null,
    },
    cancellation: {
      isCancelledOrRemovedFromSource: cancelled,
      sourcePresenceStatus: cancelled ? "MISSING_CONFIRMED" : "PRESENT",
      sourceRemovedAt: cancelled ? "2026-07-01T00:00:00.000Z" : null,
    },
    officialStatus: {
      nomusStatus: false,
      isOpen: !cancelled,
      isSettled: false,
      sourcePresenceStatus: cancelled ? "MISSING_CONFIRMED" : "PRESENT",
    },
    lastSyncedAt: "2026-07-01T00:00:00.000Z",
    ...partial,
  };
}

describe("treasuryCollectionActionRules", () => {
  it("bloqueia cobrança em título cancelado/ausente na origem", () => {
    assert.doesNotThrow(() =>
      assertReceivableAllowsCollectionAction(receivable())
    );
    assert.throws(
      () =>
        assertReceivableAllowsCollectionAction(receivable({ cancelled: true })),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
  });

  it("cancelamento é lógico: já cancelada ou versão divergente falha", () => {
    assert.throws(
      () =>
        assertCollectionActionCancellable({
          cancelledAt: new Date(),
          version: 1,
          expectedVersion: 1,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
    assert.throws(
      () =>
        assertCollectionActionCancellable({
          cancelledAt: null,
          version: 2,
          expectedVersion: 1,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError &&
        err.code === "CONFLICT" &&
        err.field === "expectedVersion"
    );
    assert.doesNotThrow(() =>
      assertCollectionActionCancellable({
        cancelledAt: null,
        version: 1,
        expectedVersion: 1,
      })
    );
  });

  it("espelha nextAction no complemento só quando informado", () => {
    assert.equal(shouldMirrorCollectionNextActionOnComplement("LIGAR"), true);
    assert.equal(shouldMirrorCollectionNextActionOnComplement("  "), false);
    assert.equal(shouldMirrorCollectionNextActionOnComplement(null), false);
  });
});
