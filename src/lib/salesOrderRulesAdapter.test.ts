import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFulfillmentKpis } from "./salesOrderManagementFulfillment.js";
import { buildManagementRowsFromOrders } from "./salesOrderManagement.js";
import { summarizeSalesOrderListRows } from "./salesOrdersListSummary.js";
import {
  buildOfficialSalesOrderListPayload,
  buildOfficialSalesOrderManagementCore,
  OFFICIAL_SO_RULES_SOURCE,
} from "./salesOrderRulesAdapter.js";
import type { SalesOrderRulesOrderInput } from "./salesOrderRulesEngine.types.js";

function order(partial: Partial<SalesOrderRulesOrderInput> & Pick<SalesOrderRulesOrderInput, "id">): SalesOrderRulesOrderInput {
  return {
    orderCode: "PD-1",
    status: "SENT_TO_NOMUS",
    issueDate: new Date(2026, 5, 10),
    expectedDeliveryDate: new Date(2026, 5, 20),
    totalNetValue: 1000,
    totalItems: 2,
    responsible: "Vendedor A",
    items: [{ id: "i1", quantity: 2 }],
    ...partial,
  };
}

const REF = new Date(2026, 5, 20);

describe("salesOrderRulesAdapter integration", () => {
  it("list payload expõe metricsSource e paridade com summarizeSalesOrderListRows", () => {
    const rows = [order({ id: "1" }), order({ id: "2", totalNetValue: 500, totalItems: 1 })];
    const payload = buildOfficialSalesOrderListPayload({
      orders: rows,
      listFilters: { status: "all" },
      referenceDate: REF,
    });
    const legacy = summarizeSalesOrderListRows(
      rows.map((r) => ({ totalNetValue: r.totalNetValue, totalItems: r.totalItems }))
    );
    assert.equal(payload.metricsSource, OFFICIAL_SO_RULES_SOURCE);
    assert.equal(payload.summary.totalOrders, legacy.totalOrders);
    assert.equal(payload.summary.totalNetAmount, legacy.totalNetAmount);
    assert.equal(payload.metrics.soldAmount, legacy.totalNetAmount);
  });

  it("gestão usa cards do motor oficial", () => {
    const rows = [order({ id: "1" })];
    const core = buildOfficialSalesOrderManagementCore({
      orders: rows,
      managementFilters: { year: 2026 },
      referenceDate: REF,
    });
    const legacy = buildManagementRowsFromOrders(
      rows.map((r) => ({
        id: r.id,
        orderCode: r.orderCode,
        status: r.status,
        issueDate: r.issueDate,
        expectedDeliveryDate: r.expectedDeliveryDate ?? null,
        totalNetValue: r.totalNetValue,
        responsible: r.responsible ?? null,
        nomusRawResponse: r.nomusRawResponse ?? null,
        items: r.items.map((i) => ({
          id: i.id,
          externalProductId: i.externalProductId,
          skuSnapshot: i.skuSnapshot,
          productNameSnapshot: i.productNameSnapshot,
          quantity: i.quantity,
        })),
      })),
      { year: 2026 },
      REF
    );
    assert.equal(core.metricsSource, OFFICIAL_SO_RULES_SOURCE);
    assert.equal(core.fulfillmentKpis.totalSoldValue, legacy.fulfillmentKpis.totalSoldValue);
    assert.equal(core.summary?.totalOrders, legacy.summary?.totalOrders);
  });

  it("fulfillment KPIs batem com buildFulfillmentKpis para mesmas linhas", () => {
    const rows = [order({ id: "1" })];
    const core = buildOfficialSalesOrderManagementCore({
      orders: rows,
      managementFilters: {},
      referenceDate: REF,
    });
    const kpis = buildFulfillmentKpis(core.rows);
    assert.equal(core.fulfillmentKpis.totalSoldValue, kpis.totalSoldValue);
  });
});
