import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildMinimalPdfDocument } from "./minimalPdfWriter.js";
import {
  assertProjectClientReportPayloadIsSafe,
  buildProjectClientReport,
  buildProjectClientReportProducts,
  clientReportPdfContainsInternalTerms,
} from "./projectsClientReport.js";
import { buildProjectClientReportPdfBuffer } from "./projectsClientReportService.js";
import type { ProjectDetail } from "@/src/types/projects.js";

function buildDetailWithPricing(): ProjectDetail {
  const productA = "aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa";
  const productB = "bbbbbbbb-bbbb-4111-8111-bbbbbbbbbbbb";
  return {
    id: "dddddddd-dddd-4111-8111-dddddddddddd",
    code: "PRJ-0100",
    title: "Conjunto Tampa + Base",
    customerName: "Cliente Teste SA",
    customerDocument: null,
    description: "Projeto comercial",
    projectType: "NEW_PRODUCT",
    status: "WAITING_QUOTATION",
    commercialOwner: "Comercial A",
    technicalOwner: "Tecnico B",
    expectedMonthlyVolume: 1000,
    targetPrice: null,
    targetMarginPercent: null,
    notes: "Entrega conforme cronograma acordado.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    currentVersion: null,
    versions: [],
    simulatedProducts: [
      {
        id: productA,
        provisionalCode: "PEC-A",
        description: "Tampa superior",
        unit: "UN",
        estimatedWeight: null,
        expectedVolume: 1,
        batchSize: null,
        notes: null,
      },
      {
        id: productB,
        provisionalCode: "PEC-B",
        description: "Base inferior",
        unit: "UN",
        estimatedWeight: null,
        expectedVolume: 1,
        batchSize: null,
        notes: null,
      },
    ],
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
    projectPricing: {
      config: { fiscalRuleId: null, defaultMarginPercent: null },
      taxRules: [],
      hasSavedPricing: true,
      items: [
        {
          targetItemId: productA,
          targetItemType: "SIMULATION",
          displayName: "Tampa superior",
          costBaseUnit: 2,
          amortizationUnitCost: 0.2,
          finalUnitCost: 2.2,
          fiscalRuleId: null,
          fiscalRuleName: null,
          taxPercent: 0,
          targetMarginPercent: 30,
          suggestedPrice: 3.2,
          taxAmount: 0,
          marginAmount: 1,
          status: "CALCULATED",
          statusLabel: "Calculado",
          errorMessage: null,
        },
        {
          targetItemId: productB,
          targetItemType: "SIMULATION",
          displayName: "Base inferior",
          costBaseUnit: 3,
          amortizationUnitCost: 0.8,
          finalUnitCost: 3.8,
          fiscalRuleId: null,
          fiscalRuleName: null,
          taxPercent: 0,
          targetMarginPercent: 30,
          suggestedPrice: 4.8,
          taxAmount: 0,
          marginAmount: 1,
          status: "CALCULATED",
          statusLabel: "Calculado",
          errorMessage: null,
        },
      ],
    },
  };
}

describe("projectsClientReport", () => {
  it("carrega produtos e preços comerciais finais", () => {
    const detail = buildDetailWithPricing();
    const products = buildProjectClientReportProducts(detail);
    assert.equal(products.length, 2);
    assert.equal(products[0]?.finalUnitPrice, 3.2);
    assert.equal(products[1]?.finalUnitPrice, 4.8);
    assert.equal(products[0]?.finalTotalPrice, 3.2);
    assert.equal(products[1]?.finalTotalPrice, 4.8);
  });

  it("calcula preço final do conjunto com mais de um produto", () => {
    const detail = buildDetailWithPricing();
    const report = buildProjectClientReport(detail);
    assert.equal(report.summary.finalSetPrice, 8);
    assert.equal(report.summary.finalSetPriceLabel, "Preço final do conjunto");
    assert.equal(report.summary.totalProposalValue, 8000);
  });

  it("usa preço final da peça quando há um produto", () => {
    const detail = buildDetailWithPricing();
    detail.simulatedProducts = detail.simulatedProducts.slice(0, 1);
    detail.projectPricing!.items = detail.projectPricing!.items.slice(0, 1);
    const report = buildProjectClientReport(detail);
    assert.equal(report.summary.productsCount, 1);
    assert.equal(report.summary.finalSetPriceLabel, "Preço final da peça");
    assert.equal(report.summary.finalSetPrice, 3.2);
  });

  it("endpoint payload não expõe campos internos de custo", () => {
    const report = buildProjectClientReport(buildDetailWithPricing());
    assertProjectClientReportPayloadIsSafe(report);
    const serialized = JSON.stringify(report).toLowerCase();
    assert.doesNotMatch(serialized, /costbaseunit/);
    assert.doesNotMatch(serialized, /finalunitcost/);
    assert.doesNotMatch(serialized, /marginamount/);
    assert.doesNotMatch(serialized, /markup/);
  });

  it("gera PDF cliente válido sem termos internos no corpo", () => {
    const report = buildProjectClientReport(buildDetailWithPricing());
    const buffer = buildProjectClientReportPdfBuffer(report);
    assert.ok(buffer.length > 100);
    assert.match(buffer.toString("utf8", 0, 8), /^%PDF-1.4/);
    assert.equal(clientReportPdfContainsInternalTerms(buffer.toString("latin1")), false);
  });

  it("minimal PDF writer gera arquivo PDF", () => {
    const buffer = buildMinimalPdfDocument({ title: "Teste", lines: ["Linha 1"] });
    assert.match(buffer.toString("utf8", 0, 8), /^%PDF-1.4/);
  });
});

describe("projectsClientReport wiring", () => {
  it("botão Proposta Cliente no detalhe do projeto", () => {
    const moduleSrc = readFileSync(
      join(process.cwd(), "src/components/ProjectsModule.tsx"),
      "utf8"
    );
    assert.match(moduleSrc, /ProjectClientReportButton/);
  });

  it("relatório gerencial interno permanece intacto", () => {
    const moduleSrc = readFileSync(
      join(process.cwd(), "src/components/ProjectsModule.tsx"),
      "utf8"
    );
    assert.match(moduleSrc, /ProjectExecutiveReportButton/);
    const routes = readFileSync(join(process.cwd(), "src/lib/projectsRoutes.ts"), "utf8");
    assert.match(routes, /client-report/);
    assert.match(routes, /client-report\.pdf/);
  });

  it("UI cliente não importa Prisma", () => {
    for (const file of [
      "src/components/projects/ProjectClientReport.tsx",
      "src/components/projects/ProjectClientReportPage.tsx",
      "src/components/projects/ProjectClientReportButton.tsx",
    ]) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /lib\/prisma/);
    }
  });
});
