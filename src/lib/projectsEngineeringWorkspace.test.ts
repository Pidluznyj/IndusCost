import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildProjectEngineeringItems,
  computeProjectEngineeringStats,
  PROJECT_ENGINEERING_MASTER_DATA_NOTICE,
  PROJECT_ENGINEERING_TAB_SUBTITLE,
  resolveProjectEngineeringItemBadges,
} from "./projectsEngineeringWorkspace.js";
import {
  getProjectTabPath,
  LEGACY_PROJECT_TAB_ALIASES,
  parseLegacyTabSegment,
  parseProjectTabFromPath,
  PROJECT_TABS,
  PROJECTS_BASE_PATH,
} from "./projectsNavigation.js";
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
        provisionalCode: "SMALTEC-COMP-001",
        description: "Componente local",
        unit: "UN",
        estimatedWeight: null,
        expectedVolume: null,
        batchSize: 100,
        notes: null,
      },
    ],
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
      unitCost: 10,
      targetMarginPercent: 20,
      suggestedPrice: 12,
      markupPercent: null,
      targetPrice: null,
      priceGap: null,
    },
    alerts: [],
    conversionAvailable: false,
    ...overrides,
  };
}

describe("projectsNavigation — menu reorganizado", () => {
  it("exibe as 8 abas do workspace de engenharia", () => {
    const labels = PROJECT_TABS.map((t) => t.label);
    assert.deepEqual(labels, [
      "Visão Geral",
      "Engenharia do Projeto",
      "Estrutura / Árvore",
      "Simulação de Custos",
      "Materiais e Componentes",
      "Cronograma / Etapas",
      "Documentos",
      "Histórico",
    ]);
  });

  it("rotas legadas redirecionam para abas equivalentes", () => {
    assert.equal(parseProjectTabFromPath("/projects/x/products"), "engineering");
    assert.equal(parseProjectTabFromPath("/projects/x/items"), "materials");
    assert.equal(parseProjectTabFromPath("/projects/x/versions"), "history");
    assert.equal(parseLegacyTabSegment("/projects/x/products"), "products");
    assert.equal(LEGACY_PROJECT_TAB_ALIASES.products, "engineering");
    assert.equal(getProjectTabPath("x", "engineering"), "/projects/x/engineering");
  });

  it("rota base /projects existe", () => {
    assert.equal(PROJECTS_BASE_PATH, "/projects");
  });
});

describe("projectsEngineeringWorkspace", () => {
  it("aba Engenharia lista item local com badges obrigatórias", () => {
    const items = buildProjectEngineeringItems(minimalDetail());
    assert.ok(items.length >= 1);
    const badges = resolveProjectEngineeringItemBadges(items[0]!);
    const labels = badges.map((b) => b.label);
    assert.ok(labels.includes("Item do projeto"));
    assert.ok(labels.includes("Novo"));
    assert.ok(labels.includes("Simulado"));
  });

  it("textos deixam claro isolamento do cadastro mestre", () => {
    assert.match(PROJECT_ENGINEERING_TAB_SUBTITLE, /cadastro mestre/i);
    assert.match(PROJECT_ENGINEERING_MASTER_DATA_NOTICE, /não será alterado/i);
  });

  it("computa estatísticas de resumo", () => {
    const stats = computeProjectEngineeringStats(minimalDetail());
    assert.equal(stats.localItemsCount, 1);
    assert.equal(stats.totalSimulatedCost, 10);
  });
});

describe("ProjectsModule UI — engenharia do projeto", () => {
  it("ProjectsModule exibe aba Engenharia do Projeto e ações principais", () => {
    const mod = readFileSync(
      join(process.cwd(), "src", "components", "ProjectsModule.tsx"),
      "utf8"
    );
    const tab = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectEngineeringTab.tsx"),
      "utf8"
    );
    assert.match(mod, /ProjectEngineeringTab/);
    assert.match(tab, /Novo item do projeto/);
    assert.match(tab, /Clonar item existente/);
    assert.match(tab, /Adicionar item oficial/);
    assert.match(mod, /Converter em cadastro oficial/);
    assert.match(mod, /Em breve/);
  });

  it("modal de novo item usa título de contexto do projeto", () => {
    const modal = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectEngineeringItemModal.tsx"),
      "utf8"
    );
    assert.match(modal, /Novo Item de Engenharia do Projeto/);
    assert.match(modal, /não altera o cadastro mestre/i);
  });

  it("fluxo de projeto não importa Prisma/backend no frontend", () => {
    const mod = readFileSync(
      join(process.cwd(), "src", "components", "ProjectsModule.tsx"),
      "utf8"
    );
    assert.equal(mod.includes("@prisma/client"), false);
    assert.equal(mod.includes("projectsService"), false);
    assert.equal(mod.includes("src/lib/prisma"), false);

    const engineeringTab = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectEngineeringTab.tsx"),
      "utf8"
    );
    assert.equal(engineeringTab.includes("projectsService"), false);
  });
});
