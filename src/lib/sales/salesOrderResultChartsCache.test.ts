/**
 * Cache dos gráficos da listagem Comercial > Pedidos de Venda.
 *
 * Trava:
 *  1. anos-alvo: pedido do ano A invalida A e A+1 (YoY), limitado a maxYear;
 *  2. compute grava por ano exatamente as duas séries que os gráficos usam;
 *  3. hook pós-sync é SOFT-FAIL (nunca propaga) e só recomputa anos já
 *     consultados ou o ano corrente;
 *  4. gates estruturais: rotas com guard, tela lendo do cache com botão
 *     Atualizar, hook plugado no script de sync, migration aditiva.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveSalesOrderResultChartsCacheTargetYears } from "./salesOrderResultChartsCache.js";
import {
  computeAndStoreSalesOrderResultChartsCache,
  getSalesOrderResultChartsCache,
  refreshSalesOrderResultChartsCacheAfterNomusSync,
  type SalesOrderResultChartsCacheDb,
} from "./salesOrderResultChartsCache.server.js";

const NOW = new Date("2026-08-26T12:00:00Z");

const SALES_ROWS = [
  { month: 1, monthLabel: "jan", currentYearAmount: 100, previousYearAmount: 80 },
];
const MARGIN_ROWS = [
  {
    month: 1,
    monthLabel: "jan",
    salesAmount: 100,
    taxAmount: 10,
    netSalesAmount: 90,
    costAmount: 60,
    marginAmount: 30,
    marginPercent: 33.3,
    ordersCount: 4,
  },
];

type FakeRow = {
  year: number;
  monthlySalesComparisonJson: unknown;
  monthlyCommercialMarginJson: unknown;
  computedAt: Date;
  computeDurationMs: number | null;
};

function fakeDb(seed: {
  cacheRows?: FakeRow[];
  orders?: Array<{ issueDate: Date | null }>;
  ordersError?: string;
}) {
  const cacheRows: FakeRow[] = (seed.cacheRows ?? []).map((r) => ({ ...r }));
  const db = {
    salesOrderResultChartsCache: {
      findUnique: async ({ where }: { where: { year: number } }) =>
        cacheRows.find((r) => r.year === where.year) ?? null,
      findMany: async ({ where }: { where: { year: { in: number[] } } }) =>
        cacheRows.filter((r) => where.year.in.includes(r.year)),
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { year: number };
        create: FakeRow;
        update: Omit<FakeRow, "year">;
      }) => {
        const existing = cacheRows.find((r) => r.year === where.year);
        if (existing) Object.assign(existing, update);
        else cacheRows.push({ ...create });
        return existing ?? create;
      },
    },
    salesOrder: {
      findMany: async () => {
        if (seed.ordersError) throw new Error(seed.ordersError);
        return seed.orders ?? [];
      },
    },
  } as unknown as SalesOrderResultChartsCacheDb;
  return { db, cacheRows };
}

function fakeDashboardBuilder(log: string[] = [], failYears: number[] = []) {
  return async (_db: unknown, query: Record<string, unknown>) => {
    const year = Number(query.year);
    log.push(String(query.year));
    if (failYears.includes(year)) {
      throw new Error(`motor falhou para ${year}`);
    }
    return {
      monthlySalesComparison: SALES_ROWS,
      monthlyCommercialMargin: MARGIN_ROWS,
    } as never;
  };
}

describe("charts-cache — anos-alvo (invalidação YoY)", () => {
  it("pedido do ano A invalida A e A+1", () => {
    assert.deepEqual(
      resolveSalesOrderResultChartsCacheTargetYears([2025], 2027),
      [2025, 2026]
    );
  });

  it("maxYear limita o horizonte (ano corrente não invalida ano inexistente na tela)", () => {
    assert.deepEqual(
      resolveSalesOrderResultChartsCacheTargetYears([2026], 2026),
      [2026]
    );
  });

  it("deduplica, ordena e ignora anos inválidos", () => {
    assert.deepEqual(
      resolveSalesOrderResultChartsCacheTargetYears(
        [2026, 2025, 2026, Number.NaN, 1900, 2050],
        2027
      ),
      [2025, 2026, 2027]
    );
  });
});

describe("charts-cache — compute e leitura", () => {
  it("compute roda o motor SÓ com o ano e grava as duas séries", async () => {
    const { db, cacheRows } = fakeDb({});
    const log: string[] = [];
    const payload = await computeAndStoreSalesOrderResultChartsCache(db, 2026, {
      buildDashboard: fakeDashboardBuilder(log) as never,
      now: () => NOW,
    });

    assert.deepEqual(log, ["2026"], "uma única chamada ao motor, só com o ano");
    assert.equal(cacheRows.length, 1);
    assert.equal(cacheRows[0].year, 2026);
    assert.deepEqual(cacheRows[0].monthlySalesComparisonJson, SALES_ROWS);
    assert.deepEqual(cacheRows[0].monthlyCommercialMarginJson, MARGIN_ROWS);
    assert.equal(payload.computedAt, NOW.toISOString());
    assert.deepEqual(payload.monthlySalesComparison, SALES_ROWS);
  });

  it("leitura: miss devolve null; hit devolve payload convertido", async () => {
    const { db } = fakeDb({
      cacheRows: [
        {
          year: 2026,
          monthlySalesComparisonJson: SALES_ROWS,
          monthlyCommercialMarginJson: MARGIN_ROWS,
          computedAt: NOW,
          computeDurationMs: 1234,
        },
      ],
    });

    assert.equal(await getSalesOrderResultChartsCache(db, 2024), null);
    const hit = await getSalesOrderResultChartsCache(db, 2026);
    assert.ok(hit);
    assert.equal(hit.year, 2026);
    assert.equal(hit.computedAt, NOW.toISOString());
    assert.equal(hit.computeDurationMs, 1234);
    assert.deepEqual(hit.monthlyCommercialMargin, MARGIN_ROWS);
  });
});

describe("charts-cache — hook pós-sync (soft-fail)", () => {
  it("sem pedidos afetados → skipped, motor nunca roda", async () => {
    const { db } = fakeDb({});
    const log: string[] = [];
    const result = await refreshSalesOrderResultChartsCacheAfterNomusSync(
      db,
      { salesOrderIds: [] },
      { buildDashboard: fakeDashboardBuilder(log) as never, now: () => NOW }
    );
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "no_affected_orders");
    assert.deepEqual(log, []);
  });

  it("só recomputa anos JÁ consultados ou o ano corrente", async () => {
    // Pedido de 2024 → alvos {2024, 2025}; nenhum tem cache e nenhum é o ano
    // corrente (2026) → nada a fazer. Não cria trabalho para tela que ninguém abriu.
    const { db } = fakeDb({
      orders: [{ issueDate: new Date("2024-05-10T00:00:00Z") }],
    });
    const log: string[] = [];
    const result = await refreshSalesOrderResultChartsCacheAfterNomusSync(
      db,
      { salesOrderIds: ["so-1"] },
      { buildDashboard: fakeDashboardBuilder(log) as never, now: () => NOW }
    );
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "no_cached_years");
    assert.deepEqual(log, []);
  });

  it("pedido do ano corrente → recomputa o ano corrente (e o cache de A+1 se existir)", async () => {
    const { db } = fakeDb({
      orders: [{ issueDate: new Date("2026-03-01T00:00:00Z") }],
      cacheRows: [
        {
          year: 2027,
          monthlySalesComparisonJson: [],
          monthlyCommercialMarginJson: [],
          computedAt: new Date("2026-01-01T00:00:00Z"),
          computeDurationMs: null,
        },
      ],
    });
    const log: string[] = [];
    const result = await refreshSalesOrderResultChartsCacheAfterNomusSync(
      db,
      { salesOrderIds: ["so-1"] },
      { buildDashboard: fakeDashboardBuilder(log) as never, now: () => NOW }
    );
    assert.equal(result.skipped, false);
    assert.deepEqual(result.yearsRefreshed, [2026, 2027]);
    assert.deepEqual(log, ["2026", "2027"]);
    assert.deepEqual(result.errors, []);
  });

  it("ELIMINATÓRIO: falha do motor em um ano não derruba os demais nem propaga", async () => {
    const { db } = fakeDb({
      orders: [{ issueDate: new Date("2026-03-01T00:00:00Z") }],
      cacheRows: [
        {
          year: 2027,
          monthlySalesComparisonJson: [],
          monthlyCommercialMarginJson: [],
          computedAt: new Date("2026-01-01T00:00:00Z"),
          computeDurationMs: null,
        },
      ],
    });
    const result = await refreshSalesOrderResultChartsCacheAfterNomusSync(
      db,
      { salesOrderIds: ["so-1"] },
      {
        buildDashboard: fakeDashboardBuilder([], [2026]) as never,
        now: () => NOW,
      }
    );
    assert.deepEqual(result.yearsRefreshed, [2027]);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].year, 2026);
  });

  it("ELIMINATÓRIO: erro geral (banco) não propaga para o sync chamador", async () => {
    const { db } = fakeDb({ ordersError: "conexão caiu" });
    const result = await refreshSalesOrderResultChartsCacheAfterNomusSync(
      db,
      { salesOrderIds: ["so-1"] },
      { now: () => NOW }
    );
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /conexão caiu/);
  });
});

/* ------------------------------------------------------------------ */
/*  Gates estruturais                                                   */
/* ------------------------------------------------------------------ */

function readSource(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("charts-cache — gates estruturais", () => {
  it("rotas GET e POST registradas com o mesmo guard da listagem", () => {
    const routes = readSource("../salesOrderResultRoutes.ts");
    assert.ok(routes.includes('"/api/sales-orders/results/charts-cache"'));
    assert.ok(
      routes.includes('"/api/sales-orders/results/charts-cache/refresh"')
    );
    const guardCount =
      routes.match(
        /requireResource\(COMMERCIAL_RESOURCE_KEYS\.salesOrders, COMMERCIAL_ACTIONS\.view\)/g
      ) ?? [];
    assert.ok(
      guardCount.length >= 3,
      "as três rotas (results, cache GET, cache POST) exigem o guard de Pedidos"
    );
  });

  it("tela lê do cache, tem botão Atualizar e mostra Atualizado em", () => {
    const charts = readSource(
      "../../components/sales/SalesOrderListMonthlyCharts.tsx"
    );
    assert.ok(charts.includes("/api/sales-orders/results/charts-cache?year="));
    assert.ok(
      charts.includes('data-testid="sales-order-list-monthly-charts-refresh"')
    );
    assert.ok(
      charts.includes(
        'data-testid="sales-order-list-monthly-charts-computed-at"'
      )
    );
    // ELIMINATÓRIO: a tela NÃO pode voltar a rodar o motor completo por sessão.
    assert.ok(
      !charts.includes("getSalesOrderResultApiPath"),
      "gráficos não podem voltar ao endpoint pesado /api/sales-orders/results"
    );
  });

  it("hook pós-sync plugado no script oficial de sync de pedidos, em try soft-fail", () => {
    const sync = readSource("../../../scripts/nomusSalesOrdersSyncV1.ts");
    assert.ok(
      sync.includes("refreshSalesOrderResultChartsCacheAfterNomusSync(prisma"),
      "script de sync chama o hook do cache"
    );
    const hookIndex = sync.indexOf(
      "refreshSalesOrderResultChartsCacheAfterNomusSync(prisma"
    );
    const before = sync.slice(Math.max(0, hookIndex - 400), hookIndex);
    assert.ok(before.includes("try {"), "hook roda dentro de try (soft-fail)");
  });

  it("migration é aditiva e idempotente", () => {
    const migration = readSource(
      "../../../prisma/migrations/20260826150000_sales_order_result_charts_cache/migration.sql"
    );
    assert.ok(
      migration.includes(
        'CREATE TABLE IF NOT EXISTS "SalesOrderResultChartsCache"'
      )
    );
    assert.ok(
      !/\bDROP\s|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bALTER\s+TABLE\b/i.test(
        migration
      ),
      "nada destrutivo e nenhuma tabela existente tocada"
    );
  });
});
