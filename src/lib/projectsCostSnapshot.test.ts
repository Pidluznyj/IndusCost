import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProjectExecutiveReport } from "./projectsExecutiveReport.js";
import {
  buildProjectClientReport,
  buildProjectClientReportProducts,
} from "./projectsClientReport.js";
import {
  buildProjectCostSnapshot,
  computeProjectCostSetTotal,
  resolveProjectCostFinalUnitPrice,
} from "./projectsCostSnapshot.js";
import type { ProjectDetail } from "@/src/types/projects.js";

function buildPricedDetail(margins: number[], prices: number[]): ProjectDetail {
  const ids = margins.map((_, index) => `${index + 1}${"0".repeat(35)}${index + 1}`);
  return {
    id: "proj-snapshot-test",
    code: "PRJ-SNAP",
    title: "Snapshot Test",
    customerName: "Cliente",
    customerDocument: null,
    description: null,
    projectType: "NEW_PRODUCT",
    status: "WAITING_QUOTATION",
    commercialOwner: null,
    technicalOwner: null,
    expectedMonthlyVolume: 100,
    targetPrice: null,
    targetMarginPercent: null,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    currentVersion: null,
    versions: [],
    simulatedProducts: ids.map((id, index) => ({
      id,
      provisionalCode: `SKU-${index + 1}`,
      description: `Item ${index + 1}`,
      unit: "UN",
      estimatedWeight: null,
      expectedVolume: 1,
      batchSize: null,
      notes: null,
    })),
    simulatedItems: [],
    structureLines: [],
    molds: [],
    snapshotRootProducts: {},
    costBreakdown: {
      rawMaterialCost: 0,
      componentCost: 0,
      serviceCost: 0,
      packagingCost: 0,
      separateMoldCost: 0,
      amortizedMoldCostPerUnit: 0,
      unitCost: 0,
      targetMarginPercent: null,
      suggestedPrice: 99.99,
      markupPercent: null,
      targetPrice: null,
      priceGap: null,
    },
    alerts: [],
    conversionAvailable: false,
    projectPricing: {
      config: { fiscalRuleId: null, defaultMarginPercent: 30 },
      taxRules: [],
      hasSavedPricing: true,
      items: ids.map((targetItemId, index) => ({
        targetItemId,
        targetItemType: "SIMULATION" as const,
        displayName: `Item ${index + 1}`,
        costBaseUnit: 2,
        amortizationUnitCost: 0,
        finalUnitCost: 2,
        fiscalRuleId: null,
        fiscalRuleName: null,
        taxPercent: 0,
        targetMarginPercent: margins[index]!,
        suggestedPrice: prices[index]!,
        suggestedPriceWithoutAmortization: prices[index]!,
        suggestedPriceWithAmortization: prices[index]!,
        taxAmount: 0,
        marginAmount: 1,
        status: "CALCULATED" as const,
        statusLabel: "Calculado",
        errorMessage: null,
      })),
    },
  };
}

describe("projectsCostSnapshot", () => {
  it("ignora costBreakdown.suggestedPrice legado no snapshot", () => {
    const detail = buildPricedDetail([30, 30], [3.2, 4.8]);
    const snapshot = buildProjectCostSnapshot(detail);
    assert.equal(snapshot.totals.finalSetPrice, 8);
    assert.notEqual(snapshot.totals.finalSetPrice, detail.costBreakdown.suggestedPrice);
  });

  it("relatório cliente usa os mesmos preços do snapshot/grid", () => {
    const detail = buildPricedDetail([30, 30], [3.2, 4.8]);
    const snapshot = buildProjectCostSnapshot(detail);
    const report = buildProjectClientReport(detail);

    assert.equal(report.summary.finalSetPrice, snapshot.totals.finalSetPrice);
    for (const item of snapshot.pricing.view.items) {
      const product = report.products.find((row) => row.id === item.targetItemId);
      assert.equal(product?.finalUnitPrice, resolveProjectCostFinalUnitPrice(item));
    }
  });

  it("relatório gerencial usa preço do conjunto do snapshot", () => {
    const detail = buildPricedDetail([30, 30], [3.2, 4.8]);
    const snapshot = buildProjectCostSnapshot(detail);
    const report = buildProjectExecutiveReport(detail);

    assert.equal(report.economicAnalysis.suggestedPrice, snapshot.totals.finalSetPrice);
    assert.equal(report.economicAnalysis.pricingItems.length, snapshot.pricing.view.items.length);
  });

  it("margem alterada no grid reflete no relatório após atualizar projectPricing", () => {
    const detail = buildPricedDetail([30, 30], [3.2, 4.8]);
    const updatedItem = detail.projectPricing!.items[0]!;
    detail.projectPricing = {
      ...detail.projectPricing!,
      items: [
        {
          ...updatedItem,
          targetMarginPercent: 40,
          suggestedPrice: 3.5,
          suggestedPriceWithAmortization: 3.5,
          suggestedPriceWithoutAmortization: 3.5,
        },
        detail.projectPricing!.items[1]!,
      ],
    };

    const snapshot = buildProjectCostSnapshot(detail);
    const report = buildProjectClientReport(detail);

    assert.equal(snapshot.totals.finalSetPrice, 8.3);
    assert.equal(report.summary.finalSetPrice, 8.3);
    assert.equal(report.products[0]?.finalUnitPrice, 3.5);
  });

  it("PRJ-00008 — conjunto R$ 13,13 alinhado entre snapshot e proposta", () => {
    const prices = [3.28, 3.28, 3.28, 3.29];
    const detail = buildPricedDetail(prices.map(() => 30), prices);
    detail.code = "PRJ-00008";
    detail.title = "IRIS";

    const snapshot = buildProjectCostSnapshot(detail);
    const report = buildProjectClientReport(detail);

    assert.equal(snapshot.totals.finalSetPrice, 13.13);
    assert.equal(report.summary.finalSetPrice, 13.13);
    assert.equal(
      computeProjectCostSetTotal(snapshot.pricing.view.items),
      report.summary.finalSetPrice
    );
  });

  it("PDF e PPTX usam o mesmo preço final do snapshot", () => {
    const detail = buildPricedDetail([30, 30], [3.2, 4.8]);
    const snapshot = buildProjectCostSnapshot(detail);
    const client = buildProjectClientReport(detail);
    const executive = buildProjectExecutiveReport(detail);

    assert.equal(client.summary.finalSetPrice, snapshot.totals.finalSetPrice);
    assert.equal(executive.economicAnalysis.suggestedPrice, snapshot.totals.finalSetPrice);
    assert.deepEqual(
      buildProjectClientReportProducts(detail).map((row) => row.finalUnitPrice),
      snapshot.pricing.view.items.map((row) => resolveProjectCostFinalUnitPrice(row))
    );
  });
});
