import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  financeApExportFilename,
  formatFinanceCalculatedStatus,
  formatFinanceCurrency,
  formatFinancePercent,
  safeFinanceNumber,
} from "./financeAccountsPayableFormat.js";

describe("financeAccountsPayableFormat", () => {
  it("safeFinanceNumber evita NaN", () => {
    assert.equal(safeFinanceNumber(NaN), 0);
    assert.equal(safeFinanceNumber(Infinity), 0);
    assert.equal(safeFinanceNumber("10,5"), 0);
    assert.equal(safeFinanceNumber(10.5), 10.5);
  });

  it("formatFinanceCurrency usa BRL com 2 casas", () => {
    assert.match(formatFinanceCurrency(1234.5), /1\.234,50/);
  });

  it("formatFinancePercent não retorna NaN", () => {
    assert.match(formatFinancePercent(12.345), /12,3%/);
    assert.match(formatFinancePercent(NaN), /0,0%/);
  });

  it("formatFinanceCalculatedStatus traduz AP", () => {
    assert.equal(formatFinanceCalculatedStatus("settled"), "Pago/Baixado");
    assert.equal(formatFinanceCalculatedStatus("suspended"), "Pagamento suspenso");
  });

  it("financeApExportFilename", () => {
    assert.equal(
      financeApExportFilename(new Date(2026, 5, 7)),
      "contas-a-pagar-2026-06-07.csv"
    );
  });
});
