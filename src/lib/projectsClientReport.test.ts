import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildMinimalPdfDocument } from "./minimalPdfWriter.js";
import {
  assertProjectClientReportPayloadIsSafe,
  applyProjectClientReportQuantities,
  buildProjectClientReport,
  buildProjectClientReportProducts,
  clientReportPdfContainsInternalTerms,
  recalculateProjectClientReportProduct,
} from "./projectsClientReport.js";
import { buildProjectClientReportPdfBuffer } from "./projectsClientReportService.js";
import {
  buildProjectClientProposalPptxBuffer,
  buildProjectClientProposalPptxFilename,
} from "./projectsClientReportPptx.js";
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

  it("gera PPTX cliente válido a partir do payload da proposta", async () => {
    const report = buildProjectClientReport(buildDetailWithPricing());
    const buffer = await buildProjectClientProposalPptxBuffer(report);
    assert.ok(buffer.length > 1000);
    assert.equal(buffer[0], 0x50);
    assert.equal(buffer[1], 0x4b);
    assert.equal(buildProjectClientProposalPptxFilename("PRJ-0100"), "proposta-cliente-PRJ-0100.pptx");
  });

  it("PPTX não quebra com projeto sem alguns dados comerciais", async () => {
    const detail = buildDetailWithPricing();
    detail.notes = "";
    detail.commercialOwner = "";
    detail.expectedMonthlyVolume = null;
    detail.projectPricing!.items = detail.projectPricing!.items.map((item) => ({
      ...item,
      suggestedPrice: null,
      status: "PENDING",
      statusLabel: "Pendente",
    }));
    const report = buildProjectClientReport(detail);
    const buffer = await buildProjectClientProposalPptxBuffer(report);
    assert.ok(buffer.length > 1000);
    assert.equal(buffer[0], 0x50);
    assert.equal(buffer[1], 0x4b);
  });

  it("quantidade padrão é 1 por item", () => {
    const detail = buildDetailWithPricing();
    const products = buildProjectClientReportProducts(detail);
    assert.equal(products.every((product) => product.quantityPerSet === 1), true);
  });

  it("editar quantidade recalcula preço total sem alterar preço unitário", () => {
    const detail = buildDetailWithPricing();
    const report = buildProjectClientReport(detail);
    const product = report.products[0]!;
    const updated = recalculateProjectClientReportProduct(product, 2);
    assert.equal(updated.finalUnitPrice, 3.2);
    assert.equal(updated.finalTotalPrice, 6.4);
    assert.equal(updated.quantityPerSet, 2);
  });

  it("quantidades editadas recalculam preço final do conjunto", () => {
    const report = buildProjectClientReport(buildDetailWithPricing());
    const productA = report.products[0]!.id;
    const productB = report.products[1]!.id;
    const updated = applyProjectClientReportQuantities(report, {
      [productA]: 1,
      [productB]: 2,
    });
    assert.equal(updated.products[1]?.finalTotalPrice, 9.6);
    assert.equal(updated.summary.finalSetPrice, 12.8);
    assert.equal(updated.summary.totalProposalValue, 12800);
  });

  it("PDF inclui quantidade editada", () => {
    const report = applyProjectClientReportQuantities(buildProjectClientReport(buildDetailWithPricing()), {
      [buildDetailWithPricing().simulatedProducts[1]!.id]: 2,
    });
    const buffer = buildProjectClientReportPdfBuffer(report);
    const text = buffer.toString("latin1");
    assert.match(text, /Qtd 2/);
    assert.match(text, /Total R\$/);
  });

  it("ProjectClientReportPage permite editar Qtd/conjunto", () => {
    const page = readFileSync(
      join(process.cwd(), "src/components/projects/ProjectClientReportPage.tsx"),
      "utf8"
    );
    assert.match(page, /client-report\/quantities/);
    assert.match(page, /applyProjectClientReportQuantities/);
    assert.match(page, /Salvar quantidades/);
    assert.match(page, /client-proposal-pptx/);
    assert.match(page, /Baixar PowerPoint/);
    const report = readFileSync(
      join(process.cwd(), "src/components/projects/ProjectClientReport.tsx"),
      "utf8"
    );
    assert.match(report, /Qtd\/conjunto/);
    assert.match(report, /Edite a quantidade de cada item no conjunto/);
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
    assert.match(routes, /client-proposal-pptx/);
    assert.match(routes, /client-report\/quantities/);
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
