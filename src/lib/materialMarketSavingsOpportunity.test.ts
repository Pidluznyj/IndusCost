import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialMarketSavingsOpportunityFromRows,
  computeMaterialMarketSavingsOpportunity,
  MATERIAL_MARKET_SAVINGS_NO_QUOTES_MESSAGE,
  MATERIAL_MARKET_SAVINGS_NO_SAVINGS_MESSAGE,
  parseMaterialMarketSavingsVolume,
  rankMaterialMarketSavingsOpportunities,
} from "./materialMarketSavingsOpportunity.js";

const REF = new Date("2026-07-08T12:00:00.000Z");

function quote(
  supplierName: string,
  netPrice: number,
  quoteDate = "2026-07-01"
) {
  return {
    quoteDate,
    netPrice,
    currency: "BRL",
    status: "ACTIVE",
    supplierName,
  };
}

describe("materialMarketSavingsOpportunity", () => {
  it("3 fornecedores com preços distintos → melhor fornecedor e economia corretos", () => {
    const result = computeMaterialMarketSavingsOpportunity({
      materialId: "mat-1",
      unit: "KG",
      currentCost: 12,
      estimatedVolume: 100,
      period: "90d",
      referenceDate: REF,
      quotes: [
        quote("Fornecedor A", 11.5, "2026-06-10"),
        quote("Fornecedor B", 9.8, "2026-06-20"),
        quote("Fornecedor C", 10.4, "2026-07-01"),
      ],
    });

    assert.equal(result.empty, false);
    assert.equal(result.hasSavings, true);
    assert.equal(result.currentPriceSource, "currentCost");
    assert.equal(result.currentPrice, 12);
    assert.equal(result.bestPrice, 9.8);
    assert.equal(result.recommendedSupplier, "Fornecedor B");
    assert.equal(result.unitSavings, 2.2);
    assert.equal(result.totalSavings, 220);
    assert.equal(result.savingsPercent, 18.33);
  });

  it("volume alterado escala totalSavings linearmente", () => {
    const base = {
      materialId: "mat-1",
      unit: "KG",
      currentCost: 10,
      period: "90d" as const,
      referenceDate: REF,
      quotes: [quote("Fornecedor X", 8)],
    };

    const one = computeMaterialMarketSavingsOpportunity({
      ...base,
      estimatedVolume: 1,
    });
    const thousand = computeMaterialMarketSavingsOpportunity({
      ...base,
      estimatedVolume: 1000,
    });

    assert.equal(one.unitSavings, 2);
    assert.equal(one.totalSavings, 2);
    assert.equal(thousand.totalSavings, 2000);
    assert.equal(thousand.totalSavings / one.totalSavings, 1000);
  });

  it("sem cotações no período → estado vazio", () => {
    const result = computeMaterialMarketSavingsOpportunity({
      materialId: "mat-1",
      unit: "KG",
      currentCost: 10,
      estimatedVolume: 50,
      period: "90d",
      referenceDate: REF,
      quotes: [],
    });

    assert.equal(result.empty, true);
    assert.equal(result.hasSavings, false);
    assert.equal(result.message, MATERIAL_MARKET_SAVINGS_NO_QUOTES_MESSAGE);
    assert.equal(result.unitSavings, 0);
    assert.equal(result.totalSavings, 0);
  });

  it("melhor preço >= atual → sem economia", () => {
    const equal = computeMaterialMarketSavingsOpportunity({
      materialId: "mat-1",
      unit: "KG",
      currentCost: 10,
      estimatedVolume: 100,
      period: "90d",
      referenceDate: REF,
      quotes: [quote("Fornecedor Caro", 10)],
    });
    assert.equal(equal.hasSavings, false);
    assert.equal(equal.message, MATERIAL_MARKET_SAVINGS_NO_SAVINGS_MESSAGE);
    assert.equal(equal.unitSavings, 0);

    const higher = computeMaterialMarketSavingsOpportunity({
      materialId: "mat-1",
      unit: "KG",
      currentCost: 10,
      estimatedVolume: 100,
      period: "90d",
      referenceDate: REF,
      quotes: [quote("Fornecedor Caro", 11.5)],
    });
    assert.equal(higher.hasSavings, false);
    assert.equal(higher.unitSavings, 0);
    assert.equal(higher.totalSavings, 0);
  });

  it("usa última cotação como preço atual quando currentCost é zero", () => {
    const result = computeMaterialMarketSavingsOpportunity({
      materialId: "mat-1",
      unit: "KG",
      currentCost: 0,
      estimatedVolume: 10,
      period: "90d",
      referenceDate: REF,
      quotes: [
        quote("Fornecedor Atual", 15, "2026-07-05"),
        quote("Fornecedor Melhor", 12, "2026-07-01"),
      ],
    });

    assert.equal(result.currentPriceSource, "latestQuote");
    assert.equal(result.currentPrice, 15);
    assert.equal(result.bestPrice, 12);
    assert.equal(result.unitSavings, 3);
    assert.equal(result.totalSavings, 30);
  });

  it("ranking retorna maior oportunidade entre monitoradas", () => {
    const ranked = rankMaterialMarketSavingsOpportunities({
      estimatedVolume: 1,
      period: "90d",
      referenceDate: REF,
      materials: [
        {
          id: "a",
          code: "MP-A",
          description: "Material A",
          unit: "KG",
          currentCost: 20,
          intelligencePath: "/materials/market-intelligence/a",
          quotes: [
            {
              id: "q1",
              materialId: "a",
              quoteDate: "2026-07-01",
              price: 18,
              currency: "BRL",
              unit: "KG",
              netPrice: 18,
              status: "ACTIVE",
              supplierName: "A1",
              createdAt: "2026-07-01",
              updatedAt: "2026-07-01",
            },
          ],
        },
        {
          id: "b",
          code: "MP-B",
          description: "Material B",
          unit: "KG",
          currentCost: 10,
          intelligencePath: "/materials/market-intelligence/b",
          quotes: [
            {
              id: "q2",
              materialId: "b",
              quoteDate: "2026-07-01",
              price: 5,
              currency: "BRL",
              unit: "KG",
              netPrice: 5,
              status: "ACTIVE",
              supplierName: "B1",
              createdAt: "2026-07-01",
              updatedAt: "2026-07-01",
            },
          ],
        },
      ],
    });

    assert.equal(ranked.topOpportunity?.materialId, "b");
    assert.equal(ranked.topOpportunity?.unitSavings, 5);
    assert.equal(ranked.items.length, 2);
  });

  it("parseMaterialMarketSavingsVolume rejeita valores inválidos", () => {
    assert.equal(parseMaterialMarketSavingsVolume("abc", 7), 7);
    assert.equal(parseMaterialMarketSavingsVolume(-5, 7), 7);
    assert.equal(parseMaterialMarketSavingsVolume("250", 7), 250);
  });

  it("buildMaterialMarketSavingsOpportunityFromRows mapeia linhas Prisma", () => {
    const result = buildMaterialMarketSavingsOpportunityFromRows({
      materialId: "mat-1",
      unit: "KG",
      currentCost: "14.5",
      estimatedVolume: 2,
      period: "90d",
      referenceDate: REF,
      quotes: [
        {
          id: "q1",
          materialId: "mat-1",
          quoteDate: "2026-07-01",
          price: 12,
          currency: "BRL",
          unit: "KG",
          netPrice: "12",
          status: "ACTIVE",
          supplierName: "Fornecedor Z",
          createdAt: "2026-07-01",
          updatedAt: "2026-07-01",
        },
      ],
    });

    assert.equal(result.bestPrice, 12);
    assert.equal(result.totalSavings, 5);
  });
});
