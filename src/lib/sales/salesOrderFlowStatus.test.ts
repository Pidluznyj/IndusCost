import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSalesOrderFlowEngineStatus,
  type SalesOrderFlowStatusDb,
} from "./salesOrderFlowStatus.server.js";
import {
  SALES_ORDER_FLOW_ENABLED_ENV,
  SALES_ORDER_FLOW_FEATURE_RESOURCE,
} from "./salesOrderFlowFeatureFlags.js";
import { SALES_ORDER_FLOW_COMPUTATION_VERSION } from "./salesOrderFlowFingerprint.js";

function createStatusDb(options?: { withFailure?: boolean }) {
  return {
    salesOrderFlowSnapshot: {
      count: async (args?: {
        where?: {
          computationVersion?: { not: string };
          inconsistentItems?: { gt: number };
        };
      }) => {
        if (args?.where?.computationVersion) return 1;
        if (args?.where?.inconsistentItems) return 2;
        return 5;
      },
      aggregate: async (args: {
        _max?: { computedAt: boolean };
        _sum?: { inconsistentItems: boolean };
      }) => {
        if (args._max) {
          return { _max: { computedAt: new Date("2026-07-17T12:00:00Z") } };
        }
        return { _sum: { inconsistentItems: 3 } };
      },
      groupBy: async () => [
        {
          computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
          _count: { _all: 4 },
        },
        {
          computationVersion: "legacy/v0",
          _count: { _all: 1 },
        },
      ],
    },
    salesOrderItemFlowSnapshot: {
      count: async () => 12,
    },
    salesOrderFlowEvent: {
      count: async () => 20,
    },
    integrationRun: {
      findFirst: async () =>
        options?.withFailure
          ? {
              target: "sales-order-flow-recompute:nfes",
              status: "PARTIAL",
              finishedAt: new Date("2026-07-17T13:00:00Z"),
              createdAt: new Date("2026-07-17T12:59:00Z"),
              errorMessage: null,
              summaryJson: {
                summary: {
                  failures: [
                    { salesOrderId: "a", message: "x" },
                    { salesOrderId: "b", message: "y" },
                  ],
                },
              },
            }
          : null,
    },
  } as unknown as SalesOrderFlowStatusDb;
}

describe("salesOrderFlowStatus (OP-58)", () => {
  it("expõe versão, snapshots, inconsistências e falha conhecida", async () => {
    const status = await buildSalesOrderFlowEngineStatus(
      createStatusDb({ withFailure: true }),
      {
        env: { [SALES_ORDER_FLOW_ENABLED_ENV]: "true" },
        now: () => new Date("2026-07-17T14:00:00Z"),
        exists: () => false,
      }
    );

    assert.equal(status.feature.resource, SALES_ORDER_FLOW_FEATURE_RESOURCE);
    assert.equal(status.feature.enabled, true);
    assert.equal(status.feature.defaultWhenAbsent, false);
    assert.equal(
      status.computation.expectedVersion,
      SALES_ORDER_FLOW_COMPUTATION_VERSION
    );
    assert.equal(
      status.computation.latestRecomputedAt,
      "2026-07-17T12:00:00.000Z"
    );
    assert.equal(status.computation.versionMismatchCount, 1);
    assert.deepEqual(status.snapshots, {
      orders: 5,
      items: 12,
      events: 20,
      ordersWithInconsistencies: 2,
      inconsistentItems: 3,
    });
    assert.equal(status.latestKnownFailure?.status, "PARTIAL");
    assert.equal(status.latestKnownFailure?.failedOrders, 2);
  });

  it("flag ausente fica desligada sem impedir o status administrativo", async () => {
    const status = await buildSalesOrderFlowEngineStatus(createStatusDb(), {
      env: {},
      exists: () => false,
    });
    assert.equal(status.feature.enabled, false);
    assert.equal(status.latestKnownFailure, null);
  });

  it("expõe estado sanitizado do rebuild quando disponível", async () => {
    const files = new Map<string, string>([
      [
        "checkpoint",
        JSON.stringify({
          version: 1,
          lastSalesOrderId: "order-id",
          lastOrderCode: "PD 02596",
          batchesCompleted: 4,
          ordersProcessed: 200,
          updatedAt: "2026-07-17T13:30:00.000Z",
        }),
      ],
      [
        "lock",
        JSON.stringify({
          version: 1,
          token: "secret-token",
          pid: 123,
          mode: "apply",
          startedAt: "2026-07-17T13:40:00.000Z",
          hostname: "internal-host",
        }),
      ],
    ]);

    const status = await buildSalesOrderFlowEngineStatus(createStatusDb(), {
      env: {
        SALES_ORDER_FLOW_REBUILD_CHECKPOINT_FILE: "checkpoint",
        SALES_ORDER_FLOW_REBUILD_LOCK_FILE: "lock",
      },
      projectRoot: ".",
      exists: (path) => files.has(path.endsWith("checkpoint") ? "checkpoint" : "lock"),
      readText: (path) =>
        files.get(path.endsWith("checkpoint") ? "checkpoint" : "lock")!,
      isPidAlive: (pid) => pid === 123,
    });

    assert.equal(status.rebuild.available, true);
    assert.equal(status.rebuild.active, true);
    assert.equal(status.rebuild.mode, "apply");
    assert.equal(status.rebuild.checkpoint?.lastOrderCode, "PD 02596");
    const json = JSON.stringify(status.rebuild);
    assert.doesNotMatch(json, /secret-token|internal-host/);
  });
});
