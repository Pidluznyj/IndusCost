import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TreasuryDomainError } from "./treasuryErrors.js";
import {
  assertPromiseAmountAllowed,
  resolveFulfillmentStatus,
  shouldExpirePromise,
} from "./treasuryPaymentPromiseRules.js";

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
});
