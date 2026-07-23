import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildSalesOrderListTotalsFromPrismaOrders,
  buildSalesOrderListWhere,
  summarizeSalesOrderListRows,
} from "./salesOrdersListSummary.js";
import {
  buildSalesOrderMarginIndicatorWhere,
  buildSalesOrderMarginPeriodSummary,
} from "./salesOrderMarginIndicators.server.js";
import type { SalesOrderMarginItemResult } from "./salesOrderMarginTypes.js";

const ROOT = join(import.meta.dirname, "..");

function item(
  partial: Partial<SalesOrderMarginItemResult> & Pick<SalesOrderMarginItemResult, "status">
): SalesOrderMarginItemResult {
  return {
    salesOrderItemId: partial.salesOrderItemId ?? "item-1",
    quantity: partial.quantity ?? 1,
    netUnitRevenue: partial.netUnitRevenue ?? 100,
    netRevenue: partial.netRevenue ?? 1000,
    unitCost: partial.unitCost ?? 400,
    totalCost: partial.totalCost ?? 400,
    marginValue: partial.marginValue ?? 600,
    marginPercent: partial.marginPercent ?? 60,
    markup: partial.markup ?? 2.5,
    status: partial.status,
    statusLabel: partial.statusLabel ?? partial.status,
    statusSeverity: partial.statusSeverity ?? "success",
    costSource: partial.costSource ?? "OFFICIAL_FINAL_COST",
    costConfidence: partial.costConfidence ?? "high",
    notes: partial.notes ?? [],
  };
}

type Row = Parameters<typeof buildSalesOrderMarginPeriodSummary>[0][number];

function row(partial: Partial<Row> & { item: SalesOrderMarginItemResult }): Row {
  return {
    orderId: partial.orderId ?? "o1",
    orderCode: partial.orderCode ?? "PD-001",
    itemId: partial.itemId ?? partial.item.salesOrderItemId ?? "i1",
    customerId: partial.customerId ?? "c1",
    customerName: partial.customerName ?? "Cliente A",
    responsible: partial.responsible ?? "Vendedor A",
    productId: partial.productId ?? "p1",
    productSku: partial.productSku ?? "SKU-1",
    productName: partial.productName ?? "Produto 1",
    quantity: partial.quantity ?? 10,
    item: partial.item,
  };
}

describe("salesOrderListIndicatorsParity", () => {
  it("totais da listagem batem com contagem Prisma do mesmo conjunto", () => {
    const orders = [
      { totalNetValue: 1000, totalItems: 2 },
      { totalNetValue: 2500, totalItems: 5 },
      { totalNetValue: 8000, totalItems: 12 },
    ];
    const totals = buildSalesOrderListTotalsFromPrismaOrders(orders);
    const legacy = summarizeSalesOrderListRows(orders);
    assert.equal(totals.totalOrders, orders.length);
    assert.equal(totals.totalOrders, legacy.totalOrders);
    assert.equal(totals.totalNetAmount, 11_500);
    assert.equal(totals.totalItems, 19);
  });

  it("indicadores usam o mesmo where da listagem (sem excluir cancelados por padrão)", () => {
    const listWhere = buildSalesOrderListWhere({ year: 2026, month: null });
    const indicatorWhere = buildSalesOrderMarginIndicatorWhere({ year: 2026 });
    assert.deepEqual(indicatorWhere, listWhere);
    const source = readFileSync(join(ROOT, "lib/salesOrderMarginIndicators.server.ts"), "utf8");
    assert.doesNotMatch(source, /notIn:\s*\[\s*"CANCELLED"\s*,\s*"ERROR"\s*\]/);
  });

  it("GET /api/sales-orders agrega summary direto dos pedidos filtrados", () => {
    const server = readFileSync(join(ROOT, "..", "server.ts"), "utf8");
    assert.match(server, /buildSalesOrderListTotalsFromPrismaOrders/);
    assert.doesNotMatch(server, /buildOfficialSalesOrderListPayload\([\s\S]*summaryOrders/s);
  });

  it("margem % consolidada usa receita com custo como denominador", () => {
    const items = [
      row({
        item: item({ netRevenue: 1000, marginValue: 200, marginPercent: 20, status: "OK" }),
      }),
      row({
        orderId: "o2",
        itemId: "i2",
        item: item({
          netRevenue: 500,
          marginValue: 0,
          marginPercent: null,
          status: "SEM_CUSTO",
          totalCost: null,
        }),
      }),
    ];
    const summary = buildSalesOrderMarginPeriodSummary(items);
    assert.equal(summary.totalSalesRevenueInScope, 1500);
    assert.equal(summary.marginRevenueCovered, 1000);
    assert.equal(summary.marginValue, 200);
    assert.ok(Math.abs((summary.marginPercent ?? 0) - 20) < 0.001);
  });

  it("App não expõe mais rota /sales-orders/indicators", () => {
    const app = readFileSync(join(ROOT, "App.tsx"), "utf8");
    assert.doesNotMatch(app, /sales-orders\/indicators/);
    assert.doesNotMatch(app, /SalesOrdersIndicatorsDashboard/);
  });
});
