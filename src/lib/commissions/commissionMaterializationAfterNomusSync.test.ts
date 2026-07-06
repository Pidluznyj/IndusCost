import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNomusSyncMaterializationTrigger,
  extractReceivableIdsFromAccountsReceivableSyncPayload,
  extractSalesOrderIdsFromSalesOrdersSyncPayload,
  isCommissionMaterializationAfterSyncEnabled,
} from "./commissionMaterializationAfterNomusSync.js";
import { runCommissionMaterializationAfterNomusSync } from "./commissionMaterializationAfterNomusSync.server.js";

const ORDER_ID = "880e8400-e29b-41d4-a716-446655440004";

describe("commissionMaterializationAfterNomusSync", () => {
  it("sync de pedido extrai salesOrderIds afetados", () => {
    const ids = extractSalesOrderIdsFromSalesOrdersSyncPayload({
      applied: { affectedSalesOrderIds: [ORDER_ID] },
      summary: { changedOrders: [{ id: "other-id" }] },
    });
    assert.deepEqual(ids, [ORDER_ID, "other-id"]);
  });

  it("sync de AR extrai receivableIds afetados", () => {
    const ids = extractReceivableIdsFromAccountsReceivableSyncPayload({
      applied: { affectedReceivableIds: [9001, 9002] },
    });
    assert.deepEqual(ids, [9001, 9002]);
  });

  it("sync de pedido chama materialização com IDs afetados", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const db = {} as never;
    const previous = process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC;
    process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC = "true";

    try {
      await runCommissionMaterializationAfterNomusSync(
        db,
        buildNomusSyncMaterializationTrigger({
          source: "sales-orders",
          syncMode: "apply",
          salesOrderIds: [ORDER_ID],
        }),
        {
          rebuild: async (_db, input) => {
            calls.push(input);
            return {
              dryRun: false,
              since: null,
              ordersProcessed: 1,
              snapshotsCreated: 1,
              snapshotsUnchanged: 0,
              snapshotsSuperseded: 0,
              schedulesCreated: 2,
              schedulesUpdated: 0,
              schedulesStaled: 0,
              schedulesUnchanged: 0,
              errors: [],
              orders: [],
            };
          },
          resolveCustomerSalesOrderIds: async () => [],
          persistAudit: async () => {},
        }
      );
    } finally {
      if (previous == null) delete process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC;
      else process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC = previous;
    }

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].salesOrderIds, [ORDER_ID]);
    assert.equal(calls[0].apply, true);
  });

  it("sync de AR chama materialização com receivableIds afetados", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const db = {} as never;
    const previous = process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC;
    process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC = "true";

    try {
      await runCommissionMaterializationAfterNomusSync(
        db,
        buildNomusSyncMaterializationTrigger({
          source: "accounts-receivable",
          syncMode: "apply",
          receivableIds: [7001],
        }),
        {
          rebuild: async (_db, input) => {
            calls.push(input);
            return {
              dryRun: false,
              since: null,
              ordersProcessed: 1,
              snapshotsCreated: 0,
              snapshotsUnchanged: 1,
              snapshotsSuperseded: 0,
              schedulesCreated: 0,
              schedulesUpdated: 1,
              schedulesStaled: 0,
              schedulesUnchanged: 1,
              errors: [],
              orders: [],
            };
          },
          resolveCustomerSalesOrderIds: async () => [],
          persistAudit: async () => {},
        }
      );
    } finally {
      if (previous == null) delete process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC;
      else process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC = previous;
    }

    assert.deepEqual(calls[0]?.receivableIds, [7001]);
  });

  it("erro na materialização é logado e não propagado", async () => {
    const audits: unknown[] = [];
    const db = {} as never;
    const previous = process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC;
    process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC = "true";

    try {
      const result = await runCommissionMaterializationAfterNomusSync(
        db,
        buildNomusSyncMaterializationTrigger({
          source: "sales-orders",
          syncMode: "apply",
          salesOrderIds: [ORDER_ID],
        }),
        {
          rebuild: async () => {
            throw new Error("falha simulada");
          },
          resolveCustomerSalesOrderIds: async () => [],
          persistAudit: async (_db, input) => {
            audits.push(input.result);
          },
        }
      );

      assert.equal(result.error, "falha simulada");
      assert.equal(audits.length, 1);
      assert.equal((audits[0] as { error?: string }).error, "falha simulada");
    } finally {
      if (previous == null) delete process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC;
      else process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC = previous;
    }
  });

  it("flag desligada não executa", async () => {
    const previous = process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC;
    process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC = "false";

    try {
      let called = false;
      const result = await runCommissionMaterializationAfterNomusSync(
        {} as never,
        buildNomusSyncMaterializationTrigger({
          source: "sales-orders",
          syncMode: "apply",
          salesOrderIds: [ORDER_ID],
        }),
        {
          rebuild: async () => {
            called = true;
            throw new Error("não deveria chamar");
          },
          resolveCustomerSalesOrderIds: async () => [],
          persistAudit: async () => {},
        }
      );

      assert.equal(called, false);
      assert.equal(result.enabled, false);
      assert.equal(result.skipped, true);
      assert.equal(result.skipReason, "flag_disabled");
    } finally {
      if (previous == null) delete process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC;
      else process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC = "false";
    }
  });

  it("flag ligada executa", async () => {
    const previous = process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC;
    process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC = "true";
    let called = false;

    try {
      const result = await runCommissionMaterializationAfterNomusSync(
        {} as never,
        buildNomusSyncMaterializationTrigger({
          source: "nfes",
          syncMode: "apply",
          nfeIds: [1001],
        }),
        {
          rebuild: async () => {
            called = true;
            return {
              dryRun: false,
              since: null,
              ordersProcessed: 0,
              snapshotsCreated: 0,
              snapshotsUnchanged: 0,
              snapshotsSuperseded: 0,
              schedulesCreated: 0,
              schedulesUpdated: 0,
              schedulesStaled: 0,
              schedulesUnchanged: 0,
              errors: [],
              orders: [],
            };
          },
          resolveCustomerSalesOrderIds: async () => [],
          persistAudit: async () => {},
        }
      );

      assert.equal(called, true);
      assert.equal(result.skipped, false);
      assert.equal(isCommissionMaterializationAfterSyncEnabled(), true);
    } finally {
      if (previous == null) delete process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC;
      else process.env.COMMISSION_MATERIALIZATION_AFTER_SYNC = previous;
    }
  });
});
