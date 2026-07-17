import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadSalesOrderFlowSummary } from "./salesOrderFlowSummary.server.js";
import type { SalesOrderFlowSummaryDb } from "./salesOrderFlowSummary.server.js";
import { SALES_ORDER_FLOW_SUMMARY_QUERY_BUDGET } from "./salesOrderFlowPerformance.js";

function createDb(options?: {
  groups?: Array<{
    currentStage: string;
    orderCount: number;
    orderValue: number;
    activeResidualValue: number;
  }>;
  counts?: Partial<{
    overdue: number;
    blocked: number;
    inconsistent: number;
    partial: number;
    cut: number;
    canceled: number;
  }>;
}) {
  const calls: Array<{ kind: string; where: unknown }> = [];
  const groups = options?.groups ?? [
    {
      currentStage: "WAITING_RELEASE",
      orderCount: 2,
      orderValue: 200,
      activeResidualValue: 80,
    },
    {
      currentStage: "CANCELED",
      orderCount: 1,
      orderValue: 10,
      activeResidualValue: 0,
    },
  ];
  const counts = {
    overdue: 1,
    blocked: 2,
    inconsistent: 3,
    partial: 4,
    cut: 5,
    canceled: 1,
    ...options?.counts,
  };

  const db = {
    salesOrderFlowSnapshot: {
      groupBy: async (args: { where: unknown }) => {
        calls.push({ kind: "groupBy", where: args.where });
        return groups.map((g) => ({
          currentStage: g.currentStage,
          _count: { _all: g.orderCount },
          _sum: {
            orderValue: g.orderValue,
            activeResidualValue: g.activeResidualValue,
          },
        }));
      },
      count: async (args: { where: unknown }) => {
        const whereJson = JSON.stringify(args.where);
        calls.push({ kind: "count", where: args.where });
        if (whereJson.includes('"isBlocked":true')) return counts.blocked;
        if (whereJson.includes("PARTIAL")) return counts.partial;
        if (whereJson.includes("SHIPPED_COMPLETED")) return counts.cut;
        if (whereJson.includes('"inconsistentItems"')) return counts.inconsistent;
        if (
          whereJson.includes('"currentStage":"CANCELED"') ||
          whereJson.includes('"currentStage":"CANCELED"')
        ) {
          return counts.canceled;
        }
        if (whereJson.includes('"isOverdue":true')) return counts.overdue;
        return 0;
      },
      aggregate: async (args: { where: unknown }) => {
        calls.push({ kind: "aggregate", where: args.where });
        return { _max: { computedAt: new Date("2026-07-17T10:00:00Z") } };
      },
    },
  } as unknown as SalesOrderFlowSummaryDb;

  return { db, calls };
}

describe("salesOrderFlowSummary.server (OP-59)", () => {
  it("agrega totais e colunas respeitando escopo de clientes", async () => {
    const { db, calls } = createDb();
    const payload = await loadSalesOrderFlowSummary(
      { customerId: "c1", atrasado: "true" },
      {
        prisma: db,
        scopeCustomerIds: ["c1", "c2"],
        canViewValues: true,
        resolveSellerWhere: async () => null,
        now: () => new Date("2026-07-17T11:00:00Z"),
      }
    );

    assert.equal(payload.valuesVisible, true);
    assert.equal(payload.totals.overdueCount, 1);
    assert.equal(payload.totals.blockedCount, 2);
    assert.equal(payload.totals.inconsistentCount, 3);
    assert.equal(payload.totals.partiallyShippedCount, 4);
    assert.equal(payload.totals.completedWithCutCount, 5);
    assert.equal(payload.totals.canceledCount, 1);
    assert.equal(
      payload.columns.find((c) => c.stage === "WAITING_RELEASE")?.orderValue,
      200
    );
    assert.equal(
      payload.columns.find((c) => c.stage === "CANCELED")?.isCanceledColumn,
      true
    );

    const groupWhere = JSON.stringify(calls.find((c) => c.kind === "groupBy")?.where);
    assert.match(groupWhere, /"c1"/);
    assert.match(groupWhere, /"c2"/);
    assert.match(groupWhere, /"isOverdue":true/);

    // OP-75: orçamento de query count (1 groupBy + 6 counts + 1 aggregate).
    assert.equal(calls.length, SALES_ORDER_FLOW_SUMMARY_QUERY_BUDGET);
    assert.equal(calls.filter((c) => c.kind === "groupBy").length, 1);
    assert.equal(calls.filter((c) => c.kind === "count").length, 6);
    assert.equal(calls.filter((c) => c.kind === "aggregate").length, 1);
  });

  it("oculta valores quando canViewValues=false", async () => {
    const { db } = createDb();
    const payload = await loadSalesOrderFlowSummary(
      {},
      {
        prisma: db,
        canViewValues: false,
        resolveSellerWhere: async () => null,
      }
    );
    assert.equal(payload.valuesVisible, false);
    for (const column of payload.columns) {
      assert.equal(column.orderValue, null);
      assert.equal(column.activeResidualValue, null);
    }
  });
});
