/**
 * Tela Resultado de Pedidos de Venda:
 *   - filtros no padrão do sistema (rascunho × aplicado; só consulta em Pesquisar);
 *   - dropdowns com dados do servidor (vendedor, cliente, produto) e Status CR multi;
 *   - gráfico mensal do prazo médio de recebimento (12 meses × ano anterior);
 *   - performance: a rota não calcula a série anual da listagem; cada consulta
 *     cancela a anterior; filtro de produto não zera Qtde Pedidos/projeção.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  buildInitialSalesOrderResultAppliedFilters,
  buildSalesOrderResultQueryString,
  formatSalesOrderResultAsOfDate,
  hasPendingSalesOrderResultFilters,
  toSalesOrderResultApiFilters,
} from "./salesOrderResultFilters.js";
import {
  SALES_ORDER_PRODUCT_FILTER_OPTIONS_PATH,
  buildSalesOrderProductFilterSearchWhere,
  buildSalesOrderProductFilterWhere,
  getSalesOrderProductFilterOptionsUrl,
  normalizeSalesOrderProductFilterId,
  parseSalesOrderProductFilterSearch,
} from "./salesOrderProductFilter.js";
import { searchSalesOrderProductFilterOptions } from "./salesOrderProductFilterOptions.server.js";
import {
  SALES_ORDER_FILTER_ACTION_BUTTON_CLASS,
  SALES_ORDER_FILTER_CONTROL_CLASS,
  SALES_ORDER_FILTER_LABEL_CLASS,
  SALES_ORDER_FILTER_PRIMARY_ACTION_CLASS,
} from "../components/sales/salesOrderFilterBarStyles.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/** Só código: remove comentários (os cabeçalhos citam o que é proibido). */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const PRODUCT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("salesOrderResultFilters — rascunho × aplicado", () => {
  const applied = {
    ...buildInitialSalesOrderResultAppliedFilters(2026),
    month: "9",
    status: "SENT_TO_NOMUS",
    hasInvoice: "true",
    receivableStatus: "open,settled",
    customerId: "c1",
    sellerKey: "123",
    productId: PRODUCT_ID,
  };

  it("filtros iniciais: ano corrente, todos os meses, nada mais", () => {
    assert.deepEqual(buildInitialSalesOrderResultAppliedFilters(2026), {
      year: "2026",
      month: "",
      status: "",
      hasInvoice: "",
      receivableStatus: "",
      customerId: "",
      sellerKey: "",
      productId: "",
    });
  });

  it("query com os nomes canônicos da listagem; opções omitem Mês, Vendedor ou Produto", () => {
    const full = new URLSearchParams(buildSalesOrderResultQueryString(applied));
    assert.equal(full.get("year"), "2026");
    assert.equal(full.get("month"), "9");
    assert.equal(full.get("status"), "SENT_TO_NOMUS");
    assert.equal(full.get("hasInvoice"), "true");
    assert.equal(full.get("receivableStatus"), "open,settled");
    assert.equal(full.get("customerId"), "c1");
    assert.equal(full.get("sellerKey"), "123");
    assert.equal(full.get("productId"), PRODUCT_ID);

    const monthly = new URLSearchParams(buildSalesOrderResultQueryString(applied, { includeMonth: false }));
    assert.equal(monthly.has("month"), false, "série de 12 meses não recebe o Mês");
    assert.equal(monthly.get("productId"), PRODUCT_ID);

    const sellers = new URLSearchParams(
      buildSalesOrderResultQueryString(applied, { includeSeller: false, includeProduct: false })
    );
    assert.equal(sellers.has("sellerKey"), false, "opções do vendedor não filtram pelo próprio vendedor");
    assert.equal(sellers.has("productId"), false);
    assert.equal(sellers.get("month"), "9");

    assert.equal(
      buildSalesOrderResultQueryString(buildInitialSalesOrderResultAppliedFilters(2025)),
      "year=2025"
    );

    // SLA: Mês + data de referência (cards do período); as barras seguem 12 meses no servidor.
    const term = new URLSearchParams(buildSalesOrderResultQueryString(applied, { asOfDate: "2026-09-25" }));
    assert.equal(term.get("month"), "9");
    assert.equal(term.get("asOfDate"), "2026-09-25");
    assert.equal(full.has("asOfDate"), false);
  });

  it("data de referência da tela = dia civil local (não o dia UTC)", () => {
    assert.equal(formatSalesOrderResultAsOfDate(new Date(2026, 8, 25, 23, 30)), "2026-09-25");
    assert.equal(formatSalesOrderResultAsOfDate(new Date(2026, 0, 1, 0, 5)), "2026-01-01");
    assert.equal(formatSalesOrderResultAsOfDate(new Date(2024, 1, 29, 12)), "2024-02-29");
  });

  it("filtros do motor do Resultado (números e asOfDate)", () => {
    assert.deepEqual(toSalesOrderResultApiFilters(applied, "2026-09-25"), {
      year: 2026,
      month: 9,
      status: "SENT_TO_NOMUS",
      hasInvoice: "true",
      receivableStatus: "open,settled",
      customerId: "c1",
      sellerKey: "123",
      productId: PRODUCT_ID,
      asOfDate: "2026-09-25",
    });
    const empty = toSalesOrderResultApiFilters(
      { ...buildInitialSalesOrderResultAppliedFilters(2026), month: "13" },
      "2026-09-25"
    );
    assert.equal(empty.month, undefined);
    assert.equal(empty.productId, undefined);
  });

  it("aviso de filtros pendentes só quando o rascunho difere do aplicado", () => {
    assert.equal(hasPendingSalesOrderResultFilters(applied, { ...applied }), false);
    assert.equal(hasPendingSalesOrderResultFilters({ ...applied, month: "10" }, applied), true);
    assert.equal(hasPendingSalesOrderResultFilters({ ...applied, productId: "" }, applied), true);
  });
});

describe("filtro de produto — dropdown com produtos vendidos", () => {
  it("id do produto: só UUID válido; inválido nunca vira 'sem filtro'", () => {
    assert.equal(normalizeSalesOrderProductFilterId(PRODUCT_ID.toUpperCase()), PRODUCT_ID);
    assert.equal(normalizeSalesOrderProductFilterId(" x "), null);
    assert.equal(buildSalesOrderProductFilterWhere(""), null);
    assert.equal(buildSalesOrderProductFilterWhere(undefined), null);
    assert.deepEqual(buildSalesOrderProductFilterWhere(PRODUCT_ID), {
      items: { some: { productId: PRODUCT_ID } },
    });
    assert.deepEqual(buildSalesOrderProductFilterWhere("abc"), { id: { in: [] } });
  });

  it("busca: mínimo 2 caracteres, limite 1–50, por SKU ou nome de produto vendido", () => {
    assert.equal(parseSalesOrderProductFilterSearch({ q: "a" }), null);
    assert.equal(parseSalesOrderProductFilterSearch({}), null);
    assert.deepEqual(parseSalesOrderProductFilterSearch({ q: "  cx  10 " }), { term: "cx 10", limit: 20 });
    assert.deepEqual(parseSalesOrderProductFilterSearch({ q: "tampa", limit: "500" }), {
      term: "tampa",
      limit: 50,
    });
    assert.deepEqual(buildSalesOrderProductFilterSearchWhere("tampa"), {
      SalesOrderItem: { some: {} },
      OR: [
        { sku: { contains: "tampa", mode: "insensitive" } },
        { name: { contains: "tampa", mode: "insensitive" } },
      ],
    });
    assert.equal(
      getSalesOrderProductFilterOptionsUrl("cx 10"),
      `${SALES_ORDER_PRODUCT_FILTER_OPTIONS_PATH}?q=cx+10&limit=20`
    );
    assert.equal(SALES_ORDER_PRODUCT_FILTER_OPTIONS_PATH, "/api/sales-orders/product-filter-options");
  });

  it("servidor: 1 consulta somente leitura; termo curto não consulta", async () => {
    const calls: unknown[] = [];
    const db = {
      product: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [{ id: PRODUCT_ID, sku: "CX-10", name: "Caixa 10 L" }];
        },
      },
    } as unknown as Pick<PrismaClient, "product">;
    assert.deepEqual(await searchSalesOrderProductFilterOptions(db, { q: "c" }), []);
    assert.equal(calls.length, 0);
    const options = await searchSalesOrderProductFilterOptions(db, { q: "caixa", limit: "5" });
    assert.deepEqual(options, [{ productId: PRODUCT_ID, sku: "CX-10", name: "Caixa 10 L" }]);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      where: buildSalesOrderProductFilterSearchWhere("caixa"),
      select: { id: true, sku: true, name: true },
      orderBy: [{ sku: "asc" }],
      take: 5,
    });
  });
});

describe("SalesOrderResultPage — filtros no padrão do sistema e gráfico do SLA", () => {
  const page = codeOnly(read("src/components/sales/SalesOrderResultPage.tsx"));

  it("consulta só com filtros aplicados: Pesquisar aplica, Limpar reseta, controles só mudam o rascunho", () => {
    assert.match(page, /onSubmit=\{\(e\) => \{\s*e\.preventDefault\(\);\s*applyFilters\(\);/);
    assert.match(page, /setApplied\(\{ \.\.\.draft \}\)/, "Pesquisar sempre recarrega (objeto novo)");
    assert.match(page, /data-testid="sales-order-result-apply-filters"/);
    assert.match(page, /data-testid="sales-order-result-clear-filters"/);
    assert.match(page, /data-testid="sales-order-result-filters-pending"/);
    assert.match(page, /hasPendingSalesOrderResultFilters\(draft, applied\)/);
    // Efeitos de consulta dependem só dos filtros APLICADOS (nunca do rascunho):
    // resultado, projeção e SLA (+ data de referência) e vendedores.
    assert.equal((page.match(/\}, \[canView, applied, asOfDate\]\);/g) ?? []).length, 3);
    assert.match(page, /\}, \[canView, sellerOptionsQuery\]\);/);
    assert.doesNotMatch(page, /void load\(\);/, "sem recarga automática a cada mudança de filtro");
    // 4 consultas (vendedores, resultado, projeção, SLA), cada uma cancelável.
    assert.equal((page.match(/fetchJsonOk</g) ?? []).length, 4);
    assert.equal((page.match(/new AbortController\(\)/g) ?? []).length, 4);
    assert.equal((page.match(/\{ signal: ac\.signal \}/g) ?? []).length, 4);
    assert.equal((page.match(/return \(\) => ac\.abort\(\);/g) ?? []).length, 4);
    // Data de referência = dia civil LOCAL (toISOString daria o dia UTC).
    assert.match(page, /useMemo\(\(\) => formatSalesOrderResultAsOfDate\(new Date\(\)\), \[\]\)/);
    assert.doesNotMatch(page, /toISOString\(\)\.slice\(0, 10\)/);
  });

  it("dropdowns com dados do servidor: vendedor, cliente, produto e Status CR múltiplo", () => {
    assert.match(page, /getSalesOrderSellerFilterOptionsUrl\(sellerOptionsQuery\)/);
    assert.match(page, /includeSeller: false, includeProduct: false/);
    assert.match(page, /data-testid="sales-order-result-filter-seller"/);
    assert.match(page, /<CustomerAutocompleteFilter/);
    assert.match(page, /<SalesOrderProductAutocompleteFilter/);
    assert.doesNotMatch(page, /UUID do produto/, "sem campo de UUID digitado");
    assert.match(page, /<SalesOrderReceivableStatusMultiSelect/);
    assert.match(page, /SALES_ORDER_LIST_STATUS_LABELS/);
    assert.match(page, /SALES_ORDER_FILTER_CONTROL_CLASS/);
    const autocomplete = read("src/components/sales/SalesOrderProductAutocompleteFilter.tsx");
    assert.match(autocomplete, /getSalesOrderProductFilterOptionsUrl\(query\)/);
    assert.match(autocomplete, /entityType="product"/);
  });

  it("gráfico mensal do prazo de recebimento (12 meses × ano anterior) e os dois gráficos originais", () => {
    assert.match(page, /<SalesOrderResultReceivableTermChart/);
    // Mês e data de referência vão para o endpoint: os cards do período usam os
    // dois; as barras continuam 12 meses (o loader ignora o Mês no where).
    assert.match(
      page,
      /getSalesOrderGrantedPaymentTermMonthlyUrl\(\s*buildSalesOrderResultQueryString\(applied, \{ asOfDate \}\)/
    );
    assert.doesNotMatch(page, /includeMonth: false/);
    assert.match(page, /setTermError\("Não foi possível carregar o prazo médio de recebimento mês a mês\."\)/);
    assert.match(page, /<SalesOrderResultMonthlyMarginChart rows=\{payload\.monthlyMargin\}/);
    assert.match(page, /<SalesOrderResultProjectionChart/);
    // Falha do SLA não mexe no resultado (fail-soft independente).
    const termStart = page.indexOf("getSalesOrderGrantedPaymentTermMonthlyUrl(");
    const termBlock = page.slice(termStart, page.indexOf("}, [canView, applied, asOfDate]);", termStart));
    assert.ok(termBlock.length > 0);
    assert.doesNotMatch(termBlock, /setPayload|setError\(/);
  });

  it("projeção vem do endpoint leve (não espera a margem); dashboard é a reserva", () => {
    assert.match(
      page,
      /getSalesOrderResultProjectionApiPath\(toSalesOrderResultApiFilters\(applied, asOfDate\)\)/
    );
    assert.match(page, /const projectionSource = projectionPayload \?\? payload;/);
    assert.match(page, /rows=\{projectionSource\.realizedVsProjected\}/);
    assert.match(page, /projection=\{projectionSource\.projection\}/);
    assert.match(page, /data-testid="sales-order-result-projection-loading"/);
    assert.match(page, /data-testid="sales-order-result-monthly-chart-loading"/);
    // Falha da projeção leve não mexe no resultado nem mostra erro (usa a reserva).
    const projStart = page.indexOf("getSalesOrderResultProjectionApiPath(");
    const projBlock = page.slice(projStart, page.indexOf("}, [canView, applied, asOfDate]);", projStart));
    assert.ok(projBlock.length > 0);
    assert.doesNotMatch(projBlock, /setPayload|setError\(/);
  });

  it("barra de filtros idêntica à da listagem (mesmas classes)", () => {
    const list = read("src/components/SalesOrdersModule.tsx");
    assert.ok(list.includes(`"${SALES_ORDER_FILTER_CONTROL_CLASS}"`), "controle");
    assert.ok(list.includes(`"${SALES_ORDER_FILTER_ACTION_BUTTON_CLASS}"`), "botões");
    assert.ok(list.includes(`"${SALES_ORDER_FILTER_LABEL_CLASS}"`), "rótulos");
    assert.ok(list.includes(`"${SALES_ORDER_FILTER_PRIMARY_ACTION_CLASS}"`), "Pesquisar");
  });
});

describe("Resultado — performance e escopo sem mudar números", () => {
  const engine = codeOnly(read("src/lib/salesOrderResultEngine.server.ts"));
  const routes = codeOnly(read("src/lib/salesOrderResultRoutes.ts"));
  const cache = codeOnly(read("src/lib/sales/salesOrderResultChartsCache.server.ts"));

  it("a rota da tela não calcula a série anual de margem da listagem; o charts-cache continua calculando", () => {
    assert.match(
      routes,
      /buildSalesOrderResultDashboard\(prisma, query, now, \{\s*includeListMarginChartSeries: false,\s*timings,\s*\}\)/
    );
    assert.match(engine, /options\.includeListMarginChartSeries !== false/);
    assert.match(engine, /!includeListMarginChartSeries\s*\? Promise\.resolve\(LIST_MARGIN_CHART_SERIES_SKIPPED\)/);
    // A população anual (todos os pedidos do ano) só é lida dentro do ramo não pulado.
    const skipIdx = engine.indexOf("!includeListMarginChartSeries");
    const yearPopulationIdx = engine.indexOf("loadSalesOrderListChartYearOrders(db, filters.year)");
    assert.ok(skipIdx > 0 && yearPopulationIdx > skipIdx);
    assert.match(engine, /chartResult\.kind === "skipped"\s*\? \[\]/);
    // Cache (gráficos da listagem) chama o motor sem a opção → default inclui a série.
    assert.match(cache, /buildDashboard\(db as PrismaClient, \{\s*year: String\(year\),\s*\}\)/);
    assert.doesNotMatch(cache, /includeListMarginChartSeries/);
  });

  it("filtro de produto fica no where; o bundle não compara UUID do produto com id do item", () => {
    assert.match(engine, /items: \{ some: \{ productId: filters\.productId \} \}/);
    const bundleStart = engine.indexOf("buildOfficialSalesOrderResultSalesBundle({");
    const bundleCall = engine.slice(bundleStart, engine.indexOf("});", bundleStart));
    assert.match(bundleCall, /productId: undefined/);
  });

  it("opções de produto: rota estática com a guarda da listagem, antes de /api/sales-orders/:id", () => {
    assert.match(routes, /SALES_ORDER_PRODUCT_FILTER_OPTIONS_PATH,\s*auth\.requireAppAuth,\s*auth\.requireResource\(COMMERCIAL_RESOURCE_KEYS\.salesOrders, COMMERCIAL_ACTIONS\.view\)/);
    assert.match(routes, /searchSalesOrderProductFilterOptions\(/);
    const server = read("server.ts");
    const idxResultRoutes = server.indexOf("registerSalesOrderResultRoutes(app, {");
    const idxById = server.indexOf('app.get("/api/sales-orders/:id"');
    assert.ok(idxResultRoutes > 0 && idxResultRoutes < idxById);
  });
});
