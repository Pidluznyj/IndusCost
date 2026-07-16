import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import {
  mapNomusProductionOrderPayload,
  mapNomusProductionOrderSalesLink,
  parseNomusProductionQuantity,
  pickItensPedidoFromOrdem,
} from "@/src/lib/nomusProductionOrdersMapper";
import {
  buildProductionOrderPointQueries,
  buildProductionOrdersPageParams,
  escapeNomusRsqlQuotedValue,
  hasNextProductionOrdersPage,
  isProductionOrdersAfterSalesSyncEnabled,
  parseProductionOrdersSyncCli,
  pickProductionOrdersArray,
  planProductionOrderPersist,
  shouldWriteProductionOrders,
  summarizeProductionOrderPersistPlans,
} from "@/src/lib/nomusProductionOrdersSyncLogic";

/** Payload comprovado: OP 05800 - 003 / PD 02534. */
const OP_05800_PAYLOAD = {
  id: 30347,
  nome: "OP 05800 - 003",
  status: "Encerrada",
  tipo: "Injeção",
  produto: "311.32AA",
  quantidade: "15.400",
  unidade: "PC",
  idProduto: 391,
  empresa: "KOPPETEL",
  itensPedido: [
    {
      id: 11324,
      idPedido: 2530,
      item: "00010",
      nomeCliente: "Esmaltec S/A",
      quantidade: "15.000",
    },
  ],
};

describe("nomusProductionOrdersMapper", () => {
  it("parseNomusProductionQuantity trata milhar Nomus", () => {
    assert.equal(parseNomusProductionQuantity("15.400"), 15400);
    assert.equal(parseNomusProductionQuantity("15.000"), 15000);
    assert.equal(parseNomusProductionQuantity(15.4), 15.4);
  });

  it("mapeia OP comprovada com vínculo oficial pedido/item", () => {
    const mapped = mapNomusProductionOrderPayload(OP_05800_PAYLOAD);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.externalId, 30347);
    assert.equal(mapped.row.name, "OP 05800 - 003");
    assert.equal(mapped.row.status, "Encerrada");
    assert.equal(mapped.row.tipo, "Injeção");
    assert.equal(mapped.row.productCode, "311.32AA");
    assert.equal(mapped.row.externalProductId, 391);
    assert.equal(mapped.row.unit, "PC");
    assert.equal(mapped.row.companyName, "KOPPETEL");
    assert.ok(mapped.row.payloadHash.length >= 32);
    assert.ok(mapped.row.quantity?.equals(new Prisma.Decimal(15400)));
    assert.equal(mapped.row.salesLinks.length, 1);
    assert.equal(mapped.row.salesLinks[0]!.externalSalesOrderId, 2530);
    assert.equal(mapped.row.salesLinks[0]!.externalSalesOrderItemId, 11324);
    assert.equal(mapped.row.salesLinks[0]!.itemNumber, "00010");
    assert.equal(mapped.row.salesLinks[0]!.customerName, "Esmaltec S/A");
    assert.ok(mapped.row.salesLinks[0]!.linkedQuantity?.equals(new Prisma.Decimal(15000)));
  });

  it("permite OP sem itensPedido (sem vínculo)", () => {
    const mapped = mapNomusProductionOrderPayload({
      id: 1,
      nome: "OP SEM PEDIDO",
      quantidade: "1.000",
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.salesLinks.length, 0);
    assert.ok(mapped.row.quantity?.equals(new Prisma.Decimal(1000)));
  });

  it("rejeita OP sem id externo", () => {
    const mapped = mapNomusProductionOrderPayload({ nome: "OP X" });
    assert.equal(mapped.ok, false);
  });

  it("ignora itensPedido sem idPedido/id oficiais", () => {
    assert.equal(mapNomusProductionOrderSalesLink({ item: "00010" }), null);
    assert.equal(pickItensPedidoFromOrdem({ itensPedido: [{ id: 1 }] }).length, 1);
  });
});

describe("nomusProductionOrdersSyncLogic", () => {
  it("CLI preview incremental e apply pontual", () => {
    const preview = parseProductionOrdersSyncCli(["preview", "--strategy=incremental"]);
    assert.equal(preview.mode, "preview");
    assert.equal(preview.strategy, "incremental");
    assert.equal(shouldWriteProductionOrders(preview.mode), false);

    const point = parseProductionOrdersSyncCli([
      "apply",
      "--externalId=30347",
      '--name=OP 05800 - 003',
      "--salesOrderExternalId=2530",
    ]);
    assert.equal(point.mode, "apply");
    assert.equal(point.strategy, "point");
    assert.deepEqual(point.externalIds, [30347]);
    assert.deepEqual(point.names, ["OP 05800 - 003"]);
    assert.deepEqual(point.salesOrderExternalIds, [2530]);
    assert.equal(shouldWriteProductionOrders(point.mode), true);
  });

  it("monta queries pontuais e paginação", () => {
    assert.equal(escapeNomusRsqlQuotedValue('OP "X"'), 'OP \\"X\\"');
    assert.deepEqual(
      buildProductionOrderPointQueries({
        externalIds: [30347],
        names: ["OP 05800 - 003"],
        salesOrderExternalIds: [2530],
      }),
      ['id==30347', 'nome=="OP 05800 - 003"', "itensPedido.idPedido==2530"]
    );
    assert.deepEqual(buildProductionOrdersPageParams(2, 50, "id==30347"), {
      pagina: "2",
      tamanhoPagina: "50",
      query: "id==30347",
    });
  });

  it("pick array e next page", () => {
    assert.equal(pickProductionOrdersArray({ ordens: [{ id: 1 }] }).length, 1);
    assert.equal(hasNextProductionOrdersPage({ totalPaginas: 3 }, 2, 50, 50), true);
    assert.equal(hasNextProductionOrdersPage({}, 1, 10, 50), false);
  });

  it("planos de persistência", () => {
    const mapped = mapNomusProductionOrderPayload(OP_05800_PAYLOAD);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    const createPlan = planProductionOrderPersist(mapped.row, new Set());
    assert.equal(createPlan.action, "create");
    const updatePlan = planProductionOrderPersist(mapped.row, new Set([30347]));
    assert.equal(updatePlan.action, "update");
    assert.deepEqual(summarizeProductionOrderPersistPlans([createPlan, updatePlan]), {
      create: 1,
      update: 1,
      salesLinks: 2,
    });
  });

  it("pós-sync habilitado por padrão", () => {
    assert.equal(isProductionOrdersAfterSalesSyncEnabled({}), true);
    assert.equal(
      isProductionOrdersAfterSalesSyncEnabled({ NOMUS_PRODUCTION_ORDERS_AFTER_SYNC: "false" }),
      false
    );
  });
});

describe("nomusProductionOrders wiring", () => {
  it("script e hook pós pedidos existem", () => {
    const script = readFileSync(
      join(process.cwd(), "scripts/nomusProductionOrdersSyncV1.ts"),
      "utf8"
    );
    const sales = readFileSync(
      join(process.cwd(), "scripts/nomusSalesOrdersSyncV1.ts"),
      "utf8"
    );
    assert.match(script, /NOMUS_PRODUCTION_ORDERS_RESOURCE/);
    assert.match(script, /runNomusProductionOrdersAfterSalesOrdersSync/);
    assert.match(sales, /runNomusProductionOrdersAfterSalesOrdersSync/);
    assert.match(sales, /production-orders sync falhou/);
  });

  it("schema e migration aditivos OP-02", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const base = readFileSync(
      join(process.cwd(), "prisma/migrations/20260728120000_nomus_production_orders/migration.sql"),
      "utf8"
    );
    const op02 = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations/20260728140000_nomus_production_orders_op02_schema/migration.sql"
      ),
      "utf8"
    );
    assert.match(schema, /model NomusProductionOrder /);
    assert.match(schema, /model NomusProductionOrderSalesLink /);
    assert.match(schema, /payloadHash/);
    assert.match(schema, /itemNumber/);
    assert.match(schema, /linkedQuantity/);
    assert.match(schema, /isCurrent/);
    assert.match(schema, /removedAt/);
    assert.match(schema, /lastChangedAt/);
    assert.doesNotMatch(schema, /model SyncState/);
    assert.match(base, /CREATE TABLE "NomusProductionOrder"/);
    assert.match(op02, /payloadHash/);
    assert.match(op02, /itemNumber/);
    assert.match(op02, /isCurrent/);
  });
});
