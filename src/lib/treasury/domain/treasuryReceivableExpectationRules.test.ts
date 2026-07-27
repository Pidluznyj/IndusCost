import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OfficialReceivableView } from "../contracts/treasuryOfficialTitleContracts.js";
import type { TreasuryTitleOperationalComplementRow } from "../mappers/treasuryTitleOperationalComplementMappers.js";
import { TreasuryDomainError } from "./treasuryErrors.js";
import {
  assertExpectationDateChangeJustified,
  assertExpectationVersionMatch,
  assertNoOfficialDueDateMutation,
  assertReceivableHasOpenBalanceForExpectation,
  assertReceivableNotCancelledForExpectation,
} from "./treasuryReceivableExpectationRules.js";

function official(
  overrides: Partial<OfficialReceivableView> = {}
): OfficialReceivableView {
  return {
    id: "t1",
    externalId: 1,
    installmentNumber: null,
    installmentLabel: null,
    counterparty: {
      personId: 1,
      name: "Cliente",
      taxId: "1",
      role: "CUSTOMER",
    },
    description: "NF",
    documentNumber: null,
    salesOrderExternalId: null,
    salesOrderCode: null,
    invoice: { externalId: null, number: null },
    issuedOn: "2026-06-01",
    dueDate: "2026-07-20",
    originalAmount: "100.00",
    openBalance: "40.00",
    settlements: {
      settledAmount: "60.00",
      settledAt: null,
      paidAt: null,
    },
    cancellation: {
      isCancelledOrRemovedFromSource: false,
      sourcePresenceStatus: "PRESENT",
      sourceRemovedAt: null,
    },
    officialStatus: {
      nomusStatus: false,
      isOpen: true,
      isSettled: false,
      sourcePresenceStatus: "PRESENT",
    },
    lastSyncedAt: "2026-07-20T12:00:00.000+00:00",
    ...overrides,
  };
}

describe("treasuryReceivableExpectationRules", () => {
  it("bloqueia título cancelado e sem saldo aberto", () => {
    assert.throws(
      () =>
        assertReceivableNotCancelledForExpectation(
          official({
            cancellation: {
              isCancelledOrRemovedFromSource: true,
              sourcePresenceStatus: "MISSING_CONFIRMED",
              sourceRemovedAt: "2026-07-01T00:00:00.000+00:00",
            },
          }),
          null
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );

    assert.throws(
      () =>
        assertReceivableHasOpenBalanceForExpectation(
          official({ openBalance: "0.00" })
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "VALIDATION_ERROR"
    );
  });

  it("exige justificativa ao mudar data esperada", () => {
    assert.throws(
      () =>
        assertExpectationDateChangeJustified({
          previousExpectedDate: "2026-07-28",
          nextExpectedDate: "2026-08-01",
          reason: "  ",
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "REQUIRED_FIELD"
    );

    assert.doesNotThrow(() =>
      assertExpectationDateChangeJustified({
        previousExpectedDate: "2026-07-28",
        nextExpectedDate: "2026-07-28",
        reason: null,
      })
    );
  });

  it("valida optimistic locking e rejeita dueDate no payload", () => {
    assert.throws(
      () =>
        assertExpectationVersionMatch({
          expectedVersion: 1,
          actualVersion: 2,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );

    assert.throws(
      () => assertNoOfficialDueDateMutation({ dueDate: "2026-08-01" }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "VALIDATION_ERROR"
    );

    const cancelled: TreasuryTitleOperationalComplementRow = {
      id: "c1",
      titleType: "RECEIVABLE",
      officialTitleId: "t1",
      officialExternalId: 1,
      expectedDate: null,
      confirmedDate: null,
      scheduledDate: null,
      expectedAmount: null,
      confirmedAmount: null,
      scheduledAmount: null,
      status: "CANCELLED",
      priority: "NORMAL",
      plannedAccountId: null,
      responsibleUserId: null,
      nextAction: null,
      reason: null,
      notes: null,
      version: 2,
      createdAt: new Date(),
      createdByUserId: "u1",
      updatedAt: new Date(),
      updatedByUserId: "u1",
      cancelledAt: new Date(),
      cancelledByUserId: "u1",
      cancellationReason: "x",
    };
    assert.throws(
      () => assertReceivableNotCancelledForExpectation(official(), cancelled),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
  });
});
