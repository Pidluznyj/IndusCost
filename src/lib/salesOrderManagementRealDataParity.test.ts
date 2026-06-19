import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildManagementRowsFromOrders,
  buildSalesOrderManagementWhere,
  parseSalesOrderManagementFilters,
} from "./salesOrderManagement.js";
import { buildSalesOrderListWhere } from "./salesOrdersListSummary.js";

const REF = new Date(2026, 5, 15);

function orderFixture(
  id: string,
  overrides: {
    nomusRawResponse?: unknown;
    items?: Array<{
      id: string;
      externalProductId: number;
      skuSnapshot: string;
      productNameSnapshot: string;
      quantity: number;
    }>;
    [key: string]: unknown;
  } = {}
) {
  const { nomusRawResponse, items, ...rest } = overrides;
  return {
    id,
    orderCode: `PD ${id}`,
    status: "SENT_TO_NOMUS",
    issueDate: new Date(2026, 3, 10),
    expectedDeliveryDate: new Date(2026, 5, 1),
    totalNetValue: 10000,
    responsible: "Vendedor",
    companyIssuer: "Empresa",
    nomusRawResponse: nomusRawResponse ?? { itensPedido: [], nfes: [] },
    Customer: { companyName: `Cliente ${id}`, tradeName: null, taxId: null },
    items: items ?? [
      {
        id: `item-${id}`,
        externalProductId: 1,
        skuSnapshot: "SKU-1",
        productNameSnapshot: "Produto",
        quantity: 10,
      },
    ],
    ...rest,
  };
}

describe("salesOrderManagementRealDataParity", () => {
  it("service usa prisma.salesOrder no endpoint", () => {
    const routes = readFileSync(
      join(process.cwd(), "src/lib/salesOrderIntelligenceRoutes.ts"),
      "utf8"
    );
    assert.match(routes, /prisma\.salesOrder\.findMany/);
    assert.doesNotMatch(routes, /prisma\.proposal/i);
  });

  it("management registrado antes de /api/sales-orders/:id no server", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const registerIdx = server.indexOf("registerSalesOrderIntelligenceRoutes(app");
    const detailIdx = server.indexOf('app.get("/api/sales-orders/:id"');
    assert.ok(registerIdx > 0, "registerSalesOrderIntelligenceRoutes ausente");
    assert.ok(detailIdx > 0, "rota :id ausente");
    assert.ok(registerIdx < detailIdx, "management deve registrar antes de :id");
  });

  it("filtro padrão de ano 2026 não exclui pedidos do ano na query Prisma", () => {
    const filters = parseSalesOrderManagementFilters({ year: "2026" });
    const where = buildSalesOrderManagementWhere(filters);
    assert.ok(where.issueDate);
    const gte = (where.issueDate as { gte?: Date }).gte;
    const lte = (where.issueDate as { lte?: Date }).lte;
    assert.equal(gte?.getFullYear(), 2026);
    assert.equal(lte?.getFullYear(), 2026);
  });

  it("mês Todos não adiciona filtro de mês", () => {
    const filters = parseSalesOrderManagementFilters({ year: "2026", month: "" });
    const where = buildSalesOrderManagementWhere(filters);
    const lte = (where.issueDate as { lte?: Date }).lte;
    assert.equal(lte?.getMonth(), 11);
  });

  it("gestão e lista compartilham buildSalesOrderListWhere para período", () => {
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 11, 31, 23, 59, 59, 999);
    const mgmtWhere = buildSalesOrderManagementWhere({ year: 2026 });
    const listWhere = buildSalesOrderListWhere({ startDate: start, endDate: end });
    assert.deepEqual(mgmtWhere.issueDate, listWhere.issueDate);
  });

  it("ausência de OP, NF e status de item não remove pedidos", () => {
    const orders = [
      orderFixture("sem-nf", { nomusRawResponse: { itensPedido: [], nfes: [] } }),
      orderFixture("com-nf", {
        nomusRawResponse: {
          itensPedido: [],
          nfes: [{ numero: "100", dataProcessamento: "10/04/2026" }],
        },
      }),
      orderFixture("sem-op", { nomusRawResponse: { itensPedido: [], nfes: [] } }),
      orderFixture("item-sem-status", {
        nomusRawResponse: {
          itensPedido: [{ idProduto: 1, quantidade: 5 }],
          nfes: [],
        },
        items: [
          {
            id: "item-x",
            externalProductId: 1,
            skuSnapshot: "SKU-X",
            productNameSnapshot: "Produto X",
            quantity: 5,
          },
        ],
      }),
    ];

    const { rows, cards, summary } = buildManagementRowsFromOrders(orders, { year: 2026 }, REF);

    assert.equal(rows.length, 4);
    assert.ok(summary.totalOrdersCount > 0);
    assert.ok(summary.validPortfolioCount > 0);
    assert.ok(cards.awaitingInProgress >= 1);
    const semNf = rows.filter((r) => !r.hasInvoice);
    assert.ok(semNf.length >= 1);
    assert.ok(rows.every((r) => Number.isFinite(r.totalNetValue)));
  });

  it("pedido sem itens sincronizados ainda aparece", () => {
    const { rows } = buildManagementRowsFromOrders(
      [orderFixture("vazio", { items: [] })],
      {},
      REF
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.itemsCount, 0);
  });

  it("summary total bate com rows filtradas", () => {
    const orders = [
      orderFixture("a"),
      orderFixture("b"),
      orderFixture("c"),
    ];
    const { rows, summary } = buildManagementRowsFromOrders(orders, {}, REF);
    assert.equal(summary.totalOrdersCount, rows.length);
    assert.equal(summary.totalOrdersCount, 3);
    assert.equal(summary.reconciliation.countMatches, true);
  });

  it("não retorna NaN/Infinity nos cards", () => {
    const { cards } = buildManagementRowsFromOrders([orderFixture("x")], {}, REF);
    for (const value of Object.values(cards)) {
      assert.ok(Number.isFinite(value));
    }
  });
});
