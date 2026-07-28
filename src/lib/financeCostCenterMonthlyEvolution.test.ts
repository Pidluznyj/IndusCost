import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCostCenterMonthlyEvolutionEmptyPayload,
  buildCostCenterMonthlyEvolutionPayload,
  buildCostCenterMonthlyEvolutionSummary,
  computeCostCenterMonthlyTrend,
  groupCostCenterAllocationByDueMonth,
  type CostCenterMonthlyEvolutionSourceRow,
} from "./financeCostCenterMonthlyEvolution.shared.js";

function row(dueDate: string | null, allocatedAmount: number): CostCenterMonthlyEvolutionSourceRow {
  return { dueDate, allocatedAmount };
}

describe("financeCostCenterMonthlyEvolution", () => {
  it("agrupa por data de vencimento em 12 meses, meses sem título ficam em zero", () => {
    const rows = [
      row("2026-02-10T00:00:00.000Z", 100),
      row("2026-02-25T00:00:00.000Z", 50),
      row("2026-07-01T00:00:00.000Z", 300),
    ];
    const buckets = groupCostCenterAllocationByDueMonth(rows, 2026);
    assert.equal(buckets.length, 12);
    assert.equal(buckets[0], 0); // Jan
    assert.equal(buckets[1], 150); // Fev = 100 + 50
    assert.equal(buckets[6], 300); // Jul
    assert.equal(buckets[11], 0); // Dez
  });

  it("respeita o ano filtrado (ignora vencimentos de outro ano)", () => {
    const rows = [
      row("2025-03-10T00:00:00.000Z", 999),
      row("2026-03-10T00:00:00.000Z", 120),
    ];
    const buckets = groupCostCenterAllocationByDueMonth(rows, 2026);
    assert.equal(buckets[2], 120);
    assert.equal(
      buckets.reduce((acc, v) => acc + v, 0),
      120
    );
  });

  it("soma dos 12 meses bate com o total das linhas no mesmo escopo", () => {
    const rows = [
      row("2026-01-05T00:00:00.000Z", 10.5),
      row("2026-01-20T00:00:00.000Z", 4.25),
      row("2026-05-15T00:00:00.000Z", 200),
      row("2026-12-31T00:00:00.000Z", 85.25),
    ];
    const expectedTotal = rows.reduce((acc, r) => acc + r.allocatedAmount, 0);
    const payload = buildCostCenterMonthlyEvolutionPayload({
      rows,
      costCenterIds: ["cc-a"],
      year: 2026,
    });
    assert.equal(payload.summary.totalYear, expectedTotal);
    const seriesSum = payload.points.reduce((acc, p) => acc + p.amount, 0);
    assert.equal(Math.round(seriesSum * 100) / 100, Math.round(expectedTotal * 100) / 100);
  });

  it("calcula a linha de tendência (regressão linear) crescente", () => {
    const amounts = [0, 0, 100, 100, 200, 200, 300, 300, 400, 400, 500, 500];
    const trend = computeCostCenterMonthlyTrend(amounts);
    assert.equal(trend.length, 12);
    // tendência monotonicamente não-decrescente para série crescente
    for (let i = 1; i < trend.length; i += 1) {
      assert.ok(trend[i]! >= trend[i - 1]!);
    }
    assert.ok(trend[11]! > trend[0]!);
  });

  it("todos os meses zero => tendência zero (nunca negativa)", () => {
    const amounts = new Array(12).fill(0);
    const trend = computeCostCenterMonthlyTrend(amounts);
    assert.ok(trend.every((value) => value === 0));
  });

  it("nunca gera tendência negativa mesmo com série decrescente", () => {
    const amounts = [500, 400, 300, 200, 100, 0, 0, 0, 0, 0, 0, 0];
    const trend = computeCostCenterMonthlyTrend(amounts);
    assert.ok(trend.every((value) => value >= 0));
  });

  it("resumo traz total, média, maior mês e menor mês com valor acima de zero", () => {
    const amounts = [0, 150, 0, 300, 0, 0, 0, 0, 0, 0, 0, 0];
    const summary = buildCostCenterMonthlyEvolutionSummary(amounts);
    assert.equal(summary.totalYear, 450);
    assert.equal(summary.monthlyAverage, 37.5); // 450 / 12
    assert.equal(summary.maxMonth?.month, 4);
    assert.equal(summary.maxMonth?.amount, 300);
    assert.equal(summary.minMonth?.month, 2); // menor mês com valor > 0
    assert.equal(summary.minMonth?.amount, 150);
  });

  it("resumo sem dados retorna extremos nulos", () => {
    const summary = buildCostCenterMonthlyEvolutionSummary(new Array(12).fill(0));
    assert.equal(summary.maxMonth, null);
    assert.equal(summary.minMonth, null);
    assert.equal(summary.totalYear, 0);
  });

  it("destaca o mês filtrado sem alterar a série de 12 meses", () => {
    const payload = buildCostCenterMonthlyEvolutionPayload({
      rows: [row("2026-08-10T00:00:00.000Z", 500)],
      costCenterIds: ["cc-a"],
      year: 2026,
      highlightMonth: 8,
    });
    assert.equal(payload.points.length, 12);
    assert.equal(payload.highlightMonth, 8);
    assert.equal(payload.points[7]?.highlighted, true);
    assert.equal(payload.points[7]?.amount, 500);
    assert.equal(payload.points[0]?.highlighted, false);
  });

  it("payload vazio (sem ano) sinaliza hasYear=false", () => {
    const payload = buildCostCenterMonthlyEvolutionEmptyPayload(["cc-a"]);
    assert.equal(payload.hasYear, false);
    assert.equal(payload.hasData, false);
    assert.equal(payload.points.length, 0);
  });

  it("agrupamento usa apenas dueDate — ignora linhas sem vencimento", () => {
    const rows = [row(null, 999), row("2026-04-10T00:00:00.000Z", 40)];
    const buckets = groupCostCenterAllocationByDueMonth(rows, 2026);
    assert.equal(
      buckets.reduce((acc, v) => acc + v, 0),
      40
    );
    assert.equal(buckets[3], 40);
  });

  it("service reutiliza a mesma fonte/filtro-base da tabela (resolveCostCenterDetailFilteredRowsForCenters)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/financeCostCenterMonthlyEvolution.ts"),
      "utf8"
    );
    assert.match(src, /resolveCostCenterDetailFilteredRowsForCenters/);
    assert.match(src, /parseCostCenterDetailListQuery/);
    // não pode usar outro critério de data: agrupamento por dueDate apenas
    assert.doesNotMatch(src, /paymentDate|settlementDate|competenceDate|createdAt|updatedAt/);
  });

  it("endpoints mensais estão registrados reutilizando a query da tabela", () => {
    const routes = readFileSync(
      join(process.cwd(), "src/lib/financeCostCenterDetailRoutes.ts"),
      "utf8"
    );
    assert.match(routes, /\/api\/finance\/cost-centers\/:id\/allocations\/monthly/);
    assert.match(routes, /\/api\/finance\/cost-centers\/allocations\/monthly/);
    assert.match(routes, /loadCostCenterMonthlyEvolutionDefault/);
    assert.match(routes, /loadCostCenterMonthlyEvolutionForCenters/);
  });
});
