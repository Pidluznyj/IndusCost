import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideTreasuryExceptionUpsert,
  isTreasuryExceptionOpenCause,
  nextTreasuryExceptionRecurrence,
} from "./treasuryExceptionRules.js";

describe("treasuryExceptionRules", () => {
  it("considera status abertos como causa aberta", () => {
    assert.equal(isTreasuryExceptionOpenCause("OPEN"), true);
    assert.equal(isTreasuryExceptionOpenCause("ACK"), true);
    assert.equal(isTreasuryExceptionOpenCause("IN_ANALYSIS"), true);
    assert.equal(isTreasuryExceptionOpenCause("WAITING_THIRD_PARTY"), true);
    assert.equal(isTreasuryExceptionOpenCause("RESOLVED"), false);
    assert.equal(isTreasuryExceptionOpenCause("IGNORED"), false);
    assert.equal(isTreasuryExceptionOpenCause("CANCELLED"), false);
  });

  it("incrementa recorrência sem zerar", () => {
    assert.equal(nextTreasuryExceptionRecurrence(1), 2);
    assert.equal(nextTreasuryExceptionRecurrence(7), 8);
    assert.equal(nextTreasuryExceptionRecurrence(0), 2);
  });

  it("decide create / update_open / reopen", () => {
    assert.deepEqual(decideTreasuryExceptionUpsert(null, null), {
      kind: "create",
    });
    assert.deepEqual(decideTreasuryExceptionUpsert("OPEN", 3), {
      kind: "update_open",
      nextRecurrence: 4,
      keepStatus: "OPEN",
    });
    assert.deepEqual(decideTreasuryExceptionUpsert("IN_ANALYSIS", 1), {
      kind: "update_open",
      nextRecurrence: 2,
      keepStatus: "IN_ANALYSIS",
    });
    assert.deepEqual(decideTreasuryExceptionUpsert("IGNORED", 2), {
      kind: "reopen",
      nextRecurrence: 3,
    });
    assert.deepEqual(decideTreasuryExceptionUpsert("RESOLVED", 2), {
      kind: "reopen",
      nextRecurrence: 3,
    });
  });
});
