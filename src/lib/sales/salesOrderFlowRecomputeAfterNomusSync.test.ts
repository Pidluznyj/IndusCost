import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSalesOrderFlowRecomputeAfterSyncTrigger,
  dedupeSalesOrderFlowOrderIds,
  hasSalesOrderFlowRecomputeTriggerTargets,
  isSalesOrderFlowRecomputeAfterSyncEnabled,
  mergeSalesOrderFlowOrderIdBatches,
  SALES_ORDER_FLOW_RECOMPUTE_AFTER_SYNC_ENV,
} from "./salesOrderFlowRecomputeAfterNomusSync.js";
import {
  resolveSalesOrderIdsFromProductionOrderExternalIds,
  resolveSalesOrderIdsFromStockDocumentExternalIds,
  runSalesOrderFlowRecomputeAfterNomusSync,
} from "./salesOrderFlowRecomputeAfterNomusSync.server.js";
import type { RecomputeSalesOrderFlowResult } from "./salesOrderFlowRecompute.server.js";

const ORDER_A = "11111111-1111-4111-8111-111111111111";
const ORDER_B = "22222222-2222-4222-8222-222222222222";
const ORDER_C = "33333333-3333-4333-8333-333333333333";

function okResult(id: string): RecomputeSalesOrderFlowResult {
  return {
    salesOrderId: id,
    orderCode: null,
    action: "unchanged",
    reason: "fingerprint_match",
    computationVersion: "sales-order-flow/v1",
    orderFingerprint: "fp",
    previousOrderStage: null,
    currentOrderStage: "WAITING_NFE",
    computedAt: null,
    items: { total: 0, upserted: 0, created: 0, updated: 0, deleted: 0 },
    events: { attempted: 0, created: 0, duplicates: 0 },
    skippedWrite: true,
    observability: {
      salesOrderId: id,
      orderCode: null,
      previousStage: null,
      currentStage: "WAITING_NFE",
      reason: "fingerprint_match",
      computationVersion: "sales-order-flow/v1",
      sourceFingerprint: "fp".slice(0, 12),
      action: "unchanged",
      source: "post-sync",
      durationMs: 1,
      metrics: {
        ordersEvaluated: 1,
        itemsEvaluated: 0,
        snapshotsCreated: 0,
        snapshotsUpdated: 0,
        unchanged: 1,
        eventsCreated: 0,
        inconsistencies: 0,
        failures: 0,
        durationMs: 1,
        computationVersion: "sales-order-flow/v1",
        source: "post-sync",
      },
    },
  };
}

describe("salesOrderFlowRecomputeAfterNomusSync (OP-57)", () => {
  it("flag default on; desliga com false", () => {
    assert.equal(isSalesOrderFlowRecomputeAfterSyncEnabled({}), true);
    assert.equal(
      isSalesOrderFlowRecomputeAfterSyncEnabled({
        [SALES_ORDER_FLOW_RECOMPUTE_AFTER_SYNC_ENV]: "false",
      }),
      false
    );
  });

  it("deduplica orderIds na mesma execução", () => {
    assert.deepEqual(
      dedupeSalesOrderFlowOrderIds([ORDER_A, ORDER_A, ORDER_B, ORDER_A]),
      [ORDER_A, ORDER_B]
    );
    assert.deepEqual(
      mergeSalesOrderFlowOrderIdBatches(
        [ORDER_A, ORDER_B],
        [ORDER_B, ORDER_C],
        [ORDER_A]
      ),
      [ORDER_A, ORDER_B, ORDER_C]
    );
  });

  it("origem sales-orders: recomputa IDs afetados", async () => {
    const calls: string[] = [];
    const result = await runSalesOrderFlowRecomputeAfterNomusSync(
      {} as never,
      buildSalesOrderFlowRecomputeAfterSyncTrigger({
        source: "sales-orders",
        syncMode: "apply",
        salesOrderIds: [ORDER_A, ORDER_A, ORDER_B],
      }),
      {
        env: { [SALES_ORDER_FLOW_RECOMPUTE_AFTER_SYNC_ENV]: "true" },
        resolveOrderIds: async (_db, trigger) =>
          dedupeSalesOrderFlowOrderIds(trigger.salesOrderIds ?? []),
        recompute: async (_db, id) => {
          calls.push(id);
          return okResult(id);
        },
        persistAudit: async () => {},
      }
    );
    assert.equal(result.skipped, false);
    assert.deepEqual(calls, [ORDER_A, ORDER_B]);
    assert.equal(result.summary?.ordersProcessed, 2);
  });

  it("origem nfes: resolve via nfeIds", async () => {
    const result = await runSalesOrderFlowRecomputeAfterNomusSync(
      {} as never,
      buildSalesOrderFlowRecomputeAfterSyncTrigger({
        source: "nfes",
        syncMode: "apply",
        nfeIds: [100, 100, 200],
      }),
      {
        env: { [SALES_ORDER_FLOW_RECOMPUTE_AFTER_SYNC_ENV]: "true" },
        resolveOrderIds: async (_db, trigger) => {
          assert.deepEqual(trigger.nfeIds, [100, 200]);
          return [ORDER_A];
        },
        recompute: async (_db, id) => okResult(id),
        persistAudit: async () => {},
      }
    );
    assert.equal(result.summary?.ordersSelected, 1);
  });

  it("origem production-orders: resolve via OP externa", async () => {
    const db = {
      nomusProductionOrderSalesLink: {
        findMany: async () => [
          { salesOrderId: ORDER_A },
          { salesOrderId: ORDER_A },
          { salesOrderId: ORDER_B },
          { salesOrderId: null },
        ],
      },
    };
    const ids = await resolveSalesOrderIdsFromProductionOrderExternalIds(
      db as never,
      [501, 501]
    );
    assert.deepEqual(ids, [ORDER_A, ORDER_B]);
  });

  it("origem stock-documents: resolve via idNfe + O2C", async () => {
    const db = {
      nomusStockDocument: {
        findMany: async () => [
          { externalId: 9, idNfe: 77 },
          { externalId: 10, idNfe: null },
        ],
      },
      salesOrderNfeLink: {
        findMany: async () => [{ salesOrderId: ORDER_A, nfeExternalId: 77 }],
      },
      orderToCashAuditFact: {
        findMany: async () => [
          { salesOrderId: ORDER_B },
          { salesOrderId: ORDER_A },
        ],
      },
    };
    const ids = await resolveSalesOrderIdsFromStockDocumentExternalIds(
      db as never,
      [9, 10]
    );
    assert.deepEqual(ids.sort(), [ORDER_A, ORDER_B].sort());
  });

  it("origem cut-fulfillment-cancel (via salesOrderIds) e links", async () => {
    for (const source of [
      "cut-fulfillment-cancel",
      "sales-order-nfe-links",
      "production-order-sales-links",
    ] as const) {
      const trigger = buildSalesOrderFlowRecomputeAfterSyncTrigger({
        source,
        syncMode: "apply",
        salesOrderIds: [ORDER_C],
      });
      assert.equal(hasSalesOrderFlowRecomputeTriggerTargets(trigger), true);
      const result = await runSalesOrderFlowRecomputeAfterNomusSync(
        {} as never,
        trigger,
        {
          env: { [SALES_ORDER_FLOW_RECOMPUTE_AFTER_SYNC_ENV]: "true" },
          resolveOrderIds: async () => [ORDER_C],
          recompute: async (_db, id) => okResult(id),
          persistAudit: async () => {},
        }
      );
      assert.equal(result.summary?.ordersProcessed, 1);
    }
  });

  it("falha isolada é registrada e não propaga", async () => {
    const result = await runSalesOrderFlowRecomputeAfterNomusSync(
      {} as never,
      buildSalesOrderFlowRecomputeAfterSyncTrigger({
        source: "sales-orders",
        syncMode: "apply",
        salesOrderIds: [ORDER_A, ORDER_B],
      }),
      {
        env: { [SALES_ORDER_FLOW_RECOMPUTE_AFTER_SYNC_ENV]: "true" },
        resolveOrderIds: async () => [ORDER_A, ORDER_B],
        recompute: async (_db, id) => {
          if (id === ORDER_A) throw new Error("boom");
          return okResult(id);
        },
        persistAudit: async () => {},
      }
    );
    assert.equal(result.error, undefined);
    assert.equal(result.summary?.errors, 1);
    assert.equal(result.summary?.failures[0]?.salesOrderId, ORDER_A);
    assert.equal(result.summary?.ordersProcessed, 1);
  });

  it("execução sem pedidos afetados é skipped", async () => {
    const result = await runSalesOrderFlowRecomputeAfterNomusSync(
      {} as never,
      buildSalesOrderFlowRecomputeAfterSyncTrigger({
        source: "nfes",
        syncMode: "apply",
      }),
      {
        env: { [SALES_ORDER_FLOW_RECOMPUTE_AFTER_SYNC_ENV]: "true" },
        recompute: async () => {
          throw new Error("não deve recomputar");
        },
        persistAudit: async () => {},
      }
    );
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "no_affected_targets");
  });

  it("preview/dry não recomputa", async () => {
    const result = await runSalesOrderFlowRecomputeAfterNomusSync(
      {} as never,
      buildSalesOrderFlowRecomputeAfterSyncTrigger({
        source: "sales-orders",
        syncMode: "preview",
        salesOrderIds: [ORDER_A],
      }),
      {
        env: { [SALES_ORDER_FLOW_RECOMPUTE_AFTER_SYNC_ENV]: "true" },
        recompute: async () => {
          throw new Error("não deve recomputar");
        },
        persistAudit: async () => {},
      }
    );
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, "not_apply_mode");
  });
});
