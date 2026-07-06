import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatSoldProductsPrintDate,
  formatSoldProductsPrintMoney,
  formatSoldProductsPrintPercent,
  formatSoldProductsPrintQty,
} from "./soldProductsPrintMeta.js";

describe("soldProductsPrintMeta", () => {
  it("formata quantidade sem quebrar milhares", () => {
    assert.equal(formatSoldProductsPrintQty(2_700_000), "2.700.000");
  });

  it("formata moeda em BRL", () => {
    assert.match(formatSoldProductsPrintMoney(559_000), /R\$\s*559\.000,00/);
  });

  it("formata data ISO em pt-BR", () => {
    assert.equal(formatSoldProductsPrintDate("2026-06-01"), "01/06/2026");
  });

  it("formata percentual com uma casa", () => {
    assert.equal(formatSoldProductsPrintPercent(38.7), "38,7%");
  });
});
