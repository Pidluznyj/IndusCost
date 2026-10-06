/**
 * Fronteira em tempo de execução: Simulações e a integração com Projetos nunca escrevem no
 * universo oficial de custo/preço. O Prisma em memória LANÇA em qualquer modelo fora do
 * domínio (ProductionCostTableVersion/Item, PriceTableVersion/Item...), então concluir um
 * fluxo sem erro prova que esses modelos não foram sequer acessados.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { ENGINEERING_RESOURCE_KEYS } from "./engineeringAccess.js";
import {
  canArchiveSimulations,
  canCreateSimulations,
  canDeleteSimulations,
} from "./commercialEngineeringPermissions.js";
import { computeProjectGuidedCosts } from "./projectsGuidedFlow.js";
import { addSimulationReferenceToProject } from "./projectsSimulationItemService.js";
import { authorizeRequireResource } from "./security/requireResource.js";
import {
  requestJson,
  startSimulationsTestApp,
  TEST_IDS,
  type TestApp,
} from "./simulationsTestSupport.js";
import type { ProjectDetail } from "@/src/types/projects.js";

const OFFICIAL_MODELS = [
  "productionCostTableVersion",
  "productionCostTableItem",
  "priceTableVersion",
  "priceTableItem",
  "priceTable",
  "materialCostTableVersion",
];

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

async function withApp(run: (app: TestApp) => Promise<void>) {
  const app = await startSimulationsTestApp();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

function assertNoOfficialAccess(app: TestApp) {
  for (const model of OFFICIAL_MODELS) {
    assert.ok(!app.db.touched.has(model), `modelo oficial acessado: ${model}`);
  }
  assert.ok(!app.db.writes.some((w) => w.model === "productPricing"), "ProductPricing escrito");
}

const scenario = (overrides: Record<string, unknown> = {}) => ({
  name: "Cenário",
  productId: TEST_IDS.product,
  taxRuleId: TEST_IDS.taxRule,
  materialAdj: 10,
  laborAdj: 0,
  indirectAdj: 0,
  efficiencyAdj: 0,
  marginAdj: 0,
  ...overrides,
});

const newProduct = (freeze: boolean, draftId: string | null = null) => ({
  inputs: {
    simulationName: "S1",
    productName: "Novo corpo",
    productSku: "SIM-1",
    notes: null,
    commercial: {
      mode: "MARGIN",
      desiredMarginPct: 20,
      targetPrice: 0,
      premises: { taxRuleId: TEST_IDS.taxRule, commissionRatePct: 3, otherRatePct: 0, freight: 0 },
    },
    lines: [
      { id: "l1", type: "EXISTING_COMPONENT", productId: TEST_IDS.product, quantity: 2, baselineSource: "PUBLISHED" },
      { id: "l2", type: "DIRECT_MATERIAL", description: "Peça", unit: "UN", quantity: 1, unitCost: 46.6 },
    ],
    simulatedComponents: [],
  },
  freeze,
  draftId,
});

describe("fronteira em execução — Simulações × custo/preço oficial", () => {
  it("1 — simulação lê PUBLISHED sem escrever PUBLISHED", async () => {
    await withApp(async (app) => {
      const res = await requestJson(app, "POST", "/api/simulations", scenario());
      assert.equal(res.status, 201);
      assert.equal(res.json.baselineSource, "PUBLISHED");
      assert.deepEqual(app.publishedReads, [TEST_IDS.product], "uma leitura do custo publicado");
      assert.deepEqual(app.db.writes, [{ model: "simulation", op: "create" }]);
      assertNoOfficialAccess(app);
    });
  });

  it("2 — simulação sobre LIVE não altera custo oficial nem o produto", async () => {
    await withApp(async (app) => {
      const res = await requestJson(app, "POST", "/api/simulations", scenario({ baselineSource: "LIVE" }));
      assert.equal(res.status, 201);
      assert.deepEqual(app.db.writes, [{ model: "simulation", op: "create" }]);
      assert.ok(!app.db.writes.some((w) => w.model === "product" || w.model === "material"));
      assertNoOfficialAccess(app);
    });
  });

  it("3, 4, 6, 7 — salvar e congelar não criam versão de custo, ProductPricing nem tabela de preço", async () => {
    await withApp(async (app) => {
      const draft = await requestJson(app, "POST", "/api/new-product-simulations/save", newProduct(false));
      assert.equal(draft.json.status, "DRAFT");
      const frozen = await requestJson(app, "POST", "/api/new-product-simulations/save", newProduct(true, draft.json.id));
      assert.equal(frozen.json.status, "SAVED");
      assert.deepEqual([...new Set(app.db.writes.map((w) => w.model))], ["newProductSimulation"]);
      assertNoOfficialAccess(app);
      // premissas comerciais da simulação vêm da regra fiscal; ProductPricing nem é lido aqui
      assert.ok(!app.db.touched.has("productPricing"));
    });
  });

  it("5, 8, 9, 13 — enviar ao Projeto copia o custo, soma no total e não cria nada oficial", async () => {
    await withApp(async (app) => {
      const frozen = await requestJson(app, "POST", "/api/new-product-simulations/save", newProduct(true));
      const item = await addSimulationReferenceToProject(
        { projectId: "p1", versionId: "v1", simulationId: frozen.json.id },
        { db: app.db.prisma as never, recalculateVersionCosts: async () => undefined }
      );
      // existente PUBLISHED 1,70 × 2 + direto 46,60 = 50,00
      assert.ok(Math.abs((item.estimatedUnitCost as number) - 50) < 1e-9);
      assert.equal(item.canBecomeOfficial, false);
      assert.deepEqual([...new Set(app.db.writes.map((w) => w.model))].sort(), [
        "newProductSimulation",
        "projectSimulatedItem",
      ]);
      assertNoOfficialAccess(app);

      const detail = {
        status: "DRAFT",
        updatedAt: "2026-10-05T00:00:00.000Z",
        simulatedProducts: [],
        simulatedItems: [item],
        structureLines: [],
        molds: [],
        costBreakdown: { unitCost: 100, separateMoldCost: 0 }, // item oficial = 100
      } as unknown as ProjectDetail;
      assert.ok(Math.abs(computeProjectGuidedCosts(detail).totalProjectCost - 150) < 1e-9);
    });
  });

  it("10, 11, 12 — mudar a Simulation, o LIVE ou o PUBLISHED depois não muda o item do projeto", async () => {
    await withApp(async (app) => {
      const frozen = await requestJson(app, "POST", "/api/new-product-simulations/save", newProduct(true));
      await addSimulationReferenceToProject(
        { projectId: "p1", versionId: "v1", simulationId: frozen.json.id },
        { db: app.db.prisma as never, recalculateVersionCosts: async () => undefined }
      );
      const snapshotOfItem = JSON.stringify(app.db.tables.projectSimulatedItem[0]);

      // Simulation original arquivada e adulterada
      await requestJson(app, "POST", `/api/new-product-simulations/${frozen.json.id}/archive`);
      app.db.tables.newProductSimulation[0].snapshot = { schemaVersion: 2, result: { costBase: 999 } };
      // novo cenário sobre LIVE e sobre PUBLISHED (releituras de custo) — nada disso toca o item
      await requestJson(app, "POST", "/api/simulations", scenario({ baselineSource: "LIVE" }));
      await requestJson(app, "POST", "/api/simulations", scenario());

      assert.equal(JSON.stringify(app.db.tables.projectSimulatedItem[0]), snapshotOfItem);
      assert.equal(app.db.tables.projectSimulatedItem[0].canBecomeOfficial, false);
      assert.equal(app.db.writes.filter((w) => w.model === "projectSimulatedItem").length, 1);
    });
  });

  it("14 — nenhuma rota de Simulações referencia função oficial de publicação", () => {
    const forbidden =
      /publishProductionCost|publishUnitaryProductionCost|createUnitaryProductionCostDraft|executeProductionCostBulkPublish|materializeComplete|productionCostCompleteSnapshot|productionCostBulkPublish|productionCostPublication|generatePriceTableVersionDraft|priceTablePublication\.server|priceTableProductionCostResolver|resolvePublishedProductionCostTableVersionForDate|refreshProductProductionCostSnapshot/;
    for (const file of [
      "src/lib/simulationsRoutes.ts",
      "src/lib/simulationsValidation.ts",
      "src/lib/simulationScenario.ts",
      "src/lib/simulationFormula.ts",
      "src/lib/newProductSimulation.server.ts",
      "src/lib/newProductSimulationInputs.ts",
      "src/lib/newProductSimulationSnapshot.ts",
      "src/lib/productCostBaseline.ts",
      "src/lib/productCostBaseline.server.ts",
    ]) {
      assert.doesNotMatch(code(file), forbidden, file);
    }
    // A única dependência do domínio oficial é o LEITOR de custo efetivo por produto/data.
    const resolver = code("src/lib/productCostBaseline.server.ts");
    const officialImports = [...resolver.matchAll(/from "\.\/(production\w+|priceTable\w+)[^"]*"/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(officialImports)].sort(), ["productionCostTables", "productionCostVersioning"]);
    assert.match(resolver, /import \{ getEffectiveProductProductionCost \} from "\.\/productionCostTables\.server\.js"/);
    assert.match(resolver, /import type \{ EffectiveProductProductionCostResult \} from "\.\/productionCostVersioning\.js"/);
  });

  it("15 — Projetos não chama publicação oficial por causa de item simulado", () => {
    const forbidden =
      /publishProductionCost|productionCostCompleteSnapshot|productionCostBulkPublish|productionCostPublication|generatePriceTableVersionDraft|priceTablePublication|productPricing\s*\.\s*(create|update|upsert|delete)/;
    for (const file of [
      "src/lib/projectsSimulationItemService.ts",
      "src/lib/projectsSimulationRefs.ts",
      "src/lib/projectsSimulationLookup.ts",
      "src/lib/projectsGuidedFlow.ts",
    ]) {
      assert.doesNotMatch(code(file), forbidden, file);
    }
    const service = code("src/lib/projectsSimulationItemService.ts");
    const writes = [...service.matchAll(/\.\s*(\w+)\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g)].map(
      (m) => `${m[1]}.${m[2]}`
    );
    assert.deepEqual(writes, ["projectSimulatedItem.create"]);
  });
});

function auth(role: AppAuthContext["role"], permissions: string[]): AppAuthContext {
  return {
    id: "u-sim",
    name: "Sim",
    email: "sim@example.com",
    role,
    permissions,
    effectivePermissions: permissions,
    accessProfileId: null,
    accessProfileName: null,
    employeeId: null,
    employeeName: null,
    employeeDepartment: null,
    isActive: true,
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "s-sim",
  } as AppAuthContext;
}

describe("permissões de Simulações — motor real de autorização", () => {
  const RESOURCE = ENGINEERING_RESOURCE_KEYS.simulations;
  const decide = (a: AppAuthContext, action: string) =>
    authorizeRequireResource(a, RESOURCE, action, { legacyCompatMode: true }).ok;
  const matrix = (a: AppAuthContext) => ({
    view: decide(a, "view"),
    create: decide(a, "create"),
    update: decide(a, "update"),
    delete: decide(a, "delete"),
  });

  it("SUPER_ADMIN pode tudo", () => {
    assert.deepEqual(matrix(auth("SUPER_ADMIN", [])), { view: true, create: true, update: true, delete: true });
  });

  it("somente leitura: vê, não cria, não arquiva, não exclui", () => {
    assert.deepEqual(matrix(auth("VIEWER", ["simulations.view"])), {
      view: true,
      create: false,
      update: false,
      delete: false,
    });
  });

  it("criar não implica arquivar nem excluir", () => {
    assert.deepEqual(matrix(auth("VIEWER", ["simulations.view", "simulations.create"])), {
      view: true,
      create: true,
      update: false,
      delete: false,
    });
  });

  it("arquivar/restaurar e excluir têm chaves próprias", () => {
    assert.deepEqual(matrix(auth("VIEWER", ["simulations.view", "simulations.edit"])), {
      view: true,
      create: false,
      update: true,
      delete: false,
    });
    assert.deepEqual(matrix(auth("VIEWER", ["simulations.view", "simulations.delete"])), {
      view: true,
      create: false,
      update: false,
      delete: true,
    });
  });

  it("sem nenhuma chave de simulações: nada", () => {
    assert.deepEqual(matrix(auth("VIEWER", ["products.view"])), {
      view: false,
      create: false,
      update: false,
      delete: false,
    });
  });

  it("helpers da tela usam as mesmas ações canônicas", () => {
    const check = (granted: string[]) => ({
      hasPermission: () => false,
      hasAnyPermission: () => false,
      canPerformAction: (_r: string, action: string) => granted.includes(action),
    });
    const creator = check(["create"]) as never;
    assert.equal(canCreateSimulations(creator), true);
    assert.equal(canArchiveSimulations(creator), false);
    assert.equal(canDeleteSimulations(creator), false);
    const manager = check(["create", "update", "delete"]) as never;
    assert.equal(canArchiveSimulations(manager), true);
    assert.equal(canDeleteSimulations(manager), true);
  });

  it("ações de cada operação: congelar = create; arquivar = update; excluir rascunho = delete", () => {
    const routes = read("src/lib/simulationsRoutes.ts");
    const expectAction = (routePath: string, verb: string, action: string) => {
      const pattern = new RegExp(
        `app\\.${verb}\\(\\s*"${routePath.replace(/[/:]/g, (c) => `\\${c}`)}",\\s*\\.\\.\\.${action},`
      );
      assert.match(routes, pattern, `${verb.toUpperCase()} ${routePath} → ${action}`);
    };
    expectAction("/api/simulations", "get", "view");
    expectAction("/api/simulations", "post", "create");
    expectAction("/api/simulations/:id", "delete", "remove");
    expectAction("/api/simulations/:id/unarchive", "post", "update");
    expectAction("/api/simulations/:id/compare", "get", "view");
    expectAction("/api/new-product-simulations/save", "post", "create");
    expectAction("/api/new-product-simulations/preview", "post", "create");
    expectAction("/api/new-product-simulations/:id/clone", "post", "create");
    expectAction("/api/new-product-simulations/:id/archive", "post", "update");
    expectAction("/api/new-product-simulations/:id/unarchive", "post", "update");
    expectAction("/api/new-product-simulations/:id", "delete", "remove");
    assert.match(routes, /const remove = \[requireAppAuth, requireResource\(RESOURCE, "delete"\)\]/);
    assert.match(routes, /const update = \[requireAppAuth, requireResource\(RESOURCE, "update"\)\]/);
  });
});
