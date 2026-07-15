import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildProjectCostAmortizationSummary,
  computeAmortizationConfig,
  roundProjectMoney,
} from "./projectsCostAmortization.js";
import { buildOtherCostNotes } from "./projectsOtherCostGroups.js";
import { canViewProjects } from "./projectsPermissions.js";
import {
  buildProjectExecutiveReport,
  executiveReportMetricsAreFinite,
  getProjectExecutiveReportPath,
  isProjectExecutiveReportPath,
  PROJECT_EXECUTIVE_REPORT_BUTTON_LABEL,
  PROJECT_EXECUTIVE_REPORT_NOT_INFORMED,
} from "./projectsExecutiveReport.js";
import { ProjectExecutiveReport } from "@/src/components/projects/ProjectExecutiveReport";
import type { ProjectDetail } from "@/src/types/projects.js";

const MOLD_TOTAL = 52_000;
const OTHER_COST_BATCH_ID = "other-cost-batch-11111111-1111-1111-1111-111111111111";
const OTHER_COST_TOTAL = 5_075;

function buildDetailFixture(): ProjectDetail {
  const itemA = "aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa";
  const itemB = "bbbbbbbb-bbbb-4111-8111-bbbbbbbbbbbb";
  const moldId = "cccccccc-cccc-4111-8111-cccccccccccc";
  return {
    id: "dddddddd-dddd-4111-8111-dddddddddddd",
    code: "PRJ-0008",
    title: "IRIS",
    customerName: "Esmaltec S/A",
    customerDocument: null,
    description: "Desenvolvimento da linha IRIS.",
    projectType: "NEW_PRODUCT",
    status: "WAITING_INTERNAL_APPROVAL",
    commercialOwner: "José Eduardo",
    technicalOwner: "Eng. Técnico",
    expectedMonthlyVolume: null,
    targetPrice: null,
    targetMarginPercent: null,
    notes: "Observação geral do projeto.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    currentVersion: {
      id: "v1",
      versionNumber: 2,
      title: "Revisão comercial",
      status: "WAITING_INTERNAL_APPROVAL",
      isCurrent: true,
      unitCost: 11.5,
      suggestedPrice: null,
      marginPercent: null,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
    versions: [],
    simulatedProducts: [],
    simulatedItems: [
      {
        id: itemA,
        provisionalCode: "A",
        description: "Haste IRIS",
        itemType: "COMPONENT",
        unit: "UN",
        estimatedUnitCost: 3,
        quotedUnitCost: null,
        supplierName: null,
        leadTimeDays: null,
        estimatedWeight: null,
        lossPercent: 0,
        requiresQuotation: false,
        requiresEngineeringReview: false,
        canBecomeOfficial: false,
        notes: "guided-origin:SIMULATION\nguided-simulation-id:11111111-1111-1111-1111-111111111111",
      },
      {
        id: itemB,
        provisionalCode: "B",
        description: "Torneira IRIS",
        itemType: "COMPONENT",
        unit: "UN",
        estimatedUnitCost: 8.5,
        quotedUnitCost: null,
        supplierName: null,
        leadTimeDays: null,
        estimatedWeight: null,
        lossPercent: 0,
        requiresQuotation: false,
        requiresEngineeringReview: false,
        canBecomeOfficial: false,
        notes: null,
      },
    ],
    structureLines: [],
    molds: [
      {
        id: moldId,
        name: "Molde da Haste",
        moldType: "Novo",
        cavities: 1,
        estimatedLifeCycles: null,
        supplierName: null,
        constructionCost: MOLD_TOTAL,
        maintenanceCost: null,
        changeCost: null,
        leadTimeDays: null,
        chargeMode: "CHARGED_SEPARATELY",
        amortizationQuantity: null,
        amortizedCostPerUnit: null,
        ownership: "UNDEFINED",
        notes: "Molde principal",
      },
    ],
    snapshotRootProducts: {},
    costBreakdown: {
      rawMaterialCost: 0,
      componentCost: 11.5,
      serviceCost: 0,
      packagingCost: 0,
      separateMoldCost: MOLD_TOTAL,
      amortizedMoldCostPerUnit: 0,
      unitCost: 11.5,
      targetMarginPercent: null,
      suggestedPrice: null,
      markupPercent: null,
      targetPrice: null,
      priceGap: null,
    },
    alerts: [],
    conversionAvailable: false,
  };
}

function buildDetailWithOtherCostFixture(): ProjectDetail {
  const detail = buildDetailFixture();
  return {
    ...detail,
    simulatedItems: [
      ...detail.simulatedItems,
      {
        id: "eeeeeeee-eeee-4111-8111-eeeeeeeeeeee",
        provisionalCode: null,
        description: "Projeto 3d",
        itemType: "OTHER",
        unit: "UN",
        estimatedUnitCost: OTHER_COST_TOTAL,
        quotedUnitCost: null,
        supplierName: "Fornecedor X",
        leadTimeDays: null,
        estimatedWeight: null,
        lossPercent: 0,
        requiresQuotation: false,
        requiresEngineeringReview: false,
        canBecomeOfficial: false,
        notes: buildOtherCostNotes("OTHER", OTHER_COST_BATCH_ID, {
          quantity: 1,
          unitCost: OTHER_COST_TOTAL,
        }),
      },
    ],
    costBreakdown: {
      ...detail.costBreakdown,
      separateMoldCost: MOLD_TOTAL,
      unitCost: detail.costBreakdown.unitCost,
    },
  };
}

function buildSavedAmortization(detail: ProjectDetail) {
  const mold = detail.molds[0]!;
  const targets = [
    {
      targetItemId: detail.simulatedItems[0]!.id,
      targetItemType: "SIMULATION" as const,
      displayName: "Haste IRIS",
      displayCode: "A",
      baseUnitCost: 3,
      suggestedQuantity: 20_000,
      entityKind: "simulation_ref" as const,
    },
    {
      targetItemId: detail.simulatedItems[1]!.id,
      targetItemType: "LEGACY" as const,
      displayName: "Torneira IRIS",
      displayCode: "B",
      baseUnitCost: 8.5,
      suggestedQuantity: 10_000,
      entityKind: "product" as const,
    },
  ];
  const computed = computeAmortizationConfig(
    {
      sourceType: "MOLD",
      sourceId: mold.id,
      sourceDescriptionSnapshot: mold.name,
      sourceTotalCostSnapshot: MOLD_TOTAL,
      passThroughPercent: 80,
      allocations: [
        {
          targetItemId: targets[0]!.targetItemId,
          targetItemType: "SIMULATION",
          targetDescriptionSnapshot: "Haste IRIS",
          targetBaseUnitCostSnapshot: 3,
          allocationPercent: 60,
          amortizationQuantity: 20_000,
        },
        {
          targetItemId: targets[1]!.targetItemId,
          targetItemType: "LEGACY",
          targetDescriptionSnapshot: "Torneira IRIS",
          targetBaseUnitCostSnapshot: 8.5,
          allocationPercent: 40,
          amortizationQuantity: 10_000,
        },
      ],
    },
    targets
  );
  return [
    {
      id: "amort-1",
      projectId: detail.id,
      ...computed,
    },
  ];
}

describe("projectsExecutiveReport — montagem", () => {
  it("monta cabeçalho com código, nome, cliente e status do projeto", () => {
    const detail = buildDetailFixture();
    const report = buildProjectExecutiveReport(detail, {
      generatedAt: new Date("2026-06-15T12:00:00.000Z"),
    });
    assert.equal(report.project.code, "PRJ-0008");
    assert.equal(report.project.name, "IRIS");
    assert.equal(report.project.customerName, "Esmaltec S/A");
    assert.equal(report.project.statusLabel, "Aguardando aprovação interna");
    assert.equal(report.project.commercialOwner, "José Eduardo");
  });

  it("calcula investimento total = moldes + outros custos", () => {
    const report = buildProjectExecutiveReport(buildDetailWithOtherCostFixture());
    assert.equal(report.executiveSummary.moldsTotal, MOLD_TOTAL);
    assert.equal(report.executiveSummary.otherCostsTotal, OTHER_COST_TOTAL);
    assert.equal(report.executiveSummary.investmentTotal, MOLD_TOTAL + OTHER_COST_TOTAL);
  });

  it("usa custo base dos itens sem incluir matéria-prima como item principal", () => {
    const detail = buildDetailFixture();
    detail.simulatedItems.push({
      id: "mp1",
      provisionalCode: "MP-1",
      description: "Polímero",
      itemType: "RAW_MATERIAL",
      unit: "KG",
      estimatedUnitCost: 12,
      quotedUnitCost: null,
      supplierName: null,
      leadTimeDays: null,
      estimatedWeight: null,
      lossPercent: 0,
      requiresQuotation: false,
      requiresEngineeringReview: false,
      canBecomeOfficial: false,
      notes: null,
    });
    const report = buildProjectExecutiveReport(detail);
    assert.equal(report.items.length, 2);
    assert.equal(report.items.some((item) => item.name === "Polímero"), false);
    assert.equal(report.executiveSummary.baseItemsCost, 11.5);
  });

  it("inclui moldes no resumo", () => {
    const report = buildProjectExecutiveReport(buildDetailFixture());
    assert.equal(report.molds.length, 1);
    assert.equal(report.molds[0]?.totalCost, MOLD_TOTAL);
  });

  it("inclui outros custos no resumo", () => {
    const report = buildProjectExecutiveReport(buildDetailWithOtherCostFixture());
    assert.equal(report.otherCosts.length, 1);
    assert.equal(report.otherCosts[0]?.batchId, OTHER_COST_BATCH_ID);
    assert.equal(report.otherCosts[0]?.totalCost, OTHER_COST_TOTAL);
  });

  it("inclui amortização de moldes", () => {
    const detail = {
      ...buildDetailFixture(),
      costAmortizations: buildSavedAmortization(buildDetailFixture()),
    };
    const report = buildProjectExecutiveReport(detail);
    assert.ok(report.amortizationMemory.some((row) => row.sourceLabel === "Molde da Haste"));
    assert.equal(report.executiveSummary.amortizedToCustomer, 41_600);
  });

  it("inclui amortização de outros custos com sourceId other-cost-batch", () => {
    const detail = buildDetailWithOtherCostFixture();
    const targetA = detail.simulatedItems[0]!.id;
    const report = buildProjectExecutiveReport({
      ...detail,
      costAmortizations: [
        {
          id: "oc-amort",
          projectId: detail.id,
          sourceType: "OTHER_COST",
          sourceId: OTHER_COST_BATCH_ID,
          sourceDescriptionSnapshot: "Projeto 3d",
          sourceTotalCostSnapshot: OTHER_COST_TOTAL,
          passThroughPercent: 100,
          passThroughAmount: OTHER_COST_TOTAL,
          absorbedAmount: 0,
          status: "DISTRIBUTED",
          distributionPercentTotal: 100,
          distributionBalancePercent: 0,
          allocatedAmountTotal: OTHER_COST_TOTAL,
          unallocatedAmount: 0,
          allocations: [
            {
              targetItemId: targetA,
              targetItemType: "SIMULATION",
              targetDescriptionSnapshot: "Haste IRIS",
              targetBaseUnitCostSnapshot: 3,
              allocationPercent: 100,
              amortizationQuantity: 1000,
              allocatedAmount: OTHER_COST_TOTAL,
              unitAmortizedCost: 5.075,
              finalUnitCost: 8.075,
            },
          ],
        },
      ],
    });
    assert.ok(
      report.amortizationMemory.some(
        (row) => row.sourceTypeLabel === "Outro custo" && row.allocatedAmount === OTHER_COST_TOTAL
      )
    );
  });

  it("calcula valor repassado via amortização", () => {
    const detail = {
      ...buildDetailFixture(),
      costAmortizations: buildSavedAmortization(buildDetailFixture()),
    };
    const report = buildProjectExecutiveReport(detail);
    assert.equal(report.executiveSummary.amortizedToCustomer, 41_600);
  });

  it("calcula valor absorvido internamente", () => {
    const detail = {
      ...buildDetailFixture(),
      costAmortizations: buildSavedAmortization(buildDetailFixture()),
    };
    const report = buildProjectExecutiveReport(detail);
    assert.equal(report.executiveSummary.absorbedInternally, 10_400);
  });

  it("não duplica valor amortizado no custo total do projeto", () => {
    const detail = {
      ...buildDetailWithOtherCostFixture(),
      costAmortizations: buildSavedAmortization(buildDetailFixture()),
    };
    const report = buildProjectExecutiveReport(detail);
    assert.equal(report.executiveSummary.totalProjectCost, 11.5 + MOLD_TOTAL + OTHER_COST_TOTAL);
    assert.notEqual(report.executiveSummary.totalProjectCost, report.executiveSummary.finalItemsCost);
  });

  it("inclui memória de amortização", () => {
    const detail = {
      ...buildDetailFixture(),
      costAmortizations: buildSavedAmortization(buildDetailFixture()),
    };
    const report = buildProjectExecutiveReport(detail);
    assert.equal(report.amortizationMemory.length, 2);
    assert.equal(report.amortizationMemory[0]?.unitAmortizedCost, 1.248);
  });

  it("gera alerta para item sem custo", () => {
    const detail = buildDetailFixture();
    detail.simulatedItems[1]!.estimatedUnitCost = 0;
    const report = buildProjectExecutiveReport(detail);
    assert.ok(report.alerts.some((alert) => alert.code === "ITEM_NO_COST"));
  });

  it("gera alerta para amortização incompleta", () => {
    const detail = buildDetailFixture();
    const mold = detail.molds[0]!;
    const itemA = detail.simulatedItems[0]!.id;
    const report = buildProjectExecutiveReport({
      ...detail,
      costAmortizations: [
        {
          id: "amort-1",
          projectId: detail.id,
          sourceType: "MOLD",
          sourceId: mold.id,
          sourceDescriptionSnapshot: mold.name,
          sourceTotalCostSnapshot: MOLD_TOTAL,
          passThroughPercent: 80,
          passThroughAmount: 41_600,
          absorbedAmount: 10_400,
          status: "INCOMPLETE",
          distributionPercentTotal: 60,
          distributionBalancePercent: 40,
          allocatedAmountTotal: 24_960,
          unallocatedAmount: 16_640,
          allocations: [
            {
              targetItemId: itemA,
              targetItemType: "SIMULATION",
              targetDescriptionSnapshot: "Haste IRIS",
              targetBaseUnitCostSnapshot: 3,
              allocationPercent: 60,
              amortizationQuantity: 20_000,
              allocatedAmount: 24_960,
              unitAmortizedCost: 1.248,
              finalUnitCost: 4.248,
            },
          ],
        },
      ],
    });
    assert.ok(report.alerts.some((alert) => alert.code === "INCOMPLETE_AMORTIZATION"));
  });

  it("se não houver preço/margem, mostra análise comercial pendente", () => {
    const report = buildProjectExecutiveReport(buildDetailFixture());
    assert.equal(report.economicAnalysis.pending, true);
    assert.match(report.economicAnalysis.message, /pendente/i);
  });

  it("resultado econômico calcula retorno da amortização por produto", () => {
    const detail = buildDetailFixture();
    // Precificação comercial considera apenas SIMULATION.
    detail.simulatedItems[1]!.notes =
      "guided-origin:SIMULATION\nguided-simulation-id:22222222-2222-2222-2222-222222222222";
    detail.costAmortizations = buildSavedAmortization(detail);
    detail.projectPricing = {
      config: { fiscalRuleId: "tax-0", defaultMarginPercent: 30 },
      taxRules: [{ id: "tax-0", name: "Zerada", description: null, taxPercent: 0 }],
      hasSavedPricing: true,
      items: detail.simulatedItems.map((item) => ({
        targetItemId: item.id,
        targetItemType: "SIMULATION" as const,
        displayName: item.description,
        costBaseUnit: item.estimatedUnitCost,
        amortizationUnitCost: 0,
        finalUnitCost: item.estimatedUnitCost,
        fiscalRuleId: "tax-0",
        fiscalRuleName: "Zerada",
        taxPercent: 0,
        targetMarginPercent: 30,
        suggestedPrice: null,
        suggestedPriceWithoutAmortization: null,
        suggestedPriceWithAmortization: null,
        taxAmount: null,
        marginAmount: null,
        status: "PENDING",
        statusLabel: "Pendente",
        errorMessage: null,
      })),
    };

    const report = buildProjectExecutiveReport(detail);
    assert.equal(report.economicAnalysis.pending, false);
    assert.equal(report.economicAnalysis.pricingItems.length, 2);

    for (const row of report.economicAnalysis.pricingItems) {
      assert.ok(row.quantity >= 1);
      assert.ok(row.suggestedPriceWithAmortization != null);
      assert.ok(row.suggestedPriceWithoutAmortization != null);
      assert.equal(
        row.amortizationReturn,
        roundProjectMoney(
          row.quantity *
            ((row.suggestedPriceWithAmortization ?? 0) -
              (row.suggestedPriceWithoutAmortization ?? 0))
        )
      );
      assert.equal(
        row.revenueWithAmortization,
        roundProjectMoney(row.quantity * (row.suggestedPriceWithAmortization ?? 0))
      );
      assert.ok((row.amortizationReturn ?? 0) > 0);
    }

    assert.equal(
      report.economicAnalysis.portfolio.totalAmortizationReturn,
      roundProjectMoney(
        report.economicAnalysis.pricingItems.reduce(
          (acc, row) => acc + (row.amortizationReturn ?? 0),
          0
        )
      )
    );
    assert.equal(report.economicAnalysis.finalUnitCost, null);
  });

  it("não retorna NaN/Infinity", () => {
    const report = buildProjectExecutiveReport(buildDetailFixture());
    assert.equal(executiveReportMetricsAreFinite(report), true);
  });
});

describe("projectsExecutiveReport — UI/rota", () => {
  const checker = (perms: string[]) => {
    const set = new Set(perms);
    return {
      hasPermission: (p: string) => set.has(p),
      hasAnyPermission: (list: string[]) => list.some((p) => set.has(p)),
    };
  };

  it("botão Gerar relatório gerencial aparece no projeto", () => {
    const mod = readFileSync(
      join(process.cwd(), "src", "components", "ProjectsModule.tsx"),
      "utf8"
    );
    const button = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectExecutiveReportButton.tsx"),
      "utf8"
    );
    assert.match(mod, /ProjectExecutiveReportButton/);
    assert.match(button, /PROJECT_EXECUTIVE_REPORT_BUTTON_LABEL/);
  });

  it("botão aparece na aba Custos do Projeto", () => {
    const tab = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectGuidedCostsTab.tsx"),
      "utf8"
    );
    assert.match(tab, /ProjectExecutiveReportButton/);
  });

  it("rota /projects/:projectId/report existe", () => {
    const app = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    assert.match(app, /projects\/:projectId\/report/);
    assert.match(app, /ProjectExecutiveReportPage/);
    assert.equal(getProjectExecutiveReportPath("abc"), "/projects/abc/report");
    assert.equal(isProjectExecutiveReportPath("/projects/abc/report"), true);
  });

  it("relatório renderiza seções principais", () => {
    const report = buildProjectExecutiveReport(buildDetailFixture());
    const html = renderToStaticMarkup(
      React.createElement(ProjectExecutiveReport, { report })
    );
    assert.match(html, /Relatório Gerencial de Projeto/);
    assert.match(html, /Resumo executivo financeiro/);
    assert.match(html, /Decisão solicitada/);
    assert.match(html, /Itens do projeto/);
    assert.match(html, /Memória de amortização/);
  });

  it("botão Imprimir aparece na tela", () => {
    const controls = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectExecutiveReportPrintControls.tsx"),
      "utf8"
    );
    const page = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectExecutiveReportPage.tsx"),
      "utf8"
    );
    assert.match(controls, /Imprimir \/ Salvar PDF/);
    assert.match(page, /window\.print/);
  });

  it("botões de ação têm classe print:hidden", () => {
    const controls = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectExecutiveReportPrintControls.tsx"),
      "utf8"
    );
    assert.match(controls, /print:hidden/);
  });

  it("menu lateral/header não aparecem no print", () => {
    const css = readFileSync(
      join(process.cwd(), "src", "project-executive-report-print.css"),
      "utf8"
    );
    assert.match(css, /project-executive-report-print-no-print/);
    assert.match(css, /body\.project-executive-report-route/);
  });

  it("impressão usa A4 retrato e grade de cards como na tela", () => {
    const css = readFileSync(
      join(process.cwd(), "src", "project-executive-report-print.css"),
      "utf8"
    );
    const page = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectExecutiveReportPage.tsx"),
      "utf8"
    );
    const reportUi = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectExecutiveReport.tsx"),
      "utf8"
    );
    assert.match(css, /size:\s*A4 portrait/);
    assert.match(css, /project-executive-report-kpi-grid/);
    assert.match(css, /grid-template-columns:\s*repeat\(3/);
    assert.match(page, /data-project-executive-report-print-page/);
    assert.match(page, /A4 portrait/);
    assert.match(reportUi, /project-executive-report-kpi-grid/);
    assert.match(reportUi, /project-executive-report-card/);
  });

  it("relatório não mostra matéria-prima como item principal", () => {
    const detail = buildDetailFixture();
    detail.simulatedItems.push({
      id: "mp1",
      provisionalCode: "MP-1",
      description: "Polímero",
      itemType: "RAW_MATERIAL",
      unit: "KG",
      estimatedUnitCost: 12,
      quotedUnitCost: null,
      supplierName: null,
      leadTimeDays: null,
      estimatedWeight: null,
      lossPercent: 0,
      requiresQuotation: false,
      requiresEngineeringReview: false,
      canBecomeOfficial: false,
      notes: null,
    });
    const html = renderToStaticMarkup(
      React.createElement(ProjectExecutiveReport, {
        report: buildProjectExecutiveReport(detail),
      })
    );
    assert.doesNotMatch(html, /Polímero/);
  });

  it("usuário sem permissão não acessa relatório", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectExecutiveReportPage.tsx"),
      "utf8"
    );
    assert.match(page, /canViewProjects/);
    assert.equal(canViewProjects(checker(["projects.view"])), true);
    assert.equal(canViewProjects(checker([])), false);
  });
});
