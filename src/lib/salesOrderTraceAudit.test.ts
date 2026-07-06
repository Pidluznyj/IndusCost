import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateSalesOrderItemMargin } from "./salesOrderMarginMath.js";
import { resolveSalesOrderItemCost } from "./salesOrderMarginResolver.js";
import {
  buildEmptySalesOrderTraceReport,
  buildSalesOrderTraceAlerts,
  buildSalesOrderTraceCsv,
  computeSalesOrderTraceTotals,
  isForbiddenNomusCostSource,
  isOfficialIndusCostSource,
  mapMarginPayloadToTraceItem,
} from "./salesOrderTraceAudit.js";
import type { SalesOrderMarginItemResult } from "./salesOrderMarginTypes.js";

function itemResult(partial: Partial<SalesOrderMarginItemResult>): SalesOrderMarginItemResult {
  return {
    salesOrderItemId: "item-1",
    productId: "prod-1",
    productSku: "618.08AA",
    productName: "Produto",
    quantity: 2,
    netUnitRevenue: 10,
    netRevenue: 20,
    unitCost: 4,
    totalCost: 8,
    marginValue: 12,
    marginPercent: 60,
    markup: 2.5,
    status: "OK",
    costSource: "VERSIONED_PRODUCTION_COST",
    costConfidence: "HIGH",
    marginCostMode: "HISTORICAL_FROZEN",
    productionCost: {
      costTableVersionId: "v1",
      costTableItemId: "i1",
      versionCode: "AUTO-2026-06",
      versionName: "AUTO",
      revision: 1,
      effectiveDate: "2026-06-01",
      publishedAt: "2026-06-02T00:00:00.000Z",
      orderIssueDate: "2026-06-15",
    },
    notes: [],
    ...partial,
  };
}

describe("salesOrderTraceAudit", () => {
  it("pedido inexistente retorna FAIL com mensagem clara", () => {
    const report = buildEmptySalesOrderTraceReport("Pedido não encontrado: orderNumber=XYZ");
    assert.equal(report.status, "FAIL");
    assert.match(report.errorMessage ?? "", /não encontrado/i);
  });

  it("item sem produto gera alerta ITEM_WITHOUT_PRODUCT_LINK", () => {
    const traceItem = mapMarginPayloadToTraceItem(
      itemResult({ productId: null, status: "SEM_PRODUTO_VINCULADO" }),
      undefined,
      null
    );
    const alerts = buildSalesOrderTraceAlerts({
      items: [traceItem],
      sellerResolved: true,
      customerExcluded: false,
      customerExclusionReason: null,
    });
    assert.ok(alerts.some((a) => a.code === "ITEM_WITHOUT_PRODUCT_LINK"));
  });

  it("produto sem custo oficial gera alerta MISSING_OFFICIAL_COST", () => {
    const traceItem = mapMarginPayloadToTraceItem(
      itemResult({ unitCost: null, totalCost: null, status: "SEM_CUSTO", costSource: "MISSING_COST" }),
      undefined,
      null
    );
    const alerts = buildSalesOrderTraceAlerts({
      items: [traceItem],
      sellerResolved: true,
      customerExcluded: false,
      customerExclusionReason: null,
    });
    assert.ok(alerts.some((a) => a.code === "MISSING_OFFICIAL_COST"));
  });

  it("margem real usa custo IndusCost versionado", () => {
    const margin = calculateSalesOrderItemMargin({
      salesOrderItemId: "i1",
      productId: "p1",
      quantity: 2,
      netTotalValue: 20,
      unitCost: 0.912785,
      costSource: "VERSIONED_PRODUCTION_COST",
      costConfidence: "HIGH",
    });
    assert.equal(margin.costSource, "VERSIONED_PRODUCTION_COST");
    assert.equal(margin.totalCost, 1.82557);
    assert.equal(margin.marginValue, 18.17443);
    assert.ok(isOfficialIndusCostSource(margin.costSource));
  });

  it("não usa custo Nomus (SalesOrderItem.unitCost) como custo industrial", () => {
    const cost = resolveSalesOrderItemCost({
      salesOrderItemId: "i1",
      productId: "p1",
      storedUnitCost: 500,
      analysis: { summary: { totalIndustrialCost: 0.912785 } },
      costPolicy: { allowLiveCostFallback: true, useFrozenUnitCostFirst: false },
    });
    assert.notEqual(cost.costSource, "SALES_ORDER_ITEM_SNAPSHOT");
    assert.equal(cost.unitCost, 0.912785);
    assert.ok(!isForbiddenNomusCostSource(cost.costSource));
  });

  it("detecta uso indevido de SalesOrderItem.unitCost como fonte de margem", () => {
    const traceItem = mapMarginPayloadToTraceItem(
      itemResult({ costSource: "SALES_ORDER_ITEM_SNAPSHOT", unitCost: 500 }),
      undefined,
      500
    );
    assert.ok(isForbiddenNomusCostSource(traceItem.costSource));
    const alerts = buildSalesOrderTraceAlerts({
      items: [traceItem],
      sellerResolved: true,
      customerExcluded: false,
      customerExclusionReason: null,
    });
    assert.ok(alerts.some((a) => a.code === "NOMUS_UNIT_COST_USED"));
  });

  it("totais consolidam vendido, custo e margem", () => {
    const items = [
      mapMarginPayloadToTraceItem(itemResult({ netRevenue: 100, totalCost: 40, marginValue: 60 }), undefined, null),
      mapMarginPayloadToTraceItem(
        itemResult({ salesOrderItemId: "item-2", netRevenue: 50, totalCost: 20, marginValue: 30 }),
        undefined,
        null
      ),
    ];
    const totals = computeSalesOrderTraceTotals(items, null);
    assert.equal(totals.totalSold, 150);
    assert.equal(totals.totalOfficialCost, 60);
    assert.equal(totals.totalMarginAmount, 90);
  });

  it("CSV inclui seções order, item e alert", () => {
    const report = buildEmptySalesOrderTraceReport("erro");
    report.alerts.push({ code: "TEST", severity: "warning", message: "msg" });
    const csv = buildSalesOrderTraceCsv(report);
    assert.match(csv, /^section,field,value/m);
    assert.match(csv, /alert,TEST,warning,msg/);
  });
});
