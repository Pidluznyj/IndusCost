import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MONEY_RANGE_PRESETS,
  formatMoneyAmountInput,
  formatMoneyRangeSummary,
  moneyAmountToFilterParam,
  parseMoneyAmountInput,
  resolveActiveMoneyRangePreset,
} from "./moneyRangeFilter.js";

describe("moneyRangeFilter", () => {
  it("parseia valores pt-BR e en-US", () => {
    assert.equal(parseMoneyAmountInput("1.500,50"), 1500.5);
    assert.equal(parseMoneyAmountInput("1500,5"), 1500.5);
    assert.equal(parseMoneyAmountInput("1500.5"), 1500.5);
    assert.equal(parseMoneyAmountInput("1.500"), 1500);
    assert.equal(parseMoneyAmountInput("R$ 10.000,00"), 10000);
    assert.equal(parseMoneyAmountInput(""), null);
    assert.equal(parseMoneyAmountInput("0"), 0);
  });

  it("emite param canônico positivo", () => {
    assert.equal(moneyAmountToFilterParam("1.000,00"), "1000");
    assert.equal(moneyAmountToFilterParam("1.500,50"), "1500.5");
    assert.equal(moneyAmountToFilterParam("0"), "");
    assert.equal(moneyAmountToFilterParam(""), "");
  });

  it("formata display sem R$", () => {
    assert.equal(formatMoneyAmountInput("1000"), "1.000,00");
    assert.equal(formatMoneyAmountInput(""), "");
  });

  it("resume faixa e reconhece presets", () => {
    assert.match(formatMoneyRangeSummary("", "10000") ?? "", /Até/);
    assert.match(formatMoneyRangeSummary("50000", "") ?? "", /A partir/);
    assert.match(formatMoneyRangeSummary("1000", "50000") ?? "", /—/);
    assert.equal(resolveActiveMoneyRangePreset("", "10000"), "upto-10k");
    assert.equal(resolveActiveMoneyRangePreset("50000", ""), "from-50k");
    assert.equal(resolveActiveMoneyRangePreset("1", "2"), null);
    assert.ok(MONEY_RANGE_PRESETS.length >= 4);
  });
});
