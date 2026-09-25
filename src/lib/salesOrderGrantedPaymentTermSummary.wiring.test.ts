/**
 * Prazo médio concedido — wiring/paridade:
 *   - endpoint usa EXATAMENTE o where canônico da listagem (parseSalesOrderListQuery +
 *     resolveSalesOrderListSellerWhere + resolveSalesOrderListWhere), sem duplicar WHERE;
 *   - população completa (page/pageSize não limitam a agregação);
 *   - número constante de queries agregadas (groupBy + aggregate), sem findMany/N+1,
 *     sem nomusRawResponse, sem escrita, sem CR;
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
  SALES_ORDER_GRANTED_PAYMENT_TERM_SUMMARY_PATH,
  getSalesOrderGrantedPaymentTermSummaryUrl,
} from "./salesOrderGrantedPaymentTermApi.js";
import {
  buildSalesOrderGrantedPaymentTermWeightWhere,
  loadSalesOrderGrantedPaymentTermSummary,
} from "./salesOrderGrantedPaymentTermSummary.server.js";
import {
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
} from "./salesOrderListQuery.server.js";
import { andSalesOrderListWhere } from "./salesOrderListReceivableFilter.js";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** Só código: remove comentários de bloco e de linha (os cabeçalhos citam o que é proibido). */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

type RecordedCall = { method: string; args: Record<string, unknown> };

/** Prisma fake: registra chamadas; qualquer leitura por pedido (findMany etc.) falha. */
function createFakeDb(calls: RecordedCall[]): PrismaClient {
  const record = (method: string, args: unknown) => {
    calls.push({ method, args: (args ?? {}) as Record<string, unknown> });
  };
  const forbid = (method: string) => async (args: unknown) => {
    record(method, args);
    throw new Error(`${method} não é permitido no KPI de prazo médio concedido`);
  };
  return {
    salesOrder: {
      groupBy: async (args: unknown) => {
        record("salesOrder.groupBy", args);
        return [
          { paymentTerms: "30/60", _count: { _all: 2 }, _sum: { totalNetValue: 10_000 } },
          { paymentTerms: "boleto", _count: { _all: 1 }, _sum: { totalNetValue: 2_500 } },
          { paymentTerms: null, _count: { _all: 1 }, _sum: { totalNetValue: 500 } },
        ];
      },
      aggregate: async (args: unknown) => {
        record("salesOrder.aggregate", args);
        return { _count: { _all: 6 } };
      },
      findMany: forbid("salesOrder.findMany"),
      findFirst: forbid("salesOrder.findFirst"),
      findUnique: forbid("salesOrder.findUnique"),
      count: forbid("salesOrder.count"),
      update: forbid("salesOrder.update"),
      updateMany: forbid("salesOrder.updateMany"),
      create: forbid("salesOrder.create"),
      delete: forbid("salesOrder.delete"),
    },
    // Filtro "Status CR" da listagem consulta o CR só para montar o where (mesmo caminho da lista).
    nomusAccountsReceivable: {
      findMany: async (args: unknown) => {
        record("nomusAccountsReceivable.findMany", args);
        return [];
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
        salesOrderCalls.map((c) => c.method).sort(),
        ["salesOrder.aggregate", "salesOrder.groupBy"],
        "exatamente 1 groupBy + 1 aggregate; nenhuma leitura por pedido"
      );

      const groupBy = calls.find((c) => c.method === "salesOrder.groupBy")!.args;
      const aggregate = calls.find((c) => c.method === "salesOrder.aggregate")!.args;

      assert.deepEqual(groupBy.by, ["paymentTerms"]);
      assert.deepEqual(groupBy._count, { _all: true });
      assert.deepEqual(groupBy._sum, { totalNetValue: true });
      assert.deepEqual(
        groupBy.where,
        andSalesOrderListWhere(expectedWhere, buildSalesOrderGrantedPaymentTermWeightWhere())
      );
      assert.deepEqual(aggregate.where, expectedWhere);
      assert.deepEqual(aggregate._count, { _all: true });

      // Paginação nunca limita a agregação; nada de select/raw.
      for (const args of [groupBy, aggregate]) {
        assert.equal("skip" in args, false);
        assert.equal("take" in args, false);
        assert.equal("select" in args, false);
        assert.equal("include" in args, false);
        assert.doesNotMatch(JSON.stringify(args), /nomusRawResponse/);
      }

      assert.equal(summary.source, "SalesOrder.paymentTerms");
    });
  }

  it("DTO calculado a partir dos agregados (sem ler pedido a pedido)", async () => {
    const calls: RecordedCall[] = [];
    const summary = await loadSalesOrderGrantedPaymentTermSummary(createFakeDb(calls), {
      year: "2026",
    });
    assert.equal(summary.totalOrders, 6);
    assert.equal(summary.weightedPopulationOrders, 4);
    assert.equal(summary.zeroOrNegativeOrders, 2);
    assert.equal(summary.recognizedOrders, 2);
    assert.equal(summary.unrecognizedOrders, 2);
    assert.equal(summary.recognizedSalesAmount, 10_000);
    assert.equal(summary.unrecognizedSalesAmount, 3_000);
    assert.equal(summary.totalWeightedSalesAmount, 13_000);
    assert.equal(summary.weightedAverageDays, 45);
    assert.ok(Math.abs(summary.coveragePercent - (10_000 * 100) / 13_000) < 1e-9);
    assert.equal(summary.orderCoveragePercent, 50);
    assert.equal(summary.quality, "LOW");
    assert.equal(summary.available, true);
    assert.deepEqual(
      summary.unrecognizedTerms.map((t) => [t.paymentTerms, t.salesAmount, t.reason]),
      [
        ["boleto", 2_500, "UNRECOGNIZED_FORMAT"],
        [null, 500, "MISSING"],
      ]
    );
    assert.equal(calls.filter((c) => c.method === "salesOrder.findMany").length, 0);
  });

  it("peso = totalNetValue > 0 (sem abs, sem zero no denominador)", () => {
    assert.deepEqual(buildSalesOrderGrantedPaymentTermWeightWhere(), {
      totalNetValue: { gt: 0 },
    });
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

  it("loader reutiliza os helpers canônicos e só agrega (groupBy + aggregate)", () => {
    assert.match(loader, /parseSalesOrderListQuery\(/);
    assert.match(loader, /resolveSalesOrderListSellerWhere\(/);
    assert.match(loader, /resolveSalesOrderListWhere\(/);
    assert.match(loader, /andSalesOrderListWhere\(/);
    assert.match(loader, /db\.salesOrder\.groupBy\(/);
    assert.match(loader, /by:\s*\["paymentTerms"\]/);
    assert.match(loader, /totalNetValue:\s*\{\s*gt:\s*0\s*\}/);
    assert.match(loader, /Promise\.all\(/);
    assert.equal((loader.match(/db\.salesOrder\./g) ?? []).length, 2, "número constante de queries");
    assert.doesNotMatch(loader, /\.(findMany|findFirst|findUnique|count)\(/);
    assert.doesNotMatch(loader, /nomusRawResponse/);
    assert.doesNotMatch(loader, /for\s*\(|while\s*\(|forEach\(/, "sem loop com Prisma (N+1)");
    assert.doesNotMatch(loader, WRITE_PATTERN);
    assert.doesNotMatch(loader, /nomusAccountsReceivable|salesOrderNfeLink|nomusNfe/i);
    assert.doesNotMatch(loader, /settlementDate|amountReceived|paymentReceivedAt|balanceReceivable/);
    assert.doesNotMatch(loader, /paymentMethod/);
  });

  it("motor puro não importa Prisma/React/Node e nunca usa paymentMethod/CR como fonte", () => {
    assert.doesNotMatch(pure, /@prisma\/client|from "react"|from "node:|from "\.\/prisma/);
    assert.match(pure, /export function parseGrantedPaymentTerm/);
    assert.match(pure, /export function computeGrantedPaymentTermSummary/);
    assert.match(pure, /SALES_ORDER_GRANTED_PAYMENT_TERM_METHODOLOGY/);
    assert.doesNotMatch(pure, /settlementDate|amountReceived|dueDate|paymentReceivedAt/);
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
  });

  it("UI: fetch dedicado com a MESMA query, AbortSignal, fail-soft e sem depender de showMarginEconomics", () => {
    assert.match(module, /getSalesOrderGrantedPaymentTermSummaryUrl\(q\)/);
    assert.match(module, /paymentTermSummary=\{paymentTermSummary\}/);
    assert.match(module, /paymentTermSummaryLoading=\{paymentTermSummaryLoading\}/);
    assert.match(module, /new AbortController\(\)/);

    const start = module.indexOf("// Prazo médio concedido — endpoint dedicado");
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

    // A lista continua carregando/renderizando independentemente do KPI.
    const idxKpi = module.indexOf("getSalesOrderGrantedPaymentTermSummaryUrl(q)");
    const idxListFetch = module.indexOf("`/api/sales-orders?${q}`");
    assert.ok(idxListFetch > 0 && idxListFetch < idxKpi, "KPI só depois do GET da lista");
  });

  it("cards: Imposto a pagar e Custo estimado fora do overview; Margem comercial e testId novo", () => {
    assert.match(cards, /GRANTED_PAYMENT_TERM_CARD_TEST_ID/);
    assert.match(cards, /GRANTED_PAYMENT_TERM_CARD_LABEL/);
    assert.match(cards, /resolveGrantedPaymentTermCardPresentation\(/);
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
    // Ordem visual: Pedidos filtrados → Valor vendido → Prazo médio → Ticket médio → Margem.
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

  it("testes novos registrados na lista unitária canônica", () => {
    const list = read("scripts/unit-test-files.txt");
    assert.match(list, /src\/lib\/salesOrderGrantedPaymentTerm\.test\.ts/);
    assert.match(list, /src\/lib\/salesOrderGrantedPaymentTermSummary\.wiring\.test\.ts/);
    assert.match(list, /src\/lib\/salesOrderGrantedPaymentTermCard\.test\.tsx/);
  });
});
