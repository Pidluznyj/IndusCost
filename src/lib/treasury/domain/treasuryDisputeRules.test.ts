import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OfficialReceivableView } from "../contracts/treasuryOfficialTitleContracts.js";
import { TreasuryDomainError } from "./treasuryErrors.js";
import {
  assertDisputeAmountAllowed,
  assertDisputeDoesNotMutateOfficialTitleFields,
  assertDisputeStatusTransition,
  assertReceivableAllowsDispute,
} from "./treasuryDisputeRules.js";

function receivable(cancelled = false): OfficialReceivableView {
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
    originalAmount: "200.00",
    openBalance: "150.00",
    settlements: {
      settledAmount: "50.00",
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
  };
}

describe("treasuryDisputeRules", () => {
  it("não permite contestação em título cancelado na origem", () => {
    assert.doesNotThrow(() => assertReceivableAllowsDispute(receivable()));
    assert.throws(
      () => assertReceivableAllowsDispute(receivable(true)),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
  });

  it("rejeita payload que tenta mutar saldo/vencimento oficiais", () => {
    assert.throws(
      () =>
        assertDisputeDoesNotMutateOfficialTitleFields({
          reason: "ok",
          openBalance: "0",
        }),
      /saldo ou vencimento oficial/i
    );
    assert.doesNotThrow(() =>
      assertDisputeDoesNotMutateOfficialTitleFields({
        reason: "Divergência de NF",
        amountDisputed: "10.00",
      })
    );
  });

  it("valor contestado > 0 e ≤ saldo aberto", () => {
    assert.doesNotThrow(() =>
      assertDisputeAmountAllowed({
        amountDisputed: "150.00",
        openBalance: "150.00",
      })
    );
    assert.throws(
      () =>
        assertDisputeAmountAllowed({
          amountDisputed: "0.00",
          openBalance: "150.00",
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "VALIDATION_ERROR"
    );
    assert.throws(
      () =>
        assertDisputeAmountAllowed({
          amountDisputed: "151.00",
          openBalance: "150.00",
        }),
      /não pode exceder/i
    );
  });

  it("transições de status: OPEN→RESOLVED/CANCELLED; CANCELLED terminal", () => {
    assert.doesNotThrow(() =>
      assertDisputeStatusTransition({ from: "OPEN", to: "RESOLVED" })
    );
    assert.doesNotThrow(() =>
      assertDisputeStatusTransition({ from: "OPEN", to: "CANCELLED" })
    );
    assert.throws(
      () => assertDisputeStatusTransition({ from: "CANCELLED", to: "OPEN" }),
      /terminal/i
    );
    assert.throws(
      () => assertDisputeStatusTransition({ from: "RESOLVED", to: "OPEN" }),
      /não pode reabrir/i
    );
  });
});
