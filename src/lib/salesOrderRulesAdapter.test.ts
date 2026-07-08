import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFulfillmentKpis } from "./salesOrderManagementFulfillment.js";
import { buildManagementRowsFromOrders } from "./salesOrderManagement.js";
import { summarizeSalesOrderListRows } from "./salesOrdersListSummary.js";
import {
  buildOfficialReportsCommercialPayload,
  buildOfficialCustomerRevenueByCustomer,
  buildOfficialSalesOrderListPayload,
  buildOfficialSalesOrderManagementCore,
  buildOfficialSalesOrderResultSalesBundle,
  mapOfficialFinancePortfolioFromManagementRows,
  mapOfficialFinancePeriodAgg,
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

  it("result sales bundle expõe timeline mensal do motor oficial", () => {
    const rows = [order({ id: "1", issueDate: new Date(2026, 0, 15), totalNetValue: 2000 })];
    const bundle = buildOfficialSalesOrderResultSalesBundle({
      orders: rows,
      year: 2026,
      referenceDate: new Date(2026, 5, 20),
    });
    assert.equal(bundle.metricsSource, OFFICIAL_SO_RULES_SOURCE);
    assert.equal(bundle.monthlyTimeline.find((p) => p.month === 1)?.soldAmount, 2000);
  });

  it("portfolio financeiro mapeia linhas de gestão sem recalcular regra", () => {
    const core = buildOfficialSalesOrderManagementCore({
      orders: [order({ id: "1" })],
      managementFilters: { year: 2026 },
      referenceDate: REF,
    });
    const portfolio = mapOfficialFinancePortfolioFromManagementRows(core.rows);
    assert.equal(portfolio.open.count + portfolio.invoiced.count, core.rows.length);
  });

  it("mapOfficialFinancePeriodAgg expõe quantidade e valor vendido do motor", () => {
    const rows = [order({ id: "1", totalNetValue: 1500 }), order({ id: "2", totalNetValue: 500 })];
    const payload = buildOfficialSalesOrderListPayload({
      orders: rows,
      listFilters: { year: 2026 },
      referenceDate: REF,
    });
    const agg = mapOfficialFinancePeriodAgg({
      listSummary: payload.summary,
      metrics: payload.metrics,
    });
    assert.equal(agg.count, 2);
    assert.equal(agg.net, 2000);
    assert.ok(Number.isFinite(agg.net));
  });

  it("reports commercial payload usa motor oficial para totais", () => {
    const rows = [
      order({ id: "1", customerId: "c1", totalNetValue: 1000 }),
      order({ id: "2", customerId: "c2", totalNetValue: 500, status: "CANCELLED" }),
    ];
    const payload = buildOfficialReportsCommercialPayload({
      orders: rows,
      listFilters: { status: "all" },
      referenceDate: REF,
      customerNames: new Map([
        ["c1", "Cliente A"],
        ["c2", "Cliente B"],
      ]),
    });
    assert.equal(payload.metricsSource, OFFICIAL_SO_RULES_SOURCE);
    assert.equal(payload.orderCount, 2);
    assert.equal(payload.totalNet, 1500);
    const abc = buildOfficialCustomerRevenueByCustomer(rows, { abcEligibleOnly: true });
    assert.equal(abc.length, 1);
    assert.equal(abc[0]!.revenue, 1000);
  });
});
