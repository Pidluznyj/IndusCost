import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildProjectGuidedItems,
  computeProjectGuidedCosts,
  PROJECT_GUIDED_HOME_TITLE,
  PROJECT_GUIDED_MASTER_NOTICE,
} from "./projectsGuidedFlow.js";
import { serializeMoldNotes } from "./projectsMoldCostLines.js";
import { buildOtherCostNotes } from "./projectsOtherCostGroups.js";
import type { ProjectDetail } from "@/src/types/projects.js";

function minimalDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: "p1",
    code: "PRJ-001",
    title: "Smaltec",
    customerName: "Smaltec",
    customerDocument: null,
    description: null,
    projectType: "NEW_PRODUCT",
    status: "DRAFT",
    commercialOwner: null,
    technicalOwner: "Eng.",
    expectedMonthlyVolume: null,
    targetPrice: null,
    targetMarginPercent: 20,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    currentVersion: null,
    versions: [],
    simulatedProducts: [
      {
        id: "sp1",
        provisionalCode: "SMALTEC-X",
        description: "Produto Smaltec X",
        unit: "UN",
        estimatedWeight: null,
        expectedVolume: null,
        batchSize: 100,
        notes: null,
      },
    ],
    simulatedItems: [
      {
        id: "oc1",
        provisionalCode: null,
        description: "Try-out",
        itemType: "OTHER",
        unit: "UN",
        estimatedUnitCost: 2500,
        quotedUnitCost: 2500,
        supplierName: null,
        leadTimeDays: null,
        estimatedWeight: null,
        lossPercent: 0,
        requiresQuotation: false,
        requiresEngineeringReview: false,
        canBecomeOfficial: false,
        notes: buildOtherCostNotes("TEST", "batch-1"),
      },
      {
        id: "oc2",
        provisionalCode: null,
        description: "Envio amostras",
        itemType: "OTHER",
        unit: "UN",
        estimatedUnitCost: 2000,
        quotedUnitCost: 2000,
        supplierName: null,
        leadTimeDays: null,
        estimatedWeight: null,
        lossPercent: 0,
        requiresQuotation: false,
        requiresEngineeringReview: false,
        canBecomeOfficial: false,
        notes: buildOtherCostNotes("FREIGHT", "batch-1"),
      },
    ],
    structureLines: [],
    molds: [
      {
        id: "m1",
        name: "Molde 16 cavidades",
        moldType: "Novo",
        cavities: 16,
        estimatedLifeCycles: null,
        supplierName: null,
        constructionCost: 85000,
        maintenanceCost: null,
        changeCost: null,
        leadTimeDays: null,
        chargeMode: "CHARGED_SEPARATELY",
        amortizationQuantity: null,
        amortizedCostPerUnit: null,
        ownership: "UNDEFINED",
        notes: serializeMoldNotes([
          {
            id: "l1",
            description: "Aço P20",
            lineType: "MATERIAL",
            supplierName: null,
            quantity: 1,
            unit: "UN",
            unitCost: 40000,
            totalCost: 40000,
            notes: null,
          },
          {
            id: "l2",
            description: "Eletroerosão",
            lineType: "EDM",
            supplierName: null,
            quantity: 1,
            unit: "UN",
            unitCost: 45000,
            totalCost: 45000,
            notes: null,
          },
        ]),
      },
    ],
    costBreakdown: {
      rawMaterialCost: 0,
      componentCost: 0,
      serviceCost: 0,
      packagingCost: 0,
      separateMoldCost: 85000,
      amortizedMoldCostPerUnit: 0,
      unitCost: 12.5,
      targetMarginPercent: 20,
      suggestedPrice: 15,
      markupPercent: null,
      targetPrice: null,
      priceGap: null,
    },
    alerts: [],
    conversionAvailable: false,
    ...overrides,
  };
}

describe("projectsGuidedFlow", () => {
  it("lista produtos, moldes e outros custos como itens guiados", () => {
    const items = buildProjectGuidedItems(minimalDetail());
    assert.ok(items.some((i) => i.itemType === "PRODUCT"));
    assert.ok(items.some((i) => i.itemType === "MOLD"));
    assert.ok(items.some((i) => i.itemType === "OTHER_COST"));
  });

  it("separa custo unitário, investimento e outros custos do projeto", () => {
    const costs = computeProjectGuidedCosts(minimalDetail());
    assert.equal(costs.estimatedUnitCost, 12.5);
    assert.equal(costs.initialInvestment, 85000);
    assert.equal(costs.otherProjectCosts, 4500);
    assert.equal(costs.totalProjectCost, 12.5 + 85000 + 4500);
  });

  it("não mistura investimento de molde no custo unitário do produto", () => {
    const costs = computeProjectGuidedCosts(minimalDetail());
    assert.ok(costs.estimatedUnitCost < costs.initialInvestment);
    assert.notEqual(costs.estimatedUnitCost, costs.totalProjectCost);
  });

  it("produto com referência oficial é identificado nas notas", () => {
    const detail = minimalDetail({
      simulatedProducts: [
        {
          id: "sp-ref",
          provisionalCode: "REF-01",
          description: "Produto referência",
          unit: "UN",
          estimatedWeight: null,
          expectedVolume: null,
          batchSize: null,
          notes: "guided-origin:REFERENCE",
        },
      ],
    });
    const items = buildProjectGuidedItems(detail);
    const product = items.find((i) => i.productId === "sp-ref");
    assert.equal(product?.origin, "OFFICIAL_REFERENCE");
  });
});

describe("ProjectsModule UI — fluxo guiado", () => {
  it("tela inicial exibe ações Criar novo produto, Criar molde e Criar outros custos", () => {
    const home = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectHomeAssistant.tsx"),
      "utf8"
    );
    assert.match(home, /Criar novo produto/);
    assert.match(home, /Criar molde/);
    assert.match(home, /Criar outros custos/);
    assert.equal(PROJECT_GUIDED_HOME_TITLE, "Montagem do Projeto");
    assert.match(home, /PROJECT_GUIDED_HOME_TITLE/);
  });

  it("modal de engenharia deixa claro isolamento do cadastro mestre", () => {
    const modal = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectEngineeringItemModal.tsx"),
      "utf8"
    );
    assert.match(modal, /Adicionar item de engenharia ao projeto/);
    assert.match(modal, /PROJECT_GUIDED_MASTER_NOTICE/);
    assert.match(PROJECT_GUIDED_MASTER_NOTICE, /não altera o cadastro mestre/i);
    assert.match(modal, /Produto/);
    assert.match(modal, /Componente/);
    assert.match(modal, /Matéria-prima/);
    assert.match(modal, /Clonado de item oficial/);
  });

  it("Clonar item não aparece como fluxo principal isolado no módulo", () => {
    const mod = readFileSync(
      join(process.cwd(), "src", "components", "ProjectsModule.tsx"),
      "utf8"
    );
    assert.equal(mod.includes("Clonar item existente"), false);
    assert.equal(mod.includes("ProjectEngineeringTab"), false);
    assert.equal(mod.includes("officialPickerOpen"), false);
    assert.match(mod, /ProjectHomeAssistant/);
    assert.match(mod, /ProjectItemsTab/);
    assert.match(mod, /ProjectGuidedMoldModal/);
    assert.match(mod, /ProjectOtherCostsModal/);
    assert.match(mod, /ProjectDetailErrorBoundary/);
    assert.match(mod, /otherCostsModalMode/);
    assert.equal(mod.includes("ProjectStructureLineModal"), false);
    assert.equal(mod.includes("ProjectLaborLineModal"), false);
  });

  it("menu do projeto possui apenas abas do fluxo guiado", () => {
    const mod = readFileSync(
      join(process.cwd(), "src", "components", "ProjectsModule.tsx"),
      "utf8"
    );
    assert.equal(mod.includes("ProjectEngineeringTree"), false);
    assert.equal(mod.includes("ProjectCostSimulation"), false);
    assert.equal(mod.includes("ProjectMaterialsAndComponents"), false);
    assert.equal(mod.includes("ProjectTimeline"), false);

    const nav = readFileSync(join(process.cwd(), "src", "lib", "projectsNavigation.ts"), "utf8");
    assert.match(nav, /Início/);
    assert.match(nav, /Itens do Projeto/);
    assert.match(nav, /Custos do Projeto/);
    assert.equal(nav.includes("Engenharia do Projeto"), false);
    assert.equal(nav.includes("Estrutura / Árvore"), false);
  });

  it("empty state orienta o usuário quando não há itens", () => {
    const home = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectHomeAssistant.tsx"),
      "utf8"
    );
    assert.match(home, /Nenhum item adicionado ao projeto ainda/i);
  });

  it("fluxo de projeto não importa Prisma/backend no frontend", () => {
    const files = [
      "src/components/ProjectsModule.tsx",
      "src/components/projects/ProjectHomeAssistant.tsx",
      "src/components/projects/ProjectItemsTab.tsx",
      "src/components/projects/ProjectGuidedMoldModal.tsx",
      "src/components/projects/ProjectOtherCostsModal.tsx",
      "src/lib/projectsGuidedFlow.ts",
    ];
    for (const file of files) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      assert.equal(src.includes("@prisma/client"), false, file);
      assert.equal(src.includes("projectsService"), false, file);
      assert.equal(src.includes("src/lib/prisma"), false, file);
    }
  });
});
