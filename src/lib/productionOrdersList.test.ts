import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  buildProductionOrderLinkAggregates,
  buildProductionOrdersListWhere,
  buildProductionOrdersStatusCounts,
  serializeProductionOrderGridRow,
  statusCountKey,
} from "@/src/lib/productionOrdersList.js";
import { listProductionOrdersForGrid } from "@/src/lib/productionOrdersList.server.js";
import {
  ProductionOrdersListQueryError,
  PRODUCTION_ORDERS_LIST_MAX_PAGE_SIZE,
  PRODUCTION_ORDERS_LIST_PERIOD_FIELD,
  parseProductionOrdersListQuery,
} from "@/src/lib/productionOrdersListQuery.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const baseOpened = new Date("2026-03-10T11:15:00.000Z");

function gridRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "op-uuid-1",
    externalId: 30347,
    name: "OP 05800 - 003",
    status: "Encerrada",
    tipo: "Injeção",
    priority: "Normal",
    companyName: "KOPPETEL",
    productCode: "311.32AA",
    productDescription: "Produto fixture OP 05800",
    quantity: new Prisma.Decimal("15400"),
    unit: "PC",
    stockSector: "PRODUCAO",
    openedAt: baseOpened,
    plannedAt: new Date("2026-03-12T21:00:00.000Z"),
    closedAt: new Date("2026-03-12T20:40:22.000Z"),
    nomusUpdatedAt: new Date("2026-03-12T20:40:22.000Z"),
    syncedAt: new Date("2026-07-16T12:00:00.000Z"),
    ...overrides,
  };
}

describe("productionOrdersListQuery", () => {
  it("defaults page/pageSize e periodField documentado", () => {
    const q = parseProductionOrdersListQuery({});
    assert.equal(q.page, 1);
    assert.equal(q.pageSize, 50);
    assert.equal(q.skip, 0);
    assert.equal(PRODUCTION_ORDERS_LIST_PERIOD_FIELD, "openedAt");
  });

  it("rejeita page inválida", () => {
    assert.throws(
      () => parseProductionOrdersListQuery({ page: "0" }),
      (error: unknown) =>
        error instanceof ProductionOrdersListQueryError && error.code === "INVALID_PAGE"
    );
  });

  it("rejeita pageSize acima do teto", () => {
    assert.throws(
      () =>
        parseProductionOrdersListQuery({
          pageSize: String(PRODUCTION_ORDERS_LIST_MAX_PAGE_SIZE + 1),
        }),
      (error: unknown) =>
        error instanceof ProductionOrdersListQueryError &&
        error.code === "INVALID_PAGE_SIZE"
    );
  });

  it("rejeita from/to inválidos e range invertido", () => {
    assert.throws(
      () => parseProductionOrdersListQuery({ from: "não-é-data" }),
      (error: unknown) =>
        error instanceof ProductionOrdersListQueryError && error.code === "INVALID_FROM"
    );
    assert.throws(
      () =>
        parseProductionOrdersListQuery({
          from: "2026-03-12T00:00:00.000Z",
          to: "2026-03-01T00:00:00.000Z",
        }),
      (error: unknown) =>
        error instanceof ProductionOrdersListQueryError &&
        error.code === "INVALID_DATE_RANGE"
    );
  });

  it("parseia filtros textuais", () => {
    const q = parseProductionOrdersListQuery({
      search: "05800",
      status: "Encerrada",
      tipo: "Injeção",
      company: "KOP",
      page: "2",
      pageSize: "25",
      from: "2026-03-01T00:00:00.000Z",
      to: "2026-03-31T23:59:59.000Z",
    });
    assert.equal(q.page, 2);
    assert.equal(q.pageSize, 25);
    assert.equal(q.skip, 25);
    assert.equal(q.search, "05800");
    assert.equal(q.status, "Encerrada");
    assert.equal(q.tipo, "Injeção");
    assert.equal(q.company, "KOP");
    assert.ok(q.openedFrom);
    assert.ok(q.openedTo);
  });
});

describe("buildProductionOrdersListWhere", () => {
  it("monta OR de busca e filtros combinados", () => {
    const q = parseProductionOrdersListQuery({
      search: "PD 02534",
      status: "Encerrada",
      tipo: "Injeção",
      company: "KOPPETEL",
      from: "2026-03-01T00:00:00.000Z",
      to: "2026-03-31T23:59:59.000Z",
    });
    const where = buildProductionOrdersListWhere(q);
    assert.ok(Array.isArray(where.AND));
    assert.equal((where.AND as unknown[]).length, 5);
  });

  it("where vazio sem filtros", () => {
    const where = buildProductionOrdersListWhere(parseProductionOrdersListQuery({}));
    assert.equal(where.AND, undefined);
  });
});

describe("serializeProductionOrderGridRow", () => {
  it("preserva decimal como string e null como null", () => {
    const row = serializeProductionOrderGridRow(gridRow());
    assert.equal(row.quantity, "15400");
    assert.equal(row.openedAt, baseOpened.toISOString());
    assert.equal(row.name, "OP 05800 - 003");

    const nullish = serializeProductionOrderGridRow(
      gridRow({
        quantity: null,
        openedAt: null,
        plannedAt: null,
        closedAt: null,
        nomusUpdatedAt: null,
        syncedAt: null,
        name: null,
      })
    );
    assert.equal(nullish.quantity, null);
    assert.equal(nullish.openedAt, null);
    assert.equal(nullish.syncedAt, null);
  });
});

describe("buildProductionOrderLinkAggregates", () => {
  it("OP sem vínculo", () => {
    const map = buildProductionOrderLinkAggregates([]);
    assert.equal(map.size, 0);
  });

  it("OP com um vínculo resolvido", () => {
    const map = buildProductionOrderLinkAggregates([
      {
        productionOrderId: "op-1",
        isCurrent: true,
        externalSalesOrderId: 2530,
        customerName: "Esmaltec S/A",
        salesOrderId: "so-1",
        salesOrderItemId: "item-1",
        orderCode: "PD 02534",
      },
    ]);
    const agg = map.get("op-1");
    assert.equal(agg?.currentLinkCount, 1);
    assert.equal(agg?.hasPendingLink, false);
    assert.deepEqual(agg?.currentSalesOrders, [
      {
        externalSalesOrderId: 2530,
        orderCode: "PD 02534",
        customerName: "Esmaltec S/A",
      },
    ]);
  });

  it("OP com vários vínculos e pedidos distintos", () => {
    const map = buildProductionOrderLinkAggregates([
      {
        productionOrderId: "op-1",
        isCurrent: true,
        externalSalesOrderId: 2530,
        customerName: "Cliente A",
        salesOrderId: "so-1",
        salesOrderItemId: "item-1",
        orderCode: "PD 02534",
      },
      {
        productionOrderId: "op-1",
        isCurrent: true,
        externalSalesOrderId: 2530,
        customerName: "Cliente A",
        salesOrderId: "so-1",
        salesOrderItemId: "item-2",
        orderCode: "PD 02534",
      },
      {
        productionOrderId: "op-1",
        isCurrent: true,
        externalSalesOrderId: 9999,
        customerName: "Cliente B",
        salesOrderId: "so-2",
        salesOrderItemId: "item-3",
        orderCode: "PD 09999",
      },
      {
        productionOrderId: "op-1",
        isCurrent: false,
        externalSalesOrderId: 1111,
        customerName: "Removido",
        salesOrderId: null,
        salesOrderItemId: null,
        orderCode: null,
      },
    ]);
    const agg = map.get("op-1");
    assert.equal(agg?.currentLinkCount, 3);
    assert.equal(agg?.currentSalesOrders.length, 2);
    assert.equal(agg?.hasPendingLink, false);
  });

  it("vínculo pendente quando FK local ausente", () => {
    const map = buildProductionOrderLinkAggregates([
      {
        productionOrderId: "op-1",
        isCurrent: true,
        externalSalesOrderId: 2530,
        customerName: "Esmaltec S/A",
        salesOrderId: null,
        salesOrderItemId: null,
        orderCode: null,
      },
    ]);
    assert.equal(map.get("op-1")?.hasPendingLink, true);
  });
});

describe("buildProductionOrdersStatusCounts", () => {
  it("usa status real do banco; chave vazia para null", () => {
    const counts = buildProductionOrdersStatusCounts([
      { status: "Encerrada", _count: { _all: 3 } },
      { status: null, _count: { _all: 1 } },
    ]);
    assert.equal(counts.Encerrada, 3);
    assert.equal(counts[statusCountKey(null)], 1);
  });
});

describe("listProductionOrdersForGrid", () => {
  it("paginação, filtros, statusCounts e ausência de N+1", async () => {
    const headers = [
      gridRow({ id: "op-1", externalId: 30347 }),
      gridRow({ id: "op-2", externalId: 40001, name: "OP sem vínculo", quantity: null }),
    ];
    const calls = {
      findMany: 0,
      count: 0,
      groupBy: 0,
      links: 0,
    };

    const db = {
      nomusProductionOrder: {
        findMany: async () => {
          calls.findMany += 1;
          return headers;
        },
        count: async () => {
          calls.count += 1;
          return 42;
        },
        groupBy: async () => {
          calls.groupBy += 1;
          return [
            { status: "Encerrada", _count: { _all: 40 } },
            { status: null, _count: { _all: 2 } },
          ];
        },
      },
      nomusProductionOrderSalesLink: {
        findMany: async (args: { where: { productionOrderId: { in: string[] } } }) => {
          calls.links += 1;
          assert.deepEqual(args.where.productionOrderId.in, ["op-1", "op-2"]);
          return [
            {
              productionOrderId: "op-1",
              isCurrent: true,
              externalSalesOrderId: 2530,
              customerName: "Esmaltec S/A",
              salesOrderId: "so-1",
              salesOrderItemId: "item-1",
              SalesOrder: { orderCode: "PD 02534" },
            },
          ];
        },
      },
    };

    const query = parseProductionOrdersListQuery({
      page: "2",
      pageSize: "2",
      search: "05800",
      status: "Encerrada",
    });
    const payload = await listProductionOrdersForGrid(
      db as unknown as import("@prisma/client").PrismaClient,
      query
    );

    assert.equal(calls.findMany, 1);
    assert.equal(calls.count, 1);
    assert.equal(calls.groupBy, 1);
    assert.equal(calls.links, 1);
    assert.equal(payload.page, 2);
    assert.equal(payload.pageSize, 2);
    assert.equal(payload.total, 42);
    assert.equal(payload.totalPages, 21);
    assert.equal(payload.periodField, "openedAt");
    assert.equal(payload.rows.length, 2);
    assert.equal(payload.rows[0]?.currentLinkCount, 1);
    assert.deepEqual(payload.rows[0]?.currentSalesOrders, [
      {
        externalSalesOrderId: 2530,
        orderCode: "PD 02534",
        customerName: "Esmaltec S/A",
      },
    ]);
    assert.equal(payload.rows[1]?.currentLinkCount, 0);
    assert.equal(payload.rows[1]?.hasPendingLink, false);
    assert.equal(payload.statusCounts.Encerrada, 40);
    assert.equal(payload.appliedFilters.some((f) => f.key === "search"), true);
  });

  it("não consulta links quando página vazia", async () => {
    let linksCalled = false;
    const db = {
      nomusProductionOrder: {
        findMany: async () => [],
        count: async () => 0,
        groupBy: async () => [],
      },
      nomusProductionOrderSalesLink: {
        findMany: async () => {
          linksCalled = true;
          return [];
        },
      },
    };
    const payload = await listProductionOrdersForGrid(
      db as unknown as import("@prisma/client").PrismaClient,
      parseProductionOrdersListQuery({})
    );
    assert.equal(payload.rows.length, 0);
    assert.equal(linksCalled, false);
  });
});

describe("productionOrdersRoutes", () => {
  it("registra GET /api/operations/production-orders com requireResource", () => {
    const routes = read("src/lib/productionOrdersRoutes.ts");
    assert.match(routes, /GET \/api\/operations\/production-orders/);
    assert.match(routes, /requireAppAuth/);
    assert.match(routes, /OPERATIONS_RESOURCE_KEYS\.productionOrders/);
    assert.match(routes, /OPERATIONS_ACTIONS\.view/);
    assert.match(routes, /listProductionOrdersForGrid/);
    assert.doesNotMatch(routes, /fetchNomusJson/);
    assert.doesNotMatch(routes, /nomusProductionOrdersClient/);
  });

  it("server registra registerProductionOrdersRoutes", () => {
    assert.match(read("server.ts"), /registerProductionOrdersRoutes/);
  });

  it("permissão oficial catalogada", () => {
    assert.match(read("src/lib/permissionCatalog.ts"), /operations\.production-orders\.view/);
    assert.match(read("src/lib/operationsAccess.ts"), /operations\.production_orders/);
    assert.match(
      read("src/lib/security/permissionContract/resources.ts"),
      /operations\.production_orders/
    );
  });
});
