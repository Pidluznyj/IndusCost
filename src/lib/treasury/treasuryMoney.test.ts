import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  isTreasuryMoneyString,
  negateTreasuryMoney,
  normalizeTreasuryMoneyString,
  roundTreasuryMoneyHalfUp,
  subtractTreasuryMoney,
  sumTreasuryMoney,
  TREASURY_MONEY_ROUNDING,
  treasuryMoneyFromCents,
  treasuryMoneyToCents,
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

  it("0,01 + 0,02 = 0,03 (precisão Decimal)", () => {
    assert.equal(addTreasuryMoney("0.01", "0.02"), "0.03");
    assert.equal(TREASURY_MONEY_ROUNDING, "HALF_UP");
  });

  it("R$ 1.000.000,99 − R$ 999.999,98 = R$ 1,01", () => {
    assert.equal(
      subtractTreasuryMoney("1000000.99", "999999.98"),
      "1.01"
    );
  });

  it("arredondamento HALF_UP consistente", () => {
    assert.equal(roundTreasuryMoneyHalfUp("1.005"), "1.01");
    assert.equal(roundTreasuryMoneyHalfUp("1.004"), "1.00");
    assert.equal(roundTreasuryMoneyHalfUp("-1.005"), "-1.01");
  });

  it("soma milhares de movimentos em centavos BigInt", () => {
    const values = Array.from({ length: 10_000 }, () => "0.01");
    assert.equal(sumTreasuryMoney(values), "100.00");
    assert.equal(treasuryMoneyFromCents(treasuryMoneyToCents("100.00")), "100.00");
    assert.equal(compareTreasuryMoney("100.00", "99.99"), 1);
  });
});
