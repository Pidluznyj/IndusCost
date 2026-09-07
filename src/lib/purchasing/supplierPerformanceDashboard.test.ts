/**
 * Compras → Performance — testes do motor puro (domínio, identidade, filtros,
 * paridade, ordenação determinística, preço, matriz, detalhes).
 * Sem banco: fixture em memória.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SupplierEvaluationError } from "./supplierPerformance.js";
import {
  buildDashboardMaterialOptions,
  buildDashboardPeriodFromPreset,
  buildSupplierMaterialMatrix,
  buildSupplierPerformanceDashboard,
  buildSupplierPerformanceDashboardPopulation,
  buildSupplierPerformanceMaterialDetail,
  buildSupplierPerformanceSupplierDetail,
  isNomusPurchaseOrderCanceled,
  parseDashboardMaterialKey,
  parseSupplierMaterialMatrixQuery,
  parseSupplierPerformanceDashboardFilters,
  resolveDashboardMaterialKey,
  resolveNomusPurchaseOrderCurrency,
  resolveNomusPurchaseOrderPerformanceDate,
  toDashboardMonthKey,
  type SupplierPerformanceDashboardFilters,
} from "./supplierPerformanceDashboard.js";
import {
  FIXTURE_FILTERS_2026,
  FIXTURE_LINES,
  S1,
  S2,
  S3,
  approx,
  buildFixtureInput,
} from "./supplierPerformanceDashboardFixture.test-helper.js";

const filters2026 = FIXTURE_FILTERS_2026;

function dashboard(overrides: Partial<SupplierPerformanceDashboardFilters> = {}, inputOverrides = {}) {
  return buildSupplierPerformanceDashboard(buildFixtureInput(inputOverrides), { ...filters2026, ...overrides });
}

describe("identidade — nunca heurística", () => {
  it("material: ID Nomus primeiro, código oficial como fallback, nunca descrição", () => {
    assert.equal(resolveDashboardMaterialKey({ productExternalId: 1, productCode: "X" }), "nomus:1");
    assert.equal(resolveDashboardMaterialKey({ productExternalId: null, productCode: " MP-004 " }), "code:MP-004");
    assert.equal(resolveDashboardMaterialKey({ productExternalId: null, productCode: null }), null);
    assert.deepEqual(parseDashboardMaterialKey("nomus:12"), { kind: "nomus", productExternalId: 12 });
    assert.deepEqual(parseDashboardMaterialKey("code:ABC"), { kind: "code", productCode: "ABC" });
    assert.equal(parseDashboardMaterialKey("desc:Aço"), null);
  });

  it("fornecedores com nomes semelhantes e IDs diferentes NÃO são agrupados", () => {
    const model = dashboard();
    const ids = model.suppliers.map((row) => row.supplierExternalId).sort();
    assert.deepEqual(ids, [S1, S2, S3]);
    const alfa = model.suppliers.find((row) => row.supplierExternalId === S1)!;
    const alfaLtda = model.suppliers.find((row) => row.supplierExternalId === S2)!;
    assert.equal(alfa.spend, 1800);
    assert.equal(alfaLtda.spend, 420);
  });

  it("MPs com descrição idêntica e IDs diferentes NÃO são agrupadas", () => {
    const model = dashboard();
    const keys = model.concentration.dominantSupplierByMaterial.map((row) => row.materialKey).sort();
    assert.ok(keys.includes("nomus:1"));
    assert.ok(keys.includes("nomus:3"));
    assert.equal(model.kpis.materialMixCount, 4); // nomus:1, nomus:2, nomus:3, code:MP-004
  });

  it("linha sem ID nem código fica UNRESOLVED (contada, nunca vinculada)", () => {
    const model = dashboard();
    assert.equal(model.metadata.population.unresolvedMaterialLines, 1);
    assert.equal(model.metadata.population.unresolvedSupplierOrders, 1);
    assert.equal(model.metadata.population.unresolvedSupplierSpend, 100);
  });
});

describe("autoridades reutilizadas", () => {
  it("data operacional = COALESCE(issuedAt, firstSeenAt)", () => {
    const issued = new Date("2026-03-01T12:00:00");
    const seen = new Date("2026-04-01T12:00:00");
    assert.equal(resolveNomusPurchaseOrderPerformanceDate({ issuedAt: issued, firstSeenAt: seen }).getTime(), issued.getTime());
    assert.equal(resolveNomusPurchaseOrderPerformanceDate({ issuedAt: null, firstSeenAt: seen }).getTime(), seen.getTime());
    assert.equal(toDashboardMonthKey(issued), "2026-03");
  });

  it("cancelamento = predicado oficial de Pedidos Nomus (canceled OU stage)", () => {
    assert.equal(isNomusPurchaseOrderCanceled({ canceled: true, stage: "OPEN" }), true);
    assert.equal(isNomusPurchaseOrderCanceled({ canceled: null, stage: "CANCELED" }), true);
    assert.equal(isNomusPurchaseOrderCanceled({ canceled: false, stage: "RECEIVED" }), false);
  });

  it("moeda ausente segue a convenção de Pedidos Nomus (BRL); informada é normalizada", () => {
    assert.equal(resolveNomusPurchaseOrderCurrency(null), "BRL");
    assert.equal(resolveNomusPurchaseOrderCurrency(" usd "), "USD");
  });

  it("período padrão segue a convenção do módulo (últimos 12 meses) e presets de ano", () => {
    const today = new Date(2026, 8, 7);
    assert.deepEqual(buildDashboardPeriodFromPreset("last12m", today), { from: "2025-09-07", to: "2026-09-07" });
    assert.deepEqual(buildDashboardPeriodFromPreset("currentYear", today), { from: "2026-01-01", to: "2026-12-31" });
    assert.deepEqual(buildDashboardPeriodFromPreset("previousYear", today), { from: "2025-01-01", to: "2025-12-31" });
    assert.deepEqual(buildDashboardPeriodFromPreset("all", today), { from: null, to: null });
  });
});

describe("população e elegibilidade", () => {
  it("exclui cancelados por padrão, fora do período e outra moeda — com contagem explícita", () => {
    const model = dashboard();
    assert.equal(model.kpis.purchaseOrderCount, 9);
    assert.equal(model.metadata.population.canceledExcluded, 1);
    assert.equal(model.metadata.population.outsidePeriodExcluded, 1);
    assert.equal(model.metadata.population.otherCurrencyExcluded, 1);
    assert.equal(model.metadata.eligibilityRule.status, "BLOCKED_BY_BUSINESS_RULE");
  });

  it("includeCanceled traz o cancelado e a sua avaliação de volta (elegibilidade da Avaliação Fornecedor)", () => {
    const model = dashboard({ includeCanceled: true });
    assert.equal(model.kpis.purchaseOrderCount, 10);
    assert.equal(model.metadata.population.canceledExcluded, 0);
    assert.equal(model.kpis.totalSpend, 4470 + 9999);
    assert.ok(model.evaluation.available);
    if (model.evaluation.available) assert.equal(model.evaluation.summary.evaluatedOrders, 4);
  });

  it("multi-moeda: moeda principal por nº de pedidos, outras nunca somadas; filtro de moeda isola", () => {
    const model = dashboard();
    assert.equal(model.metadata.currency.selected, "BRL");
    assert.equal(model.metadata.currency.multiCurrency, true);
    assert.deepEqual(
      model.metadata.currency.available.map((c) => c.currency),
      ["BRL", "USD"]
    );
    const usd = dashboard({ currency: "USD" });
    assert.equal(usd.kpis.purchaseOrderCount, 1);
    assert.equal(usd.kpis.totalSpend, 700);
    assert.equal(usd.metadata.currency.selected, "USD");
  });

  it("pedido sem valor de cabeçalho não soma e é contado", () => {
    const model = dashboard();
    assert.equal(model.metadata.population.ordersWithoutValue, 1);
    assert.equal(model.metadata.population.linesWithoutValue, 1);
  });
});

describe("KPIs executivos", () => {
  it("spend total, fornecedores ativos, pedidos, linhas, ticket médio", () => {
    const model = dashboard();
    assert.equal(model.kpis.totalSpend, 4470);
    assert.equal(model.kpis.activeSuppliers, 3);
    assert.equal(model.kpis.purchaseOrderCount, 9);
    assert.equal(model.kpis.purchaseLineCount, 11);
    assert.ok(approx(model.kpis.averageTicket, 4470 / 9, 0.01));
  });

  it("mix total, mix por fornecedor e mix médio", () => {
    const model = dashboard();
    assert.equal(model.kpis.materialMixCount, 4);
    const byId = new Map(model.suppliers.map((row) => [row.supplierExternalId, row]));
    assert.equal(byId.get(S1)!.mixCount, 2);
    assert.equal(byId.get(S2)!.mixCount, 1);
    assert.equal(byId.get(S3)!.mixCount, 2);
    assert.ok(approx(model.kpis.averageSupplierMix, (2 + 1 + 2) / 3));
  });

  it("share, Top1/Top3/Top5", () => {
    const model = dashboard();
    const byId = new Map(model.suppliers.map((row) => [row.supplierExternalId, row]));
    assert.ok(approx(byId.get(S3)!.share, 2150 / 4470));
    assert.ok(approx(model.kpis.top1Concentration, 2150 / 4470));
    assert.ok(approx(model.kpis.top3Concentration, (2150 + 1800 + 420) / 4470));
    assert.equal(model.kpis.top5Concentration, model.kpis.top3Concentration);
  });

  it("single-source observado, dual sourcing observado e média de fornecedores por MP", () => {
    const model = dashboard();
    assert.equal(model.kpis.singleSourceObservedCount, 1); // nomus:3
    assert.equal(model.kpis.dualSourceObservedCount, 2); // nomus:1, nomus:2
    assert.equal(model.kpis.materialsWithoutIdentifiedSupplier, 1); // code:MP-004 (pedido sem fornecedor)
    assert.ok(approx(model.kpis.singleSourceObservedRate, 1 / 4));
    assert.ok(approx(model.kpis.dualSourceObservedRate, 2 / 4));
    assert.ok(approx(model.kpis.averageSuppliersPerMaterial, (2 + 2 + 1) / 3));
    const single = model.concentration.singleSourceMaterials;
    assert.equal(single.length, 1);
    assert.equal(single[0]!.materialKey, "nomus:3");
    assert.equal(single[0]!.singleSourceObserved, true);
  });

  it("dataset vazio: zeros reais e null onde não há denominador", () => {
    const model = buildSupplierPerformanceDashboard(buildFixtureInput({ orders: [], lines: [], evaluations: [] }), filters2026);
    assert.equal(model.kpis.totalSpend, 0);
    assert.equal(model.kpis.purchaseOrderCount, 0);
    assert.equal(model.kpis.averageTicket, null);
    assert.equal(model.kpis.top1Concentration, null);
    assert.equal(model.kpis.singleSourceObservedRate, null);
    assert.equal(model.kpis.averageSuppliersPerMaterial, null);
    assert.equal(model.kpis.averageSupplierMix, null);
    assert.deepEqual(model.suppliers, []);
    assert.deepEqual(model.concentration.pareto, []);
  });

  it("denominador zero: pedidos sem valor → shares null, ticket 0 real", () => {
    const input = buildFixtureInput({
      orders: [
        { id: "z1", externalId: 1, orderNumber: "Z1", supplierExternalId: S1, supplierName: "A", supplierTaxId: null, stage: "OPEN", canceled: false, issuedAt: new Date("2026-02-01T12:00:00"), firstSeenAt: new Date("2026-02-01T12:00:00"), expectedAt: null, currency: null, totalAmount: null, paymentTerms: null },
      ],
      lines: [],
      evaluations: [],
    });
    const model = buildSupplierPerformanceDashboard(input, filters2026);
    assert.equal(model.kpis.totalSpend, 0);
    assert.equal(model.kpis.averageTicket, 0);
    assert.equal(model.suppliers[0]!.share, null);
    assert.equal(model.kpis.top1Concentration, null);
  });
});

describe("rankings determinísticos", () => {
  it("por spend, por pedidos e por mix com tie-break neutro (nome, ID)", () => {
    const model = dashboard();
    assert.deepEqual(model.rankings.topSpend.map((r) => r.supplierExternalId), [S3, S1, S2]);
    assert.deepEqual(model.rankings.topSpend.map((r) => r.position), [1, 2, 3]);
    // pedidos: S1=3, S2=3, S3=2 → empate S1/S2 resolvido por nome
    assert.deepEqual(model.rankings.topOrderCount.map((r) => r.supplierExternalId), [S1, S2, S3]);
    // mix: S1=2, S3=2 (empate por nome), S2=1
    assert.deepEqual(model.rankings.topMix.map((r) => r.supplierExternalId), [S1, S3, S2]);
  });

  it("limite de ranking respeitado", () => {
    const model = buildSupplierPerformanceDashboard(buildFixtureInput(), filters2026, { rankingLimit: 2 });
    assert.equal(model.rankings.topSpend.length, 2);
    assert.equal(model.rankings.limit, 2);
  });

  it("pareto: acumulado chega a 100% incluindo o bucket não identificado", () => {
    const model = dashboard();
    const pareto = model.concentration.pareto;
    assert.equal(pareto[0]!.supplierExternalId, S3);
    assert.equal(pareto[pareto.length - 1]!.unresolved, true);
    assert.ok(approx(pareto[pareto.length - 1]!.cumulativeShare, 1));
    assert.ok(model.charts.spendBySupplier.every((row) => !row.unresolved));
  });
});

describe("fornecedor × matéria-prima", () => {
  it("share por material e fornecedor principal por MP (base financeira)", () => {
    const model = dashboard();
    const m1 = model.concentration.dominantSupplierByMaterial.find((row) => row.materialKey === "nomus:1")!;
    assert.equal(m1.dominantBasis, "financial");
    assert.equal(m1.dominant!.supplierExternalId, S1);
    assert.ok(approx(m1.dominant!.share, 1300 / 1880));
    assert.equal(m1.second!.supplierExternalId, S2);
    assert.ok(approx(m1.second!.share, 580 / 1880));
    assert.equal(m1.supplierCountObserved, 2);
  });

  it("MP sem valor de linha usa 'mais frequente' explicitamente, nunca share financeiro inventado", () => {
    const input = buildFixtureInput({
      lines: FIXTURE_LINES.map((line) => (line.productExternalId === 3 ? { ...line, totalAmount: null, unitPrice: null } : line)),
    });
    const model = buildSupplierPerformanceDashboard(input, filters2026);
    const m3 = model.concentration.dominantSupplierByMaterial.find((row) => row.materialKey === "nomus:3")!;
    assert.equal(m3.dominantBasis, "orders");
    assert.equal(m3.dominant!.share, null);
    assert.equal(m3.spend, 0);
  });

  it("MPs com maior concentração ordenadas por share dominante DESC", () => {
    const model = dashboard();
    const shares = model.concentration.mostConcentratedMaterials.map((row) => row.dominant?.share ?? -1);
    for (let i = 1; i < shares.length; i += 1) assert.ok(shares[i - 1]! >= shares[i]!);
    assert.equal(model.concentration.mostConcentratedMaterials[0]!.materialKey, "nomus:3");
  });

  it("matriz: busca, ordenação, paginação e totais do conjunto inteiro", () => {
    const input = buildFixtureInput();
    const all = buildSupplierMaterialMatrix(input, filters2026, parseSupplierMaterialMatrixQuery({}));
    assert.equal(all.total, 6); // (M1,S1) (M1,S2) (M2,S1) (M2,S3) (M3,S3) (M4,unresolved)
    assert.equal(all.rows[0]!.spend, 1300);
    assert.equal(all.totals.pairCount, 6);
    assert.equal(all.totals.materialCount, 4);
    const paged = buildSupplierMaterialMatrix(input, filters2026, parseSupplierMaterialMatrixQuery({ page: "2", pageSize: "3" }));
    assert.equal(paged.rows.length, 3);
    assert.equal(paged.total, 6);
    assert.equal(paged.totals.spend, all.totals.spend);
    const searched = buildSupplierMaterialMatrix(input, filters2026, parseSupplierMaterialMatrixQuery({ search: "resina" }));
    assert.equal(searched.total, 2);
    assert.ok(searched.rows.every((row) => row.materialKey === "nomus:2"));
    const bySupplier = buildSupplierMaterialMatrix(input, filters2026, parseSupplierMaterialMatrixQuery({ sort: "supplier" }));
    assert.equal(bySupplier.rows[0]!.supplierName, "Alfa Metais");
    assert.throws(() => parseSupplierMaterialMatrixQuery({ sort: "hack" }), SupplierEvaluationError);
  });

  it("matriz respeita filtro de fornecedor e de material", () => {
    const input = buildFixtureInput();
    const onlyS1 = buildSupplierMaterialMatrix(input, { ...filters2026, supplierExternalId: S1 }, parseSupplierMaterialMatrixQuery({}));
    assert.ok(onlyS1.rows.every((row) => row.supplierExternalId === S1));
    assert.equal(onlyS1.total, 2);
    const onlyM2 = buildSupplierMaterialMatrix(input, { ...filters2026, materialKey: "nomus:2" }, parseSupplierMaterialMatrixQuery({}));
    assert.ok(onlyM2.rows.every((row) => row.materialKey === "nomus:2"));
    assert.equal(onlyM2.spendBasis, "line");
  });

  it("quantidade só é agregada dentro da mesma unidade (unidades mistas → null + lista)", () => {
    const input = buildFixtureInput();
    const matrix = buildSupplierMaterialMatrix(input, filters2026, parseSupplierMaterialMatrixQuery({}));
    const m1s1 = matrix.rows.find((row) => row.materialKey === "nomus:1" && row.supplierExternalId === S1)!;
    assert.equal(m1s1.quantity, null);
    assert.equal(m1s1.unit, null);
    assert.deepEqual(m1s1.unitsObserved, ["KG", "L"]);
    assert.equal(m1s1.weightedAveragePrice, null);
    const m1s2 = matrix.rows.find((row) => row.materialKey === "nomus:1" && row.supplierExternalId === S2)!;
    assert.equal(m1s2.unit, "KG");
    assert.equal(m1s2.quantity, 12); // 5 + 4 + 3 (linha sem valor conta na quantidade, não no preço)
  });
});

describe("preço", () => {
  it("preço médio ponderado = SUM(valor) / SUM(quantidade) — não média simples de unitPrice", () => {
    const detail = buildSupplierPerformanceMaterialDetail(buildFixtureInput(), filters2026, "nomus:1")!;
    const s2 = detail.suppliers.find((row) => row.supplierExternalId === S2)!;
    // (300 + 280) / (5 + 4) = 64,444444; média simples de unitPrice seria 65
    assert.ok(approx(s2.weightedAveragePrice, 580 / 9));
    assert.equal(s2.lastPrice, 70); // linha mais recente COM preço (o9)
    assert.equal(s2.lastPriceDate?.slice(0, 10), "2026-04-10");
    assert.equal(s2.lastPurchaseDate?.slice(0, 10), "2026-06-01"); // última compra (o12, sem preço)
  });

  it("último preço = linha mais recente pela data operacional (tie: ID do pedido, índice da linha)", () => {
    const detail = buildSupplierPerformanceMaterialDetail(buildFixtureInput(), filters2026, "nomus:1")!;
    const s1 = detail.suppliers.find((row) => row.supplierExternalId === S1)!;
    assert.equal(s1.lastPrice, 100);
    assert.equal(s1.lastPurchaseDate?.slice(0, 10), "2026-05-01");
  });

  it("dispersão só entre fornecedores da mesma MP + unidade + moeda; unidades mistas contadas", () => {
    const model = dashboard();
    assert.equal(model.pricing.materialsWithComparablePrices, 2);
    assert.equal(model.pricing.materialsWithMixedUnits, 1);
    const m2 = model.pricing.dispersion.find((row) => row.materialKey === "nomus:2")!;
    assert.equal(m2.unit, "KG");
    assert.equal(m2.minAveragePrice, 100);
    assert.equal(m2.maxAveragePrice, 120);
    assert.equal(m2.spread, 20);
    assert.ok(approx(m2.spreadPct, 0.2));
    const m1 = model.pricing.dispersion.find((row) => row.materialKey === "nomus:1")!;
    assert.equal(m1.unit, "KG");
    assert.ok(approx(m1.minAveragePrice, 55));
    assert.ok(approx(m1.maxAveragePrice, 580 / 9));
  });

  it("maiores aumentos: primeiro vs último mês, por MP + fornecedor + unidade", () => {
    const model = dashboard();
    assert.equal(model.pricing.increases.length, 2);
    const first = model.pricing.increases[0]!;
    assert.equal(first.materialKey, "nomus:1");
    assert.equal(first.supplierExternalId, S1);
    assert.equal(first.unit, "KG");
    assert.equal(first.firstAveragePrice, 50);
    assert.equal(first.lastAveragePrice, 60);
    assert.ok(approx(first.changePct, 0.2));
  });

  it("evolução de preço: séries por fornecedor + unidade, nunca misturadas", () => {
    const detail = buildSupplierPerformanceMaterialDetail(buildFixtureInput(), filters2026, "nomus:1")!;
    const s1Series = detail.priceEvolution.filter((series) => series.supplierExternalId === S1);
    assert.deepEqual(s1Series.map((series) => series.unit).sort(), ["KG", "L"]);
    const kg = s1Series.find((series) => series.unit === "KG")!;
    assert.deepEqual(kg.points.map((p) => [p.month, p.weightedAveragePrice]), [["2026-01", 50], ["2026-02", 60]]);
    assert.equal(detail.totals.quantity, null); // unidades mistas
    assert.deepEqual(detail.material.unitsObserved, ["KG", "L"]);
  });
});

describe("filtros", () => {
  it("parser fail-fast: filtros inválidos viram erro de domínio (400)", () => {
    assert.throws(() => parseSupplierPerformanceDashboardFilters({ from: "2026-13-01" }), SupplierEvaluationError);
    assert.throws(() => parseSupplierPerformanceDashboardFilters({ supplierExternalId: "abc" }), SupplierEvaluationError);
    assert.throws(() => parseSupplierPerformanceDashboardFilters({ materialKey: "desc:x" }), SupplierEvaluationError);
    assert.throws(() => parseSupplierPerformanceDashboardFilters({ currency: "R$" }), SupplierEvaluationError);
    assert.throws(() => parseSupplierPerformanceDashboardFilters({ includeCanceled: "talvez" }), SupplierEvaluationError);
    const parsed = parseSupplierPerformanceDashboardFilters({ from: "2026-01-01", to: "2026-12-31", supplierExternalId: "101", materialKey: "nomus:1", materialGroup: "AÇOS", currency: "brl", includeCanceled: "1" });
    assert.deepEqual(parsed, { period: { from: "2026-01-01", to: "2026-12-31" }, supplierExternalId: 101, materialKey: "nomus:1", materialGroup: "AÇOS", currency: "BRL", includeCanceled: true });
  });

  it("filtro de fornecedor afeta KPIs, rankings e gráficos coerentemente", () => {
    const model = dashboard({ supplierExternalId: S1 });
    assert.equal(model.kpis.purchaseOrderCount, 3);
    assert.equal(model.kpis.totalSpend, 1800);
    assert.equal(model.suppliers.length, 1);
    assert.ok(approx(model.kpis.top1Concentration, 1));
    assert.equal(model.charts.monthly.reduce((sum, p) => sum + p.orderCount, 0), 3);
    // opções de fornecedor continuam com a base inteira (para trocar o filtro)
    assert.equal(model.filterOptions.suppliers.length, 3);
  });

  it("filtro de material muda a base de spend para linha e nunca rateia cabeçalho", () => {
    const model = dashboard({ materialKey: "nomus:2" });
    assert.equal(model.metadata.spendBasis, "line");
    assert.equal(model.kpis.totalSpend, 1700); // 500 (o1) + 1200 (o4); o5 cancelado e o8 USD fora
    assert.equal(model.kpis.purchaseOrderCount, 2);
    assert.equal(model.kpis.purchaseLineCount, 2);
    assert.equal(model.kpis.materialMixCount, 1);
    assert.equal(model.metadata.population.noMatchingLineExcluded, 7);
  });

  it("filtro de grupo (catálogo Nomus por ID) e período por ano", () => {
    const model = dashboard({ materialGroup: "AÇOS" });
    assert.equal(model.kpis.materialMixCount, 2); // nomus:1 e nomus:3
    assert.deepEqual(model.filterOptions.materialGroups.map((g) => g.group), ["AÇOS", "QUÍMICOS"]);
    const y2025 = dashboard({ period: { from: "2025-01-01", to: "2025-12-31" } });
    assert.equal(y2025.kpis.purchaseOrderCount, 1);
    assert.equal(y2025.kpis.totalSpend, 50);
    const all = dashboard({ period: { from: null, to: null } });
    assert.equal(all.kpis.purchaseOrderCount, 10);
  });

  it("filtro combinado fornecedor + ano + material", () => {
    const model = dashboard({ supplierExternalId: S1, materialKey: "nomus:1" });
    assert.equal(model.kpis.purchaseOrderCount, 3);
    assert.equal(model.kpis.totalSpend, 1300);
    assert.equal(model.suppliers[0]!.mixCount, 1);
  });
});

describe("paridade (invariantes fortes)", () => {
  it("A/B: soma do spend dos fornecedores + não identificado = total; shares ≈ 100%", () => {
    const model = dashboard();
    const supplierSum = model.suppliers.reduce((sum, row) => sum + row.spend, 0);
    assert.ok(approx(supplierSum + model.metadata.population.unresolvedSupplierSpend, model.kpis.totalSpend, 0.01));
    const shareSum = model.concentration.pareto.reduce((sum, row) => sum + (row.share ?? 0), 0);
    assert.ok(approx(shareSum, 1, 1e-5));
  });

  it("C/D: por MP, soma do spend dos fornecedores = spend da MP; shares ≈ 100%", () => {
    const input = buildFixtureInput();
    const matrix = buildSupplierMaterialMatrix(input, filters2026, parseSupplierMaterialMatrixQuery({ pageSize: "200" }));
    const byMaterial = new Map<string, { spend: number; share: number }>();
    for (const row of matrix.rows) {
      const entry = byMaterial.get(row.materialKey) ?? { spend: 0, share: 0 };
      entry.spend += row.spend;
      entry.share += row.shareOfMaterial ?? 0;
      byMaterial.set(row.materialKey, entry);
    }
    for (const [key, entry] of byMaterial) {
      const detail = buildSupplierPerformanceMaterialDetail(input, filters2026, key)!;
      assert.ok(approx(entry.spend, detail.totals.spend, 0.01), `spend ${key}`);
      if (detail.totals.spend > 0) assert.ok(approx(entry.share, 1, 1e-5), `share ${key}`);
    }
  });

  it("E/F/G/H: detalhe do fornecedor bate com o ranking (spend, pedidos, mix) — mesmo read model", () => {
    const input = buildFixtureInput();
    const model = buildSupplierPerformanceDashboard(input, filters2026);
    for (const row of model.rankings.topSpend) {
      const detail = buildSupplierPerformanceSupplierDetail(input, filters2026, row.supplierExternalId)!;
      assert.equal(detail.purchases.spend, row.spend);
      assert.equal(detail.purchases.orderCount, row.orderCount);
      assert.equal(detail.purchases.mixCount, row.mixCount);
      assert.equal(detail.supplier.share, row.share);
      assert.deepEqual(detail.supplier.evaluation, row.evaluation);
    }
  });

  it("série mensal reconcilia com o total e enumera os meses do período", () => {
    const model = dashboard();
    assert.equal(model.charts.monthly.length, 12);
    assert.ok(approx(model.charts.monthly.reduce((sum, p) => sum + p.spend, 0), model.kpis.totalSpend, 0.01));
    assert.equal(model.charts.monthly.reduce((sum, p) => sum + p.orderCount, 0), model.kpis.purchaseOrderCount);
    const jan = model.charts.monthly.find((p) => p.month === "2026-01")!;
    assert.equal(jan.spend, 1100);
    assert.equal(jan.orderCount, 2);
    assert.equal(jan.activeSuppliers, 1); // pedido sem fornecedor não conta
  });

  it("cabeçalho × linhas: totais expostos, sem rateio", () => {
    const model = dashboard();
    assert.equal(model.metadata.population.headerSpendTotal, 4470);
    assert.equal(model.metadata.population.lineSpendTotal, 500 + 500 + 600 + 300 + 1200 + 800 + 100 + 280 + 200 + 150);
  });
});

describe("scorecard e detalhe de MP", () => {
  it("scorecard: identificação, compras, MPs exclusivas, dominância, histórico", () => {
    const detail = buildSupplierPerformanceSupplierDetail(buildFixtureInput(), filters2026, S3)!;
    assert.equal(detail.supplier.name, "Beta Químicos");
    assert.equal(detail.supplier.document, "22.222.222/0001-22");
    assert.equal(detail.supplier.registryStatus, "ACTIVE");
    assert.equal(detail.purchases.spend, 2150);
    assert.equal(detail.purchases.exclusiveMaterialCount, 1);
    assert.equal(detail.concentration.singleSourceMaterials[0]!.materialKey, "nomus:3");
    assert.equal(detail.concentration.dominantMaterials.length, 2); // nomus:2 (1200 > 500) e nomus:3
    assert.ok(approx(detail.concentration.maxMaterialShare, 1));
    assert.deepEqual(detail.purchases.paymentTerms, [{ label: "45 dias", count: 1 }]);
    assert.equal(detail.materials[0]!.materialKey, "nomus:2");
    // denominador = todas as linhas valoradas do fornecedor (1200 + 800 + 150 da linha sem material) — sem rateio
    assert.ok(approx(detail.materials[0]!.shareOfSupplier, 1200 / 2150));
    assert.ok(detail.advancedMetrics.length > 0);
  });

  it("scorecard: fornecedor fora da população → null (404 na API)", () => {
    assert.equal(buildSupplierPerformanceSupplierDetail(buildFixtureInput(), filters2026, 999), null);
    assert.equal(buildSupplierPerformanceMaterialDetail(buildFixtureInput(), filters2026, "nomus:999"), null);
  });

  it("detalhe de MP: ranking de fornecedores com share e nota", () => {
    const detail = buildSupplierPerformanceMaterialDetail(buildFixtureInput(), filters2026, "nomus:2")!;
    assert.equal(detail.totals.spend, 1700);
    assert.equal(detail.totals.supplierCountObserved, 2);
    assert.equal(detail.totals.unit, "KG");
    assert.equal(detail.totals.quantity, 15);
    assert.deepEqual(detail.suppliers.map((row) => row.supplierExternalId), [S3, S1]);
    assert.ok(approx(detail.suppliers[0]!.shareOfMaterial, 1200 / 1700));
    assert.equal(detail.suppliers[1]!.evaluation?.summary.overallScore, 4);
    assert.equal(detail.dispersion.length, 1);
  });
});

describe("indicadores avançados — registro de disponibilidade", () => {
  it("catálogo completo com status e motivo; indisponível nunca traz valor 0", () => {
    const model = dashboard();
    const keys = model.advancedMetrics.map((m) => m.key);
    for (const key of ["OTD", "OTIF", "LEAD_TIME", "FILL_RATE", "PPM", "REJECTION_RATE", "NCR", "RETURNS", "RESPONSE_TIME", "SCAR", "COMPLIANCE_STATUS", "PAYMENT_TERMS", "PPV", "SAVINGS", "COST_AVOIDANCE", "CONCENTRATION", "SINGLE_SOURCE_OBSERVED", "DUAL_SOURCE_OBSERVED"]) {
      assert.ok(keys.includes(key), `falta ${key}`);
    }
    for (const metric of model.advancedMetrics) {
      if (metric.status === "unavailable") {
        assert.equal(metric.source === null || metric.value === null || metric.value.kind === "reference", true, metric.key);
        assert.ok(metric.reason, `${metric.key} precisa de motivo`);
        assert.ok(metric.value == null || metric.value.kind === "reference", `${metric.key} não pode expor valor`);
      }
    }
    const otd = model.advancedMetrics.find((m) => m.key === "OTD")!;
    assert.equal(otd.status, "unavailable");
    assert.match(otd.reason!, /recebimento/);
    const ppv = model.advancedMetrics.find((m) => m.key === "PPV")!;
    assert.equal(ppv.status, "unavailable");
    assert.match(ppv.reason!, /referência/);
  });

  it("disponíveis/parciais calculados só com fonte oficial", () => {
    const model = dashboard();
    const byKey = new Map(model.advancedMetrics.map((m) => [m.key, m]));
    const fill = byKey.get("FILL_RATE")!;
    assert.equal(fill.status, "partial");
    assert.equal(fill.value?.kind, "percent");
    // linhas com received: o1(10/10, 5/5), o2 (5/10), o3 (5/5), o4 (0/10) → média = (1+1+0.5+1+0)/5 = 0.7
    if (fill.value?.kind === "percent") {
      assert.ok(approx(fill.value.value, 0.7));
      assert.equal(fill.value.numerator, 3);
      assert.equal(fill.value.denominator, 5);
    }
    const partial = byKey.get("PARTIALLY_RECEIVED_ORDERS")!;
    assert.equal(partial.status, "available");
    assert.deepEqual(partial.value, { kind: "count", value: 1, of: 9 });
    const overdue = byKey.get("OPEN_OVERDUE_ORDERS")!;
    assert.equal(overdue.status, "available");
    // o2 PARTIALLY_RECEIVED previsão 2026-02-25 < now; o4 OPEN previsão 2026-03-15 < now → 2 atrasados de 2 abertos
    assert.deepEqual(overdue.value, { kind: "count", value: 2, of: 2 });
    const promised = byKey.get("PROMISED_LEAD_TIME")!;
    assert.equal(promised.status, "available");
    assert.deepEqual(promised.value, { kind: "days", value: 10, count: 3 });
    const terms = byKey.get("PAYMENT_TERMS")!;
    assert.equal(terms.status, "partial");
    const registry = byKey.get("SUPPLIER_REGISTRY_STATUS")!;
    assert.equal(registry.status, "partial");
    if (registry.value?.kind === "distribution") {
      assert.deepEqual(registry.value.items, [{ label: "ACTIVE", count: 2 }]);
      assert.equal(registry.value.unknownCount, 1);
    }
  });
});

describe("opções de material", () => {
  it("agrupa por identidade oficial e ordena por frequência", () => {
    const options = buildDashboardMaterialOptions(FIXTURE_LINES, 3);
    assert.equal(options[0]!.materialKey, "nomus:1");
    assert.equal(options.length, 3);
    assert.ok(!options.some((o) => o.materialKey.startsWith("desc")));
  });
});

describe("população — instrumentação", () => {
  it("expõe base de opções antes dos filtros de fornecedor/material", () => {
    const population = buildSupplierPerformanceDashboardPopulation(buildFixtureInput(), { ...filters2026, supplierExternalId: S1 });
    assert.equal(population.baseOrders.length, 9);
    assert.equal(population.orders.length, 3);
    assert.equal(population.excluded.otherSupplier, 6);
  });
});
