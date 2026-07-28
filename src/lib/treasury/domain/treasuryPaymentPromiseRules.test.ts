import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TreasuryDomainError } from "./treasuryErrors.js";
import type { OfficialReceivableView } from "../contracts/treasuryOfficialTitleContracts.js";
import type { TreasuryPaymentPromiseRow } from "../mappers/treasuryPaymentPromiseMappers.js";
import {
  assertNoOfficialDueDateInPromiseBody,
  assertPromiseAmountAllowed,
  assertPromiseCancellable,
  assertPromiseFulfillable,
  assertReceivableAllowsPromise,
  resolveFulfillmentStatus,
  shouldExpirePromise,
} from "./treasuryPaymentPromiseRules.js";

function official(open: string, cancelled = false): OfficialReceivableView {
  return {
    id: "ar-1",
    externalId: 1,
    installmentNumber: null,
    installmentLabel: null,
    counterparty: {
      personId: 1,
      name: "C",
      taxId: null,
      role: "CUSTOMER",
    },
    description: null,
    documentNumber: null,
    salesOrderExternalId: null,
    salesOrderCode: null,
    invoice: { externalId: null, number: null },
    issuedOn: null,
    dueDate: "2026-07-15",
    originalAmount: open,
    openBalance: open,
    settlements: { settledAmount: "0.00", settledAt: null, paidAt: null },
    cancellation: {
      isCancelledOrRemovedFromSource: cancelled,
      sourcePresenceStatus: cancelled ? "MISSING_CONFIRMED" : "PRESENT",
      sourceRemovedAt: null,
    },
    officialStatus: {
      nomusStatus: false,
      isOpen: !cancelled && Number(open) > 0,
      isSettled: Number(open) <= 0,
      sourcePresenceStatus: "PRESENT",
    },
    lastSyncedAt: "2026-07-01T00:00:00.000Z",
  };
}

function promiseRow(
  status: TreasuryPaymentPromiseRow["status"]
): TreasuryPaymentPromiseRow {
  return {
    id: "p1",
    titleType: "RECEIVABLE",
    officialTitleId: "ar-1",
    officialExternalId: 1,
    promisedDate: new Date("2026-07-20T00:00:00.000Z"),
    promisedAmount: "100.00",
    fulfilledAmount: status === "FULFILLED" ? "100.00" : "0.00",
    contactNote: null,
    channel: null,
    notes: null,
    responsibleUserId: null,
    status,
    version: 1,
    createdAt: new Date(),
    createdByUserId: "u1",
    updatedAt: new Date(),
    updatedByUserId: null,
    cancelledAt: status === "CANCELLED" ? new Date() : null,
    cancelledByUserId: null,
    cancellationReason: null,
    fulfilledAt: status === "FULFILLED" ? new Date() : null,
  };
}

describe("treasuryPaymentPromiseRules", () => {
  it("permite parcial e exige confirmação+justificativa acima do saldo", () => {
    assert.doesNotThrow(() =>
      assertPromiseAmountAllowed({
        promisedAmount: "100.00",
        openBalance: "400.00",
      })
    );
    assert.throws(
      () =>
        assertPromiseAmountAllowed({
          promisedAmount: "500.00",
          openBalance: "400.00",
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "VALIDATION_ERROR"
    );
    assert.throws(
      () =>
        assertPromiseAmountAllowed({
          promisedAmount: "500.00",
          openBalance: "400.00",
          confirmAboveBalance: true,
          justification: "  ",
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "REQUIRED_FIELD"
    );
    assert.doesNotThrow(() =>
      assertPromiseAmountAllowed({
        promisedAmount: "500.00",
        openBalance: "400.00",
        confirmAboveBalance: true,
        justification: "Cliente confirmou total",
      })
    );
  });

  it("resolve cumprimento parcial/total e expiração", () => {
    assert.equal(
      resolveFulfillmentStatus({
        promisedAmount: "100.00",
        nextFulfilledAmount: "40.00",
      }),
      "PARTIALLY_FULFILLED"
    );
    assert.equal(
      resolveFulfillmentStatus({
        promisedAmount: "100.00",
        nextFulfilledAmount: "100.00",
      }),
      "FULFILLED"
    );
    assert.equal(
      shouldExpirePromise({
        status: "ACTIVE",
        promisedDate: "2026-07-01",
        fulfilledAmount: "0.00",
        promisedAmount: "50.00",
        todayCivilDate: "2026-07-27",
      }),
      true
    );
    assert.equal(
      shouldExpirePromise({
        status: "FULFILLED",
        promisedDate: "2026-07-01",
        fulfilledAmount: "50.00",
        promisedAmount: "50.00",
        todayCivilDate: "2026-07-27",
      }),
      false
    );
  });

  it("bloqueia título cancelado/saldo zero e dueDate oficial no body", () => {
    assert.throws(
      () => assertReceivableAllowsPromise(official("100.00", true)),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
    assert.throws(
      () => assertReceivableAllowsPromise(official("0.00")),
      /saldo em aberto/i
    );
    assert.throws(
      () => assertNoOfficialDueDateInPromiseBody({ dueDate: "2026-08-01" }),
      /vencimento oficial/i
    );
  });

  it("não cancela FULFILLED/CANCELLED e não cumpre CANCELLED/EXPIRED", () => {
    assert.throws(
      () => assertPromiseCancellable(promiseRow("FULFILLED")),
      /cumprida não pode ser cancelada/i
    );
    assert.throws(
      () => assertPromiseCancellable(promiseRow("CANCELLED")),
      /já está cancelada/i
    );
    assert.doesNotThrow(() => assertPromiseCancellable(promiseRow("ACTIVE")));
    assert.throws(
      () => assertPromiseFulfillable(promiseRow("CANCELLED")),
      /não pode ser cumprida/i
    );
    assert.throws(
      () => assertPromiseFulfillable(promiseRow("FULFILLED")),
      /já está cumprida/i
    );
  });
});
