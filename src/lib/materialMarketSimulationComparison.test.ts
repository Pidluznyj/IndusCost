import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialSimulationComparison,
  resolveMarginDifferenceVariant,
  resolveMaterialPriceDifferenceVariant,
  resolveProductsAtRiskVariant,
} from "./materialMarketSimulationComparison.js";
import type { MaterialProductFinancialImpactResponse } from "./materialProductFinancialImpact.js";
import type {
  MaterialMarketSimulationMarginSummary,
  MaterialMarketSimulationProductImpact,
} from "./materialMarketSimulation.js";

function sampleFinancial(): MaterialProductFinancialImpactResponse {
  return {
    materialId: "mat-1",
    disclaimer: "Simulação",
    baselineMaterialPriceBRL: 100,
    simulatedMaterialPriceBRL: 110,
    baselinePriceSource: "user",
    simulatedPriceSource: "user",
    marginThresholdPct: 10,
    impactedProductCount: 2,
    marginLossCount: 1,
    reajusteCount: 1,
    items: [
      {
        productId: "p1",
        sku: "SKU-1",
        productName: "Produto 1",
        bomQuantity: 1,
        previousCost: 50,
        simulatedCost: 55,
        costDifferenceBRL: 5,
        costDifferencePct: 10,
        sellingPrice: 100,
        sellingPriceTableCode: "ATACADO",
        previousMargin: 50,
        simulatedMargin: 45,
        targetMarginPct: 20,
        marginLoss: true,
        reajusteNecessario: false,
        missingData: { bom: false, sellingPrice: false, cost: false },
        costError: null,
      },
      {
        productId: "p2",
        sku: "SKU-2",
        productName: "Produto 2",
        bomQuantity: 1,
        previousCost: 80,
        simulatedCost: 95,
        costDifferenceBRL: 15,
        costDifferencePct: 18.75,
        sellingPrice: 100,
        sellingPriceTableCode: "VAREJO",
        previousMargin: 20,
        simulatedMargin: 5,
        targetMarginPct: 20,
        marginLoss: true,
        reajusteNecessario: true,
        missingData: { bom: false, sellingPrice: false, cost: false },
        costError: null,
      },
    ],
  };
}

function sampleProductImpacts(): MaterialMarketSimulationProductImpact[] {
  return [
    {
      productId: "p1",
      sku: "SKU-1",
      productName: "Produto 1",
      bomQuantity: 1,
      previousCost: 50,
      simulatedCost: 55,
      costDifferenceBRL: 5,
      costDifferencePct: 10,
      sellingPrice: 100,
      previousMargin: 50,
      simulatedMargin: 45,
      marginDelta: -5,
      isCritical: false,
      criticalReason: null,
    },
    {
      productId: "p2",
      sku: "SKU-2",
      productName: "Produto 2",
      bomQuantity: 1,
      previousCost: 80,
      simulatedCost: 95,
      costDifferenceBRL: 15,
      costDifferencePct: 18.75,
      sellingPrice: 100,
      previousMargin: 20,
      simulatedMargin: 5,
      marginDelta: -15,
      isCritical: true,
      criticalReason: "Reajuste necessário",
    },
  ];
}

function sampleMarginSummary(): MaterialMarketSimulationMarginSummary {
  return {
    impactedProductCount: 2,
    avgPreviousMargin: 35,
    avgSimulatedMargin: 25,
    avgMarginDelta: -10,
    criticalProductCount: 1,
    marginLossCount: 2,
    reajusteCount: 1,
  };
}

describe("materialMarketSimulationComparison", () => {
  it("+10% simulation → comparison material difference matches API prices", () => {
    const comparison = buildMaterialSimulationComparison({
      currentPrice: 100,
      simulatedPrice: 110,
      productImpacts: sampleProductImpacts(),
      marginSummary: sampleMarginSummary(),
      financial: sampleFinancial(),
    });

    assert.equal(comparison.material.currentPrice, 100);
    assert.equal(comparison.material.simulatedPrice, 110);
    assert.equal(comparison.material.differenceBRL, 10);
    assert.equal(comparison.material.differencePct, 10);
  });

  it("comparison margin averages mirror marginSummary input", () => {
    const marginSummary = sampleMarginSummary();
    const comparison = buildMaterialSimulationComparison({
      currentPrice: 100,
      simulatedPrice: 110,
      productImpacts: sampleProductImpacts(),
      marginSummary,
      financial: sampleFinancial(),
    });

    assert.equal(comparison.margin.currentAvg, marginSummary.avgPreviousMargin);
    assert.equal(comparison.margin.simulatedAvg, marginSummary.avgSimulatedMargin);
    assert.equal(comparison.margin.differencePct, -10);
  });

  it("productsAtRisk.simulated equals financial reajusteCount", () => {
    const financial = sampleFinancial();
    const comparison = buildMaterialSimulationComparison({
      currentPrice: 100,
      simulatedPrice: 110,
      productImpacts: sampleProductImpacts(),
      marginSummary: sampleMarginSummary(),
      financial,
    });

    assert.equal(comparison.productsAtRisk.simulated, financial.reajusteCount);
    assert.equal(comparison.totalCostImpactBRL, 20);
  });

  it("variant helpers reflect worse/better outcomes", () => {
    assert.equal(resolveMaterialPriceDifferenceVariant(5), "danger");
    assert.equal(resolveMaterialPriceDifferenceVariant(-3), "success");
    assert.equal(resolveMarginDifferenceVariant(-2), "danger");
    assert.equal(resolveMarginDifferenceVariant(1.5), "success");
    assert.equal(resolveProductsAtRiskVariant(1, 3), "danger");
    assert.equal(resolveProductsAtRiskVariant(3, 1), "success");
  });
});
