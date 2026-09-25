/**
 * Prazo médio de recebimento — wiring/paridade:
 *   - endpoint usa EXATAMENTE o where canônico da listagem (parseSalesOrderListQuery +
 *     resolveSalesOrderListSellerWhere + resolveSalesOrderListWhere), sem duplicar WHERE;
 *   - população completa (page/pageSize não limitam a carga);
 *   - cadeia canônica do CR (SalesOrderNfeLink válida → NomusNfe.xmlDhEmi →
 *     NomusAccountsReceivable.sourceInvoiceId), número constante de queries,
 *     sem leitura por pedido, sem nomusRawResponse/rawPayload, sem escrita;
 *   - só pedidos faturados entram na média/cobertura (participação do faturado no DTO);
 *   - permissão = listagem (sem margem/custo); rota estática antes de /api/sales-orders/:id;
 *   - UI: fetch dedicado com AbortSignal, fail-soft, independente de showMarginEconomics;
 *   - cards: Imposto a pagar / Custo estimado fora do overview; Margem comercial permanece.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  SALES_ORDER_GRANTED_PAYMENT_TERM_MONTHLY_PATH,
  SALES_ORDER_GRANTED_PAYMENT_TERM_SUMMARY_PATH,
  getSalesOrderGrantedPaymentTermMonthlyUrl,
  getSalesOrderGrantedPaymentTermSummaryUrl,
} from "./salesOrderGrantedPaymentTermApi.js";
import {
  buildSalesOrderGrantedPaymentTermOrderSelect,
  loadSalesOrderGrantedPaymentTermMonthlySeries,
  loadSalesOrderGrantedPaymentTermSummary,
} from "./salesOrderGrantedPaymentTermSummary.server.js";
import { andSalesOrderListWhere } from "./salesOrderListReceivableFilter.js";
import { buildSalesOrderProductFilterWhere } from "./salesOrderProductFilter.js";
import {
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
} from "./salesOrderListQuery.server.js";
import { buildSalesOrderValidNfeLinkWhere } from "./salesOrdersListSummary.js";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Só código: remove comentários de bloco e de linha (os cabeçalhos citam o que é proibido). */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

type RecordedCall = { method: string; args: Record<string, unknown> };

const NF_101_ISSUE = new Date(2026, 8, 1); // 01/09/2026
const NF_103_PROCESSING = new Date(2026, 8, 10); // 10/09/2026 (sem xmlDhEmi)

/**
 * Prisma fake: registra chamadas; qualquer leitura por pedido (findFirst/count…) falha.
 * População: A (faturado, títulos 30/60 da NF 101), B (sem NF, condição "28 DDL"),
 * C (faturado, NF 102 sem títulos, condição "boleto"), D (valor zero),
 * E (faturado, NF 103 sem xmlDhEmi → dataProcessamento).
 */
function createFakeDb(calls: RecordedCall[]): PrismaClient {
  const record = (method: string, args: unknown) => {
    calls.push({ method, args: (args ?? {}) as Record<string, unknown> });
  };
  const forbid = (method: string) => async (args: unknown) => {
    record(method, args);
    throw new Error(`${method} não é permitido no KPI de prazo médio de recebimento`);
  };
  return {
    salesOrder: {
      findMany: async (args: unknown) => {
        record("salesOrder.findMany", args);
        return [
          { id: "A", totalNetValue: 10_000, paymentTerms: "30/60", nfeLinks: [{ nfeExternalId: 101, dataProcessamento: NF_101_ISSUE }] },
          { id: "B", totalNetValue: 30_000, paymentTerms: "28 DDL", nfeLinks: [] },
          { id: "C", totalNetValue: 5_000, paymentTerms: "boleto", nfeLinks: [{ nfeExternalId: 102, dataProcessamento: new Date(2026, 8, 5) }] },
          { id: "D", totalNetValue: 0, paymentTerms: null, nfeLinks: [] },
          { id: "E", totalNetValue: 2_000, paymentTerms: null, nfeLinks: [{ nfeExternalId: 103, dataProcessamento: NF_103_PROCESSING }] },
        ];
      },
      groupBy: forbid("salesOrder.groupBy"),
      aggregate: forbid("salesOrder.aggregate"),
      findFirst: forbid("salesOrder.findFirst"),
      findUnique: forbid("salesOrder.findUnique"),
      count: forbid("salesOrder.count"),
      update: forbid("salesOrder.update"),
      updateMany: forbid("salesOrder.updateMany"),
      create: forbid("salesOrder.create"),
      delete: forbid("salesOrder.delete"),
    },
    nomusNfe: {
      findMany: async (args: unknown) => {
        record("nomusNfe.findMany", args);
        return [
          { externalId: 101, xmlDhEmi: NF_101_ISSUE, dataProcessamento: NF_101_ISSUE },
          { externalId: 102, xmlDhEmi: new Date(2026, 8, 5), dataProcessamento: new Date(2026, 8, 5) },
          { externalId: 103, xmlDhEmi: null, dataProcessamento: NF_103_PROCESSING },
        ];
      },
      findFirst: forbid("nomusNfe.findFirst"),
    },
    // Títulos por NF (sourceInvoiceId) — também consultado pelo filtro "Status CR" da listagem.
    nomusAccountsReceivable: {
      findMany: async (args: unknown) => {
        record("nomusAccountsReceivable.findMany", args);
        const where = (args as { where?: { sourceInvoiceId?: { in?: number[] } } }).where;
        if (!where?.sourceInvoiceId?.in) return [];
        return [
          { externalId: 1, sourceInvoiceId: 101, sourceInvoiceNumber: "101", dueDate: new Date(2026, 9, 1), amountReceivable: 5_000, amountReceived: 0, balanceReceivable: 5_000, settlementDate: null },
          { externalId: 2, sourceInvoiceId: 101, sourceInvoiceNumber: "101", dueDate: new Date(2026, 9, 31), amountReceivable: 5_000, amountReceived: 5_000, balanceReceivable: 0, settlementDate: new Date(2026, 9, 28) },
          { externalId: 3, sourceInvoiceId: 103, sourceInvoiceNumber: "103", dueDate: new Date(2026, 8, 24), amountReceivable: 2_000, amountReceived: 0, balanceReceivable: 2_000, settlementDate: null },
        ];
      },
    },
    salesOrderNfeLink: {
      findMany: async (args: unknown) => {
        record("salesOrderNfeLink.findMany", args);
        return [];
      },
    },
  } as unknown as PrismaClient;
}

async function expectedListWhere(query: Record<string, unknown>) {
  const db = createFakeDb([]);
  const parsed = parseSalesOrderListQuery(query);
  const sellerWhere = await resolveSalesOrderListSellerWhere(db, {
    sellerKeyRaw: parsed.sellerKeyRaw,
    sellerText: parsed.sellerText,
  });
  return resolveSalesOrderListWhere(db, parsed, sellerWhere);
}

const FILTER_SCENARIOS: Array<{ name: string; query: Record<string, unknown>; marker: RegExp }> = [
  {
    name: "cliente + ano/mês + paginação",
    query: { customerId: "c1", year: "2026", month: "9", page: "3", pageSize: "20" },
    marker: /"customerId":"c1"[\s\S]*"issueDate"/,
  },
  {
    name: "vendedor (sellerKey) + status",
    query: { sellerKey: "123", status: "SENT_TO_NOMUS" },
    marker: /"externalSellerId":123[\s\S]*|"status":"SENT_TO_NOMUS"/,
  },
  {
    name: "Com NF + status CR",
    query: { hasInvoice: "true", receivableStatus: "open" },
    marker: /"nfeLinks":\{"some"/,
  },
  {
    name: "faixa de valor + busca",
    query: { minNetValue: "1000", maxNetValue: "5000", q: "02739" },
    marker: /"totalNetValue":\{"gte":1000,"lte":5000\}/,
  },
  {
    name: "período explícito + cancelados",
    query: { startDate: "2026-01-01", endDate: "2026-03-31", status: "CANCELLED" },
    marker: /"status":"CANCELLED"/,
  },
  {
    name: "Sem NF + CR quitado/sem CR + vendedor sem cadastro",
    query: { hasInvoice: "false", receivableStatus: "settled,none", sellerKey: "no-seller" },
    marker: /"nfeLinks":\{"none"/,
  },
];

describe("payment-term-summary — paridade com o where oficial da listagem", () => {
  for (const scenario of FILTER_SCENARIOS) {
    it(`mesmo where da listagem: ${scenario.name}`, async () => {
      const calls: RecordedCall[] = [];
      const db = createFakeDb(calls);
      const summary = await loadSalesOrderGrantedPaymentTermSummary(db, scenario.query);
      const expectedWhere = await expectedListWhere(scenario.query);

      // O where canônico realmente aplicou o filtro do cenário.
      assert.match(JSON.stringify(expectedWhere), scenario.marker);

      const salesOrderCalls = calls.filter((c) => c.method.startsWith("salesOrder."));
      assert.deepEqual(
        salesOrderCalls.map((c) => c.method),
        ["salesOrder.findMany"],
        "exatamente 1 findMany da população; nenhuma leitura por pedido"
      );
      assert.ok(calls.filter((c) => c.method === "nomusNfe.findMany").length <= 1, "NF-e em 1 query");
      assert.ok(
        calls.filter((c) => c.method === "nomusAccountsReceivable.findMany").length <= 2,
        "títulos em 1 query (+1 do filtro Status CR quando aplicado)"
      );

      const findMany = salesOrderCalls[0]!.args;
      assert.deepEqual(findMany.where, expectedWhere);
      assert.deepEqual(findMany.select, buildSalesOrderGrantedPaymentTermOrderSelect());
      assert.deepEqual(
        (findMany.select as { nfeLinks: { where: unknown } }).nfeLinks.where,
        buildSalesOrderValidNfeLinkWhere(),
        "só NF-e válidas (processadas, não canceladas)"
      );

      // Paginação nunca limita a carga; nada de raw.
      assert.equal("skip" in findMany, false);
      assert.equal("take" in findMany, false);
      assert.equal("include" in findMany, false);
      for (const call of calls) {
        assert.doesNotMatch(JSON.stringify(call.args), /nomusRawResponse|rawPayload|xmlRaw/);
      }

      assert.match(summary.source, /NomusAccountsReceivable\.dueDate/);
    });
  }

  it("DTO calculado a partir da cadeia NF-e → títulos (emissão → vencimento) só para faturados", async () => {
    const calls: RecordedCall[] = [];
    const summary = await loadSalesOrderGrantedPaymentTermSummary(createFakeDb(calls), { year: "2026" });
    // A: 30d@5000 + 60d@5000 → 45 (títulos, NF 101 xmlDhEmi 01/09)
    // B: sem NF-e → não entra (notInvoiced), mesmo com condição "28 DDL"
    // C: NF 102 sem títulos + "boleto" → faturado não resolvido
    // D: valor zero → fora do peso
    // E: NF 103 sem xmlDhEmi → dataProcessamento 10/09; título vence 24/09 → 14
    assert.equal(summary.totalOrders, 5);
    assert.equal(summary.weightedPopulationOrders, 3);
    assert.equal(summary.zeroOrNegativeOrders, 1);
    assert.equal(summary.notInvoicedOrders, 1);
    assert.equal(summary.notInvoicedSalesAmount, 30_000);
    assert.equal(summary.coveredOrders, 2);
    assert.equal(summary.uncoveredOrders, 1);
    assert.equal(summary.coveredSalesAmount, 12_000);
    assert.equal(summary.uncoveredSalesAmount, 5_000);
    assert.equal(summary.invoicedSalesAmount, 17_000);
    assert.equal(summary.positiveSalesAmount, 47_000);
    assert.ok(Math.abs(summary.invoicedSharePercent - (17_000 * 100) / 47_000) < 1e-9);
    const expectedDays = (10_000 * 45 + 2_000 * 14) / 12_000;
    assert.ok(Math.abs(summary.weightedAverageDays! - expectedDays) < 1e-9);
    assert.ok(Math.abs(summary.coveragePercent - (12_000 * 100) / 17_000) < 1e-9);
    assert.equal(summary.quality, "LOW");
    assert.equal(summary.available, true);
    assert.equal(summary.titlesUsed, 3);
    assert.equal(summary.titlesIgnored, 0);
    assert.equal(summary.sources.receivableTitles.orders, 2);
    assert.equal(summary.sources.receivableTitles.salesAmount, 12_000);
    assert.equal(summary.sources.commercialTerms.orders, 0);
    assert.deepEqual(
      summary.unrecognizedTerms.map((t) => [t.paymentTerms, t.orderCount, t.salesAmount, t.reason]),
      [["boleto", 1, 5_000, "UNRECOGNIZED_FORMAT"]]
    );
    // Títulos buscados pelas NF-e válidas da população (sourceInvoiceId), nunca pedido a pedido.
    const titlesCall = calls.find((c) => c.method === "nomusAccountsReceivable.findMany")!;
    assert.deepEqual(
      (titlesCall.args as { where: { sourceInvoiceId: { in: number[] } } }).where.sourceInvoiceId.in,
      [101, 102, 103]
    );
    const nfeCall = calls.find((c) => c.method === "nomusNfe.findMany")!;
    assert.deepEqual((nfeCall.args as { where: { externalId: { in: number[] } } }).where.externalId.in, [101, 102, 103]);
    assert.deepEqual(nfeCall.args.select, { externalId: true, xmlDhEmi: true, dataProcessamento: true });
  });

  it("população sem NF-e não consulta NF-e nem títulos e fica indisponível (sem faturados)", async () => {
    const calls: RecordedCall[] = [];
    const db = createFakeDb(calls);
    (db as unknown as { salesOrder: { findMany: unknown } }).salesOrder.findMany = async (args: unknown) => {
      calls.push({ method: "salesOrder.findMany", args: (args ?? {}) as Record<string, unknown> });
      return [{ id: "X", totalNetValue: 100, paymentTerms: "30", nfeLinks: [] }];
    };
    const summary = await loadSalesOrderGrantedPaymentTermSummary(db, {});
    assert.equal(summary.quality, "UNAVAILABLE");
    assert.equal(summary.weightedAverageDays, null);
    assert.equal(summary.notInvoicedOrders, 1);
    assert.equal(summary.invoicedSharePercent, 0);
    assert.equal(calls.filter((c) => c.method === "nomusNfe.findMany").length, 0);
    assert.equal(calls.filter((c) => c.method === "nomusAccountsReceivable.findMany").length, 0);
  });
});

describe("payment-term-monthly — 12 meses × ano anterior com o where oficial da listagem", () => {
  const PRODUCT_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

  /** População por chamada: 1ª = ano filtrado, 2ª = ano anterior (ordem do Promise.all). */
  function createMonthlyFakeDb(calls: RecordedCall[]): PrismaClient {
    const db = createFakeDb(calls);
    const populations = [
      [
        {
          id: "C1",
          issueDate: new Date(2026, 0, 10),
          totalNetValue: 10_000,
          paymentTerms: null,
          nfeLinks: [{ nfeExternalId: 101, dataProcessamento: NF_101_ISSUE }],
        },
      ],
      [
        {
          id: "P1",
          issueDate: new Date(2025, 0, 12),
          totalNetValue: 4_000,
          paymentTerms: "28 DDL",
          nfeLinks: [{ nfeExternalId: 103, dataProcessamento: NF_103_PROCESSING }],
        },
      ],
    ];
    let call = 0;
    (db as unknown as { salesOrder: { findMany: unknown } }).salesOrder.findMany = async (
      args: unknown
    ) => {
      calls.push({ method: "salesOrder.findMany", args: (args ?? {}) as Record<string, unknown> });
      return populations[call++] ?? [];
    };
    return db;
  }

  async function expectedYearWhere(query: Record<string, unknown>, year: number) {
    const db = createFakeDb([]);
    const parsed = parseSalesOrderListQuery(query);
    const sellerWhere = await resolveSalesOrderListSellerWhere(db, {
      sellerKeyRaw: parsed.sellerKeyRaw,
      sellerText: parsed.sellerText,
    });
    return andSalesOrderListWhere(
      await resolveSalesOrderListWhere(db, { ...parsed, year, month: null }, sellerWhere),
      buildSalesOrderProductFilterWhere(query.productId)
    );
  }

  it("ano filtrado e anterior com os filtros da tela, sem o Mês, com produto; queries constantes", async () => {
    const query = {
      year: "2026",
      month: "9",
      customerId: "c1",
      sellerKey: "123",
      status: "SENT_TO_NOMUS",
      productId: PRODUCT_ID,
      page: "3",
    };
    const calls: RecordedCall[] = [];
    const series = await loadSalesOrderGrantedPaymentTermMonthlySeries(createMonthlyFakeDb(calls), query);

    const populationCalls = calls.filter((c) => c.method === "salesOrder.findMany");
    assert.equal(populationCalls.length, 2, "uma consulta por ano");
    assert.deepEqual(populationCalls[0]!.args.where, await expectedYearWhere(query, 2026));
    assert.deepEqual(populationCalls[1]!.args.where, await expectedYearWhere(query, 2025));
    assert.deepEqual(populationCalls[0]!.args.select, buildSalesOrderGrantedPaymentTermOrderSelect());
    const currentWhere = JSON.stringify(populationCalls[0]!.args.where);
    assert.match(currentWhere, /"customerId":"c1"/);
    assert.match(currentWhere, /"externalSellerId":123/);
    assert.match(currentWhere, /"status":"SENT_TO_NOMUS"/);
    assert.match(currentWhere, new RegExp(`"productId":"${PRODUCT_ID}"`));
    for (const call of populationCalls) {
      assert.equal("skip" in call.args, false);
      assert.equal("take" in call.args, false);
    }
    assert.equal(calls.filter((c) => c.method === "nomusNfe.findMany").length, 1);
    assert.equal(calls.filter((c) => c.method === "nomusAccountsReceivable.findMany").length, 1);
    assert.equal(
      calls.filter((c) => /.(findFirst|findUnique|count|update|updateMany|create|delete)$/.test(c.method)).length,
      0
    );

    assert.equal(series.year, 2026);
    assert.equal(series.previousYear, 2025);
    assert.equal(series.rows[0]!.current.chartDays, 45, "títulos 30/60 da NF 101");
    assert.equal(series.rows[0]!.previous.chartDays, 14, "título da NF 103 prevalece sobre 28 DDL");
    assert.equal(series.rows.slice(1).every((r) => r.current.totalOrders === 0), true);
  });

  it("sem Ano na query usa o ano corrente; produto inválido não é ignorado em silêncio", async () => {
    const calls: RecordedCall[] = [];
    const series = await loadSalesOrderGrantedPaymentTermMonthlySeries(
      createMonthlyFakeDb(calls),
      { productId: "nao-e-uuid" },
      new Date(2025, 5, 1)
    );
    assert.equal(series.year, 2025);
    assert.equal(series.previousYear, 2024);
    const wheres = calls
      .filter((c) => c.method === "salesOrder.findMany")
      .map((c) => JSON.stringify(c.args.where));
    assert.equal(wheres.length, 2);
    for (const where of wheres) assert.match(where, /"id":\{"in":\[\]\}/);
  });
});

describe("payment-term-summary — estrutura (read-only, leve, sem N+1)", () => {
  const loader = codeOnly(read("src/lib/salesOrderGrantedPaymentTermSummary.server.ts"));
  const pure = codeOnly(read("src/lib/salesOrderGrantedPaymentTerm.ts"));
  const routes = codeOnly(read("src/lib/salesOrderGrantedPaymentTermRoutes.ts"));
  const api = codeOnly(read("src/lib/salesOrderGrantedPaymentTermApi.ts"));
  const server = read("server.ts");
  const module = read("src/components/SalesOrdersModule.tsx");
  const cards = read("src/components/sales/SalesOrderListSummaryCards.tsx");
  const css = read("src/components/sales/sales-order-list-summary-cards.css");

  const WRITE_PATTERN =
    /\.(update|updateMany|create|createMany|delete|deleteMany|upsert)\(|\$transaction|\$executeRaw|\$queryRaw/;

  it("loader reutiliza os helpers canônicos e a cadeia oficial do CR, com queries constantes", () => {
    assert.match(loader, /parseSalesOrderListQuery\(/);
    assert.match(loader, /resolveSalesOrderListSellerWhere\(/);
    assert.match(loader, /resolveSalesOrderListWhere\(/);
    assert.match(loader, /buildSalesOrderValidNfeLinkWhere\(\)/);
    assert.match(loader, /loadSalesOrderListReceivablesByNfeExternalIds\(/);
    assert.match(loader, /collectReceivablesForOrderNfes\(/);
    assert.match(loader, /xmlDhEmi/);
    assert.match(loader, /invoiced: order\.nfeLinks\.length > 0/);
    assert.match(loader, /Promise\.all\(/);
    assert.equal((loader.match(/db\.salesOrder\./g) ?? []).length, 1, "1 query de população");
    assert.equal((loader.match(/db\.nomusNfe\./g) ?? []).length, 1, "1 query de NF-e");
    assert.doesNotMatch(loader, /db\.nomusAccountsReceivable\./, "títulos via helper compartilhado");
    assert.doesNotMatch(loader, /groupBy|aggregate|findFirst|findUnique|\.count\(/);
    assert.doesNotMatch(loader, /nomusRawResponse|rawPayload|xmlRaw/);
    assert.doesNotMatch(loader, /for\s*\(|while\s*\(|forEach\(/, "sem loop com Prisma (N+1)");
    assert.doesNotMatch(loader, /\.map\(\s*async/, "sem consulta dentro de map (N+1)");
    // Consultas de população limitadas ao número de wheres (1 no card, 2 na série mensal).
    assert.match(loader, /wheres\.map\(\(where\) => db\.salesOrder\.findMany\(\{ where, select \}\)\)/);
    assert.doesNotMatch(loader, WRITE_PATTERN);
    assert.doesNotMatch(loader, /settlementDate|amountReceived|balanceReceivable|paymentMethod/);
  });

  it("motor puro não importa Prisma/React/Node; usa vencimento, nunca liquidação", () => {
    assert.doesNotMatch(pure, /@prisma\/client|from "react"|from "node:|from "\.\/prisma/);
    assert.match(pure, /export function parseGrantedPaymentTerm/);
    assert.match(pure, /export function resolveReceivableTitleTermDays/);
    assert.match(pure, /export function computeSalesOrderGrantedPaymentTermSummary/);
    assert.match(pure, /SALES_ORDER_GRANTED_PAYMENT_TERM_METHODOLOGY/);
    assert.match(pure, /"NOT_INVOICED"/);
    assert.doesNotMatch(pure, /settlementDate|amountReceived|paymentReceivedAt/);
    assert.doesNotMatch(pure, /paymentMethod\s*[:=]/);
    assert.doesNotMatch(pure, WRITE_PATTERN);
  });

  it("rota: mesma autorização da listagem (sem permissão de margem/custo)", () => {
    assert.match(routes, /SALES_ORDER_GRANTED_PAYMENT_TERM_SUMMARY_PATH/);
    assert.match(routes, /auth\.requireAppAuth/);
    assert.match(routes, /requireResource\(COMMERCIAL_RESOURCE_KEYS\.salesOrders, COMMERCIAL_ACTIONS\.view\)/);
    assert.doesNotMatch(routes, /canViewMarginEconomics|products\.tab\.cost|costs\.view|salesOrdersDetail/);
    assert.doesNotMatch(routes, WRITE_PATTERN);
    assert.match(routes, /\.status\(500\)/);
    assert.equal(SALES_ORDER_GRANTED_PAYMENT_TERM_SUMMARY_PATH, "/api/sales-orders/payment-term-summary");
    assert.doesNotMatch(SALES_ORDER_GRANTED_PAYMENT_TERM_SUMMARY_PATH, /:/, "rota estática");
    // Série mensal (tela Resultado): mesma guarda, rota estática no mesmo registro.
    assert.match(routes, /SALES_ORDER_GRANTED_PAYMENT_TERM_MONTHLY_PATH, \.\.\.guard/);
    assert.match(routes, /loadSalesOrderGrantedPaymentTermMonthlySeries\(/);
    assert.equal(SALES_ORDER_GRANTED_PAYMENT_TERM_MONTHLY_PATH, "/api/sales-orders/payment-term-monthly");
    assert.doesNotMatch(SALES_ORDER_GRANTED_PAYMENT_TERM_MONTHLY_PATH, /:/, "rota estática");
  });

  it("server.ts registra a rota estática antes de /api/sales-orders/:id", () => {
    assert.match(server, /import \{ registerSalesOrderGrantedPaymentTermRoutes \} from ".\/src\/lib\/salesOrderGrantedPaymentTermRoutes\.js"/);
    const idxList = server.indexOf('app.get("/api/sales-orders", requireAppAuth');
    const idxRegister = server.indexOf("registerSalesOrderGrantedPaymentTermRoutes(app, {");
    const idxDetailRoutes = server.indexOf("registerSalesOrderDetailRoutes(app, {");
    const idxById = server.indexOf('app.get("/api/sales-orders/:id"');
    assert.ok(idxList > 0 && idxRegister > idxList, "registro após o GET da listagem");
    assert.ok(idxRegister < idxDetailRoutes, "registro antes das rotas de detalhe");
    assert.ok(idxRegister < idxById, "registro antes de /api/sales-orders/:id");
    const registerBlock = server.slice(idxRegister, idxRegister + 200);
    assert.match(registerBlock, /requireAppAuth,\s*requireResource,/);
    assert.doesNotMatch(registerBlock, /canViewMarginEconomics/);
  });

  it("helper de URL frontend-safe", () => {
    assert.doesNotMatch(api, /@prisma\/client|\.server\.js|from "node:/);
    assert.equal(
      getSalesOrderGrantedPaymentTermSummaryUrl("year=2026&month=9"),
      "/api/sales-orders/payment-term-summary?year=2026&month=9"
    );
    assert.equal(getSalesOrderGrantedPaymentTermSummaryUrl(), "/api/sales-orders/payment-term-summary");
    assert.equal(
      getSalesOrderGrantedPaymentTermMonthlyUrl("year=2026&customerId=c1"),
      "/api/sales-orders/payment-term-monthly?year=2026&customerId=c1"
    );
    assert.equal(getSalesOrderGrantedPaymentTermMonthlyUrl(), "/api/sales-orders/payment-term-monthly");
  });

  it("UI: fetch dedicado com a MESMA query, AbortSignal, fail-soft e sem depender de showMarginEconomics", () => {
    assert.match(module, /getSalesOrderGrantedPaymentTermSummaryUrl\(q\)/);
    assert.match(module, /paymentTermSummary=\{paymentTermSummary\}/);
    assert.match(module, /paymentTermSummaryLoading=\{paymentTermSummaryLoading\}/);
    assert.match(module, /new AbortController\(\)/);

    const start = module.indexOf("// Prazo médio de recebimento — endpoint dedicado");
    const end = module.indexOf("// Margens só DEPOIS da grade", start);
    assert.ok(start > 0 && end > start, "bloco do KPI antes das margens");
    const block = module.slice(start, end);
    assert.doesNotMatch(block, /showMarginEconomics/, "KPI carrega para todos que veem pedidos");
    assert.match(block, /\{ signal \}/);
    assert.match(block, /signal\?\.aborted/);
    assert.match(block, /\.catch\(\(e\) => \{/);
    assert.match(block, /console\.error\(e\)/);
    assert.match(block, /setPaymentTermSummary\(null\)/);
    assert.match(block, /setPaymentTermSummaryLoading\(false\)/);
    assert.doesNotMatch(block, /setRows\(\[\]\)|setSummary\(|setMarginSummary\(|alert\(/, "falha do KPI não derruba a lista");

    const idxKpi = module.indexOf("getSalesOrderGrantedPaymentTermSummaryUrl(q)");
    const idxListFetch = module.indexOf("`/api/sales-orders?${q}`");
    assert.ok(idxListFetch > 0 && idxListFetch < idxKpi, "KPI só depois do GET da lista");
  });

  it("cards: Imposto a pagar e Custo estimado fora do overview; Margem comercial, testId e mesma altura", () => {
    assert.match(cards, /GRANTED_PAYMENT_TERM_CARD_TEST_ID/);
    assert.match(cards, /GRANTED_PAYMENT_TERM_CARD_LABEL/);
    assert.match(cards, /resolveGrantedPaymentTermCardPresentation\(/);
    // Participação do faturado vai para o tooltip: o card não tem linha extra.
    assert.doesNotMatch(cards, /footnote/);
    assert.doesNotMatch(css, /sales-order-list-summary-footnote/);
    // Todos os cards da faixa com a altura do mais alto (label em 2 linhas, badge de margem).
    assert.match(
      css,
      /\.sales-order-list-summary-grid > \* > div,\s*\.sales-order-list-summary-grid \.metric-card \{\s*height: 100%;\s*\}/
    );
    assert.match(cards, /CalendarClock/);
    assert.match(cards, /Margem comercial/);
    assert.match(cards, /sales-order-list-general-margin-card/);
    assert.match(cards, /showMarginCard/);
    for (const forbidden of [
      "Imposto a pagar",
      "Custo estimado",
      "sales-order-list-tax-payable-card",
      "sales-order-list-estimated-cost-card",
      "BadgePercent",
      "Scale",
      "createPortal",
      "SalesOrderListCostHoverTooltip",
      "buildSalesOrderListCostBreakdownTooltipText",
      "shareOfSoldValuePercent",
      "costShareOfSold",
      "taxShareOfSold",
      "taxAmount",
      "costBreakdown",
    ]) {
      assert.equal(cards.includes(forbidden), false, `cards não deve conter ${forbidden}`);
    }
    assert.doesNotMatch(cards, /\.reduce\(\s*\(/, "sem aritmética de negócio no React");
    assert.doesNotMatch(css, /sales-order-list-cost-tooltip-panel/, "CSS morto removido");
    const order = [
      'label="Pedidos filtrados"',
      'label="Valor vendido"',
      "label={GRANTED_PAYMENT_TERM_CARD_LABEL}",
      'label="Ticket médio"',
      'label="Margem comercial"',
    ].map((needle) => cards.indexOf(needle));
    assert.ok(order.every((i) => i >= 0));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });

  it("motor de margem/custo/imposto intacto (helpers continuam disponíveis para outras telas)", () => {
    const breakdown = read("src/lib/salesOrderListCostBreakdown.ts");
    assert.match(breakdown, /export function shareOfSoldValuePercent/);
    assert.match(breakdown, /export function buildSalesOrderListCostBreakdownTooltipText/);
    const marginTypes = read("src/lib/salesOrderListMarginSummary.ts");
    assert.match(marginTypes, /taxAmount: number;/);
    assert.match(marginTypes, /totalCost: number;/);
  });

  it("testes registrados na lista unitária canônica", () => {
    const list = read("scripts/unit-test-files.txt");
    assert.match(list, /src\/lib\/salesOrderGrantedPaymentTerm\.test\.ts/);
    assert.match(list, /src\/lib\/salesOrderGrantedPaymentTermSummary\.wiring\.test\.ts/);
    assert.match(list, /src\/lib\/salesOrderGrantedPaymentTermCard\.test\.tsx/);
  });
});
