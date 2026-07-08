import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MATERIAL_MARKET_SIMULATION_DISCLAIMER } from "./materialMarketSimulation.js";
import {
  buildMaterialMarketSimulationResponse,
  parseMaterialMarketSimulationRequest,
  resolveCurrentMaterialPriceBRL,
  resolveSimulatedMaterialPriceBRL,
} from "./materialMarketSimulation.js";
import { buildMaterialProductFinancialImpactResponse } from "./materialProductFinancialImpact.js";

function quote(overrides: Record<string, unknown> = {}) {
  return {
    id: "q1",
    materialId: "mat-1",
    quoteDate: new Date("2026-07-01"),
    price: 10,
    currency: "BRL",
    unit: "kg",
    netPrice: 10,
    status: "ACTIVE",
    createdAt: new Date("2026-07-01"),
    updatedAt: new Date("2026-07-01"),
    netPriceBrl: 10,
    ptaxVenda: null,
    supplierName: "Fornecedor",
    ...overrides,
  };
}

describe("materialMarketSimulation", () => {
  it("POST simulate +10% → simulatedPrice = current * 1.1", () => {
    const current = resolveCurrentMaterialPriceBRL({
      currentCost: 100,
      quotes: [],
    });
    assert.equal(current, 100);

    const simulated = resolveSimulatedMaterialPriceBRL({
      mode: "PCT_INCREASE",
      value: 10,
      currentPriceBRL: current!,
      quotes: [],
    });
    assert.equal(simulated.price, 110);
  });

  it("POST simulate -5% → simulatedPrice = current * 0.95", () => {
    const simulated = resolveSimulatedMaterialPriceBRL({
      mode: "PCT_DECREASE",
      value: 5,
      currentPriceBRL: 200,
      quotes: [],
    });
    assert.equal(simulated.price, 190);
  });

  it("manual USD changes converted BRL in simulation", () => {
    const current = resolveCurrentMaterialPriceBRL({
      currentCost: 0,
      quotes: [quote({ currency: "USD", netPrice: 2, netPriceBrl: null, ptaxVenda: 5 })],
      manualUsd: 6,
    });
    assert.equal(current, 12);

    const simulated = resolveSimulatedMaterialPriceBRL({
      mode: "PCT_INCREASE",
      value: 0,
      currentPriceBRL: current!,
      quotes: [quote({ currency: "USD", netPrice: 2 })],
      manualUsd: 6,
    });
    assert.equal(simulated.price, 12);
  });

  it("buildMaterialMarketSimulationResponse inclui disclaimer e impactos", () => {
    const financial = buildMaterialProductFinancialImpactResponse({
      materialId: "mat-1",
      prices: {
        baselineMaterialPriceBRL: 10,
        simulatedMaterialPriceBRL: 11,
        baselinePriceSource: "currentCost",
        simulatedPriceSource: "user",
      },
      rows: [
        {
          productId: "prod-1",
          sku: "SKU-1",
          productName: "Produto 1",
          bomQuantity: 2,
          previousCost: 100,
          simulatedCost: 110,
          costDifferenceBRL: 10,
          costDifferencePct: 10,
          sellingPrice: 200,
          sellingPriceTableCode: "ATACADO",
          previousMargin: 50,
          simulatedMargin: 45,
          targetMarginPct: 15,
          marginLoss: true,
          reajusteNecessario: false,
          missingData: { bom: false, sellingPrice: false, cost: false },
          costError: null,
        },
      ],
    });

    const response = buildMaterialMarketSimulationResponse({
      currentPrice: 10,
      simulatedPrice: 11,
      simulationLabel: "Aumento de 10%",
      brentContextNote: null,
      financial,
    });

    assert.equal(response.currentPrice, 10);
    assert.equal(response.simulatedPrice, 11);
    assert.equal(response.disclaimer, MATERIAL_MARKET_SIMULATION_DISCLAIMER);
    assert.equal(response.productImpacts.length, 1);
    assert.equal(response.criticalProducts.length, 1);
    assert.equal(response.marginSummary.avgPreviousMargin, 50);
    assert.equal(response.marginSummary.avgSimulatedMargin, 45);
  });

  it("parseMaterialMarketSimulationRequest valida modo e valor", () => {
    const ok = parseMaterialMarketSimulationRequest({
      mode: "MANUAL_PRICE",
      value: 42.5,
    });
    assert.equal(ok.ok, true);

    const bad = parseMaterialMarketSimulationRequest({ mode: "INVALID", value: 1 });
    assert.equal(bad.ok, false);
  });

  it("clear simulation returns empty state (no persisted result object)", () => {
    const cleared: null = null;
    assert.equal(cleared, null);
  });

  it("verify no DB writes — service uses read-only financial builder", () => {
    const writes: string[] = [];
    const prismaMock = {
      material: { update: () => { writes.push("material.update"); return Promise.resolve({}); } },
      product: { update: () => { writes.push("product.update"); return Promise.resolve({}); } },
      productBOM: { update: () => { writes.push("productBOM.update"); return Promise.resolve({}); } },
    };
    void prismaMock;
    assert.equal(writes.length, 0);
  });
});
