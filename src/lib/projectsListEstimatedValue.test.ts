import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeProjectGuidedCosts, resolveProjectEstimatedTotalCost } from "./projectsGuidedFlow.js";
import {
  computeProjectListEstimatedValue,
  computeSeparateMoldInvestment,
  serializeProjectListRow,
} from "./projectsService.js";
import { buildOtherCostNotes } from "./projectsOtherCostGroups.js";
import type { ProjectDetail } from "@/src/types/projects.js";

function minimalDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: "p1",
    code: "PRJ-00008",
    title: "IRIS",
    customerName: "Cliente",
    customerDocument: null,
    description: null,
    projectType: "NEW_PRODUCT",
    status: "DRAFT",
    commercialOwner: null,
    technicalOwner: null,
    expectedMonthlyVolume: null,
    targetPrice: null,
    targetMarginPercent: null,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    currentVersion: null,
    versions: [],
    simulatedProducts: [],
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
      suggestedPrice: null,
      markupPercent: null,
      targetPrice: null,
      priceGap: null,
    },
    alerts: [],
    conversionAvailable: false,
    ...overrides,
  };
}

describe("projectsListEstimatedValue", () => {
  it("listagem usa mesma base da aba Custos do Projeto (totalProjectCost)", () => {
    const detail = minimalDetail({
      costBreakdown: {
        rawMaterialCost: 10,
        componentCost: 2.5,
        serviceCost: 0,
        packagingCost: 0,
        separateMoldCost: 85000,
        amortizedMoldCostPerUnit: 0,
        unitCost: 12.5,
        targetMarginPercent: null,
        suggestedPrice: null,
        markupPercent: null,
        targetPrice: null,
        priceGap: null,
      },
      simulatedItems: [
        {
          id: "oc1",
          provisionalCode: "OC-1",
          description: "Frete",
          itemType: "OTHER",
          unit: "UN",
          estimatedUnitCost: 4500,
          quotedUnitCost: null,
          supplierName: null,
          leadTimeDays: null,
          estimatedWeight: null,
          lossPercent: 0,
          requiresQuotation: false,
          requiresEngineeringReview: false,
          canBecomeOfficial: true,
          notes: buildOtherCostNotes("OTHER", "batch-1"),
        },
      ],
    });

    const guided = computeProjectGuidedCosts(detail);
    const fromResolver = resolveProjectEstimatedTotalCost(
      detail.costBreakdown,
      detail.simulatedItems
    );
    assert.equal(fromResolver, guided.totalProjectCost);
    assert.equal(fromResolver, 12.5 + 85000 + 4500);
  });

  it("projeto com custo snapshot exibe valor estimado mesmo sem suggestedPrice", async () => {
    const row = await serializeProjectListRow({
      id: "p-iris",
      code: "PRJ-00008",
      title: "IRIS",
      customerName: "Cliente",
      projectType: "NEW_PRODUCT",
      status: "DRAFT",
      commercialOwner: null,
      technicalOwner: null,
      description: null,
      customerDocument: null,
      expectedMonthlyVolume: null,
      targetPrice: null,
      targetMarginPercent: null,
      notes: null,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-06-01"),
      versions: [
        {
          id: "v1",
          projectId: "p-iris",
          versionNumber: 1,
          title: "Versão 1",
          status: "DRAFT",
          assumptionsJson: null,
          totalEstimatedCost: 12.5,
          totalMoldCost: 85000,
          totalAmortizedMoldCost: null,
          unitCost: 12.5,
          suggestedPrice: null,
          marginPercent: null,
          markupPercent: null,
          expectedVolume: null,
          notes: null,
          isCurrent: true,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-06-01"),
          molds: [
            {
              id: "m1",
              projectId: "p-iris",
              versionId: "v1",
              name: "Molde",
              moldType: null,
              constructionCost: 85000,
              chargeMode: "CHARGED_SEPARATELY",
              amortizationQuantity: null,
              amortizedCostPerUnit: null,
              ownership: "COMPANY",
              notes: null,
              createdAt: new Date("2026-01-01"),
              updatedAt: new Date("2026-06-01"),
            },
          ],
          simulatedItems: [
            {
              id: "oc1",
              projectId: "p-iris",
              versionId: "v1",
              provisionalCode: "OC-1",
              description: "Frete",
              itemType: "OTHER",
              unit: "UN",
              estimatedUnitCost: 4500,
              quotedUnitCost: null,
              supplierName: null,
              leadTimeDays: null,
              estimatedWeight: null,
              lossPercent: 0,
              requiresQuotation: false,
              requiresEngineeringReview: false,
              canBecomeOfficial: true,
              notes: buildOtherCostNotes("OTHER", "batch-1"),
              createdAt: new Date("2026-01-01"),
              updatedAt: new Date("2026-06-01"),
            },
          ],
        },
      ],
    } as never);

    assert.equal(row.estimatedValue, 12.5 + 85000 + 4500);
  });

  it("projeto sem custo retorna null (UI: Sem custo estimado)", () => {
    const value = computeProjectListEstimatedValue({
      id: "v-empty",
      projectId: "p-empty",
      versionNumber: 1,
      title: null,
      status: "DRAFT",
      assumptionsJson: null,
      totalEstimatedCost: null,
      totalMoldCost: null,
      totalAmortizedMoldCost: null,
      unitCost: null,
      suggestedPrice: null,
      marginPercent: null,
      markupPercent: null,
      expectedVolume: null,
      notes: null,
      isCurrent: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      molds: [],
      simulatedItems: [],
    });
    assert.equal(value, null);
  });

  it("valor zero real retorna 0, não null", () => {
    const value = computeProjectListEstimatedValue({
      id: "v-zero",
      projectId: "p-zero",
      versionNumber: 1,
      title: null,
      status: "DRAFT",
      assumptionsJson: null,
      totalEstimatedCost: null,
      totalMoldCost: null,
      totalAmortizedMoldCost: null,
      unitCost: 0,
      suggestedPrice: null,
      marginPercent: null,
      markupPercent: null,
      expectedVolume: null,
      notes: null,
      isCurrent: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      molds: [],
      simulatedItems: [],
    } as never);
    assert.equal(value, 0);
  });

  it("computeSeparateMoldInvestment considera apenas moldes cobrados separadamente", () => {
    const separate = computeSeparateMoldInvestment([
      { chargeMode: "CHARGED_SEPARATELY", constructionCost: 1000 },
      { chargeMode: "AMORTIZED_IN_PRODUCT", constructionCost: 5000 },
    ] as never);
    assert.equal(separate, 1000);
  });

  it("não retorna NaN/Infinity", () => {
    const value = resolveProjectEstimatedTotalCost(
      { unitCost: Number.NaN, separateMoldCost: Number.POSITIVE_INFINITY },
      []
    );
    assert.equal(Number.isFinite(value), true);
  });
});
