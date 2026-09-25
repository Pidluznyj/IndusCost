/**
 * Tela Resultado de Pedidos de Venda — desempenho sem mudar números:
 *   - cache curto das respostas (TTL, in-flight, sem cachear erro, chave estrita);
 *   - Server-Timing por fase;
 *   - margem: config, contexto de custo e contexto fiscal calculados UMA vez e
 *     compartilhados pelas duas apurações (resultado idêntico, menos leituras);
 *   - projeção leve: mesmos números do dashboard, sem motor de margem nem JSON;
 *   - JSON do Nomus: itens extraídos uma vez por pedido (mesmo status por item).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  buildSalesOrderResultCacheKey,
  createSalesOrderResultResponseCache,
  formatSalesOrderResultCacheDay,
  formatSalesOrderResultServerTiming,
} from "./salesOrderResultResponseCache.js";
import {
  buildSalesOrderResultDashboard,
  buildSalesOrderResultProjectionPayload,
  SALES_ORDER_RESULT_PROJECTION_PRISMA_SELECT,
} from "./salesOrderResultEngine.server.js";
import { buildOfficialSalesOrderListMarginSummary } from "./salesMarginRulesAdapter.js";
import {
  loadSalesMarginNomusConfig,
  salesMarginNomusConfigToCostPolicy,
} from "./salesMarginNomusConfig.js";
import { buildSalesOrderMarginContext } from "./salesOrderMarginService.server.js";
import { resolveOfficialSalesMarginTaxContext } from "./salesMarginNomusTaxContext.server.js";
import {
  extractNomusRawItems,
  matchRawItemToDbItem,
  resolveMatchedNomusRawItemStatus,
  resolveSalesOrderItemNomusStatus,
} from "./salesOrderNomusRaw.js";
import {
  getSalesOrderResultApiPath,
  getSalesOrderResultProjectionApiPath,
  SALES_ORDER_RESULT_PROJECTION_API_PATH,
} from "./salesOrderResultApi.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/** Só código: remove comentários (os cabeçalhos citam o que é proibido). */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("cache curto das respostas do Resultado", () => {
  it("miss calcula, hit reaproveita dentro do TTL, expirado recalcula", async () => {
    let clock = 1_000;
    const cache = createSalesOrderResultResponseCache<number>({
      ttlMs: 100,
      maxEntries: 10,
      now: () => clock,
    });
    let computed = 0;
    const compute = async () => ++computed;

    assert.deepEqual(await cache.getOrCompute("k", compute), { value: 1, status: "miss" });
    clock += 99;
    assert.deepEqual(await cache.getOrCompute("k", compute), { value: 1, status: "hit" });
    clock += 1;
    assert.deepEqual(await cache.getOrCompute("k", compute), { value: 2, status: "miss" });
    assert.equal(computed, 2);
  });

  it("requisições idênticas simultâneas compartilham o mesmo cálculo", async () => {
    const cache = createSalesOrderResultResponseCache<string>({ ttlMs: 1_000, maxEntries: 10 });
    const gate = deferred<string>();
    let computed = 0;
    const compute = () => {
      computed += 1;
      return gate.promise;
    };
    const first = cache.getOrCompute("k", compute);
    const second = cache.getOrCompute("k", compute);
    gate.resolve("payload");
    assert.deepEqual(await first, { value: "payload", status: "miss" });
    assert.deepEqual(await second, { value: "payload", status: "shared" });
    assert.equal(computed, 1);
  });

  it("erro não é cacheado (nem para quem esperava o mesmo cálculo)", async () => {
    const cache = createSalesOrderResultResponseCache<string>({ ttlMs: 1_000, maxEntries: 10 });
    const gate = deferred<string>();
    const first = cache.getOrCompute("k", () => gate.promise);
    const second = cache.getOrCompute("k", () => gate.promise);
    gate.reject(new Error("banco indisponível"));
    await assert.rejects(first, /banco indisponível/);
    await assert.rejects(second, /banco indisponível/);
    assert.equal(cache.size(), 0);
    assert.deepEqual(await cache.getOrCompute("k", async () => "ok"), { value: "ok", status: "miss" });
  });

  it("sem chave (sem carimbo de atualização) calcula sempre, sem guardar", async () => {
    const cache = createSalesOrderResultResponseCache<number>({ ttlMs: 1_000, maxEntries: 10 });
    let computed = 0;
    assert.deepEqual(await cache.getOrCompute(null, async () => ++computed), { value: 1, status: "bypass" });
    assert.deepEqual(await cache.getOrCompute(null, async () => ++computed), { value: 2, status: "bypass" });
    assert.equal(cache.size(), 0);
  });

  it("tamanho limitado: descarta a entrada usada há mais tempo", async () => {
    const cache = createSalesOrderResultResponseCache<string>({ ttlMs: 60_000, maxEntries: 2 });
    await cache.getOrCompute("a", async () => "A");
    await cache.getOrCompute("b", async () => "B");
    assert.equal((await cache.getOrCompute("a", async () => "A2")).status, "hit");
    await cache.getOrCompute("c", async () => "C");
    assert.equal(cache.size(), 2);
    assert.equal((await cache.getOrCompute("a", async () => "A3")).status, "hit");
    assert.deepEqual(await cache.getOrCompute("b", async () => "B2"), { value: "B2", status: "miss" });
  });

  it("chave: tipo + dia + carimbo + parâmetros exatamente como vieram (ordem não importa)", () => {
    const context = { versionStamp: "2026-09-25T10:00:00.000Z", day: "2026-09-25|2026-09-25" };
    const a = buildSalesOrderResultCacheKey("dashboard", { year: "2026", month: "9" }, context);
    const b = buildSalesOrderResultCacheKey("dashboard", { month: "9", year: "2026" }, context);
    assert.equal(a, b);
    assert.notEqual(a, buildSalesOrderResultCacheKey("projection", { year: "2026", month: "9" }, context));
    assert.notEqual(a, buildSalesOrderResultCacheKey("dashboard", { year: "2026", month: "8" }, context));
    assert.notEqual(a, buildSalesOrderResultCacheKey("dashboard", { year: "2026", month: " 9" }, context));
    assert.notEqual(
      a,
      buildSalesOrderResultCacheKey("dashboard", { year: "2026", month: "9" }, { ...context, versionStamp: "2026-09-25T10:05:00.000Z" }),
      "sync novo ⇒ chave nova"
    );
    assert.notEqual(
      a,
      buildSalesOrderResultCacheKey("dashboard", { year: "2026", month: "9" }, { ...context, day: "2026-09-26|2026-09-26" })
    );
    assert.equal(
      buildSalesOrderResultCacheKey("dashboard", { year: "2026" }, { ...context, versionStamp: null }),
      null
    );
  });

  it("dia da chave: data civil local + UTC; Server-Timing só com nomes válidos", () => {
    assert.match(formatSalesOrderResultCacheDay(new Date(2026, 8, 25, 22, 30)), /^2026-09-25\|\d{4}-\d{2}-\d{2}$/);
    assert.equal(
      formatSalesOrderResultServerTiming({ scope: 12.4, orders: 340, "bad name": 5, marginContext: Number.NaN }),
      "scope;dur=12, orders;dur=340"
    );
    assert.equal(formatSalesOrderResultServerTiming({}), "");
  });
});

/* ------------------------------------------------------------------ */
/*  Banco falso que registra as leituras e respeita o `select`          */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

function pickSelected(row: Row, select: unknown): Row {
  if (!select || typeof select !== "object") return row;
  const out: Row = {};
  for (const [key, spec] of Object.entries(select as Record<string, unknown>)) {
    if (!spec) continue;
    const value = row[key];
    const nested = (spec as { select?: unknown }).select;
    if (spec === true || nested == null) out[key] = value ?? null;
    else if (Array.isArray(value)) out[key] = value.map((entry) => pickSelected(entry as Row, nested));
    else if (value && typeof value === "object" && value instanceof Date === false) {
      out[key] = pickSelected(value as Row, nested);
    } else out[key] = value ?? null;
  }
  return out;
}

function makeRecordingDb(orders: Row[]) {
  const calls: string[] = [];
  const selects: unknown[] = [];
  const modelProxy = (model: string) =>
    new Proxy(
      {},
      {
        get(_inner, method: string | symbol) {
          return async (args?: { select?: unknown }) => {
            calls.push(`${model}.${String(method)}`);
            if (model === "salesOrder" && method === "findMany") {
              selects.push(args?.select);
              return orders.map((order) => pickSelected(order, args?.select));
            }
            if (method === "findMany" || method === "groupBy") return [];
            if (method === "count") return 0;
            if (method === "aggregate") return { _max: {}, _min: {}, _sum: {}, _count: {}, _avg: {} };
            return null;
          };
        },
      }
    );
  const db = new Proxy(
    {},
    {
      get(_target, model: string | symbol) {
        if (typeof model !== "string" || model === "then") return undefined;
        if (model.startsWith("$")) return async () => [];
        return modelProxy(model);
      },
    }
  ) as unknown as PrismaClient;
  return { db, calls, selects };
}

function countCalls(calls: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const call of calls) out[call] = (out[call] ?? 0) + 1;
  return out;
}

function fakeItem(id: string, orderId: string, n: number): Row {
  return {
    id,
    salesOrderId: orderId,
    productId: `p${n}`,
    proposalItemId: null,
    externalProductId: 100 + n,
    skuSnapshot: `SKU${n}`,
    productNameSnapshot: `Produto ${n}`,
    quantity: 2 + n,
    flowItemSnapshot: null,
    negotiatedPrice: 50 + n,
    totalNetValue: (2 + n) * (50 + n),
    unitCost: null,
    nomusIsCanceled: false,
    nomusIsStale: false,
    nomusIsCut: false,
    nomusItemStatusNormalized: null,
    nomusItemStatusRaw: null,
  };
}

function fakeOrders(): Row[] {
  return [1, 2, 3, 4, 5, 6].map((i) => ({
    id: `o${i}`,
    orderCode: `PD-${i}`,
    status: i === 6 ? "CANCELLED" : "SENT_TO_NOMUS",
    customerId: `c${i % 2}`,
    issueDate: new Date(2026, i, 10),
    expectedDeliveryDate: new Date(2026, i, 30),
    totalNetValue: 1000 * i,
    totalGrossValue: 1100 * i,
    totalItems: 2,
    responsible: "Ana",
    nomusSellerName: "Ana",
    externalSellerId: "7",
    companyIssuer: "INDUS",
    externalSalesOrderId: String(9000 + i),
    proposalId: null,
    Customer: { companyName: `Cliente ${i}`, tradeName: null, taxId: "12345678000199" },
    nomusRawResponse: {
      itensPedido: [
        { idProduto: 100 + i, status: i === 3 ? 6 : 2, quantidade: 2 },
        { idProduto: 200, status: 2 },
      ],
    },
    items: [fakeItem(`o${i}-a`, `o${i}`, i), fakeItem(`o${i}-b`, `o${i}`, i + 10)],
  }));
}

describe("margem: contexto calculado uma vez e compartilhado (resultado idêntico)", () => {
  it("margem comercial com contexto pré-calculado = cálculo próprio, sem repetir as leituras", async () => {
    const orders = fakeOrders() as never[];
    const standalone = makeRecordingDb(fakeOrders());
    const expected = await buildOfficialSalesOrderListMarginSummary(standalone.db, orders, { year: 2026 });

    const prep = makeRecordingDb(fakeOrders());
    const { config: nomusConfig } = await loadSalesMarginNomusConfig(prep.db);
    const marginContext = await buildSalesOrderMarginContext(prep.db, orders, {
      costPolicy: salesMarginNomusConfigToCostPolicy(nomusConfig),
    });
    const productIds = (fakeOrders() as Array<{ items: Array<{ productId: string }> }>).flatMap(
      (order) => order.items.map((item) => item.productId)
    );
    const officialTaxContext = await resolveOfficialSalesMarginTaxContext(prep.db, productIds, nomusConfig);

    const shared = makeRecordingDb(fakeOrders());
    const actual = await buildOfficialSalesOrderListMarginSummary(shared.db, orders, {
      year: 2026,
      precomputedMarginContext: { nomusConfig, marginContext, officialTaxContext },
    });

    assert.deepEqual(actual, expected);
    const before = countCalls(standalone.calls);
    const after = countCalls(shared.calls);
    // Produto, custo, imposto e config não são relidos.
    for (const call of ["product.findMany", "productPricing.findMany", "indirectCost.findFirst"]) {
      assert.ok((before[call] ?? 0) > 0, `cálculo próprio lê ${call}`);
      assert.equal(after[call] ?? 0, 0, `contexto compartilhado não relê ${call}`);
    }
    assert.ok(shared.calls.length < standalone.calls.length);
  });

  it("dashboard: config, contexto de custo e contexto fiscal uma única vez no motor", () => {
    const engine = codeOnly(read("src/lib/salesOrderResultEngine.server.ts"));
    assert.equal((engine.match(/loadSalesMarginNomusConfig\(/g) ?? []).length, 1);
    assert.equal((engine.match(/buildSalesOrderMarginContext\(/g) ?? []).length, 1);
    assert.equal((engine.match(/resolveOfficialSalesMarginTaxContext\(/g) ?? []).length, 1);
    assert.match(
      engine,
      /precomputedMarginContext: \{ nomusConfig, marginContext, officialTaxContext \}/
    );
    const adapter = codeOnly(read("src/lib/salesMarginRulesAdapter.ts"));
    assert.match(adapter, /precomputed\?\.nomusConfig \?\? \(await loadSalesMarginNomusConfig\(db\)\)\.config/);
    assert.match(adapter, /precomputed\?\.marginContext \?\?\s*\(await buildSalesOrderMarginContext\(db, orders, \{/);
    assert.match(
      adapter,
      /precomputed\?\.officialTaxContext \?\?\s*\(await resolveOfficialSalesMarginTaxContext\(db, productIds, nomusConfig\)\)/
    );
  });
});

describe("projeção leve: mesmos números do dashboard, sem margem e sem JSON", () => {
  it("Realizado vs Projetado, KPIs de projeção e YoY idênticos ao dashboard completo", async () => {
    const now = new Date(2026, 8, 25, 12);
    const query = { year: "2026", asOfDate: "2026-09-25" };
    const full = makeRecordingDb(fakeOrders());
    const dashboard = await buildSalesOrderResultDashboard(full.db, query, now, {
      includeListMarginChartSeries: false,
    });
    const light = makeRecordingDb(fakeOrders());
    const timings: Record<string, number> = {};
    const projection = await buildSalesOrderResultProjectionPayload(light.db, query, now, { timings });

    assert.deepEqual(projection, {
      filters: dashboard.filters,
      monthlySalesComparison: dashboard.monthlySalesComparison,
      realizedVsProjected: dashboard.realizedVsProjected,
      projection: dashboard.projection,
    });
    assert.ok(dashboard.realizedVsProjected.some((row) => row.realizedAmount > 0));
    // Só pedidos (ano filtrado + ano anterior): nenhuma leitura de custo/produto/imposto.
    assert.deepEqual(countCalls(light.calls), { "salesOrder.findMany": 2 });
    assert.equal(typeof timings.total, "number");
  });

  it("select da projeção = regras de pedido sem o JSON do Nomus", async () => {
    assert.equal("nomusRawResponse" in SALES_ORDER_RESULT_PROJECTION_PRISMA_SELECT, false);
    assert.equal(SALES_ORDER_RESULT_PROJECTION_PRISMA_SELECT.issueDate, true);
    assert.equal(SALES_ORDER_RESULT_PROJECTION_PRISMA_SELECT.totalNetValue, true);
    assert.equal(SALES_ORDER_RESULT_PROJECTION_PRISMA_SELECT.status, true);
    const light = makeRecordingDb(fakeOrders());
    await buildSalesOrderResultProjectionPayload(light.db, { year: "2026" }, new Date(2026, 8, 25));
    assert.ok(light.selects.length > 0);
    for (const select of light.selects) {
      assert.equal(JSON.stringify(select).includes("nomusRawResponse"), false);
    }
  });

  it("dashboard registra as fases (Server-Timing)", async () => {
    const timings: Record<string, number> = {};
    const full = makeRecordingDb(fakeOrders());
    await buildSalesOrderResultDashboard(full.db, { year: "2026" }, new Date(2026, 8, 25), {
      includeListMarginChartSeries: false,
      timings,
    });
    const phases = ["scope", "orders", "marginContext", "taxContext", "marginManagerial", "marginCommercial", "previousYear", "total"];
    for (const phase of phases) {
      assert.equal(typeof timings[phase], "number", `fase ${phase}`);
    }
    assert.equal("listMarginChartSeries" in timings, false, "série da listagem pulada na tela");
  });
});

describe("rotas: projeção leve, cache e Server-Timing", () => {
  const routes = codeOnly(read("src/lib/salesOrderResultRoutes.ts"));

  it("projeção: rota estática com a guarda de Pedidos, antes de /api/sales-orders/:id", () => {
    assert.equal(SALES_ORDER_RESULT_PROJECTION_API_PATH, "/api/sales-orders/results/projection");
    assert.match(
      routes,
      /SALES_ORDER_RESULT_PROJECTION_API_PATH,\s*auth\.requireAppAuth,\s*auth\.requireResource\(COMMERCIAL_RESOURCE_KEYS\.salesOrders, COMMERCIAL_ACTIONS\.view\)/
    );
    assert.match(routes, /buildSalesOrderResultProjectionPayload\(prisma, query, now, \{ timings \}\)/);
    const server = read("server.ts");
    const idxResultRoutes = server.indexOf("registerSalesOrderResultRoutes(app, {");
    const idxById = server.indexOf('app.get("/api/sales-orders/:id"');
    assert.ok(idxResultRoutes > 0 && idxResultRoutes < idxById);
  });

  it("dashboard e projeção passam pelo cache curto + Server-Timing; chave sem usuário", () => {
    assert.equal((routes.match(/sendSalesOrderResultResponse\(res, \{/g) ?? []).length, 2);
    assert.match(routes, /cache: dashboardResponseCache/);
    assert.match(routes, /cache: projectionResponseCache/);
    assert.match(routes, /loadSalesOrdersLastUpdatedAt\(prisma\)/);
    assert.match(routes, /res\.setHeader\("Server-Timing", formatSalesOrderResultServerTiming\(timings\)\)/);
    assert.match(routes, /res\.setHeader\("X-Sales-Order-Result-Cache", status\)/);
    assert.match(routes, /SALES_ORDER_RESULT_CACHE_TTL_MS = 5 \* 60 \* 1000/);
    // A resposta depende só da query (mesmo guard para todos): nada do usuário na chave.
    const keyCall = routes.slice(routes.indexOf("buildSalesOrderResultCacheKey("));
    assert.doesNotMatch(keyCall.slice(0, keyCall.indexOf(");")), /req\.|user|session/i);
  });

  it("caminhos do cliente: mesma query no dashboard e na projeção", () => {
    const filters = { year: 2026, month: 9, asOfDate: "2026-09-25", sellerKey: "7" };
    const dashboardPath = getSalesOrderResultApiPath(filters);
    const projectionPath = getSalesOrderResultProjectionApiPath(filters);
    assert.equal(dashboardPath, "/api/sales-orders/results?year=2026&month=9&sellerKey=7&asOfDate=2026-09-25");
    assert.equal(
      projectionPath,
      "/api/sales-orders/results/projection?year=2026&month=9&sellerKey=7&asOfDate=2026-09-25"
    );
  });
});

describe("JSON do Nomus: itens extraídos uma vez por pedido (mesmo status por item)", () => {
  const raw = {
    itensPedido: [
      { idProduto: 101, codigoProduto: "A-1", descricaoProduto: "Válvula", status: 6, quantidade: 2 },
      { produto: { id: 202 }, codigoProduto: "B-2", descricaoProduto: "Bomba", status: "Cancelado" },
      { codigoProduto: "C-3", nomeProduto: "Tubo", situacaoItem: "Atendido", quantidade: 5 },
      { codigoProduto: "D-4", descricaoProduto: "Luva", quantidade: 3, quantidadeCancelada: 3 },
      { codigoProduto: "E-5", descricaoProduto: "Flange", status: 2 },
    ],
  };
  const cases: Array<{
    label: string;
    orderRaw: unknown;
    dbItem: { externalProductId?: number | null; skuSnapshot?: string | null; productNameSnapshot?: string | null };
    options?: { itemIndex?: number; totalDbItems?: number };
  }> = [
    { label: "id do produto", orderRaw: raw, dbItem: { externalProductId: 101 } },
    { label: "id aninhado", orderRaw: raw, dbItem: { externalProductId: 202 } },
    { label: "SKU", orderRaw: raw, dbItem: { skuSnapshot: "c-3" } },
    { label: "nome", orderRaw: raw, dbItem: { productNameSnapshot: "luva" } },
    { label: "posição", orderRaw: raw, dbItem: { skuSnapshot: "ZZZ" }, options: { itemIndex: 4, totalDbItems: 5 } },
    { label: "sem casamento", orderRaw: raw, dbItem: { skuSnapshot: "ZZZ" }, options: { itemIndex: 0, totalDbItems: 2 } },
    { label: "item único", orderRaw: { itens: [{ status: 3 }] }, dbItem: { skuSnapshot: "X" }, options: { itemIndex: 0, totalDbItems: 1 } },
    { label: "sem itens", orderRaw: { nfes: [] }, dbItem: { externalProductId: 1 } },
    { label: "JSON nulo", orderRaw: null, dbItem: { externalProductId: 1 } },
  ];

  for (const testCase of cases) {
    it(`status igual ao cálculo item a item — ${testCase.label}`, () => {
      const matched = matchRawItemToDbItem(
        extractNomusRawItems(testCase.orderRaw),
        testCase.dbItem,
        testCase.options
      );
      assert.equal(
        resolveMatchedNomusRawItemStatus(matched),
        resolveSalesOrderItemNomusStatus(testCase.orderRaw, testCase.dbItem, testCase.options)
      );
    });
  }

  it("casos de referência mantêm o status esperado", () => {
    assert.equal(resolveSalesOrderItemNomusStatus(raw, { externalProductId: 101 }), "cancelled");
    assert.equal(
      resolveMatchedNomusRawItemStatus(matchRawItemToDbItem(extractNomusRawItems(raw), { externalProductId: 101 })),
      "cancelled"
    );
    assert.equal(resolveMatchedNomusRawItemStatus(null), "unknown");
  });

  it("motor de margem extrai os itens do JSON uma vez por pedido", () => {
    const service = codeOnly(read("src/lib/salesOrderMarginService.server.ts"));
    assert.doesNotMatch(service, /resolveSalesOrderItemNomusStatus\(/);
    assert.match(service, /const nomusStatus = resolveMatchedNomusRawItemStatus\(matched\);/);
    const loopStart = service.search(
      /for \(const order of orders\) \{\s*const items = order\.items \?\? itemsByOrderId\.get\(order\.id\) \?\? \[\];/
    );
    assert.ok(loopStart > 0, "laço por pedido do contexto de margem");
    const loop = service.slice(loopStart, service.indexOf("if (resolverItems.length === 0)", loopStart));
    assert.match(loop, /const rawItems = extractNomusRawItems\(order\.nomusRawResponse\);\s*items\.forEach\(/);
    assert.match(loop, /mapItemToResolverInput\(item, order, index, items\.length, rawItems\)/);
  });
});
