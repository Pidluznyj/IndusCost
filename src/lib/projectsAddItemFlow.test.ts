import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildProjectGuidedItems,
  PROJECT_GUIDED_HOME_INTRO,
} from "./projectsGuidedFlow.js";
import {
  PROJECTS_BLOCK_IN_PROJECT_PRODUCT_CREATION,
  PROJECT_IN_PROJECT_PRODUCT_CREATION_DISABLED_MESSAGE,
} from "./projectsAddItemPolicy.js";
import { buildSimulationRefNotes } from "./projectsSimulationRefs.js";
import type { ProjectDetail } from "@/src/types/projects.js";

function minimalDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: "p1",
    code: "PRJ-001",
    title: "Teste",
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

describe("projectsAddItemFlow", () => {
  it("bloqueia criação in-project por política", () => {
    assert.equal(PROJECTS_BLOCK_IN_PROJECT_PRODUCT_CREATION, true);
    assert.match(PROJECT_IN_PROJECT_PRODUCT_CREATION_DISABLED_MESSAGE, /Simulações/i);
  });

  it("lista item simulado vindo de Simulações no fluxo guiado", () => {
    const items = buildProjectGuidedItems(
      minimalDetail({
        simulatedItems: [
          {
            id: "si-sim",
            provisionalCode: "SIM-01",
            description: "Produto simulado X",
            itemType: "FINISHED_PRODUCT",
            unit: "UN",
            estimatedUnitCost: 88,
            quotedUnitCost: 88,
            supplierName: null,
            leadTimeDays: null,
            estimatedWeight: null,
            lossPercent: 0,
            requiresQuotation: false,
            requiresEngineeringReview: false,
            canBecomeOfficial: false,
            notes: buildSimulationRefNotes("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
          },
        ],
      })
    );
    const sim = items.find((i) => i.entityKind === "simulation_ref");
    assert.ok(sim);
    assert.equal(sim?.origin, "FROM_SIMULATION");
    assert.equal(sim?.estimatedCost, 88);
  });

  it("projeto legado com ProjectSimulatedProduct continua listando item", () => {
    const items = buildProjectGuidedItems(
      minimalDetail({
        simulatedProducts: [
          {
            id: "sp-legacy",
            provisionalCode: "LEG-01",
            description: "Produto legado",
            unit: "UN",
            estimatedWeight: null,
            expectedVolume: null,
            batchSize: null,
            notes: null,
          },
        ],
      })
    );
    const legacy = items.find((i) => i.productId === "sp-legacy");
    assert.ok(legacy);
    assert.equal(legacy?.origin, "CREATED_IN_PROJECT");
    assert.match(legacy?.originLabel ?? "", /Legado/i);
  });

  it("UI não exibe criar novo produto no projeto", () => {
    const home = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectHomeAssistant.tsx"),
      "utf8"
    );
    const itemsTab = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectItemsTab.tsx"),
      "utf8"
    );
    const mod = readFileSync(join(process.cwd(), "src", "components", "ProjectsModule.tsx"), "utf8");

    assert.equal(home.includes("Criar novo produto"), false);
    assert.equal(itemsTab.includes("Criar produto"), false);
    assert.equal(mod.includes("Criar novo produto"), false);
    assert.match(home, /Adicionar item/);
    assert.match(itemsTab, /Adicionar item/);
    assert.match(mod, /ProjectAddItemModal/);
    assert.match(mod, /openAddItem/);
  });

  it("modal de adicionar item oferece oficial e simulação", () => {
    const modal = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectAddItemModal.tsx"),
      "utf8"
    );
    assert.match(modal, /Produto oficial/);
    assert.match(modal, /Componente oficial/);
    assert.match(modal, /Produto simulado/);
    assert.match(modal, /simulation-references/);
    assert.match(modal, /import-product-snapshot/);
  });

  it("rotas expõem lookup e referência de simulação", () => {
    const routes = readFileSync(join(process.cwd(), "src", "lib", "projectsRoutes.ts"), "utf8");
    assert.match(routes, /lookup\/simulations/);
    assert.match(routes, /simulation-references/);
    assert.match(routes, /PROJECTS_BLOCK_IN_PROJECT_PRODUCT_CREATION/);
  });

  it("workspace legado fica somente leitura", () => {
    const ws = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectSimulatedProductWorkspace.tsx"),
      "utf8"
    );
    assert.match(ws, /legacyReadOnly/);
    assert.match(ws, /somente leitura/i);
  });

  it("texto da home orienta uso de Simulações", () => {
    assert.match(PROJECT_GUIDED_HOME_INTRO, /Simulações/i);
  });
});
