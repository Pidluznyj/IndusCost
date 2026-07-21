import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSalesOrderFlowAnalyticsModel,
  buildSalesOrderFlowBurnMetrics,
  buildSalesOrderFlowCfdSnapshot,
  buildSalesOrderFlowWipByStage,
} from "@/src/lib/salesOrderFlowAnalytics.js";
import type { SalesOrderFlowSummaryColumn } from "@/src/lib/sales/salesOrderFlowSummary.js";

function columns(
  counts: Partial<Record<string, number>>
): SalesOrderFlowSummaryColumn[] {
  return [
    "WAITING_RELEASE",
    "WAITING_PRODUCTION_ORDER",
    "IN_PRODUCTION",
    "WAITING_OUTPUT_DOCUMENT",
    "WAITING_NFE",
    "SHIPPED_COMPLETED",
    "CANCELED",
  ].map((stage) => ({
    stage: stage as SalesOrderFlowSummaryColumn["stage"],
    label: stage,
    isCanceledColumn: stage === "CANCELED",
    orderCount: counts[stage] ?? 0,
    orderValue: null,
    activeResidualValue: null,
  }));
}

describe("salesOrderFlowAnalytics", () => {
  it("monta WIP por etapa operacional", () => {
    const wip = buildSalesOrderFlowWipByStage(
      columns({
        WAITING_RELEASE: 2,
        IN_PRODUCTION: 5,
        SHIPPED_COMPLETED: 3,
      })
    );
    assert.equal(wip.length, 6);
    assert.equal(
      wip.find((row) => row.stage === "IN_PRODUCTION")?.orderCount,
      5
    );
    assert.equal(
      wip.find((row) => row.stage === "SHIPPED_COMPLETED")?.orderCount,
      3
    );
  });

  it("monta CFD snapshot cumulativo", () => {
    const cfd = buildSalesOrderFlowCfdSnapshot(
      columns({
        WAITING_RELEASE: 1,
        WAITING_PRODUCTION_ORDER: 1,
        IN_PRODUCTION: 2,
        WAITING_OUTPUT_DOCUMENT: 0,
        WAITING_NFE: 1,
        SHIPPED_COMPLETED: 4,
      })
    );
    assert.equal(cfd[0]?.wip, 1);
    assert.equal(cfd[0]?.cumulativeReached, 9);
    assert.equal(cfd.at(-1)?.stage, "SHIPPED_COMPLETED");
    assert.equal(cfd.at(-1)?.cumulativeReached, 4);
  });

  it("calcula burnup e burndown a partir do WIP", () => {
    const burn = buildSalesOrderFlowBurnMetrics(
      columns({
        WAITING_RELEASE: 2,
        IN_PRODUCTION: 3,
        SHIPPED_COMPLETED: 5,
      })
    );
    assert.equal(burn.totals.scopeOrders, 10);
    assert.equal(burn.totals.completedOrders, 5);
    assert.equal(burn.totals.remainingOrders, 5);
    assert.equal(burn.burnup.find((p) => p.key === "completed")?.value, 5);
    assert.equal(burn.burndown.find((p) => p.key === "remaining")?.value, 5);
  });

  it("compõe modelo completo com riscos", () => {
    const model = buildSalesOrderFlowAnalyticsModel({
      columns: columns({
        WAITING_RELEASE: 4,
        SHIPPED_COMPLETED: 2,
      }),
      totals: {
        overdueCount: 1,
        blockedCount: 1,
        inconsistentCount: 0,
        partiallyShippedCount: 0,
        completedWithCutCount: 0,
      },
    });
    assert.equal(model.totals.activeOrders, 4);
    assert.ok(model.risks.some((r) => r.key === "overdue" && r.value === 1));
    assert.ok(model.cfd.length === 6);
  });
});
