import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeStandardProcessUnitCosts } from "./componentStandardProcessCost.js";
import type { ProductCostBaselineOk } from "./productCostBaseline.js";
import { simulateScenarioDrivers, simulateScenarioFromBreakdown } from "./simulationFormula.js";
import {
  buildScenarioBaselineSnapshot,
  computeLegacyScenarioComparison,
  computeScenarioComparison,
  parseScenarioBaselineSnapshot,
  type ScenarioPricingPremises,
} from "./simulationScenario.js";

const near = (actual: number, expected: number, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);

const NO_ADJ = { materialAdjPct: 0, laborAdjPct: 0, hmAdjPct: 0, efficiencyAdjPct: 0, marginAdjPct: 0 };

const pricing: ScenarioPricingPremises = {
  taxRuleId: "t",
  taxRuleName: "Venda SP",
  taxRatePct: 18,
  commRatePct: 3,
  otherRatePct: 0,
  marginRatePct: 20,
  freight: 0,
};

function cost(overrides: Partial<ProductCostBaselineOk>): ProductCostBaselineOk {
  return {
    status: "OK",
    source: "LIVE",
    productId: "p",
    sku: "610.01AA",
    name: "Produto",
    totalMaterialCost: 1,
    totalHHUnit: 0.2,
    totalHMUnit: 0.1,
    totalIndustrialCost: 1.3,
    productionCostVersionId: null,
    productionCostVersionCode: null,
    productionCostRevision: null,
    effectiveDate: null,
    publishedAt: null,
    calculatedAt: "2026-10-05T15:00:00.000Z",
    referenceDate: null,
    ownProcess: null,
    warnings: [],
    metadata: { context: "ENGINEERING_SCENARIO", costAnalysisPartial: false },
    ...overrides,
  };
}

const snapshot = (overrides: Partial<ProductCostBaselineOk> = {}, p: ScenarioPricingPremises = pricing) =>
  buildScenarioBaselineSnapshot({ cost: cost(overrides), pricing: p, capturedAt: new Date("2026-10-05T15:00:00Z") });

describe("simulateScenarioDrivers — MP, HH, HM", () => {
  it("cada driver altera só o seu componente", () => {
    const base = { mp: 10, hh: 2, hm: 3, ownProcess: null };
    const mp = simulateScenarioDrivers(base, { ...NO_ADJ, materialAdjPct: 10 });
    assert.ok(mp.ok === true);
    if (mp.ok === true) {
      near(mp.simulated.mp, 11);
      assert.equal(mp.simulated.hh, 2);
      assert.equal(mp.simulated.hm, 3);
    }
    const hh = simulateScenarioDrivers(base, { ...NO_ADJ, laborAdjPct: 8 });
    if (hh.ok === true) {
      near(hh.simulated.hh, 2.16);
      assert.equal(hh.simulated.mp, 10);
    }
    const hm = simulateScenarioDrivers(base, { ...NO_ADJ, hmAdjPct: 15 });
    if (hm.ok === true) near(hm.simulated.hm, 3.45);
  });

  it("valores inválidos, negativos ou abaixo de −100% são recusados", () => {
    const base = { mp: 10, hh: 2, hm: 3, ownProcess: null };
    for (const adj of [
      { ...NO_ADJ, materialAdjPct: Number.NaN },
      { ...NO_ADJ, laborAdjPct: Number.POSITIVE_INFINITY },
      { ...NO_ADJ, hmAdjPct: -150 },
    ]) {
      const r = simulateScenarioDrivers(base, adj);
      assert.equal(r.ok, false);
      if (r.ok === false) assert.equal(r.code, "INVALID_INPUT");
    }
    const negative = simulateScenarioDrivers({ mp: -1, hh: 0, hm: 0, ownProcess: null }, NO_ADJ);
    assert.equal(negative.ok, false);
  });
});

describe("simulateScenarioDrivers — eficiência igual ao motor físico", () => {
  const process = {
    cycleTimeSeconds: 36,
    cavities: 2,
    efficiencyExpectedPercent: 80,
    setupTimeMin: 90,
    lotSize: 500,
    globalHhCostPerHour: 60,
    machineHourCostPerHour: 20,
  };

  function ownProcessOf(result: ReturnType<typeof computeStandardProcessUnitCosts>) {
    assert.ok(result.ok === true);
    if (result.ok !== true) throw new Error("unreachable");
    const hhRatio = result.globalHhCostPerHour / result.cellHourCost;
    const hmRatio = result.machineHourCostPerHour / result.cellHourCost;
    return {
      result,
      own: {
        transformHh: result.unitTransform * hhRatio,
        transformHm: result.unitTransform * hmRatio,
        setupHh: result.setupCost * hhRatio,
        setupHm: result.setupCost * hmRatio,
      },
    };
  }

  for (const efficiencyAdjPct of [25, 10, -5, -50, 100]) {
    it(`setup > 0, eficiência ${efficiencyAdjPct > 0 ? "+" : ""}${efficiencyAdjPct}%: bate com computeStandardProcessUnitCosts`, () => {
      const { result: baseResult, own } = ownProcessOf(computeStandardProcessUnitCosts(process));
      // filhos da BOM contribuem com HH/HM que NÃO podem ser escalados
      const childHh = 0.4;
      const childHm = 0.15;
      const sim = simulateScenarioDrivers(
        { mp: 5, hh: baseResult.totalHH_Unit + childHh, hm: baseResult.totalHM_Unit + childHm, ownProcess: own },
        { ...NO_ADJ, efficiencyAdjPct }
      );
      const engine = computeStandardProcessUnitCosts({
        ...process,
        efficiencyExpectedPercent: process.efficiencyExpectedPercent * (1 + efficiencyAdjPct / 100),
      });
      assert.ok(sim.ok === true && engine.ok === true);
      if (sim.ok === true && engine.ok === true) {
        near(sim.simulated.hh, engine.totalHH_Unit + childHh, 1e-9);
        near(sim.simulated.hm, engine.totalHM_Unit + childHm, 1e-9);
        assert.equal(sim.simulated.mp, 5);
        near(engine.setupCost, baseResult.setupCost, 1e-12); // setup não muda com eficiência
        assert.equal(sim.efficiencyApplied, true);
      }
    });
  }

  it("setup = 0: equivale a dividir a transformação", () => {
    const { result, own } = ownProcessOf(computeStandardProcessUnitCosts({ ...process, setupTimeMin: 0 }));
    const sim = simulateScenarioDrivers(
      { mp: 0, hh: result.totalHH_Unit, hm: result.totalHM_Unit, ownProcess: own },
      { ...NO_ADJ, efficiencyAdjPct: 25 }
    );
    if (sim.ok === true) near(sim.simulated.hh + sim.simulated.hm, result.totalStepCost / 1.25);
  });

  it("a fórmula legada escalava setup e filhos — divergência documentada", () => {
    const { result, own } = ownProcessOf(computeStandardProcessUnitCosts(process));
    const legacy = simulateScenarioFromBreakdown(
      { mp: 0, hh: result.totalHH_Unit, hm: result.totalHM_Unit },
      { ...NO_ADJ, efficiencyAdjPct: 25 },
      { taxRatePct: 0, commRatePct: 0, otherRatePct: 0, marginRatePct: 0, freight: 0 }
    );
    const drivers = simulateScenarioDrivers(
      { mp: 0, hh: result.totalHH_Unit, hm: result.totalHM_Unit, ownProcess: own },
      { ...NO_ADJ, efficiencyAdjPct: 25 }
    );
    assert.ok(drivers.ok === true);
    if (drivers.ok === true) {
      assert.ok(legacy.simulated.costBase < drivers.simulated.costBase, "legado reduzia também o setup");
    }
  });

  it("eficiência ≤ −100% é recusada (nunca fator 0,000001)", () => {
    const own = { transformHh: 1, transformHm: 1, setupHh: 0, setupHm: 0 };
    for (const efficiencyAdjPct of [-100, -150]) {
      const r = simulateScenarioDrivers({ mp: 1, hh: 1, hm: 1, ownProcess: own }, { ...NO_ADJ, efficiencyAdjPct });
      assert.equal(r.ok, false);
      if (r.ok === false) assert.equal(r.code, "INVALID_EFFICIENCY");
    }
  });

  it("sem decomposição (ou decomposição incoerente) não inventa número", () => {
    const missing = simulateScenarioDrivers({ mp: 1, hh: 1, hm: 1, ownProcess: null }, { ...NO_ADJ, efficiencyAdjPct: 10 });
    assert.equal(missing.ok, false);
    if (missing.ok === false) assert.equal(missing.code, "EFFICIENCY_DECOMPOSITION_UNAVAILABLE");
    const incoherent = simulateScenarioDrivers(
      { mp: 1, hh: 1, hm: 1, ownProcess: { transformHh: 5, transformHm: 0, setupHh: 0, setupHm: 0 } },
      { ...NO_ADJ, efficiencyAdjPct: 10 }
    );
    assert.equal(incoherent.ok, false);
    // sem eficiência, a ausência de decomposição não impede o cenário
    assert.equal(simulateScenarioDrivers({ mp: 1, hh: 1, hm: 1, ownProcess: null }, NO_ADJ).ok, true);
  });
});

describe("computeScenarioComparison — referência numérica LIVE × PUBLISHED", () => {
  it("LIVE 1,30 e PUBLISHED 1,70 são bases distintas e rotuladas", () => {
    const live = computeScenarioComparison(snapshot(), NO_ADJ);
    const published = computeScenarioComparison(
      snapshot({
        source: "PUBLISHED",
        totalMaterialCost: 1.2,
        totalHHUnit: 0.3,
        totalHMUnit: 0.2,
        totalIndustrialCost: 1.7,
        productionCostVersionId: "v1",
        productionCostVersionCode: "2026-10",
        productionCostRevision: 2,
        effectiveDate: "2026-10-01",
        calculatedAt: null,
      }),
      NO_ADJ
    );
    near(live.base.ciu, 1.3);
    near(published.base.ciu, 1.7);
    assert.equal(live.baseline.badge, "LIVE — NÃO PUBLICADO");
    assert.equal(published.baseline.badge, "PUBLICADO");
    assert.equal(published.baseline.productionCostRevision, 2);
    assert.equal(live.deltas.total.abs, 0);
  });

  it("preço simulado: imposto 18%, comissão 3%, margem 20% → custo / 0,59", () => {
    const cmp = computeScenarioComparison(snapshot({ totalMaterialCost: 10, totalHHUnit: 0, totalHMUnit: 0 }), NO_ADJ);
    near(cmp.base.resultados.suggestedPrice as number, 10 / 0.59);
    near(cmp.simulated.markup as number, 1 / 0.59);
  });

  it("deltas absolutos e percentuais por componente; processo = HH + HM", () => {
    const cmp = computeScenarioComparison(snapshot(), { ...NO_ADJ, materialAdjPct: 10, laborAdjPct: 50, hmAdjPct: -20 });
    near(cmp.deltas.mp.abs, 0.1);
    near(cmp.deltas.mp.pct as number, 10);
    near(cmp.deltas.hh.abs, 0.1);
    near(cmp.deltas.hm.abs, -0.02);
    near(cmp.deltas.process.abs, 0.08);
    near(cmp.deltas.total.abs, 0.18);
    near(cmp.delta.ciuPct as number, (0.18 / 1.3) * 100);
    assert.equal(cmp.costIssue, null);
  });

  it("base zerada não gera Infinity/NaN nos percentuais", () => {
    const cmp = computeScenarioComparison(
      snapshot({ totalMaterialCost: 0, totalHHUnit: 0, totalHMUnit: 0 }),
      { ...NO_ADJ, materialAdjPct: 10 }
    );
    assert.equal(cmp.deltas.total.pct, null);
    assert.equal(cmp.delta.ciuPct, null);
    assert.ok(JSON.stringify(cmp).indexOf("null") >= 0);
    assert.ok(!/NaN|Infinity/.test(JSON.stringify(cmp)));
  });

  it("premissas impossíveis: preço nulo com motivo, custo preservado", () => {
    const cmp = computeScenarioComparison(snapshot({}, { ...pricing, marginRatePct: 79 }), NO_ADJ);
    assert.equal(cmp.base.resultados.suggestedPrice, null);
    assert.equal(cmp.pricingIssue?.code, "IMPOSSIBLE_PREMISES");
    near(cmp.simulated.ciu, 1.3);
    // margem do cenário que estoura o divisor
    const scenarioOnly = computeScenarioComparison(snapshot(), { ...NO_ADJ, marginAdjPct: 300 });
    assert.ok(scenarioOnly.base.resultados.suggestedPrice != null);
    assert.equal(scenarioOnly.simulated.suggestedPrice, null);
    assert.match(scenarioOnly.pricingIssue?.message ?? "", /^Cenário:/);
  });

  it("snapshot inválido não é aceito; válido é reidratado", () => {
    assert.equal(parseScenarioBaselineSnapshot(null), null);
    assert.equal(parseScenarioBaselineSnapshot({ schemaVersion: 1 }), null);
    assert.equal(parseScenarioBaselineSnapshot({ ...snapshot(), cost: { ...snapshot().cost, mp: "x" } }), null);
    const roundTrip = parseScenarioBaselineSnapshot(JSON.parse(JSON.stringify(snapshot())));
    assert.equal(roundTrip?.cost.source, "LIVE");
  });
});

describe("computeLegacyScenarioComparison — registros sem base gravada", () => {
  const live = { name: "Produto", sku: "610.01AA", mp: 1, hh: 0.2, hm: 0.1, calculatedAt: "2026-10-05T15:00:00.000Z" };

  it("preserva o cálculo histórico, rotulado como legado", () => {
    const cmp = computeLegacyScenarioComparison(live, pricing, { ...NO_ADJ, materialAdjPct: 100, efficiencyAdjPct: 25 });
    assert.equal(cmp.simulationMethod, "LEGACY_AGGREGATE_SCALING");
    assert.equal(cmp.baseline.source, "LEGACY_LIVE");
    near(cmp.breakdown.simulated.mp, 2);
    near(cmp.breakdown.simulated.hh, 0.2 / 1.25);
  });

  it("eficiência ≤ −100% em registro legado vira problema explícito", () => {
    const cmp = computeLegacyScenarioComparison(live, pricing, { ...NO_ADJ, efficiencyAdjPct: -100 });
    assert.equal(cmp.costIssue?.code, "INVALID_EFFICIENCY");
    assert.equal(cmp.simulated.suggestedPrice, null);
    near(cmp.simulated.ciu, 1.3);
  });
});

describe("eficiência — exemplo numérico explícito (X, Y, Z, F, S)", () => {
  // material X = 10,00 | mão de obra própria (transformação) Y = 2,00 | máquina própria
  // (transformação) Z = 3,00 | filhos F = 1,00 (HH) + 1,50 (HM) | setup S = 0,50 (HH) + 0,50 (HM)
  const base = {
    mp: 10,
    hh: 2 + 0.5 + 1, // Y + setup HH + filhos HH = 3,50
    hm: 3 + 0.5 + 1.5, // Z + setup HM + filhos HM = 5,00
    ownProcess: { transformHh: 2, transformHm: 3, setupHh: 0.5, setupHm: 0.5 },
  };

  it("eficiência +25% só divide Y e Z; material, filhos e setup ficam iguais", () => {
    const r = simulateScenarioDrivers(base, { ...NO_ADJ, efficiencyAdjPct: 25 });
    assert.ok(r.ok === true);
    if (r.ok === true) {
      assert.equal(r.simulated.mp, 10); // X intacto
      near(r.simulated.hh, 2 / 1.25 + 0.5 + 1); // 1,60 + 0,50 + 1,00 = 3,10
      near(r.simulated.hm, 3 / 1.25 + 0.5 + 1.5); // 2,40 + 0,50 + 1,50 = 4,40
      near(r.simulated.costBase, 17.5);
      near(r.base.costBase, 18.5);
      // a redução total é exatamente a da transformação própria: (2 + 3) × (1 − 1/1,25) = 1,00
      near(r.base.costBase - r.simulated.costBase, 1);
    }
  });

  it("eficiência −20% só aumenta Y e Z", () => {
    const r = simulateScenarioDrivers(base, { ...NO_ADJ, efficiencyAdjPct: -20 });
    if (r.ok === true) {
      assert.equal(r.simulated.mp, 10);
      near(r.simulated.hh, 2 / 0.8 + 0.5 + 1); // 4,00
      near(r.simulated.hm, 3 / 0.8 + 0.5 + 1.5); // 5,75
    }
  });

  it("a base informada não é mutada pelo cálculo", () => {
    const frozen = JSON.stringify(base);
    simulateScenarioDrivers(base, { ...NO_ADJ, materialAdjPct: 30, laborAdjPct: 10, hmAdjPct: 5, efficiencyAdjPct: 40 });
    assert.equal(JSON.stringify(base), frozen);
  });

  it("drivers combinados: taxa-hora multiplica o processo já ajustado pela eficiência", () => {
    const r = simulateScenarioDrivers(base, { ...NO_ADJ, materialAdjPct: 10, laborAdjPct: 8, hmAdjPct: 15, efficiencyAdjPct: 25 });
    if (r.ok === true) {
      near(r.simulated.mp, 11);
      near(r.simulated.hh, 3.1 * 1.08);
      near(r.simulated.hm, 4.4 * 1.15);
    }
  });
});
