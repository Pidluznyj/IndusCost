import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addTreasuryMoney,
  isTreasuryMoneyString,
  negateTreasuryMoney,
  normalizeTreasuryMoneyString,
} from "./treasuryMoney.js";

describe("treasuryMoney", () => {
  it("valida e normaliza strings decimais", () => {
    assert.equal(isTreasuryMoneyString("10.5"), true);
    assert.equal(normalizeTreasuryMoneyString("10.5"), "10.50");
    assert.equal(normalizeTreasuryMoneyString("-2"), "-2.00");
  });

  it("rejeita vírgula e float inválido", () => {
    assert.equal(isTreasuryMoneyString("10,50"), false);
    assert.throws(() => normalizeTreasuryMoneyString("10,50"));
  });

  it("soma e nega em centavos sem float", () => {
    assert.equal(addTreasuryMoney("10.10", "0.20"), "10.30");
    assert.equal(addTreasuryMoney("0.01", "-0.01"), "0.00");
    assert.equal(negateTreasuryMoney("5.00"), "-5.00");
  });
});
