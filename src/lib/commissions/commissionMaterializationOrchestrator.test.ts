import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommissionOrderMaterializationResult } from "./commissionOrderMaterializer.js";
import type { CommissionReceivableScheduleRebuildResult } from "./commissionReceivableScheduler.js";
import {
  aggregateMaterializationRunSummary,
  mergeAffectedSalesOrderRefs,
  resolveMaterializationDryRun,
} from "./commissionMaterializationOrchestrator.js";
import {
  rebuildCommissionMaterializationForAffectedSales,
  resolveSalesOrderIdsFromNfeExternalIds,
  resolveSalesOrderIdsFromReceivableExternalIds,
} from "./commissionMaterializationOrchestrator.server.js";

const ORDER_A = "880e8400-e29b-41d4-a716-446655440004";
const ORDER_B = "880e8400-e29b-41d4-a716-446655440005";

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
    preview: [],
    ...overrides,
  };
}

describe("commissionMaterializationOrchestrator", () => {
  it("receivable alterado identifica pedido afetado", async () => {
    const db = {
      nomusAccountsReceivable: {
        findMany: async () => [{ externalId: 9001, sourceInvoiceId: 555 }],
      },
      salesOrderNfeLink: {
        findMany: async () => [{ salesOrderId: ORDER_A }],
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
    const db = {} as never;

    const summary = await rebuildCommissionMaterializationForAffectedSales(
      db,
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
    assert.equal(summary.schedulesUpdated, 1);
    assert.equal(summary.orders[0].snapshotAction, "superseded");
    assert.equal(summary.orders[0].scheduleAction, "updated");
  });

  it("preview não grava", async () => {
    const db = {} as never;
    const summary = await rebuildCommissionMaterializationForAffectedSales(
      db,
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
  });

  it("apply grava", async () => {
    const db = {} as never;
    const summary = await rebuildCommissionMaterializationForAffectedSales(
      db,
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

  it("fechamento fechado não é alterado", async () => {
    const closing = {
      id: "closing-1",
      year: 2026,
      month: 6,
      status: "CLOSED",
      source: "RECEIPT_BASED",
      calculationHash: "closed-hash",
      lineCount: 3,
    };
    const db = {
      commissionMonthlyClosing: {
        findMany: async () => [closing],
        update: async () => {
          throw new Error("fechamento não deve ser alterado");
        },
        updateMany: async () => {
          throw new Error("fechamento não deve ser alterado");
        },
        create: async () => {
          throw new Error("fechamento não deve ser alterado");
        },
      },
    };

    const summary = await rebuildCommissionMaterializationForAffectedSales(
      db as never,
      { salesOrderIds: [ORDER_A], apply: true },
      {
        materialize: async () => snapshotResult(),
        rebuildSchedule: async () => scheduleResult(),
      }
    );

    const closings = await db.commissionMonthlyClosing.findMany();
    assert.equal(closings[0].status, "CLOSED");
    assert.equal(closings[0].calculationHash, "closed-hash");
    assert.equal(summary.ordersProcessed, 1);
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
  });

  it("aggregateMaterializationRunSummary soma totais", () => {
    const summary = aggregateMaterializationRunSummary({
      dryRun: false,
      since: new Date("2026-06-01T00:00:00.000Z"),
      orders: [
        {
          salesOrderId: ORDER_A,
          sources: ["SALES_ORDER"],
          snapshotAction: "created",
          scheduleAction: "created",
          snapshotId: "s1",
          schedulesCreated: 2,
          schedulesSuperseded: 0,
          schedulesStaled: 0,
          schedulesUnchanged: 0,
        },
        {
          salesOrderId: ORDER_B,
          sources: ["NFE"],
          snapshotAction: "unchanged",
          scheduleAction: "unchanged",
          snapshotId: "s2",
          schedulesCreated: 0,
          schedulesSuperseded: 0,
          schedulesStaled: 0,
          schedulesUnchanged: 3,
        },
      ],
    });

    assert.equal(summary.snapshotsCreated, 1);
    assert.equal(summary.snapshotsUnchanged, 1);
    assert.equal(summary.schedulesCreated, 2);
    assert.equal(summary.schedulesUnchanged, 3);
  });
});
