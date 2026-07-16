import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE } from "@/src/lib/fixtures/nomusProductionOrderOp05800.js";
import { createNomusProductionOrdersClient } from "@/src/lib/nomusProductionOrdersClient.js";
import { mapNomusProductionOrderForPersist } from "@/src/lib/nomusProductionOrdersMapper.js";
import {
  buildProductionOrdersPreviewSummary,
  planProductionOrderLinksPreview,
  planProductionOrderPreview,
  PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER,
} from "@/src/lib/nomusProductionOrdersPreview.js";
import {
  createProductionOrdersPreviewReadOnlyPrisma,
  runNomusProductionOrdersPreview,
} from "@/src/lib/nomusProductionOrdersPreview.server.js";
import {
  buildProductionOrdersDateRangeRsql,
  buildProductionOrdersSyncQueries,
  parseProductionOrdersSyncCli,
} from "@/src/lib/nomusProductionOrdersSyncLogic.js";
import { stableNomusProductionOrderPayloadHash } from "@/src/lib/nomusProductionOrdersParsers.js";

describe("production orders preview CLI/filters", () => {
  it("suporta nome, externalId, intervalo, páginas e estratégias", () => {
    const opts = parseProductionOrdersSyncCli([
      "preview",
      "--name=OP 05800 - 003",
      "--externalId=30347",
      "--from=2026-01-01",
      "--to=2026-07-16",
      "--max-pages=3",
      "--start-page=2",
      "--page-size=25",
    ]);
    assert.equal(opts.mode, "preview");
    assert.equal(opts.strategy, "point");
    assert.deepEqual(opts.names, ["OP 05800 - 003"]);
    assert.deepEqual(opts.externalIds, [30347]);
    assert.equal(opts.from, "2026-01-01");
    assert.equal(opts.to, "2026-07-16");
    assert.equal(opts.startPage, 2);
    assert.equal(opts.maxPages, 3);
    assert.equal(opts.pageSize, 25);

    const incremental = parseProductionOrdersSyncCli([
      "preview",
      "--strategy=incremental",
      "--max-pages=5",
    ]);
    assert.equal(incremental.strategy, "incremental");

    const backfill = parseProductionOrdersSyncCli([
      "preview",
      "backfill",
      "--start-page=10",
    ]);
    assert.equal(backfill.strategy, "backfill");
    assert.equal(backfill.startPage, 10);
  });

  it("monta RSQL de intervalo e combina com pontual", () => {
    assert.equal(
      buildProductionOrdersDateRangeRsql({ from: "2026-01-01", to: "2026-01-31" }),
      "dataAlteracao>=01/01/2026;dataAlteracao<=31/01/2026"
    );
    const queries = buildProductionOrdersSyncQueries({
      strategy: "point",
      externalIds: [30347],
      names: [],
      salesOrderExternalIds: [],
      from: "2026-03-01",
      to: "2026-03-31",
      dateField: "dataAbertura",
    });
    assert.deepEqual(queries, [
      "id==30347;dataAbertura>=01/03/2026;dataAbertura<=31/03/2026",
    ]);
  });
});

describe("production orders preview planning", () => {
  it("classifica create/update/unchanged e vínculos", () => {
    const mapped = mapNomusProductionOrderForPersist(NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;

    const createPlan = planProductionOrderPreview({
      row: mapped.row,
      existing: null,
      links: planProductionOrderLinksPreview({
        incomingItemIds: [11324],
        existingCurrentItemIds: [],
        resolvedFullyCount: 1,
        unresolvedCount: 0,
      }),
    });
    assert.equal(createPlan.action, "create");

    const unchanged = planProductionOrderPreview({
      row: mapped.row,
      existing: {
        externalId: 30347,
        payloadHash: mapped.row.payloadHash,
      },
      links: planProductionOrderLinksPreview({
        incomingItemIds: [11324],
        existingCurrentItemIds: [11324],
        resolvedFullyCount: 0,
        unresolvedCount: 1,
      }),
    });
    assert.equal(unchanged.action, "unchanged");

    const updated = planProductionOrderPreview({
      row: mapped.row,
      existing: { externalId: 30347, payloadHash: "other" },
      links: planProductionOrderLinksPreview({
        incomingItemIds: [],
        existingCurrentItemIds: [11324],
        resolvedFullyCount: 0,
        unresolvedCount: 0,
      }),
    });
    assert.equal(updated.action, "update");
    assert.equal(updated.links.linksToDeactivate, 1);

    const summary = buildProductionOrdersPreviewSummary({
      pagesRead: 1,
      recordsReceived: 1,
      plans: [createPlan, unchanged, updated],
      rateLimitCount: 2,
      errors: 0,
      durationMs: 12,
      filters: {
        strategy: "point",
        names: ["OP 05800 - 003"],
        externalIds: [30347],
        salesOrderExternalIds: [],
        from: null,
        to: null,
        dateField: "dataAlteracao",
        startPage: 1,
        maxPages: 5,
        pageSize: 50,
        queries: ['nome=="OP 05800 - 003"'],
      },
    });
    assert.equal(summary.mode, "preview");
    assert.equal(summary.dryRunBanner, PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER);
    assert.equal(summary.created, 1);
    assert.equal(summary.updated, 1);
    assert.equal(summary.unchanged, 1);
    assert.equal(summary.rateLimitCount, 2);
    assert.equal(summary.duration, 12);
  });
});

describe("runNomusProductionOrdersPreview — DRY RUN sem gravação", () => {
  it("não altera OP, vínculos, SyncState nem registros de negócio", async () => {
    const writes: string[] = [];
    const forbidWrite = (label: string) => async () => {
      writes.push(label);
      throw new Error(`write attempted: ${label}`);
    };

    const prisma = {
      nomusProductionOrder: {
        findMany: async () => [
          {
            externalId: 30347,
            payloadHash: stableNomusProductionOrderPayloadHash(
              NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE
            ),
          },
        ],
        create: forbidWrite("nomusProductionOrder.create"),
        update: forbidWrite("nomusProductionOrder.update"),
        upsert: forbidWrite("nomusProductionOrder.upsert"),
        delete: forbidWrite("nomusProductionOrder.delete"),
        deleteMany: forbidWrite("nomusProductionOrder.deleteMany"),
        updateMany: forbidWrite("nomusProductionOrder.updateMany"),
      },
      nomusProductionOrderSalesLink: {
        findMany: async () => [
          {
            productionOrderExternalId: 30347,
            externalSalesOrderItemId: 999,
            isCurrent: true,
          },
        ],
        create: forbidWrite("nomusProductionOrderSalesLink.create"),
        update: forbidWrite("nomusProductionOrderSalesLink.update"),
        updateMany: forbidWrite("nomusProductionOrderSalesLink.updateMany"),
        deleteMany: forbidWrite("nomusProductionOrderSalesLink.deleteMany"),
      },
      salesOrder: {
        findMany: async () => [{ externalSalesOrderId: 2530 }],
        create: forbidWrite("salesOrder.create"),
        update: forbidWrite("salesOrder.update"),
      },
      salesOrderItem: {
        findMany: async () => [{ nomusItemExternalId: 11324 }],
        create: forbidWrite("salesOrderItem.create"),
        update: forbidWrite("salesOrderItem.update"),
      },
      syncState: {
        findMany: async () => [],
        upsert: forbidWrite("syncState.upsert"),
        update: forbidWrite("syncState.update"),
        create: forbidWrite("syncState.create"),
      },
      $transaction: forbidWrite("$transaction"),
    };

    const readOnly = createProductionOrdersPreviewReadOnlyPrisma(prisma as never);
    assert.throws(() => readOnly.nomusProductionOrder.create({} as never));
    assert.throws(() => readOnly.nomusProductionOrderSalesLink.updateMany({} as never));
    assert.throws(() => readOnly.syncState.upsert({} as never));
    assert.throws(() => readOnly.salesOrder.update({} as never));
    assert.throws(() => readOnly.$transaction(async () => null));

    const client = createNomusProductionOrdersClient({
      baseUrl: "https://nomus.test/rest/",
      pageSize: 50,
      maxPages: 1,
      logger: () => undefined,
      sleepFn: async () => undefined,
      fetchJson: async () => [NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE],
    });

    const summary = await runNomusProductionOrdersPreview({
      argv: ["preview", '--name=OP 05800 - 003', "--max-pages=1"],
      deps: {
        client,
        logger: () => undefined,
        readModel: {
          findExistingOrders: async () => [
            {
              externalId: 30347,
              payloadHash: stableNomusProductionOrderPayloadHash(
                NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE
              ),
            },
          ],
          findExistingCurrentLinks: async () => [
            {
              productionOrderExternalId: 30347,
              externalSalesOrderItemId: 999,
              isCurrent: true,
            },
          ],
          findLocalSalesOrderExternalIds: async () => new Set([2530]),
          findLocalSalesOrderItemExternalIds: async () => new Set([11324]),
        },
      },
    });

    assert.equal(summary.mode, "preview");
    assert.equal(summary.dryRunBanner, PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER);
    assert.equal(summary.recordsReceived, 1);
    assert.equal(summary.unchanged, 1);
    assert.equal(summary.linkedRows, 1);
    assert.equal(summary.locallyResolved, 1);
    assert.equal(summary.unresolved, 0);
    assert.equal(summary.linksToDeactivate, 1);
    assert.equal(summary.filters.names[0], "OP 05800 - 003");
    assert.equal(writes.length, 0);
    assert.ok(mappedQtyStillOk());
  });
});

function mappedQtyStillOk() {
  const mapped = mapNomusProductionOrderForPersist(NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE);
  return (
    mapped.ok &&
    mapped.row.quantity != null &&
    mapped.row.quantity.equals(new Prisma.Decimal(15400))
  );
}
