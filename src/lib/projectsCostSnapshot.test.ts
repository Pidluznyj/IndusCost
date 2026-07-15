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
import { roundProjectMoney } from "./projectsCostAmortization.js";
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

  it("relatório gerencial usa preços e quantidades por produto (não média do conjunto)", () => {
    const ids = ["110000000000000000000000000000001", "220000000000000000000000000000002"];
    const detail = buildPricedDetail([30, 30], [3.2, 4.8]);
    // Força duas simulações com amortização no custo para diferenciar preço com/sem.
    detail.simulatedItems = ids.map((id, index) => ({
      ...detail.simulatedItems[index]!,
      id,
      notes: `guided-origin:SIMULATION\nguided-simulation-id:${id}`,
      estimatedUnitCost: index === 0 ? 2.24 : 3.36,
    }));
    detail.molds = [
      {
        id: "mold-snap-1",
        name: "Molde teste",
        moldType: "Novo",
        cavities: 1,
        estimatedLifeCycles: null,
        supplierName: null,
        constructionCost: 10_000,
        maintenanceCost: null,
        changeCost: null,
        leadTimeDays: null,
        chargeMode: "CHARGED_SEPARATELY",
        amortizationQuantity: null,
        amortizedCostPerUnit: null,
        ownership: "UNDEFINED",
        notes: null,
      },
    ];
    detail.costAmortizations = [
      {
        id: "amort-snap",
        projectId: detail.id,
        sourceType: "MOLD",
        sourceId: "mold-snap-1",
        sourceDescriptionSnapshot: "Molde teste",
        sourceTotalCostSnapshot: 10_000,
        passThroughPercent: 100,
        passThroughAmount: 10_000,
        absorbedAmount: 0,
        status: "DISTRIBUTED",
        distributionPercentTotal: 100,
        distributionBalancePercent: 0,
        allocatedAmountTotal: 10_000,
        unallocatedAmount: 0,
        allocations: [
          {
            targetItemId: ids[0]!,
            targetItemType: "SIMULATION",
            targetDescriptionSnapshot: "Item 1",
            targetBaseUnitCostSnapshot: 2.24,
            allocationPercent: 60,
            amortizationQuantity: 1000,
            allocatedAmount: 6_000,
            unitAmortizedCost: 6,
            finalUnitCost: 8.24,
          },
          {
            targetItemId: ids[1]!,
            targetItemType: "SIMULATION",
            targetDescriptionSnapshot: "Item 2",
            targetBaseUnitCostSnapshot: 3.36,
            allocationPercent: 40,
            amortizationQuantity: 1000,
            allocatedAmount: 4_000,
            unitAmortizedCost: 4,
            finalUnitCost: 7.36,
          },
        ],
      },
    ];
    detail.projectPricing = {
      config: { fiscalRuleId: "tax-0", defaultMarginPercent: 30 },
      taxRules: PRICING_TAX_RULES,
      hasSavedPricing: true,
      items: ids.map((targetItemId, index) => ({
        targetItemId,
        targetItemType: "SIMULATION" as const,
        displayName: `Item ${index + 1}`,
        costBaseUnit: index === 0 ? 2.24 : 3.36,
        amortizationUnitCost: 0,
        finalUnitCost: index === 0 ? 2.24 : 3.36,
        fiscalRuleId: "tax-0",
        fiscalRuleName: "Zerada",
        taxPercent: 0,
        targetMarginPercent: 30,
        suggestedPrice: null,
        suggestedPriceWithoutAmortization: null,
        suggestedPriceWithAmortization: null,
        taxAmount: null,
        marginAmount: null,
        status: "PENDING" as const,
        statusLabel: "Pendente",
        errorMessage: null,
      })),
    };

    const report = buildProjectExecutiveReport(detail);

    assert.equal(report.economicAnalysis.pricingItems.length, 2);
    assert.equal(report.economicAnalysis.portfolio.productCount, 2);
    assert.equal(report.economicAnalysis.finalUnitCost, null);

    for (const row of report.economicAnalysis.pricingItems) {
      assert.equal(row.quantity, 1000);
      assert.ok((row.amortizationReturn ?? 0) > 0);
      assert.equal(
        row.amortizationReturn,
        roundProjectMoney(
          row.quantity *
            ((row.suggestedPriceWithAmortization ?? 0) -
              (row.suggestedPriceWithoutAmortization ?? 0))
        )
      );
    }

    assert.equal(
      report.economicAnalysis.portfolio.totalRevenueWithAmortization,
      roundProjectMoney(
        report.economicAnalysis.pricingItems.reduce(
          (acc, row) => acc + (row.revenueWithAmortization ?? 0),
          0
        )
      )
    );
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
