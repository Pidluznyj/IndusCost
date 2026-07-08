import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractNomusSalesOrderFinancialSummary } from "./nomusSalesOrderFinancialParcels.js";

describe("nomusSalesOrderFinancialParcels", () => {
  it("lê valorTotalFinanceiro e parcelas aninhadas em condicaoPagamento", () => {
    const summary = extractNomusSalesOrderFinancialSummary({
      condicaoPagamento: {
        valorTotalFinanceiro: 202_860,
        condicaoPagamentoParcelas: [
          { numeroParcela: 1, dataVencimento: "10/09/2026", valorParcela: 202_860 },
        ],
      },
    });
    assert.equal(summary.financialTotal, 202_860);
    assert.equal(summary.parcels.length, 1);
    assert.equal(summary.parcels[0]?.amount, 202_860);
  });

  it("soma parcelas quando total financeiro ausente", () => {
    const summary = extractNomusSalesOrderFinancialSummary({
      parcelas: [
        { numeroParcela: 1, valorParcela: 100_000 },
        { numeroParcela: 2, valorParcela: 102_860 },
      ],
    });
    assert.equal(summary.financialTotal, 202_860);
  });
});
