import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialProductFinancialImpactResponse,
  computeCostDifference,
  computeMarginPercentFromFixedSalePrice,
  computeMaterialProductFinancialImpacts,
  computeSingleProductFinancialImpact,
  mapProductImpactToFinancialImpactRow,
  MATERIAL_FINANCIAL_IMPACT_DEFAULT_MARGIN_THRESHOLD_PCT,
  MATERIAL_FINANCIAL_IMPACT_DISCLAIMER,
  resolveDefaultMaterialSimulationPrices,
  resolveReajusteNecessario,
} from "./materialProductFinancialImpact.js";

const PRICING_RATES = {
  taxRate: 0.1,
  commissionRate: 0.02,
  otherRate: 0.01,
  marginRate: 0.15,
  freight: 0,
};

describe("materialProductFinancialImpact", () => {
  it("resolve preços padrão: baseline currentCost e simulado última cotação", () => {
    const resolved = resolveDefaultMaterialSimulationPrices({
      currentCost: 10,
      quotes: [
        { quoteDate: "2026-01-01", netPrice: 11, status: "ACTIVE" },
        { quoteDate: "2026-02-01", netPrice: 12.5, status: "ACTIVE" },
      ],
    });
    assert.equal(resolved.baselineMaterialPriceBRL, 10);
    assert.equal(resolved.baselinePriceSource, "currentCost");
    assert.equal(resolved.simulatedMaterialPriceBRL, 12.5);
    assert.equal(resolved.simulatedPriceSource, "latestQuote");
  });

  it("produto com vínculo BOM: delta de margem correto com preço comercial fixo", () => {
    const impact = computeSingleProductFinancialImpact({
      product: {
        productId: "p1",
        sku: "619.24AA",
        name: "Produto teste",
        bomLineId: "bom-1",
        bomQuantity: 2,
        lossPercentage: 0,
        costAnalysis: {
          totalIndustrialCost: 100,
          materialLineCost: 20,
        },
        pricingRates: PRICING_RATES,
      },
      currentMaterialPriceBRL: 10,
      simulatedMaterialPriceBRL: 15,
      criticalMarginPercent: 5,
    });
    assert.ok(impact);
    const row = mapProductImpactToFinancialImpactRow({
      impact: impact!,
      bomQuantity: 2,
      sellingPrice: 200,
      sellingPriceTableCode: "ATACADO",
      targetMarginPct: 15,
    });
    assert.equal(row.previousCost, 100);
    assert.equal(row.simulatedCost, 110);
    assert.equal(row.costDifferenceBRL, 10);
    assert.equal(row.previousMargin, 50);
    assert.equal(row.simulatedMargin, 45);
    assert.equal(row.marginLoss, true);
  });

  it("marca perda de margem e reajuste necessário", () => {
    const impact = computeSingleProductFinancialImpact({
      product: {
        productId: "p2",
        sku: "620.00AA",
        name: "Produto margem",
        bomLineId: "bom-2",
        bomQuantity: 1,
        lossPercentage: 0,
        costAnalysis: {
          totalIndustrialCost: 80,
          materialLineCost: 10,
        },
        pricingRates: PRICING_RATES,
      },
      currentMaterialPriceBRL: 10,
      simulatedMaterialPriceBRL: 25,
      criticalMarginPercent: 5,
    });
    assert.ok(impact);
    const row = mapProductImpactToFinancialImpactRow({
      impact: impact!,
      bomQuantity: 1,
      sellingPrice: 100,
      sellingPriceTableCode: "VAREJO_1",
      targetMarginPct: 20,
    });
    assert.equal(row.reajusteNecessario, true);
    assert.equal(row.marginLoss, true);
  });

  it("sem preço de venda publicado → missingData claro", () => {
    const impact = computeSingleProductFinancialImpact({
      product: {
        productId: "p3",
        sku: "621.00AA",
        name: "Sem preço",
        bomLineId: "bom-3",
        bomQuantity: 1,
        lossPercentage: 0,
        costAnalysis: {
          totalIndustrialCost: 50,
          materialLineCost: 5,
        },
        pricingRates: null,
      },
      currentMaterialPriceBRL: 5,
      simulatedMaterialPriceBRL: 6,
      criticalMarginPercent: 5,
    });
    assert.ok(impact);
    const row = mapProductImpactToFinancialImpactRow({
      impact: impact!,
      bomQuantity: 1,
      sellingPrice: null,
      sellingPriceTableCode: null,
      targetMarginPct: null,
    });
    assert.equal(row.missingData.sellingPrice, true);
    assert.equal(row.previousMargin, null);
    assert.equal(row.marginLoss, false);
  });

  it("usa limiar padrão de reajuste sem margem publicada", () => {
    assert.equal(
      resolveReajusteNecessario({ simulatedMargin: 8, targetMarginPct: null }),
      true
    );
    assert.equal(MATERIAL_FINANCIAL_IMPACT_DEFAULT_MARGIN_THRESHOLD_PCT, 10);
  });

  it("integração computeMaterialProductFinancialImpacts com preços baseline/simulado", () => {
    const result = computeMaterialProductFinancialImpacts({
      materialId: "mat-1",
      currentMaterialPriceBRL: 10,
      simulatedMaterialPriceBRL: 15,
      products: [
        {
          productId: "prod-1",
          sku: "100.01AA",
          name: "Panela",
          bomLineId: "bom-1",
          bomQuantity: 1.5,
          lossPercentage: 0,
          costAnalysis: { totalIndustrialCost: 40, materialLineCost: 10 },
          pricingRates: PRICING_RATES,
        },
      ],
    });
    assert.equal(result.productImpacts.length, 1);
    assert.ok(result.productImpacts[0]!.simulatedIndustrialCost > result.productImpacts[0]!.previousIndustrialCost);
  });

  it("monta resposta da API com disclaimer e contagens", () => {
    const response = buildMaterialProductFinancialImpactResponse({
      materialId: "mat-1",
      prices: {
        baselineMaterialPriceBRL: 10,
        simulatedMaterialPriceBRL: 12,
        baselinePriceSource: "currentCost",
        simulatedPriceSource: "latestQuote",
      },
      rows: [
        {
          productId: "p1",
          sku: "A",
          productName: "Prod A",
          bomQuantity: 1,
          previousCost: 10,
          simulatedCost: 12,
          costDifferenceBRL: 2,
          costDifferencePct: 20,
          sellingPrice: 20,
          sellingPriceTableCode: "ATACADO",
          previousMargin: 50,
          simulatedMargin: 40,
          targetMarginPct: 15,
          marginLoss: true,
          reajusteNecessario: false,
          missingData: { bom: false, sellingPrice: false, cost: false },
          costError: null,
        },
      ],
    });
    assert.equal(response.disclaimer, MATERIAL_FINANCIAL_IMPACT_DISCLAIMER);
    assert.equal(response.marginLossCount, 1);
    assert.equal(computeCostDifference(10, 12).costDifferenceBRL, 2);
    assert.equal(computeMarginPercentFromFixedSalePrice(100, 60), 40);
  });
});
