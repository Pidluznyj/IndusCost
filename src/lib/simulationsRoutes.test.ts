import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createFakeDb,
  liveAnalysis,
  requestJson,
  startSimulationsTestApp,
  TEST_IDS,
  type TestApp,
} from "./simulationsTestSupport.js";

async function withApp(
  options: Parameters<typeof startSimulationsTestApp>[0],
  run: (app: TestApp) => Promise<void>
) {
  const app = await startSimulationsTestApp(options);
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

const scenarioBody = (overrides: Record<string, unknown> = {}) => ({
  name: "MP +10%",
  description: "",
  productId: TEST_IDS.product,
  taxRuleId: TEST_IDS.taxRule,
  materialAdj: 10,
  laborAdj: 0,
  indirectAdj: 0,
  efficiencyAdj: 0,
  marginAdj: 0,
  ...overrides,
});

const newProductInputs = (overrides: Record<string, unknown> = {}) => ({
  simulationName: "Novo corpo XYZ",
  productName: "Novo corpo XYZ",
  productSku: "SIM-001",
  notes: null,
  commercial: { mode: "MARGIN", desiredMarginPct: 20, targetPrice: 0, premises: null },
  lines: [
    { id: "l1", type: "EXISTING_COMPONENT", productId: TEST_IDS.product, quantity: 2, baselineSource: "PUBLISHED" },
    { id: "l2", type: "SIMULATED_COMPONENT", componentId: "c1", quantity: 1 },
    { id: "l3", type: "DIRECT_MATERIAL", description: "Parafuso", unit: "UN", quantity: 4, unitCost: 0.25 },
  ],
  simulatedComponents: [
    {
      id: "c1",
      name: "Tampa simulada",
      sku: null,
      materials: [
        { materialId: TEST_IDS.material, code: "", description: "", unit: "kg", quantity: 0.5, unitCost: null },
      ],
      process: {
        mode: "STANDARD",
        cycleTimeSeconds: 36,
        cavities: 2,
        efficiencyExpectedPercent: 100,
        setupTimeMin: 60,
        lotSize: 1000,
      },
    },
  ],
  ...overrides,
});

describe("simulationsRoutes — autenticação e permissões", () => {
  it("sem autenticação: 401 em todas as rotas, sem tocar no banco", async () => {
    await withApp({ authenticated: false }, async (app) => {
      for (const [method, path] of [
        ["GET", "/api/simulations"],
        ["POST", "/api/simulations"],
        ["DELETE", `/api/simulations/${TEST_IDS.product}`],
        ["GET", `/api/simulations/${TEST_IDS.product}/compare`],
        ["GET", "/api/new-product-simulations"],
        ["POST", "/api/new-product-simulations/save"],
        ["POST", `/api/new-product-simulations/${TEST_IDS.product}/clone`],
        ["DELETE", `/api/new-product-simulations/${TEST_IDS.product}`],
      ] as const) {
        const res = await requestJson(app, method, path, method === "GET" ? undefined : {});
        assert.equal(res.status, 401, `${method} ${path}`);
      }
      assert.equal(app.db.touched.size, 0);
    });
  });

  it("toda rota declara recurso engineering.simulations com a ação certa", async () => {
    await withApp({}, async (app) => {
      assert.ok(app.guardCalls.every((c) => c.resource === "engineering.simulations"));
      const actions = app.guardCalls.map((c) => c.action);
      for (const action of ["view", "create", "update", "delete"]) {
        assert.ok(actions.includes(action), `ação ${action} declarada`);
      }
    });
  });

  it("view não executa mutation", async () => {
    await withApp({ grantedActions: ["view"] }, async (app) => {
      assert.equal((await requestJson(app, "GET", "/api/simulations")).status, 200);
      assert.equal((await requestJson(app, "POST", "/api/simulations", scenarioBody())).status, 403);
      assert.equal((await requestJson(app, "DELETE", `/api/simulations/${TEST_IDS.product}`)).status, 403);
      assert.equal(
        (await requestJson(app, "POST", "/api/new-product-simulations/save", { inputs: newProductInputs() })).status,
        403
      );
      assert.equal(app.db.writes.length, 0);
    });
  });

  it("create não implica delete nem arquivar", async () => {
    await withApp({ grantedActions: ["view", "create"] }, async (app) => {
      const created = await requestJson(app, "POST", "/api/simulations", scenarioBody());
      assert.equal(created.status, 201);
      assert.equal((await requestJson(app, "DELETE", `/api/simulations/${created.json.id}`)).status, 403);
      assert.equal(
        (await requestJson(app, "POST", `/api/new-product-simulations/${TEST_IDS.product}/archive`)).status,
        403
      );
      assert.equal(app.db.tables.simulation[0].archivedAt, null);
    });
  });
});

describe("simulationsRoutes — validação e robustez", () => {
  it("UUID inválido → 400 (não chega ao Prisma)", async () => {
    await withApp({}, async (app) => {
      for (const [method, path] of [
        ["GET", "/api/simulations/nao-e-uuid/compare"],
        ["DELETE", "/api/simulations/nao-e-uuid"],
        ["GET", "/api/new-product-simulations/nao-e-uuid"],
        ["POST", "/api/new-product-simulations/nao-e-uuid/clone"],
        ["DELETE", "/api/new-product-simulations/nao-e-uuid"],
        ["POST", "/api/new-product-simulations/nao-e-uuid/archive"],
      ] as const) {
        const res = await requestJson(app, method, path);
        assert.equal(res.status, 400, `${method} ${path}`);
        assert.equal(res.json.error, "INVALID_ID");
      }
      assert.equal(app.db.touched.size, 0);
    });
  });

  it("erro do Prisma vira resposta HTTP e o servidor continua de pé", async () => {
    await withApp({}, async (app) => {
      app.db.failNext = { model: "simulation", op: "findMany", error: new Error("connection reset") };
      const failed = await requestJson(app, "GET", "/api/simulations");
      assert.equal(failed.status, 500);
      assert.equal(failed.json.error, "INTERNAL_ERROR");
      app.db.failNext = {
        model: "newProductSimulation",
        op: "findUnique",
        error: Object.assign(new Error("bad uuid"), { code: "P2023" }),
      };
      assert.equal((await requestJson(app, "GET", `/api/new-product-simulations/${TEST_IDS.missing}`)).status, 400);
      assert.equal((await requestJson(app, "GET", "/api/simulations")).status, 200);
    });
  });

  it("POST /api/simulations rejeita payload inválido", async () => {
    await withApp({}, async (app) => {
      const cases: Array<[Record<string, unknown>, string]> = [
        [{ name: "" }, "INVALID_NAME"],
        [{ productId: "x" }, "INVALID_PRODUCT_ID"],
        [{ taxRuleId: "" }, "INVALID_TAX_RULE_ID"],
        [{ materialAdj: "abc" }, "INVALID_ADJUSTMENT"],
        [{ materialAdj: 1e9 }, "ADJUSTMENT_OUT_OF_RANGE"],
        [{ efficiencyAdj: -100 }, "ADJUSTMENT_OUT_OF_RANGE"],
        [{ laborAdj: "NaN" }, "INVALID_ADJUSTMENT"],
        [{ marginAdj: "Infinity" }, "INVALID_ADJUSTMENT"],
        [{ baselineSource: "OFICIAL" }, "INVALID_BASELINE_SOURCE"],
      ];
      for (const [override, code] of cases) {
        const res = await requestJson(app, "POST", "/api/simulations", scenarioBody(override));
        assert.equal(res.status, 400, JSON.stringify(override));
        assert.equal(res.json.error, code);
      }
      assert.equal(app.db.tables.simulation.length, 0);
    });
  });

  it("campos extras do corpo não são persistidos (sem mass assignment)", async () => {
    await withApp({}, async (app) => {
      const res = await requestJson(
        app,
        "POST",
        "/api/simulations",
        scenarioBody({
          id: TEST_IDS.missing,
          createdAt: "2000-01-01T00:00:00Z",
          createdByUserId: TEST_IDS.missing,
          createdByName: "Falsa",
          archivedAt: "2000-01-01T00:00:00Z",
          baselineSnapshot: { hacked: true },
        })
      );
      assert.equal(res.status, 201);
      const row = app.db.tables.simulation[0];
      assert.notEqual(row.id, TEST_IDS.missing);
      assert.equal(row.createdByUserId, TEST_IDS.user, "autoria vem da sessão");
      assert.equal(row.createdByName, "Usuária da Sessão");
      assert.equal(row.archivedAt, null);
      assert.equal((row.baselineSnapshot as { hacked?: boolean }).hacked, undefined);
    });
  });

  it("produto ou premissas inexistentes são recusados na criação", async () => {
    await withApp({}, async (app) => {
      const noProduct = await requestJson(app, "POST", "/api/simulations", scenarioBody({ productId: TEST_IDS.missing }));
      assert.equal(noProduct.status, 404);
      const noPricing = await requestJson(app, "POST", "/api/simulations", scenarioBody({ taxRuleId: TEST_IDS.missing }));
      assert.equal(noPricing.status, 422);
      assert.equal(noPricing.json.error, "PRICING_PREMISES_NOT_FOUND");
    });
  });
});

describe("simulationsRoutes — cenário existente com base explícita", () => {
  it("padrão é PUBLISHED: base 1,70 com versão e revisão registradas", async () => {
    await withApp({}, async (app) => {
      const res = await requestJson(app, "POST", "/api/simulations", scenarioBody());
      assert.equal(res.status, 201);
      assert.equal(res.json.baselineSource, "PUBLISHED");
      assert.equal(res.json.baselineProductionCostVersionId, TEST_IDS.version);
      assert.equal(res.json.baselineRevision, 2);
      assert.ok(Math.abs(res.json.comparison.base.ciu - 1.7) < 1e-9);
      assert.equal(res.json.comparison.baseline.badge, "PUBLICADO");
      // MP +10% sobre 1,20 → +0,12
      assert.ok(Math.abs(res.json.comparison.deltas.mp.abs - 0.12) < 1e-9);
      assert.ok(Math.abs(res.json.comparison.simulated.ciu - 1.82) < 1e-9);
    });
  });

  it("LIVE explícito: base 1,30, sem versão, com instante do cálculo", async () => {
    await withApp({}, async (app) => {
      const res = await requestJson(app, "POST", "/api/simulations", scenarioBody({ baselineSource: "LIVE" }));
      assert.equal(res.status, 201);
      assert.equal(res.json.baselineSource, "LIVE");
      assert.equal(res.json.baselineProductionCostVersionId, null);
      assert.ok(Math.abs(res.json.comparison.base.ciu - 1.3) < 1e-9);
      assert.equal(res.json.comparison.baseline.badge, "LIVE — NÃO PUBLICADO");
      assert.equal(res.json.comparison.baseline.calculatedAt, "2026-10-05T15:00:00.000Z");
      assert.deepEqual(app.publishedReads, [], "LIVE não consulta custo publicado");
    });
  });

  it("sem custo publicado: 422 explícito, sem fallback automático para LIVE", async () => {
    await withApp({}, async (app) => {
      const res = await requestJson(
        app,
        "POST",
        "/api/simulations",
        scenarioBody({ productId: TEST_IDS.productNoPublished })
      );
      assert.equal(res.status, 422);
      assert.equal(res.json.error, "NO_PUBLISHED_COST");
      assert.match(res.json.message, /não possui custo oficial publicado/);
      assert.equal(app.db.tables.simulation.length, 0);
    });
  });

  it("compare usa a base congelada: reproduzível e com produto/SKU", async () => {
    await withApp({}, async (app) => {
      const created = await requestJson(app, "POST", "/api/simulations", scenarioBody({ laborAdj: 50 }));
      const first = await requestJson(app, "GET", `/api/simulations/${created.json.id}/compare`);
      const second = await requestJson(app, "GET", `/api/simulations/${created.json.id}/compare`);
      assert.equal(first.status, 200);
      assert.deepEqual(first.json, second.json);
      assert.equal(first.json.base.product, "Produto real");
      assert.equal(first.json.base.sku, "610.01AA");
      assert.equal(first.json.simulationMethod, "DRIVER_SIMULATION");
      assert.ok(Math.abs(first.json.breakdown.simulated.hh - 0.45) < 1e-9);
      assert.ok(Math.abs(first.json.deltas.total.abs - (0.12 + 0.15)) < 1e-9);
      assert.ok(first.json.deltas.total.pct > 0);
    });
  });

  it("eficiência sobre base publicada sem decomposição: limitação explícita, não número", async () => {
    await withApp({}, async (app) => {
      const res = await requestJson(app, "POST", "/api/simulations", scenarioBody({ efficiencyAdj: 10 }));
      assert.equal(res.status, 422);
      assert.equal(res.json.error, "EFFICIENCY_DECOMPOSITION_UNAVAILABLE");
    });
  });

  it("eficiência em LIVE não reduz setup nem MP", async () => {
    await withApp({}, async (app) => {
      const res = await requestJson(
        app,
        "POST",
        "/api/simulations",
        scenarioBody({ baselineSource: "LIVE", materialAdj: 0, efficiencyAdj: 25 })
      );
      assert.equal(res.status, 201);
      const cmp = res.json.comparison;
      assert.equal(cmp.efficiencyApplied, true);
      // processo 0,30 = transformação 0,24 + setup 0,06 → 0,24/1,25 + 0,06 = 0,252
      const process = cmp.breakdown.simulated.hh + cmp.breakdown.simulated.hm;
      assert.ok(Math.abs(process - 0.252) < 1e-9, String(process));
      assert.equal(cmp.breakdown.simulated.mp, 1);
    });
  });

  it("eficiência em PUBLISHED é permitida quando o processo vivo coincide com o publicado", async () => {
    await withApp({ analysis: liveAnalysis({ mp: 1.2, hh: 0.3, hm: 0.2, setup: 0.1 }) }, async (app) => {
      const res = await requestJson(app, "POST", "/api/simulations", scenarioBody({ materialAdj: 0, efficiencyAdj: 100 }));
      assert.equal(res.status, 201);
      const process = res.json.comparison.breakdown.simulated.hh + res.json.comparison.breakdown.simulated.hm;
      // 0,50 = 0,40 transformação + 0,10 setup → 0,20 + 0,10
      assert.ok(Math.abs(process - 0.3) < 1e-9, String(process));
    });
  });

  it("margem impossível: custo simulado continua disponível e o preço vem como problema explícito", async () => {
    const db = createFakeDb({ pricing: { desiredMargin: 80, commission: 3, otherVariables: 0, freightOut: 0, taxPct: 18 } });
    await withApp({ db }, async (app) => {
      const created = await requestJson(app, "POST", "/api/simulations", scenarioBody());
      assert.equal(created.status, 201);
      const cmp = created.json.comparison;
      assert.equal(cmp.base.resultados.suggestedPrice, null);
      assert.equal(cmp.simulated.suggestedPrice, null);
      assert.equal(cmp.delta.price, null);
      assert.equal(cmp.pricingIssue.code, "IMPOSSIBLE_PREMISES");
      assert.ok(cmp.simulated.ciu > 0);
    });
  });

  it("registro legado (sem base gravada) abre rotulado como legado", async () => {
    await withApp({}, async (app) => {
      app.db.tables.simulation.push({
        id: TEST_IDS.version,
        name: "Antigo",
        productId: TEST_IDS.product,
        taxRuleId: TEST_IDS.taxRule,
        materialAdj: 15,
        laborAdj: 5,
        indirectAdj: 0,
        efficiencyAdj: 2,
        marginAdj: 0,
        baselineSnapshot: null,
        baselineSource: null,
        archivedAt: null,
      });
      const res = await requestJson(app, "GET", `/api/simulations/${TEST_IDS.version}/compare`);
      assert.equal(res.status, 200);
      assert.equal(res.json.simulationMethod, "LEGACY_AGGREGATE_SCALING");
      assert.equal(res.json.baseline.source, "LEGACY_LIVE");
      assert.equal(res.json.base.sku, "610.01AA");
      const list = await requestJson(app, "GET", "/api/simulations");
      assert.equal(list.json[0].baselineBadge, "LEGADO — BASE NÃO REGISTRADA");
    });
  });

  it("DELETE arquiva (não apaga) e a lista padrão esconde arquivados", async () => {
    await withApp({}, async (app) => {
      const created = await requestJson(app, "POST", "/api/simulations", scenarioBody());
      const del = await requestJson(app, "DELETE", `/api/simulations/${created.json.id}`);
      assert.deepEqual(del.json, { success: true, archived: true });
      assert.equal(app.db.tables.simulation.length, 1, "linha preservada");
      assert.equal(app.db.tables.simulation[0].archivedByUserId, TEST_IDS.user);
      assert.equal((await requestJson(app, "GET", "/api/simulations")).json.length, 0);
      assert.equal((await requestJson(app, "GET", "/api/simulations?includeArchived=1")).json.length, 1);
      await requestJson(app, "POST", `/api/simulations/${created.json.id}/unarchive`);
      assert.equal((await requestJson(app, "GET", "/api/simulations")).json.length, 1);
      assert.equal((await requestJson(app, "DELETE", `/api/simulations/${TEST_IDS.missing}`)).status, 404);
    });
  });
});

describe("simulationsRoutes — novo produto com servidor como autoridade", () => {
  it("snapshot montado no navegador é recusado", async () => {
    await withApp({}, async (app) => {
      const res = await requestJson(app, "POST", "/api/new-product-simulations/save", {
        simulationName: "x",
        snapshot: { header: { productName: "x" }, result: { costBase: 0.01 } },
      });
      assert.equal(res.status, 400);
      assert.equal(res.json.error, "SNAPSHOT_NOT_ACCEPTED");
      assert.equal(app.db.tables.newProductSimulation.length, 0);
    });
  });

  it("servidor recalcula: números enviados pelo cliente são ignorados", async () => {
    await withApp({}, async (app) => {
      const res = await requestJson(app, "POST", "/api/new-product-simulations/save", {
        inputs: { ...newProductInputs(), result: { costBase: 0.01 }, createdBy: "Falsa" },
        snapshot: { result: { costBase: 0.01 } },
        createdBy: "Falsa",
        freeze: true,
      });
      assert.equal(res.status, 201);
      const snap = res.json.snapshot;
      assert.equal(snap.schemaVersion, 2);
      assert.equal(snap.kind, "SIMULATION_SNAPSHOT");
      // existente PUBLISHED 1,70 × 2 = 3,40
      const existing = snap.composition.lines[0];
      assert.equal(existing.baseline.source, "PUBLISHED");
      assert.equal(existing.baseline.productionCostVersionId, TEST_IDS.version);
      assert.equal(existing.baseline.productionCostRevision, 2);
      assert.ok(Math.abs(existing.lineTotal - 3.4) < 1e-9);
      // simulado: MP 0,5 kg × (9 + 1) = 5,00; processo: HH 60 + HM 20 = 80/h, 200 pç/h → 0,40 + setup 80/1000 = 0,08
      const component = snap.composition.simulatedComponents[0];
      assert.ok(Math.abs(component.mp - 5) < 1e-9);
      assert.ok(Math.abs(component.hh + component.hm - 0.48) < 1e-9);
      assert.equal(component.processResult.hhRatePerHour, 60);
      assert.equal(component.processResult.hmRatePerHour, 20);
      assert.ok(Math.abs(component.processResult.setupCost - 0.08) < 1e-9);
      assert.equal(component.materials[0].source, "CATALOG");
      assert.equal(component.materials[0].costOverridden, false);
      assert.equal(component.materials[0].catalogEffectiveUnitCost, 10);
      // direto: 4 × 0,25 = 1,00
      assert.equal(snap.composition.lines[2].costOrigin, "MANUAL_DIRECT");
      assert.ok(Math.abs(snap.result.costBase - (3.4 + 5.48 + 1)) < 1e-9);
      assert.deepEqual(snap.hourCosts, { globalHhCostPerHour: 60, machineHourCostPerHour: 20, hhSource: "AUTO" });
      // autoria e datas do servidor
      assert.equal(res.json.createdByUserId, TEST_IDS.user);
      assert.equal(snap.header.createdBy, "Usuária da Sessão");
      assert.equal(snap.header.savedAt, "2026-10-05T15:00:00.000Z");
      assert.equal(res.json.status, "SAVED");
      assert.match(res.json.snapshotHash, /^[0-9a-f]{64}$/);
      // sem premissas comerciais: análise industrial preliminar, nunca "viável"
      assert.equal(snap.result.analysis.kind, "INDUSTRIAL_PRELIMINARY");
      assert.equal(snap.result.viability, undefined);
      assert.ok(Math.abs(snap.result.price - snap.result.costBase / 0.8) < 1e-9);
    });
  });

  it("override manual de custo de catálogo fica registrado", async () => {
    await withApp({}, async (app) => {
      const inputs = newProductInputs();
      (inputs.simulatedComponents as any)[0].materials[0].unitCost = 12.5;
      const res = await requestJson(app, "POST", "/api/new-product-simulations/preview", { inputs });
      assert.equal(res.status, 200);
      const material = res.json.snapshot.composition.simulatedComponents[0].materials[0];
      assert.equal(material.costOverridden, true);
      assert.equal(material.unitCost, 12.5);
      assert.equal(material.catalogEffectiveUnitCost, 10);
      assert.equal(app.db.writes.length, 0, "preview não grava");
    });
  });

  it("componente existente sem custo publicado: 422 com a linha, sem fallback", async () => {
    await withApp({}, async (app) => {
      const inputs = newProductInputs();
      (inputs.lines as any)[0].productId = TEST_IDS.productNoPublished;
      const res = await requestJson(app, "POST", "/api/new-product-simulations/save", { inputs });
      assert.equal(res.status, 422);
      assert.equal(res.json.error, "NO_PUBLISHED_COST");
      assert.equal(res.json.details[0].lineId, "l1");
      assert.equal(app.db.tables.newProductSimulation.length, 0);
    });
  });

  it("componente existente em LIVE (padrão do novo produto) registra a base", async () => {
    await withApp({}, async (app) => {
      const inputs = newProductInputs();
      delete (inputs.lines as any)[0].baselineSource;
      const res = await requestJson(app, "POST", "/api/new-product-simulations/preview", { inputs });
      const line = res.json.snapshot.composition.lines[0];
      assert.equal(line.baseline.source, "LIVE");
      assert.equal(line.baseline.calculatedAt, "2026-10-05T15:00:00.000Z");
      assert.deepEqual(line.breakdown, { mp: 2, hh: 0.4, hm: 0.2 }, "MP/HH/HM reais, nunca tudo em MP");
    });
  });

  it("análise comercial da simulação usa imposto, comissão e frete — e é rotulada como simulada", async () => {
    await withApp({}, async (app) => {
      const inputs = newProductInputs({
        lines: [{ id: "l3", type: "DIRECT_MATERIAL", description: "Kit", unit: "UN", quantity: 1, unitCost: 10 }],
        simulatedComponents: [],
        commercial: {
          mode: "MARGIN",
          desiredMarginPct: 20,
          targetPrice: 0,
          premises: { taxRuleId: TEST_IDS.taxRule, commissionRatePct: 3, otherRatePct: 0, freight: 0 },
        },
      });
      const res = await requestJson(app, "POST", "/api/new-product-simulations/preview", { inputs });
      const snap = res.json.snapshot;
      assert.equal(snap.result.analysis.kind, "COMMERCIAL_SIMULATED");
      assert.match(snap.result.analysis.priceLabel, /simulad/i);
      assert.equal(snap.commercial.premises.taxRatePct, 18);
      // 10 / (1 − 0,18 − 0,03 − 0,20) = 16,949152…
      assert.ok(Math.abs(snap.result.price - 10 / 0.59) < 1e-9);
      assert.ok(!app.db.touched.has("productPricing"), "não lê nem escreve ProductPricing");
    });
  });

  it("premissas impossíveis não viram preço 0", async () => {
    await withApp({}, async (app) => {
      const inputs = newProductInputs({
        commercial: {
          mode: "MARGIN",
          desiredMarginPct: 90,
          targetPrice: 0,
          premises: { taxRatePct: 18, commissionRatePct: 3, otherRatePct: 0, freight: 0 },
        },
      });
      const res = await requestJson(app, "POST", "/api/new-product-simulations/preview", { inputs });
      assert.equal(res.json.snapshot.result.price, null);
      assert.equal(res.json.snapshot.result.analysis.error.code, "IMPOSSIBLE_PREMISES");
    });
  });

  it("congelada é imutável; clone gera rascunho com linhagem; salvar o clone preserva a origem", async () => {
    await withApp({}, async (app) => {
      const saved = await requestJson(app, "POST", "/api/new-product-simulations/save", { inputs: newProductInputs() });
      const frozenSnapshot = JSON.stringify(app.db.tables.newProductSimulation[0].snapshot);

      const overwrite = await requestJson(app, "POST", "/api/new-product-simulations/save", {
        inputs: newProductInputs({ productName: "Alterado" }),
        draftId: saved.json.id,
      });
      assert.equal(overwrite.status, 409);
      assert.equal(overwrite.json.error, "SIMULATION_FROZEN");

      const clone = await requestJson(app, "POST", `/api/new-product-simulations/${saved.json.id}/clone`);
      assert.equal(clone.status, 201);
      assert.equal(clone.json.status, "DRAFT");
      assert.equal(clone.json.sourceSimulationId, saved.json.id);

      const edited = newProductInputs({ productName: "Novo corpo XYZ rev. B" });
      (edited.lines as any)[2].unitCost = 0.5;
      const draftSave = await requestJson(app, "POST", "/api/new-product-simulations/save", {
        inputs: edited,
        draftId: clone.json.id,
        freeze: false,
      });
      assert.equal(draftSave.status, 200);
      assert.equal(draftSave.json.status, "DRAFT");
      const frozenClone = await requestJson(app, "POST", "/api/new-product-simulations/save", {
        inputs: edited,
        draftId: clone.json.id,
        freeze: true,
      });
      assert.equal(frozenClone.json.status, "SAVED");
      assert.equal(frozenClone.json.sourceSimulationId, saved.json.id, "linhagem preservada");
      assert.equal(app.db.tables.newProductSimulation.length, 2, "rascunho virou a congelada; sem órfão");

      assert.equal(JSON.stringify(app.db.tables.newProductSimulation[0].snapshot), frozenSnapshot);
      const reopened = await requestJson(app, "GET", `/api/new-product-simulations/${saved.json.id}`);
      assert.equal(JSON.stringify(reopened.json.snapshot), frozenSnapshot, "reabrir = mesmo resultado");
    });
  });

  it("excluir: só rascunho; congelada é arquivada e sai da lista padrão", async () => {
    await withApp({}, async (app) => {
      const saved = await requestJson(app, "POST", "/api/new-product-simulations/save", { inputs: newProductInputs() });
      const del = await requestJson(app, "DELETE", `/api/new-product-simulations/${saved.json.id}`);
      assert.equal(del.status, 409);
      assert.equal(del.json.error, "FROZEN_SIMULATION_NOT_DELETABLE");

      const archived = await requestJson(app, "POST", `/api/new-product-simulations/${saved.json.id}/archive`);
      assert.equal(archived.json.status, "ARCHIVED");
      assert.equal(app.db.tables.newProductSimulation[0].archivedByUserId, TEST_IDS.user);
      assert.equal((await requestJson(app, "GET", "/api/new-product-simulations")).json.length, 0);
      assert.equal((await requestJson(app, "GET", "/api/new-product-simulations?status=ARCHIVED")).json.length, 1);
      const restored = await requestJson(app, "POST", `/api/new-product-simulations/${saved.json.id}/unarchive`);
      assert.equal(restored.json.status, "SAVED");

      const clone = await requestJson(app, "POST", `/api/new-product-simulations/${saved.json.id}/clone`);
      assert.equal((await requestJson(app, "DELETE", `/api/new-product-simulations/${clone.json.id}`)).status, 204);
      assert.equal(app.db.tables.newProductSimulation.length, 1);
    });
  });
});

describe("simulationsRoutes — fronteira com o universo oficial", () => {
  it("fluxo completo só escreve em Simulation e NewProductSimulation", async () => {
    await withApp({}, async (app) => {
      const scenario = await requestJson(app, "POST", "/api/simulations", scenarioBody());
      await requestJson(app, "POST", "/api/simulations", scenarioBody({ baselineSource: "LIVE" }));
      await requestJson(app, "GET", `/api/simulations/${scenario.json.id}/compare`);
      await requestJson(app, "DELETE", `/api/simulations/${scenario.json.id}`);
      const saved = await requestJson(app, "POST", "/api/new-product-simulations/save", { inputs: newProductInputs() });
      await requestJson(app, "POST", `/api/new-product-simulations/${saved.json.id}/clone`);
      await requestJson(app, "POST", `/api/new-product-simulations/${saved.json.id}/archive`);
      await requestJson(app, "GET", `/api/simulations/product-baseline?productId=${TEST_IDS.product}&source=PUBLISHED`);

      assert.deepEqual([...new Set(app.db.writes.map((w) => w.model))].sort(), ["newProductSimulation", "simulation"]);
      // O Prisma falso lança em qualquer modelo fora da lista; chegar aqui prova que nenhum
      // modelo oficial de custo/preço (ProductionCostTable*, PriceTable*) foi acessado.
      for (const model of app.db.touched) {
        assert.ok(
          ["product", "material", "taxRule", "productPricing", "simulation", "newProductSimulation"].includes(model),
          model
        );
      }
    });
  });

  it("product-baseline devolve estado explícito quando não há custo publicado", async () => {
    await withApp({}, async (app) => {
      const res = await requestJson(
        app,
        "GET",
        `/api/simulations/product-baseline?productId=${TEST_IDS.productNoPublished}&source=PUBLISHED`
      );
      assert.equal(res.status, 200);
      assert.equal(res.json.status, "NO_PUBLISHED_COST");
      const bad = await requestJson(app, "GET", `/api/simulations/product-baseline?productId=${TEST_IDS.product}&source=X`);
      assert.equal(bad.status, 400);
    });
  });
});
