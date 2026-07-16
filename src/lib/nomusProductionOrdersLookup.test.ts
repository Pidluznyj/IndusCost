import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOMUS_PRODUCTION_ORDER_OP_05800_EXPECTED,
  NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE,
} from "@/src/lib/fixtures/nomusProductionOrderOp05800.js";
import {
  buildProductionOrderExternalIdQuery,
  buildProductionOrderNameLookupQuery,
  buildProductionOrderSalesOrderItemQuery,
  buildProductionOrderSalesOrderQuery,
  parseProductionOrdersLookupCli,
  planProductionOrdersLookupQueries,
  resolveProductionOrdersLookupOperation,
} from "@/src/lib/nomusProductionOrdersLookup.js";
import {
  runProductionOrdersLookupLoop,
  type ProductionOrdersLookupLocalResolver,
} from "@/src/lib/nomusProductionOrdersLookup.server.js";
import {
  buildProductionOrderExternalIdQuery as clientBuildIdQuery,
} from "@/src/lib/nomusProductionOrdersClient.js";

function createLocalStub(options?: {
  localOpIds?: number[];
  orderIdByExt?: Map<number, string>;
  itemIdByExt?: Map<number, string>;
  pending?: Array<{
    externalSalesOrderId: number;
    externalSalesOrderItemId: number;
    salesOrderId: string | null;
    salesOrderItemId: string | null;
    isCurrent: boolean;
  }>;
}): ProductionOrdersLookupLocalResolver {
  return {
    findOpExternalIdsBySalesFilters: async () => options?.localOpIds ?? [],
    resolveLinkLocals: async () => ({
      ordersByExternalId: options?.orderIdByExt ?? new Map(),
      itemsByExternalId: options?.itemIdByExt ?? new Map(),
    }),
    listPendingLinks: async () => options?.pending ?? [],
  };
}

describe("production orders lookup CLI", () => {
  it("parseia flags kebab-case do caso real OP 05800", () => {
    const opts = parseProductionOrdersLookupCli([
      "preview",
      '--name=OP 05800 - 003',
      "--external-id=30347",
      "--sales-order-external-id=2530",
      "--sales-order-item-external-id=11324",
    ]);
    assert.equal(opts.mode, "preview");
    assert.deepEqual(opts.names, ["OP 05800 - 003"]);
    assert.deepEqual(opts.externalIds, [30347]);
    assert.deepEqual(opts.salesOrderExternalIds, [2530]);
    assert.deepEqual(opts.salesOrderItemExternalIds, [11324]);
    assert.equal(opts.reconcileUnresolved, false);
  });

  it("aceita --reconcile-unresolved e aliases camelCase", () => {
    const opts = parseProductionOrdersLookupCli([
      "apply",
      "--externalId=30347",
      "--salesOrderExternalId=2530",
      "--salesOrderItemExternalId=11324",
      "--reconcile-unresolved",
    ]);
    assert.equal(opts.mode, "apply");
    assert.equal(opts.reconcileUnresolved, true);
    assert.equal(resolveProductionOrdersLookupOperation(opts), "lookup_and_reconcile");
  });

  it("exige filtro ou reconcile", () => {
    assert.throws(() => parseProductionOrdersLookupCli(["preview"]), /filtro pontual|reconcile/);
  });

  it("monta RSQL pontual (id/nome/pedido/item)", () => {
    assert.equal(buildProductionOrderExternalIdQuery(30347), "id==30347");
    assert.equal(clientBuildIdQuery(30347), "id==30347");
    assert.equal(buildProductionOrderNameLookupQuery("OP 05800 - 003"), 'nome=="OP 05800 - 003"');
    assert.equal(buildProductionOrderSalesOrderQuery(2530), "itensPedido.idPedido==2530");
    assert.equal(buildProductionOrderSalesOrderItemQuery(11324), "itensPedido.id==11324");

    const plan = planProductionOrdersLookupQueries({
      names: ["OP 05800 - 003"],
      externalIds: [30347],
      salesOrderExternalIds: [2530],
      salesOrderItemExternalIds: [11324],
      reconcileUnresolved: false,
    });
    assert.equal(plan.apiRequired, true);
    assert.ok(plan.queries.includes("id==30347"));
    assert.ok(plan.queries.includes('nome=="OP 05800 - 003"'));
  });

  it("reconcile-only não exige API", () => {
    const plan = planProductionOrdersLookupQueries({
      names: [],
      externalIds: [],
      salesOrderExternalIds: [],
      salesOrderItemExternalIds: [],
      reconcileUnresolved: true,
    });
    assert.equal(plan.apiRequired, false);
    assert.deepEqual(plan.queries, []);
    assert.equal(
      resolveProductionOrdersLookupOperation({
        names: [],
        externalIds: [],
        salesOrderExternalIds: [],
        salesOrderItemExternalIds: [],
        reconcileUnresolved: true,
      }),
      "reconcile"
    );
  });
});

describe("runProductionOrdersLookupLoop — OP 05800", () => {
  it("preview por nome/externalId traz OP e mostra pendência sem gravar", async () => {
    let persistCalls = 0;
    let apiCalls = 0;
    const summary = await runProductionOrdersLookupLoop({
      mode: "preview",
      options: parseProductionOrdersLookupCli([
        "preview",
        '--name=OP 05800 - 003',
        "--external-id=30347",
      ]),
      fetchPages: async ({ query }) => {
        apiCalls += 1;
        assert.match(query, /id==30347|nome==/);
        return {
          pagesRead: 1,
          recordsReceived: 1,
          items: [NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE],
        };
      },
      persist: async () => {
        persistCalls += 1;
        throw new Error("preview não deve persistir");
      },
      local: createLocalStub({
        pending: [
          {
            externalSalesOrderId: 2530,
            externalSalesOrderItemId: 11324,
            salesOrderId: null,
            salesOrderItemId: null,
            isCurrent: true,
          },
        ],
      }),
      logger: () => {},
    });

    assert.equal(summary.mode, "preview");
    assert.equal(summary.apiCalled, true);
    assert.ok(apiCalls >= 1);
    assert.equal(persistCalls, 0);
    assert.equal(summary.orders.length, 1);
    assert.equal(summary.orders[0]!.externalId, NOMUS_PRODUCTION_ORDER_OP_05800_EXPECTED.externalId);
    assert.equal(summary.orders[0]!.name, NOMUS_PRODUCTION_ORDER_OP_05800_EXPECTED.name);
    assert.equal(summary.orders[0]!.outcome, "preview");
    assert.equal(summary.orders[0]!.links[0]!.externalSalesOrderId, 2530);
    assert.equal(summary.orders[0]!.links[0]!.externalSalesOrderItemId, 11324);
    assert.equal(summary.orders[0]!.links[0]!.pending, true);
    assert.ok(summary.pendingLinks.some((l) => l.externalSalesOrderId === 2530));
  });

  it("apply por external-id persiste e resolve pedido/item locais", async () => {
    let persistCalls = 0;
    const summary = await runProductionOrdersLookupLoop({
      mode: "apply",
      options: parseProductionOrdersLookupCli(["apply", "--external-id=30347"]),
      fetchPages: async () => ({
        pagesRead: 1,
        recordsReceived: 1,
        items: [NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE],
      }),
      persist: async () => {
        persistCalls += 1;
        return {
          outcome: "created",
          externalId: 30347,
          productionOrderId: "po-1",
          links: {
            linksCreated: 1,
            linksUpdated: 0,
            linksReactivated: 0,
            linksMarkedAbsent: 0,
            salesOrderResolved: 1,
            salesOrderItemResolved: 1,
          },
          error: null,
        };
      },
      local: createLocalStub({
        orderIdByExt: new Map([[2530, "so-2530"]]),
        itemIdByExt: new Map([[11324, "soi-11324"]]),
      }),
      logger: () => {},
    });

    assert.equal(persistCalls, 1);
    assert.equal(summary.created, 1);
    assert.equal(summary.orders[0]!.outcome, "created");
    assert.equal(summary.orders[0]!.links[0]!.localSalesOrderId, "so-2530");
    assert.equal(summary.orders[0]!.links[0]!.localSalesOrderItemId, "soi-11324");
    assert.equal(summary.orders[0]!.links[0]!.pending, false);
    assert.equal(summary.pendingLinks.length, 0);
  });

  it("consulta por sales-order / item usa ids locais sem full scan", async () => {
    const queries: string[] = [];
    const summary = await runProductionOrdersLookupLoop({
      mode: "preview",
      options: parseProductionOrdersLookupCli([
        "preview",
        "--sales-order-external-id=2530",
        "--sales-order-item-external-id=11324",
      ]),
      fetchPages: async ({ query }) => {
        queries.push(query);
        if (query === "id==30347") {
          return {
            pagesRead: 1,
            recordsReceived: 1,
            items: [NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE],
          };
        }
        return { pagesRead: 1, recordsReceived: 0, items: [] };
      },
      local: createLocalStub({ localOpIds: [30347] }),
      logger: () => {},
    });

    assert.ok(queries.includes("itensPedido.idPedido==2530"));
    assert.ok(queries.includes("itensPedido.id==11324"));
    assert.ok(queries.includes("id==30347"), "deve incluir OP resolvida localmente");
    assert.equal(summary.orders[0]!.externalId, 30347);
    assert.ok(summary.pagesRead <= 5 * queries.length);
  });

  it("reconcile-unresolved não chama API e não altera pedido", async () => {
    let apiCalls = 0;
    let reconcileCalls = 0;
    const summary = await runProductionOrdersLookupLoop({
      mode: "apply",
      options: parseProductionOrdersLookupCli(["apply", "--reconcile-unresolved", "--limit=50"]),
      fetchPages: async () => {
        apiCalls += 1;
        throw new Error("API não deve ser chamada");
      },
      reconcilePending: async () => {
        reconcileCalls += 1;
        return {
          scanned: 1,
          salesOrderResolved: 1,
          salesOrderItemResolved: 1,
          updated: 1,
        };
      },
      local: createLocalStub({
        pending: [
          {
            externalSalesOrderId: 2530,
            externalSalesOrderItemId: 11324,
            salesOrderId: null,
            salesOrderItemId: null,
            isCurrent: true,
          },
        ],
      }),
      logger: () => {},
    });

    assert.equal(apiCalls, 0);
    assert.equal(summary.apiCalled, false);
    assert.equal(reconcileCalls, 1);
    assert.equal(summary.operation, "reconcile");
    assert.deepEqual(summary.reconcile, {
      scanned: 1,
      salesOrderResolved: 1,
      salesOrderItemResolved: 1,
      updated: 1,
    });
  });

  it("preview + reconcile não escreve FKs", async () => {
    let reconcileCalls = 0;
    const summary = await runProductionOrdersLookupLoop({
      mode: "preview",
      options: parseProductionOrdersLookupCli([
        "preview",
        "--external-id=30347",
        "--reconcile-unresolved",
      ]),
      fetchPages: async () => ({
        pagesRead: 1,
        recordsReceived: 1,
        items: [NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE],
      }),
      reconcilePending: async () => {
        reconcileCalls += 1;
        return { scanned: 0, salesOrderResolved: 0, salesOrderItemResolved: 0, updated: 0 };
      },
      local: createLocalStub(),
      logger: () => {},
    });

    assert.equal(reconcileCalls, 0);
    assert.equal(summary.operation, "lookup_and_reconcile");
    assert.equal(summary.reconcile?.updated, 0);
  });

  it("reexecução idempotente apply unchanged", async () => {
    let persistCalls = 0;
    const run = () =>
      runProductionOrdersLookupLoop({
        mode: "apply",
        options: parseProductionOrdersLookupCli(["apply", "--external-id=30347"]),
        fetchPages: async () => ({
          pagesRead: 1,
          recordsReceived: 1,
          items: [NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE],
        }),
        persist: async () => {
          persistCalls += 1;
          return {
            outcome: persistCalls === 1 ? "created" : "unchanged",
            externalId: 30347,
            productionOrderId: "po-1",
            links: {
              linksCreated: persistCalls === 1 ? 1 : 0,
              linksUpdated: 0,
              linksReactivated: 0,
              linksMarkedAbsent: 0,
              salesOrderResolved: 0,
              salesOrderItemResolved: 0,
            },
            error: null,
          };
        },
        local: createLocalStub({
          orderIdByExt: new Map([[2530, "so-1"]]),
          itemIdByExt: new Map([[11324, "soi-1"]]),
        }),
        logger: () => {},
      });

    const first = await run();
    const second = await run();
    assert.equal(first.created, 1);
    assert.equal(second.unchanged, 1);
    assert.equal(persistCalls, 2);
  });
});

describe("production orders lookup wiring", () => {
  it("scripts package.json existem e orquestrador não inclui lookup OP", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    assert.match(
      pkg.scripts["sync:nomus:production-orders:lookup:preview"] ?? "",
      /Lookup/
    );
    assert.match(pkg.scripts["sync:nomus:production-orders:lookup:apply"] ?? "", /Lookup/);
    assert.match(pkg.scripts["test:nomus:production-orders"] ?? "", /Lookup/);

    const orchestrator = readFileSync(
      join(process.cwd(), "scripts/nomusSyncOrchestrator.ts"),
      "utf8"
    );
    assert.doesNotMatch(orchestrator, /production-orders:lookup/);
    assert.doesNotMatch(orchestrator, /nomusProductionOrdersLookup/);
  });
});
