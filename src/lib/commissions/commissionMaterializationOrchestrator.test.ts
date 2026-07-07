import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommissionOrderMaterializationResult } from "./commissionOrderMaterializer.js";
import type { CommissionReceivableScheduleRebuildResult } from "./commissionReceivableScheduler.js";
import {
  aggregateMaterializationRunSummary,
  buildMaterializationRebuildCsv,
  COMMISSION_MATERIALIZATION_REBUILD_CONFIRMATION,
  mergeAffectedSalesOrderRefs,
  parseMaterializationLimit,
  resolveMaterializationDryRun,
  validateMaterializationRebuildApply,
} from "./commissionMaterializationOrchestrator.js";
import {
  rebuildCommissionMaterializationForAffectedSales,
  resolveSalesOrderIdsFromNfeExternalIds,
  resolveSalesOrderIdsFromReceivableExternalIds,
} from "./commissionMaterializationOrchestrator.server.js";

const ORDER_A = "880e8400-e29b-41d4-a716-446655440004";
const ORDER_B = "880e8400-e29b-41d4-a716-446655440005";
const ORDER_C = "880e8400-e29b-41d4-a716-446655440006";

function snapshotResult(
  overrides: Partial<CommissionOrderMaterializationResult> = {}
): CommissionOrderMaterializationResult {
  return {
    action: "created",
    snapshotId: "snap-1",
    previousSnapshotId: null,
    sourceHash: "hash-1",
    dryRun: false,
    preview: {
      salesOrderId: ORDER_A,
      nfeId: 1001,
      sourceHash: "hash-1",
      totalSoldAmount: 10000,
      totalGrossCommissionAmount: 160,
      totalFinalCommissionAmount: 160,
      items: [],
    },
    ...overrides,
  };
}

function scheduleResult(
  overrides: Partial<CommissionReceivableScheduleRebuildResult> = {}
): CommissionReceivableScheduleRebuildResult {
  return {
    action: "created",
    orderSnapshotId: "snap-1",
    schedulesCreated: 2,
    schedulesSuperseded: 0,
    schedulesStaled: 0,
    schedulesUnchanged: 0,
    dryRun: false,
    preview: [
      {
        orderSnapshotId: "snap-1",
        receivableId: 1,
        receivableCode: "CR-1",
        installmentNumber: 1,
        nfeId: 1001,
        salesOrderId: ORDER_A,
        customerId: "cust-1",
        canonicalSellerId: "seller-1",
        receivableNominalAmount: 5000,
        receivableSharePercent: 50,
        scheduledCommissionAmount: 80,
        status: "ACTIVE",
        sourceHash: "sched-hash",
      },
    ],
    ...overrides,
  };
}

function mockDb(overrides: Record<string, unknown> = {}) {
  return {
    commissionMonthlyClosing: {
      findMany: async () => [],
    },
    commissionOrderSnapshot: {
      count: async () => 1,
    },
    commissionReceivableSchedule: {
      count: async () => 2,
    },
    salesOrderNfeLink: {
      findMany: async () => [],
    },
    ...overrides,
  };
}

function orderRow(
  partial: Partial<import("./commissionMaterializationOrchestrator.js").CommissionMaterializationOrderResult>
): import("./commissionMaterializationOrchestrator.js").CommissionMaterializationOrderResult {
  return {
    salesOrderId: ORDER_A,
    sources: ["SALES_ORDER"],
    snapshotAction: "created",
    scheduleAction: "created",
    snapshotId: "s1",
    schedulesCreated: 2,
    schedulesSuperseded: 0,
    schedulesStaled: 0,
    schedulesUnchanged: 0,
    changed: true,
    excludedCustomerItems: 0,
    unresolvedSeller: false,
    receivablesWithoutLink: 0,
    ...partial,
  };
}

describe("commissionMaterializationOrchestrator", () => {
  it("receivable alterado identifica pedido afetado", async () => {
    const db = {
      nomusAccountsReceivable: {
        findMany: async () => [{ externalId: 9001, sourceInvoiceId: 555 }],
      },
      salesOrderNfeLink: {
        findMany: async () => [{ salesOrderId: ORDER_A, nfeExternalId: 555 }],
      },
    };

    const refs = await resolveSalesOrderIdsFromReceivableExternalIds(db as never, [9001]);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].salesOrderId, ORDER_A);
    assert.deepEqual(refs[0].sources, ["RECEIVABLE"]);
  });

  it("NF alterada identifica pedido afetado", async () => {
    const db = {
      salesOrderNfeLink: {
        findMany: async () => [{ salesOrderId: ORDER_B, nfeExternalId: 777 }],
      },
    };

    const refs = await resolveSalesOrderIdsFromNfeExternalIds(db as never, [777]);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].salesOrderId, ORDER_B);
    assert.deepEqual(refs[0].sources, ["NFE"]);
  });

  it("pedido alterado recalcula snapshot e schedule", async () => {
    const calls: string[] = [];
    const db = mockDb();

    const summary = await rebuildCommissionMaterializationForAffectedSales(
      db as never,
      { salesOrderIds: [ORDER_A], apply: true },
      {
        materialize: async (_db, input) => {
          calls.push(`materialize:${input.salesOrderId}:${input.dryRun}`);
          return snapshotResult({ action: "superseded" });
        },
        rebuildSchedule: async (_db, input) => {
          calls.push(`schedule:${input.salesOrderId}:${input.dryRun}`);
          return scheduleResult({ action: "updated", schedulesSuperseded: 1 });
        },
      }
    );

    assert.deepEqual(calls, [`materialize:${ORDER_A}:false`, `schedule:${ORDER_A}:false`]);
    assert.equal(summary.ordersProcessed, 1);
    assert.equal(summary.snapshotsSuperseded, 1);
    assert.equal(summary.snapshotsUpdated, 1);
    assert.equal(summary.schedulesUpdated, 1);
    assert.equal(summary.ordersChanged, 1);
    assert.equal(summary.orders[0].snapshotAction, "superseded");
    assert.equal(summary.orders[0].scheduleAction, "updated");
  });

  it("preview não grava", async () => {
    const db = mockDb();
    const summary = await rebuildCommissionMaterializationForAffectedSales(
      db as never,
      { salesOrderIds: [ORDER_A], preview: true },
      {
        materialize: async (_db, input) => {
          assert.equal(input.dryRun, true);
          return snapshotResult({ action: "unchanged", dryRun: true });
        },
        rebuildSchedule: async (_db, input) => {
          assert.equal(input.dryRun, true);
          return scheduleResult({ action: "unchanged", dryRun: true, schedulesUnchanged: 2 });
        },
      }
    );

    assert.equal(summary.dryRun, true);
    assert.equal(summary.snapshotsUnchanged, 1);
    assert.equal(summary.schedulesUnchanged, 2);
    assert.equal(summary.ordersChanged, 0);
  });

  it("apply sem confirm bloqueia na validação CLI", () => {
    const blocked = validateMaterializationRebuildApply({ apply: true, confirm: "errado" });
    assert.equal(blocked.ok, false);
    const allowed = validateMaterializationRebuildApply({
      apply: true,
      confirm: COMMISSION_MATERIALIZATION_REBUILD_CONFIRMATION,
    });
    assert.equal(allowed.ok, true);
  });

  it("apply com confirm grava", async () => {
    const db = mockDb();
    const summary = await rebuildCommissionMaterializationForAffectedSales(
      db as never,
      { salesOrderIds: [ORDER_A], apply: true },
      {
        materialize: async (_db, input) => {
          assert.equal(input.dryRun, false);
          return snapshotResult();
        },
        rebuildSchedule: async (_db, input) => {
          assert.equal(input.dryRun, false);
          return scheduleResult();
        },
      }
    );

    assert.equal(summary.dryRun, false);
    assert.equal(summary.snapshotsCreated, 1);
    assert.equal(summary.schedulesCreated, 2);
  });

  it("limit funciona", async () => {
    const processed: string[] = [];
    const db = mockDb();
    const summary = await rebuildCommissionMaterializationForAffectedSales(
      db as never,
      {
        salesOrderIds: [ORDER_A, ORDER_B, ORDER_C],
        limit: 2,
        preview: true,
      },
      {
        materialize: async (_db, input) => {
          processed.push(input.salesOrderId);
          return snapshotResult({ preview: { ...snapshotResult().preview, salesOrderId: input.salesOrderId } });
        },
        rebuildSchedule: async () => scheduleResult({ action: "unchanged", schedulesUnchanged: 1 }),
      }
    );

    assert.equal(processed.length, 2);
    assert.equal(summary.ordersEvaluated, 2);
    assert.equal(summary.limit, 2);
  });

  it("fechamento fechado é preservado", async () => {
    const closing = {
      id: "closing-1",
      year: 2026,
      month: 6,
    };
    const db = mockDb({
      nomusAccountsReceivable: {
        findMany: async () => [],
      },
      commissionMonthlyClosing: {
        findMany: async () => [closing],
        update: async () => {
          throw new Error("fechamento não deve ser alterado");
        },
      },
    });

    const summary = await rebuildCommissionMaterializationForAffectedSales(
      db as never,
      { salesOrderIds: [ORDER_A], year: 2026, month: 6, apply: true },
      {
        materialize: async () => snapshotResult(),
        rebuildSchedule: async () => scheduleResult(),
      }
    );

    assert.equal(summary.closedClosingsPreserved.length, 1);
    assert.equal(summary.closedClosingsPreserved[0].closingId, "closing-1");
    assert.equal(summary.ordersProcessed, 1);
  });

  it("CSV é gerado com colunas esperadas", () => {
    const summary = aggregateMaterializationRunSummary({
      dryRun: true,
      since: new Date("2026-06-01T00:00:00.000Z"),
      orders: [
        orderRow({ salesOrderId: ORDER_A }),
        orderRow({
          salesOrderId: ORDER_B,
          snapshotAction: "unchanged",
          scheduleAction: "unchanged",
          changed: false,
        }),
      ],
    });
    const csv = buildMaterializationRebuildCsv(summary);
    assert.match(csv, /salesOrderId,sources,changed/);
    assert.match(csv, new RegExp(ORDER_A));
    assert.match(csv, /yes/);
  });

  it("mergeAffectedSalesOrderRefs deduplica fontes", () => {
    const merged = mergeAffectedSalesOrderRefs([
      { salesOrderId: ORDER_A, sources: ["SALES_ORDER"] },
      { salesOrderId: ORDER_A, sources: ["RECEIVABLE"] },
      { salesOrderId: ORDER_B, sources: ["NFE"] },
    ]);

    assert.equal(merged.length, 2);
    assert.deepEqual(merged[0].sources, ["SALES_ORDER", "RECEIVABLE"]);
    assert.throws(() => resolveMaterializationDryRun({ preview: true, apply: true }));
    assert.equal(parseMaterializationLimit("25"), 25);
  });

  it("mergeAffectedSalesOrderRefs une nfeIds por pedido", () => {
    const merged = mergeAffectedSalesOrderRefs([
      { salesOrderId: ORDER_A, sources: ["RECEIVABLE"], nfeIds: [1001] },
      { salesOrderId: ORDER_A, sources: ["NFE"], nfeIds: [1002, 1001] },
    ]);
    assert.equal(merged.length, 1);
    assert.deepEqual(merged[0].nfeIds, [1001, 1002]);
  });

  it("aggregateMaterializationRunSummary soma totais e issues", () => {
    const summary = aggregateMaterializationRunSummary({
      dryRun: false,
      since: new Date("2026-06-01T00:00:00.000Z"),
      orders: [
        orderRow({
          salesOrderId: ORDER_A,
          excludedCustomerItems: 2,
          unresolvedSeller: true,
          receivablesWithoutLink: 1,
        }),
        orderRow({
          salesOrderId: ORDER_B,
          snapshotAction: "unchanged",
          scheduleAction: "unchanged",
          changed: false,
          schedulesCreated: 0,
          schedulesUnchanged: 3,
        }),
      ],
    });

    assert.equal(summary.snapshotsCreated, 1);
    assert.equal(summary.snapshotsUnchanged, 1);
    assert.equal(summary.schedulesCreated, 2);
    assert.equal(summary.schedulesUnchanged, 3);
    assert.equal(summary.ordersChanged, 1);
    assert.equal(summary.excludedCustomers, 1);
    assert.equal(summary.unresolvedSellers, 1);
    assert.equal(summary.receivablesWithoutLink, 1);
  });
});
