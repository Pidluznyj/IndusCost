import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTreasuryBankMovementFingerprint } from "./treasuryBankMovementFingerprint.js";
import {
  absoluteTreasuryMoneyString,
  buildTreasuryOfxPreviewClassification,
} from "./treasuryOfxPreviewRules.js";
import type { TreasuryOfxParsedTransaction } from "../ofx/treasuryOfxParser.js";

const ACCOUNT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function tx(
  overrides: Partial<TreasuryOfxParsedTransaction> &
    Pick<TreasuryOfxParsedTransaction, "fitId" | "postedCivilDate" | "amount" | "direction">
): TreasuryOfxParsedTransaction {
  return {
    memo: null,
    trnType: null,
    currency: "BRL",
    accountBankId: null,
    accountId: null,
    accountType: null,
    source: "BANK",
    ...overrides,
  };
}

describe("treasuryOfxPreviewRules", () => {
  it("classifica NEW, DUPLICATE (existente e intra-arquivo) e INVALID", () => {
    const credit = tx({
      fitId: "F1",
      postedCivilDate: "2026-07-15",
      amount: "150.00",
      direction: "CREDIT",
      memo: "A",
    });
    const debit = tx({
      fitId: "F2",
      postedCivilDate: "2026-07-16",
      amount: "-40.50",
      direction: "DEBIT",
      memo: "B",
    });
    const intra = tx({
      fitId: "F3",
      postedCivilDate: "2026-07-17",
      amount: "10.00",
      direction: "CREDIT",
      memo: "C",
    });
    const fp1 = buildTreasuryBankMovementFingerprint({
      accountId: ACCOUNT,
      fitId: "F1",
      postedCivilDate: "2026-07-15",
      direction: "CREDIT",
      amount: "150.00",
    });

    const result = buildTreasuryOfxPreviewClassification({
      accountId: ACCOUNT,
      transactions: [credit, debit, intra, intra],
      invalidSeeds: [
        { sortOrder: 99, reason: "sem FITID", fitId: null, description: "x" },
      ],
      existingFingerprints: new Set([fp1]),
      fileAlreadyImported: false,
    });

    assert.equal(result.movements[0]?.status, "DUPLICATE");
    assert.equal(result.movements[0]?.duplicateReason, "EXISTING_MOVEMENT");
    assert.equal(result.movements[1]?.status, "NEW");
    assert.equal(result.movements[1]?.amount, "40.50");
    assert.equal(result.movements[2]?.status, "NEW");
    assert.equal(result.movements[3]?.status, "DUPLICATE");
    assert.equal(result.movements[3]?.duplicateReason, "INTRA_FILE");
    assert.equal(result.movements[4]?.status, "INVALID");
    assert.deepEqual(result.period, {
      startCivilDate: "2026-07-15",
      endCivilDate: "2026-07-17",
    });
    assert.equal(result.totals.newCount, 2);
    assert.equal(result.totals.duplicateCount, 2);
    assert.equal(result.totals.invalidCount, 1);
    assert.equal(result.totals.creditAmount, "170.00");
    assert.equal(result.totals.debitAmount, "40.50");
    assert.equal(result.totals.netAmount, "129.50");
  });

  it("absoluteTreasuryMoneyString remove sinal", () => {
    assert.equal(absoluteTreasuryMoneyString("-10.5"), "10.50");
    assert.equal(absoluteTreasuryMoneyString("3"), "3.00");
  });
});
