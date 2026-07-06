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
import { computeLiveProjectPricingView } from "./projectsPricing.js";
import type { ProjectDetail } from "@/src/types/projects.js";

const PRICING_TAX_RULES = [{ id: "tax-0", name: "Zerada", description: null, taxPercent: 0 }];

function simulationItemNotes(id: string) {
  return `guided-origin:SIMULATION\nguided-simulation-id:${id}`;
}

function buildPricedDetail(margins: number[], prices: number[]): ProjectDetail {
  const ids = margins.map((_, index) => `${index + 1}${"0".repeat(35)}${index + 1}`);
  const unitCosts = prices.map((price, index) => {
    const margin = margins[index] ?? 30;
    return Math.round(price * (1 - margin / 100) * 1000000) / 1000000;
  });
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
    simulatedProducts: [],
    simulatedItems: ids.map((id, index) => ({
      id,
      provisionalCode: `SKU-${index + 1}`,
      description: `Item ${index + 1}`,
      itemType: "COMPONENT" as const,
      unit: "UN",
      estimatedUnitCost: unitCosts[index]!,
      quotedUnitCost: null,
      supplierName: null,
      leadTimeDays: null,
      estimatedWeight: null,
      lossPercent: 0,
      requiresQuotation: false,
      requiresEngineeringReview: false,
      canBecomeOfficial: false,
      notes: simulationItemNotes(id),
    })),
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
      config: { fiscalRuleId: "tax-0", defaultMarginPercent: 30 },
      taxRules: PRICING_TAX_RULES,
      hasSavedPricing: true,
      items: ids.map((targetItemId, index) => ({
        targetItemId,
        targetItemType: "SIMULATION" as const,
        displayName: `Item ${index + 1}`,
        costBaseUnit: unitCosts[index]!,
        amortizationUnitCost: 0,
        finalUnitCost: unitCosts[index]!,
        fiscalRuleId: "tax-0",
        fiscalRuleName: "Zerada",
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
    detail.simulatedItems[0]!.estimatedUnitCost = 2.1;
    detail.projectPricing = {
      ...detail.projectPricing!,
      items: [
        {
          ...updatedItem,
          targetMarginPercent: 40,
          costBaseUnit: 2.1,
          finalUnitCost: 2.1,
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

  it("relatório gerencial usa imposto vigente da regra fiscal, não snapshot salvo", () => {
    const detail = buildPricedDetail([30], [10]);
    const taxRules = [{ id: "tax-1", name: "MI", description: null, taxPercent: 27.25 }];
    detail.projectPricing = {
      ...detail.projectPricing!,
      taxRules,
      config: { fiscalRuleId: "tax-1", defaultMarginPercent: 30 },
      items: detail.projectPricing!.items.map((item) => ({
        ...item,
        fiscalRuleId: "tax-1",
        fiscalRuleName: "MI",
        taxPercent: 10,
        taxAmount: 1,
      })),
    };

    const live = computeLiveProjectPricingView(detail);
    const snapshot = buildProjectCostSnapshot(detail);
    const report = buildProjectExecutiveReport(detail);

    assert.equal(live.items.length, 1);
    assert.equal(live.items[0]?.taxPercent, 27.25);
    assert.equal(snapshot.pricing.view.items[0]?.taxPercent, 27.25);
    assert.equal(report.economicAnalysis.taxPercent, 27.25);
    assert.notEqual(report.economicAnalysis.taxPercent, 10);
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
