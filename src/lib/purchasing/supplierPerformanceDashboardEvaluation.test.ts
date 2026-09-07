/**
 * Compras → Performance — a avaliação existente é preservada 100%.
 * Prova: escala V2 1–5, pesos 25/25/25/25, só finalizadas, sem ponderação por
 * spend, V1 não convertido, V1 e V2 nunca misturados, cobertura reaproveitada.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SUPPLIER_EVALUATION_CRITERIA,
  SUPPLIER_EVALUATION_METHODOLOGY_ID,
  SUPPLIER_EVALUATION_METHODOLOGY_V1,
  SUPPLIER_EVALUATION_METHODOLOGY_V2,
  SUPPLIER_EVALUATION_METHODOLOGY_VERSION,
  SUPPLIER_EVALUATION_SCORE_MAX,
  SUPPLIER_EVALUATION_SCORE_MIN,
  buildSupplierPerformanceSummary,
  computeSupplierOrderEvaluation,
} from "./supplierPerformance.js";
import {
  buildDashboardSupplierEvaluation,
  buildSupplierPerformanceDashboard,
  buildSupplierPerformanceSupplierDetail,
  type DashboardEvaluationInput,
} from "./supplierPerformanceDashboard.js";
import { FIXTURE_FILTERS_2026, S1, S2, S3, approx, buildFixtureInput } from "./supplierPerformanceDashboardFixture.test-helper.js";

function evaluation(partial: Partial<DashboardEvaluationInput> & { nomusPurchaseOrderId: string }): DashboardEvaluationInput {
  return {
    overallScore: 4,
    qualityScore: 4,
    deliveryScore: 4,
    conformityScore: 4,
    serviceScore: 4,
    methodologyVersion: 2,
    revision: 1,
    createdAt: new Date("2026-01-01T12:00:00"),
    updatedAt: new Date("2026-01-01T12:00:00"),
    updatedByUserName: null,
    ...partial,
  };
}

describe("metodologia existente — intocada", () => {
  it("V2 continua 1–5 com pesos 25/25/25/25 e é a vigente", () => {
    assert.equal(SUPPLIER_EVALUATION_METHODOLOGY_VERSION, SUPPLIER_EVALUATION_METHODOLOGY_V2);
    assert.equal(SUPPLIER_EVALUATION_METHODOLOGY_ID, "SUPPLIER_ORDER_EVALUATION_V2");
    assert.equal(SUPPLIER_EVALUATION_SCORE_MIN, 1);
    assert.equal(SUPPLIER_EVALUATION_SCORE_MAX, 5);
    assert.deepEqual(
      SUPPLIER_EVALUATION_CRITERIA.map((c) => [c.key, c.weightPercent]),
      [["quality", 25], ["delivery", 25], ["conformity", 25], ["service", 25]]
    );
    const result = computeSupplierOrderEvaluation({ qualityScore: 5, deliveryScore: 4, conformityScore: 3, serviceScore: 4 });
    assert.equal(result.overallScore, 4);
    assert.equal(result.methodologyVersion, 2);
  });

  it("o dashboard não define pesos, escala nem score composto próprios", async () => {
    const source = await import("node:fs").then((fs) => fs.readFileSync("src/lib/purchasing/supplierPerformanceDashboard.ts", "utf8"));
    assert.doesNotMatch(source, /weightPercent\s*[:=]\s*\d/);
    assert.doesNotMatch(source, /SupplierPerformanceIndex|riskScore|compositeScore|Nota Geral 0/i);
    assert.match(source, /resolveSupplierEvaluationAggregation/);
    assert.match(source, /buildSupplierPerformanceSummary/);
    assert.match(source, /averageScoreOrNull/);
  });
});

describe("consolidação por fornecedor via motor OP-26", () => {
  it("média simples das avaliações finalizadas — sem ponderar por spend ou quantidade", () => {
    const rows = [
      evaluation({ nomusPurchaseOrderId: "a", overallScore: 5, qualityScore: 5, deliveryScore: 5, conformityScore: 5, serviceScore: 5 }),
      evaluation({ nomusPurchaseOrderId: "b", overallScore: 3, qualityScore: 3, deliveryScore: 3, conformityScore: 3, serviceScore: 3 }),
    ];
    const result = buildDashboardSupplierEvaluation(4, rows)!;
    assert.equal(result.summary.overallScore, 4);
    assert.equal(result.summary.evaluatedOrders, 2);
    assert.equal(result.summary.eligibleOrders, 4);
    assert.equal(result.summary.coverage, 0.5);
    assert.equal(result.methodologyVersion, 2);
    assert.equal(result.scaleMax, 5);
    // mesma resposta da autoridade existente
    const expected = buildSupplierPerformanceSummary({
      eligibleOrders: 4,
      evaluatedOrders: 2,
      averages: { overall: 4, quality: 4, delivery: 4, conformity: 4, service: 4 },
    });
    assert.deepEqual(result.summary, expected);
  });

  it("sem avaliações: nota null (nunca 0), cobertura 0 com elegíveis > 0, null sem elegíveis", () => {
    const withEligible = buildDashboardSupplierEvaluation(3, [])!;
    assert.equal(withEligible.summary.overallScore, null);
    assert.equal(withEligible.summary.coverage, 0);
    assert.equal(withEligible.summary.pendingOrders, 3);
    assert.equal(buildDashboardSupplierEvaluation(0, []), null);
  });

  it("V1 não é convertido: fornecedor só com V1 fica na escala 0–10", () => {
    const rows = [evaluation({ nomusPurchaseOrderId: "a", overallScore: 8, qualityScore: 8, deliveryScore: 8, conformityScore: 8, serviceScore: 8, methodologyVersion: 1 })];
    const result = buildDashboardSupplierEvaluation(1, rows)!;
    assert.equal(result.methodologyVersion, SUPPLIER_EVALUATION_METHODOLOGY_V1);
    assert.equal(result.scaleMax, 10);
    assert.equal(result.summary.overallScore, 8); // não é 4 (8/2)
    assert.equal(result.v1Count, 1);
    assert.equal(result.v2Count, 0);
  });

  it("V1 e V2 nunca entram na mesma média: com V2 presente, V1 é ignorado no consolidado", () => {
    const rows = [
      evaluation({ nomusPurchaseOrderId: "a", overallScore: 4, methodologyVersion: 2 }),
      evaluation({ nomusPurchaseOrderId: "b", overallScore: 10, qualityScore: 10, deliveryScore: 10, conformityScore: 10, serviceScore: 10, methodologyVersion: 1 }),
    ];
    const result = buildDashboardSupplierEvaluation(2, rows)!;
    assert.equal(result.methodologyVersion, 2);
    assert.equal(result.summary.overallScore, 4); // (4+10)/2 = 7 seria mistura proibida
    assert.equal(result.evaluationCount, 1);
    assert.equal(result.summary.evaluatedOrders, 1);
    assert.equal(result.v1Count, 1);
    assert.equal(result.v2Count, 1);
  });
});

describe("dashboard — rankings e KPIs de avaliação", () => {
  const model = buildSupplierPerformanceDashboard(buildFixtureInput(), FIXTURE_FILTERS_2026);

  it("ranking V2 não inclui fornecedor só-V1; bloco legado separado com escala original", () => {
    assert.deepEqual(model.rankings.bestEvaluated.map((r) => r.supplierExternalId), [S1, S3]);
    assert.deepEqual(model.rankings.legacyEvaluated.map((r) => r.supplierExternalId), [S2]);
    assert.equal(model.rankings.legacyEvaluated[0]!.evaluation!.scaleMax, 10);
    assert.equal(model.rankings.legacyEvaluated[0]!.evaluation!.summary.overallScore, 8);
    assert.deepEqual(model.rankings.lowestEvaluated.map((r) => r.supplierExternalId), [S3, S1]);
    for (const criterion of SUPPLIER_EVALUATION_CRITERIA) {
      assert.ok(model.rankings.byCriterion[criterion.key].every((r) => r.evaluation?.methodologyVersion === 2));
    }
    assert.deepEqual(model.rankings.byCriterion.quality.map((r) => r.supplierExternalId), [S1, S3]);
  });

  it("nº de avaliações e cobertura por fornecedor reaproveitam a autoridade", () => {
    const s1 = model.suppliers.find((r) => r.supplierExternalId === S1)!.evaluation!;
    assert.equal(s1.evaluationCount, 2);
    assert.equal(s1.summary.evaluatedOrders, 2);
    assert.equal(s1.summary.eligibleOrders, 3);
    assert.ok(approx(s1.summary.coverage, 2 / 3));
    assert.equal(s1.summary.overallScore, 4);
    assert.equal(s1.summary.qualityScore, 4.5);
    const s3 = model.suppliers.find((r) => r.supplierExternalId === S3)!.evaluation!;
    assert.equal(s3.summary.overallScore, 2.5);
    assert.equal(s3.summary.coverage, 0.5);
  });

  it("KPI global: média por pedido (peso igual), cobertura sobre elegíveis, escala V2", () => {
    assert.ok(model.evaluation.available);
    if (!model.evaluation.available) return;
    assert.equal(model.evaluation.scaleMax, 5);
    assert.equal(model.evaluation.methodologyId, "SUPPLIER_ORDER_EVALUATION_V2");
    assert.equal(model.evaluation.summary.evaluatedOrders, 3); // o1, o2, o4 (V2); o3 é V1
    assert.equal(model.evaluation.summary.eligibleOrders, 9);
    assert.ok(approx(model.evaluation.summary.overallScore, 3.5));
    assert.ok(approx(model.evaluation.summary.coverage, 3 / 9));
    assert.equal(model.kpis.evaluationScore, 3.5);
    assert.equal(model.kpis.evaluationScaleMax, 5);
    assert.equal(model.evaluation.criteria.find((c) => c.key === "quality")!.average, 3.67);
    assert.equal(model.evaluation.evaluatedSuppliers, 2);
    assert.equal(model.evaluation.v1OnlySuppliers, 1);
    assert.equal(model.evaluation.suppliersWithoutEvaluation, 0);
  });

  it("distribuição de notas só V2; scatter só V2", () => {
    if (!model.evaluation.available) throw new Error("avaliação deveria estar disponível");
    const bands = model.evaluation.distribution;
    assert.equal(bands.reduce((sum, b) => sum + b.orders, 0), 3);
    assert.equal(bands.find((b) => b.band.startsWith("4,00"))!.orders, 2);
    assert.equal(bands.find((b) => b.band.startsWith("2,00"))!.orders, 1);
    assert.equal(bands.reduce((sum, b) => sum + b.suppliers, 0), 2);
    assert.deepEqual(model.evaluation.scoreVsSpend.map((p) => p.supplierExternalId), [S3, S1]);
  });

  it("feature flag OFF: avaliação indisponível, nada inferido, nenhum 0", () => {
    const off = buildSupplierPerformanceDashboard(buildFixtureInput({ evaluationFeatureEnabled: false }), FIXTURE_FILTERS_2026);
    assert.equal(off.evaluation.available, false);
    assert.equal(off.kpis.evaluationScore, null);
    assert.equal(off.kpis.evaluationCoverage, null);
    assert.deepEqual(off.rankings.bestEvaluated, []);
    assert.deepEqual(off.rankings.legacyEvaluated, []);
    assert.ok(off.suppliers.every((r) => r.evaluation === null));
    const detail = buildSupplierPerformanceSupplierDetail(buildFixtureInput({ evaluationFeatureEnabled: false }), FIXTURE_FILTERS_2026, S1)!;
    assert.equal(detail.evaluation.available, false);
  });

  it("scorecard: histórico segmentado por metodologia e evolução V2 no eixo da data do pedido", () => {
    const s2 = buildSupplierPerformanceSupplierDetail(buildFixtureInput(), FIXTURE_FILTERS_2026, S2)!;
    if (!s2.evaluation.available) throw new Error("avaliação deveria estar disponível");
    assert.equal(s2.evaluation.history.length, 1);
    assert.equal(s2.evaluation.history[0]!.methodologyVersion, 1);
    assert.equal(s2.evaluation.history[0]!.scaleMax, 10);
    assert.deepEqual(s2.evaluation.monthlyV2, []);
    assert.equal(s2.evaluation.monthlyV1.length, 1);
    const s1 = buildSupplierPerformanceSupplierDetail(buildFixtureInput(), FIXTURE_FILTERS_2026, S1)!;
    if (!s1.evaluation.available) throw new Error("avaliação deveria estar disponível");
    assert.deepEqual(s1.evaluation.monthlyV2.map((p) => [p.month, p.averageOverall, p.count]), [["2026-01", 4, 1], ["2026-02", 4, 1]]);
    assert.equal(s1.evaluation.history[0]!.externalId, 2); // mais recente primeiro
  });
});
