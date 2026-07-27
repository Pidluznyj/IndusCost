import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertTreasuryTransferCreateable,
  assertTreasuryTransferTransitionAllowed,
  isTreasuryTransferFundsInTransit,
  resolveTreasuryTransferProjectionLegs,
} from "./treasuryTransferRules.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

describe("treasuryTransferRules", () => {
  it("exige origem≠destino e valor positivo", () => {
    assert.throws(
      () =>
        assertTreasuryTransferCreateable({
          fromAccountId: "a",
          toAccountId: "a",
          amount: "10.00",
        }),
      TreasuryDomainError
    );
    assert.throws(
      () =>
        assertTreasuryTransferCreateable({
          fromAccountId: "a",
          toAccountId: "b",
          amount: "0.00",
        }),
      TreasuryDomainError
    );
    assertTreasuryTransferCreateable({
      fromAccountId: "a",
      toAccountId: "b",
      amount: "0.01",
    });
  });

  it("controla transições de status", () => {
    assertTreasuryTransferTransitionAllowed("FORECAST", "schedule");
    assertTreasuryTransferTransitionAllowed("SCHEDULED", "send");
    assertTreasuryTransferTransitionAllowed("SENT", "receive");
    assertTreasuryTransferTransitionAllowed("RECEIVED", "reconcile");
    assert.throws(
      () => assertTreasuryTransferTransitionAllowed("RECONCILED", "cancel"),
      TreasuryDomainError
    );
    assert.throws(
      () => assertTreasuryTransferTransitionAllowed("SENT", "reconcile"),
      TreasuryDomainError
    );
  });

  it("marca recurso em trânsito só em SENT", () => {
    assert.equal(isTreasuryTransferFundsInTransit("SENT"), true);
    assert.equal(isTreasuryTransferFundsInTransit("RECEIVED"), false);
    assert.equal(isTreasuryTransferFundsInTransit("FORECAST"), false);
  });

  it("resolve pernas: SENT omite entrada; RECEIVED fecha o par", () => {
    const sent = resolveTreasuryTransferProjectionLegs({
      status: "SENT",
      civilDate: "2026-08-01",
      sentCivilDate: "2026-08-02",
    });
    assert.equal(sent.outCivilDate, "2026-08-02");
    assert.equal(sent.inCivilDate, null);
    assert.equal(sent.fundsInTransit, true);
    assert.equal(sent.outRealized, true);

    const received = resolveTreasuryTransferProjectionLegs({
      status: "RECEIVED",
      civilDate: "2026-08-01",
      sentCivilDate: "2026-08-02",
      receivedCivilDate: "2026-08-03",
    });
    assert.equal(received.inCivilDate, "2026-08-03");
    assert.equal(received.fundsInTransit, false);
    assert.equal(received.inRealized, true);
  });
});
