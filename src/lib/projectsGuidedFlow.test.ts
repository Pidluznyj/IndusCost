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
import { formatProjectGuidedItemCost } from "./projectsUiUtils.js";
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
    snapshotRootProducts: {},
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
  it("lista produto simulado de Simulações como item guiado", () => {
    const detail = minimalDetail({
      simulatedItems: [
        {
          id: "sim-ref",
          provisionalCode: "SIM-X",
          description: "Simulação salva",
          itemType: "FINISHED_PRODUCT",
          unit: "UN",
          estimatedUnitCost: 50,
          quotedUnitCost: 50,
          supplierName: null,
          leadTimeDays: null,
          estimatedWeight: null,
          lossPercent: 0,
          requiresQuotation: false,
          requiresEngineeringReview: false,
          canBecomeOfficial: false,
          notes: "guided-origin:SIMULATION\nguided-simulation-id:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        },
      ],
    });
    const items = buildProjectGuidedItems(detail);
    const sim = items.find((i) => i.entityKind === "simulation_ref");
    assert.equal(sim?.origin, "FROM_SIMULATION");
    assert.equal(sim?.estimatedCost, 50);
  });

  it("produto oficial importado lista nome do produto pai, não matéria-prima da BOM", () => {
    const rootId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const detail = minimalDetail({
      structureLines: [
        {
          id: "mat-1",
          simulatedProductId: null,
          parentLineId: null,
          level: 0,
          treePath: null,
          snapshotRootProductId: rootId,
          lineType: "RAW_MATERIAL",
          sourceType: "EXISTING_MATERIAL",
          existingProductId: null,
          existingMaterialId: "material-1",
          simulatedItemId: null,
          sourceOfficialBomId: "bom-1",
          sourceOfficialRoutingId: null,
          descriptionSnapshot: "115.01-- — *PP* Polipropileno H 503",
          unitSnapshot: "KG",
          quantity: 0.04,
          lossPercent: 5,
          officialQuantitySnapshot: 0.04,
          officialLossPercentSnapshot: 5,
          officialUnitCostSnapshot: 12,
          unitCostSnapshot: 12,
          totalCost: 0.5,
          costSource: "OFFICIAL_COST_ANALYSIS",
          isChangedFromOfficial: false,
          isMissingCost: false,
          countsInSimulatedProductCost: true,
          supplierNameSnapshot: null,
          notes: `snapshot:${rootId}`,
          sortOrder: 0,
        },
        {
          id: "mat-2",
          simulatedProductId: null,
          parentLineId: null,
          level: 0,
          treePath: null,
          snapshotRootProductId: rootId,
          lineType: "RAW_MATERIAL",
          sourceType: "EXISTING_MATERIAL",
          existingProductId: null,
          existingMaterialId: "material-2",
          simulatedItemId: null,
          sourceOfficialBomId: "bom-2",
          sourceOfficialRoutingId: null,
          descriptionSnapshot: "121.16-- — MasterBatch Branco",
          unitSnapshot: "KG",
          quantity: 0.01,
          lossPercent: 0,
          officialQuantitySnapshot: 0.01,
          officialLossPercentSnapshot: 0,
          officialUnitCostSnapshot: 20,
          unitCostSnapshot: 20,
          totalCost: 0.2,
          costSource: "OFFICIAL_COST_ANALYSIS",
          isChangedFromOfficial: false,
          isMissingCost: false,
          countsInSimulatedProductCost: true,
          supplierNameSnapshot: null,
          notes: `snapshot:${rootId}`,
          sortOrder: 1,
        },
      ],
      snapshotRootProducts: {
        [rootId]: {
          sku: "310.01AA",
          name: "Corpo Torneira EGM30 Branco",
        },
      },
    });

    const items = buildProjectGuidedItems(detail);
    const imported = items.find((i) => i.snapshotRootProductId === rootId);
    assert.ok(imported);
    assert.equal(imported?.name, "Corpo Torneira EGM30 Branco");
    assert.equal(imported?.code, "310.01AA");
    assert.notEqual(imported?.name, "*PP* Polipropileno H 503");
    assert.ok((imported?.estimatedCost ?? 0) > 0);
    assert.equal(imported?.itemTypeLabel, "Produto oficial");
  });

  it("produto oficial sem custo exibe status pendente", () => {
    const rootId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const detail = minimalDetail({
      structureLines: [
        {
          id: "mat-zero",
          simulatedProductId: null,
          parentLineId: null,
          level: 0,
          treePath: null,
          snapshotRootProductId: rootId,
          lineType: "RAW_MATERIAL",
          sourceType: "EXISTING_MATERIAL",
          existingProductId: null,
          existingMaterialId: "material-z",
          simulatedItemId: null,
          sourceOfficialBomId: null,
          sourceOfficialRoutingId: null,
          descriptionSnapshot: "Material sem custo",
          unitSnapshot: "KG",
          quantity: 1,
          lossPercent: 0,
          officialQuantitySnapshot: 1,
          officialLossPercentSnapshot: 0,
          officialUnitCostSnapshot: 0,
          unitCostSnapshot: 0,
          totalCost: 0,
          costSource: "OFFICIAL_COST_ANALYSIS",
          isChangedFromOfficial: false,
          isMissingCost: true,
          countsInSimulatedProductCost: true,
          supplierNameSnapshot: null,
          notes: `snapshot:${rootId}`,
          sortOrder: 0,
        },
      ],
      snapshotRootProducts: {
        [rootId]: { sku: "999.99", name: "Produto sem custo" },
      },
    });
    const items = buildProjectGuidedItems(detail);
    const imported = items.find((i) => i.snapshotRootProductId === rootId);
    assert.equal(imported?.status, "PENDING_COST");
    assert.equal(imported?.estimatedCost, null);
  });
});

describe("ProjectsModule UI — fluxo guiado", () => {
  it("tela inicial exibe adicionar item, molde e outros custos", () => {
    const home = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectHomeAssistant.tsx"),
      "utf8"
    );
    assert.match(home, /Adicionar item/);
    assert.match(home, /Criar molde/);
    assert.match(home, /Adicionar custo|outros custos/i);
    assert.equal(home.includes("Criar novo produto"), false);
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
    assert.match(PROJECT_GUIDED_MASTER_NOTICE, /não alteram cadastro oficial/i);
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
    assert.match(mod, /ProjectStructureLineModal/);
    assert.match(mod, /ProjectSimulatedProductWorkspace/);
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

  it("ProjectsModule monta workspace legado e modal de adicionar item", () => {
    const mod = readFileSync(join(process.cwd(), "src", "components", "ProjectsModule.tsx"), "utf8");
    assert.match(mod, /ProjectSimulatedProductWorkspace/);
    assert.match(mod, /ProjectAddItemModal/);
    assert.match(mod, /legacyReadOnly/);
    assert.match(mod, /setSimulatedWorkspaceProductId/);
    assert.match(mod, /resolveReferencedSimulatedProductUnitCost/);
  });

  it("workspace legado oculta criação de subcomponente quando somente leitura", () => {
    const ws = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectSimulatedProductWorkspace.tsx"),
      "utf8"
    );
    assert.match(ws, /ProjectBomSimulationTable/);
    assert.match(ws, /legacyReadOnly/);
    assert.match(ws, /effectiveCanManage/);
  });

  it("empty state orienta o usuário quando não há itens", () => {
    const home = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectHomeAssistant.tsx"),
      "utf8"
    );
    assert.match(home, /Nenhum item adicionado ao projeto ainda/i);
  });

  it("grade da home exibe ação Remover e coluna Ações", () => {
    const home = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectHomeAssistant.tsx"),
      "utf8"
    );
    assert.match(home, /Ações/);
    assert.match(home, /Remover/);
    assert.match(home, /onDeleteItem/);
    assert.equal(home.includes("ProjectDeleteConfirmModal"), false);
    assert.equal(home.includes("window.confirm"), false);
  });

  it("ProjectsModule repassa exclusão para a grade da home", () => {
    const mod = readFileSync(join(process.cwd(), "src", "components", "ProjectsModule.tsx"), "utf8");
    assert.match(mod, /onDeleteItem=\{canManage \? handleGuidedItemDelete/);
    assert.match(mod, /handleGuidedItemDelete/);
    assert.match(mod, /structure-snapshot/);
    assert.match(mod, /Remover item do projeto/);
    assert.equal(mod.includes("window.confirm"), false);
  });

  it("custo pendente exibe Sem custo em vez de traço", () => {
    assert.equal(formatProjectGuidedItemCost(null, "PENDING_COST"), "Sem custo");
    assert.equal(formatProjectGuidedItemCost(0, "PENDING_COST"), "Sem custo");
    assert.match(formatProjectGuidedItemCost(12.5, "CALCULATED"), /12,50/);
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
