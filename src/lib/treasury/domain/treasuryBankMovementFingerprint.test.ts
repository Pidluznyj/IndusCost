import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTreasuryBankMovementFingerprint,
  buildTreasuryBankMovementNormalizedPayload,
} from "./treasuryBankMovementFingerprint.js";

const ACCOUNT = "11111111-1111-1111-1111-111111111111";

describe("treasuryBankMovementFingerprint", () => {
  it("usa FITID quando presente e é estável", () => {
    const a = buildTreasuryBankMovementFingerprint({
      accountId: ACCOUNT,
      fitId: "FIT-001",
      postedCivilDate: "2026-07-01",
      direction: "CREDIT",
      amount: "10.00",
    });
    const b = buildTreasuryBankMovementFingerprint({
      accountId: ACCOUNT,
      fitId: "FIT-001",
      postedCivilDate: "2026-07-02",
      direction: "DEBIT",
      amount: "99.00",
      description: "ignored when fitId present",
    });
    assert.equal(a, b);
    assert.match(a, /^[a-f0-9]{64}$/);
  });

  it("compõe fingerprint sem FITID e diferencia direção/valor", () => {
    const base = {
      accountId: ACCOUNT,
      postedCivilDate: "2026-07-01",
      direction: "DEBIT" as const,
      amount: "100.50",
      description: "PIX Fornecedor",
      documentNumber: "123",
    };
    const a = buildTreasuryBankMovementFingerprint(base);
    const b = buildTreasuryBankMovementFingerprint({
      ...base,
      direction: "CREDIT",
    });
    const c = buildTreasuryBankMovementFingerprint({
      ...base,
      description: "  pix   fornecedor ",
    });
    assert.notEqual(a, b);
    assert.equal(a, c);
  });

  it("payload normalizado é mínimo e money-string", () => {
    const payload = buildTreasuryBankMovementNormalizedPayload({
      fitId: " F1 ",
      postedCivilDate: "2026-07-01",
      direction: "CREDIT",
      amount: "1.5",
      description: "  Recebimento ",
      counterpartyName: "Cliente X",
      documentNumber: "NF-9",
      trnType: "CREDIT",
    });
    assert.deepEqual(payload, {
      fitId: "F1",
      postedCivilDate: "2026-07-01",
      userCivilDate: null,
      direction: "CREDIT",
      amount: "1.50",
      currency: "BRL",
      description: "Recebimento",
      documentNumber: "NF-9",
      counterpartyName: "Cliente X",
      trnType: "CREDIT",
    });
    assert.equal("rawOfx" in payload, false);
    assert.equal("accountNumber" in payload, false);
  });
});
