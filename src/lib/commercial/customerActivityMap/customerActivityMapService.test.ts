/**
 * Mapa de Atuação — serviço e rotas (Prisma fake, sem banco).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { CUSTOMER_MAP_NO_OWNER_KEY, parseCustomerMapFilters } from "./customerActivityMap.js";
import {
  createCustomerActivityMapService,
  CUSTOMER_MAP_DETAIL_LIMIT,
} from "./customerActivityMapService.server.js";

const NOW = new Date("2026-10-02T12:00:00Z");

const CUSTOMERS = [
  { id: "a", companyName: "Alfa", tradeName: null, city: "Curitiba", state: "PR", country: "Brasil", status: "ACTIVE", createdAt: new Date("2024-01-01"), CrmCustomerCommercialOwner: { isActive: true, sellerCanonicalName: "Gislene" } },
  { id: "b", companyName: "Beta", tradeName: "Beta ME", city: "curitiba", state: "PR", country: "Brasil", status: "INACTIVE", createdAt: new Date("2024-01-01"), CrmCustomerCommercialOwner: { isActive: false, sellerCanonicalName: "Antigo" } },
  { id: "c", companyName: "Gama", tradeName: null, city: "Joinville", state: "SC", country: "Brasil", status: "ACTIVE", createdAt: new Date("2026-09-25"), CrmCustomerCommercialOwner: null },
  { id: "d", companyName: "Delta", tradeName: null, city: "Lugar Nenhum", state: "SC", country: "Brasil", status: "ACTIVE", createdAt: new Date("2024-01-01"), CrmCustomerCommercialOwner: null },
  { id: "e", companyName: "Épsilon", tradeName: null, city: null, state: null, country: "Brasil", status: "ACTIVE", createdAt: new Date("2024-01-01"), CrmCustomerCommercialOwner: null },
];

const ORDERS = [
  { customerId: "a", count: 3, last: new Date("2026-09-18T12:00:00Z") },
  { customerId: "c", count: 1, last: new Date("2026-08-01T12:00:00Z") },
];

function fakePrisma() {
  const calls = { customerFindMany: [] as any[], orderGroupBy: [] as any[], ownerGroupBy: 0 };
  const prisma = {
    customer: {
      findMany: async (args: any) => {
        calls.customerFindMany.push(args);
        const where = args.where ?? {};
        return CUSTOMERS.filter((customer) => {
          if (where.status === "ACTIVE") return customer.status === "ACTIVE";
          if (where.status?.not === "ACTIVE") return customer.status !== "ACTIVE";
          return true;
        });
      },
    },
    salesOrder: {
      groupBy: async (args: any) => {
        calls.orderGroupBy.push(args);
        const ids: string[] | undefined = args.where.customerId?.in;
        return ORDERS.filter((order) => !ids || ids.includes(order.customerId)).map((order) => ({
          customerId: order.customerId,
          _count: { _all: order.count },
          _max: { issueDate: order.last },
        }));
      },
    },
    crmCustomerCommercialOwner: {
      groupBy: async () => {
        calls.ownerGroupBy += 1;
        return [{ sellerIdentityKey: "k-gislene", sellerCanonicalName: "Gislene", _count: { _all: 1 } }];
      },
    },
  };
  return { prisma: prisma as never, calls };
}

describe("serviço — visão geral", () => {
  it("agrega em lote: 1 leitura de clientes + 1 groupBy de pedidos, sem N+1", async () => {
    const { prisma, calls } = fakePrisma();
    const service = createCustomerActivityMapService({ prisma, now: () => NOW });
    const overview = await service.getOverview(parseCustomerMapFilters({}));

    assert.equal(calls.customerFindMany.length, 1);
    assert.equal(calls.orderGroupBy.length, 1);
    assert.equal(overview.summary.customers, 5);
    assert.equal(overview.summary.mappedCustomers, 3);
    assert.equal(overview.summary.stateOnlyCustomers, 1);
    assert.equal(overview.summary.unmappedCustomers, 1);
    assert.equal(overview.summary.orders, 4);
    assert.equal(overview.cities[0]?.city, "Curitiba");
    assert.equal(overview.cities[0]?.customers, 2);
    assert.deepEqual(overview.filters.owners, [{ key: "k-gislene", name: "Gislene", customers: 1 }]);
  });

  it("pedidos usam a população oficial: fora CANCELLED/ERROR", async () => {
    const { prisma, calls } = fakePrisma();
    const service = createCustomerActivityMapService({ prisma, now: () => NOW });
    await service.getOverview(parseCustomerMapFilters({}));
    assert.deepEqual(calls.orderGroupBy[0].where.status, { notIn: ["CANCELLED", "ERROR"] });
    assert.equal(calls.orderGroupBy[0].where.issueDate, undefined);
  });

  it("período restringe os PEDIDOS, não a carteira", async () => {
    const { prisma, calls } = fakePrisma();
    const service = createCustomerActivityMapService({ prisma, now: () => NOW });
    const overview = await service.getOverview(parseCustomerMapFilters({ orderPeriod: "30d" }));
    assert.equal(
      calls.orderGroupBy[0].where.issueDate.gte.toISOString(),
      "2026-09-02T12:00:00.000Z"
    );
    assert.equal(calls.customerFindMany[0].where.createdAt, undefined);
    assert.equal(overview.summary.customers, 5);
  });

  it("filtros de situação e responsável vão para a consulta", async () => {
    const { prisma, calls } = fakePrisma();
    const service = createCustomerActivityMapService({ prisma, now: () => NOW });
    const active = await service.getOverview(
      parseCustomerMapFilters({ status: "ACTIVE", ownerKey: "k-gislene" })
    );
    assert.equal(active.summary.customers, 4);
    assert.equal(calls.customerFindMany[0].where.status, "ACTIVE");
    assert.deepEqual(calls.customerFindMany[0].where.CrmCustomerCommercialOwner, {
      is: { isActive: true, sellerIdentityKey: "k-gislene" },
    });

    await service.getOverview(parseCustomerMapFilters({ ownerKey: CUSTOMER_MAP_NO_OWNER_KEY }));
    assert.equal(calls.customerFindMany[1].where.OR.length, 2);
  });
});

describe("serviço — detalhe sob demanda", () => {
  it("bbox devolve só os clientes da área, com dados do popup", async () => {
    const { prisma, calls } = fakePrisma();
    const service = createCustomerActivityMapService({ prisma, now: () => NOW });
    const detail = await service.getDetail(parseCustomerMapFilters({}), {
      kind: "bounds",
      bounds: { west: -50, south: -26, east: -49, north: -25 },
    });
    assert.deepEqual(detail.customers.map((customer) => customer.id), ["a", "b"]);
    assert.equal(detail.total, 2);
    assert.equal(detail.truncated, false);
    const alfa = detail.customers[0]!;
    assert.equal(alfa.precision, "CITY");
    assert.equal(alfa.ownerName, "Gislene");
    assert.equal(alfa.orderCount, 3);
    assert.equal(alfa.lastOrderAt, "2026-09-18T12:00:00.000Z");
    // responsável inativo não é exibido como responsável
    assert.equal(detail.customers[1]!.ownerName, null);
    // pedidos consultados só para os clientes devolvidos
    assert.deepEqual(calls.orderGroupBy[0].where.customerId, { in: ["a", "b"] });
  });

  it("por município usa o código IBGE", async () => {
    const { prisma } = fakePrisma();
    const service = createCustomerActivityMapService({ prisma, now: () => NOW });
    const detail = await service.getDetail(parseCustomerMapFilters({}), {
      kind: "city",
      ibgeCode: 4209102,
    });
    assert.deepEqual(detail.customers.map((customer) => customer.companyName), ["Gama"]);
  });

  it("qualidade cadastral: lista quem não chegou ao município, com o motivo", async () => {
    const { prisma } = fakePrisma();
    const service = createCustomerActivityMapService({ prisma, now: () => NOW });
    const detail = await service.getDetail(parseCustomerMapFilters({}), { kind: "unresolved" });
    assert.deepEqual(
      detail.customers.map((customer) => [customer.companyName, customer.precision, customer.reason]),
      [
        ["Delta", "STATE", "Cidade não reconhecida na UF informada"],
        ["Épsilon", "UNKNOWN", "Sem cidade e sem UF"],
      ]
    );
  });

  it("recorte vazio não consulta pedidos", async () => {
    const { prisma, calls } = fakePrisma();
    const service = createCustomerActivityMapService({ prisma, now: () => NOW });
    const detail = await service.getDetail(parseCustomerMapFilters({}), {
      kind: "bounds",
      bounds: { west: 0, south: 0, east: 1, north: 1 },
    });
    assert.deepEqual(detail, { customers: [], total: 0, truncated: false });
    assert.equal(calls.orderGroupBy.length, 0);
    assert.ok(CUSTOMER_MAP_DETAIL_LIMIT >= 500);
  });
});

describe("rotas — autorização e leitura", () => {
  const routes = fs.readFileSync(new URL("./customerActivityMapRoutes.ts", import.meta.url), "utf8");
  const server = fs.readFileSync(new URL("../../../../server.ts", import.meta.url), "utf8");

  it("toda rota exige sessão e a permissão de Clientes (view)", () => {
    const declared = routes.match(/app\.(get|post|put|patch|delete)\(/g) ?? [];
    assert.deepEqual(declared, ["app.get(", "app.get("]);
    assert.equal((routes.match(/requireAppAuth, view, async/g) ?? []).length, 2);
    assert.match(routes, /requireResource\(CUSTOMER_ACTIVITY_MAP_RESOURCE_KEY, "view"\)/);
    assert.match(routes, /CUSTOMER_ACTIVITY_MAP_RESOURCE_KEY = "commercial\.customers"/);
  });

  it("serviço é somente leitura", () => {
    const service = fs.readFileSync(
      new URL("./customerActivityMapService.server.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(service, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    assert.doesNotMatch(service, /fetch\(|https?:\/\//);
  });

  it("está registrado no servidor", () => {
    assert.match(server, /registerCustomerActivityMapRoutes\(app, \{ requireAppAuth, requireResource \}\)/);
  });
});
