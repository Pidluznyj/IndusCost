import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialMarketFxDecompositionFromRows,
  buildFxDecompositionExplanation,
  computeMaterialMarketFxDecomposition,
  computeUnexplainedBrlVariationPct,
} from "./materialMarketFxDecomposition.js";
import type { MaterialMarketQuoteSourceRow } from "./materialMarketQuote.js";

function baseRow(
  overrides: Partial<MaterialMarketQuoteSourceRow> & Pick<MaterialMarketQuoteSourceRow, "id" | "quoteDate" | "netPrice" | "currency">
): MaterialMarketQuoteSourceRow {
  return {
    materialId: "mat-1",
    price: overrides.netPrice,
    unit: "kg",
    status: "ACTIVE",
    createdAt: overrides.quoteDate,
    updatedAt: overrides.quoteDate,
    ...overrides,
  };
}

describe("materialMarketFxDecomposition", () => {
  it("USD: preço BRL +10%, câmbio +2% → residual ~8% (multiplicativo)", () => {
    const from = {
      quoteDate: "2026-06-01",
      quoteDateLabel: "01/06/2026",
      originalCurrency: "USD",
      originalPrice: 100,
      priceBRL: 500,
      exchangeRateUsed: 5,
    };
    const to = {
      quoteDate: "2026-07-01",
      quoteDateLabel: "01/07/2026",
      originalCurrency: "USD",
      originalPrice: 107.84,
      priceBRL: 550,
      exchangeRateUsed: 5.1,
    };

    const result = computeMaterialMarketFxDecomposition({
      materialName: "ABS",
      fromQuote: from,
      toQuote: to,
      periodLabel: "30 dias",
    });

    assert.equal(result.hasSufficientData, true);
    assert.equal(result.brlVariationPct, 10);
    assert.equal(result.exchangeVariationPct, 2);
    assert.ok(Math.abs((result.unexplainedVariationPct ?? 0) - 7.84) < 0.1);
    assert.match(result.explanation, /ABS/);
    assert.match(result.explanation, /câmbio/i);
    assert.ok(result.calculationBasis.includes("PTAX"));
  });

  it("fórmula multiplicativa conhecida: 10% BRL e 2% FX → ~7,84% residual", () => {
    const unexplained = computeUnexplainedBrlVariationPct(10, 2);
    assert.ok(Math.abs(unexplained - 7.84) < 0.1);
  });

  it("BRL: toda variação é atribuída a preço/fornecedor", () => {
    const result = computeMaterialMarketFxDecomposition({
      materialName: "PP",
      fromQuote: {
        quoteDate: "2026-06-01",
        quoteDateLabel: "01/06/2026",
        originalCurrency: "BRL",
        originalPrice: 100,
        priceBRL: 100,
        exchangeRateUsed: null,
      },
      toQuote: {
        quoteDate: "2026-07-01",
        quoteDateLabel: "01/07/2026",
        originalCurrency: "BRL",
        originalPrice: 115,
        priceBRL: 115,
        exchangeRateUsed: null,
      },
      periodLabel: "Últimas duas cotações",
    });

    assert.equal(result.hasSufficientData, true);
    assert.equal(result.brlVariationPct, 15);
    assert.equal(result.exchangeVariationPct, 0);
    assert.equal(result.unexplainedVariationPct, 15);
    assert.match(result.explanation, /preço\/fornecedor/i);
  });

  it("cotação única → dados insuficientes", () => {
    const result = buildMaterialMarketFxDecompositionFromRows({
      materialName: "ABS",
      rows: [
        baseRow({
          id: "q1",
          quoteDate: "2026-07-01",
          netPrice: 100,
          currency: "USD",
        }),
      ],
      exchangeRatesByDate: new Map([["2026-07-01", 5.1]]),
    });

    assert.equal(result.hasSufficientData, false);
    assert.equal(result.fromQuote, null);
    assert.equal(result.toQuote, null);
    assert.match(result.explanation, /insuficientes/i);
  });

  it("USD sem snapshot PTAX → dados insuficientes", () => {
    const result = buildMaterialMarketFxDecompositionFromRows({
      materialName: "ABS",
      rows: [
        baseRow({
          id: "q2",
          quoteDate: "2026-07-01",
          netPrice: 110,
          currency: "USD",
        }),
        baseRow({
          id: "q1",
          quoteDate: "2026-06-01",
          netPrice: 100,
          currency: "USD",
        }),
      ],
      exchangeRatesByDate: new Map([["2026-07-01", 5.1]]),
    });

    assert.equal(result.hasSufficientData, false);
    assert.match(result.calculationBasis, /PTAX/i);
  });

  it("compara últimas duas cotações por padrão", () => {
    const result = buildMaterialMarketFxDecompositionFromRows({
      materialName: "PVC",
      period: "latest",
      exchangeRatesByDate: new Map([
        ["2026-07-08", 5.2],
        ["2026-07-01", 5.0],
      ]),
      rows: [
        baseRow({
          id: "q3",
          quoteDate: "2026-07-08",
          netPrice: 10,
          currency: "USD",
        }),
        baseRow({
          id: "q2",
          quoteDate: "2026-07-01",
          netPrice: 10,
          currency: "USD",
        }),
      ],
    });

    assert.equal(result.hasSufficientData, true);
    assert.equal(result.periodLabel, "Últimas duas cotações");
    assert.equal(result.brlVariationPct, 4);
    assert.equal(result.exchangeVariationPct, 4);
    assert.equal(result.unexplainedVariationPct, 0);
  });

  it("monta explicação em português", () => {
    const text = buildFxDecompositionExplanation({
      materialName: "ABS",
      brlVariationPct: 10,
      exchangeVariationPct: 2,
      unexplainedVariationPct: 8,
      currency: "USD",
    });
    assert.match(text, /ABS subiu 10%/);
    assert.match(text, /dólar subiu 2%/);
    assert.match(text, /aproximadamente 8%/);
  });
});
