import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildSalesOrderMarginAlerts,
  buildSalesOrderMarginByCustomer,
  buildSalesOrderMarginByProduct,
  buildSalesOrderMarginBySeller,
  buildSalesOrderMarginPeriodSummary,
  parseSalesOrderMarginIndicatorFilters,
} from "./salesOrderMarginIndicators.server.js";
import { formatKpiCompactCurrency } from "./kpiDisplayFormat.js";
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

function row(
  partial: Partial<Row> & { item: SalesOrderMarginItemResult }
): Row {
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

describe("salesOrderMarginIndicators", () => {
  it("1. indicador geral calcula margem ponderada sobre receita com custo", () => {
    const items = [
      row({ item: item({ netRevenue: 1000, marginValue: 200, marginPercent: 20 }) }),
      row({
        orderId: "o2",
        itemId: "i2",
        item: item({ netRevenue: 3000, marginValue: 900, marginPercent: 30 }),
      }),
    ];
    const summary = buildSalesOrderMarginPeriodSummary(items);
    assert.equal(summary.netRevenue, 4000);
    assert.equal(summary.marginRevenueCovered, 4000);
    assert.equal(summary.marginValue, 1100);
    assert.ok(Math.abs((summary.marginPercent ?? 0) - 27.5) < 0.001);
  });

  it("2. ranking por cliente calcula margem ponderada", () => {
    const items = [
      row({
        customerId: "c1",
        customerName: "Alpha",
        item: item({ netRevenue: 1000, marginValue: 100, marginPercent: 10 }),
      }),
      row({
        orderId: "o2",
        itemId: "i2",
        customerId: "c1",
        customerName: "Alpha",
        item: item({ netRevenue: 1000, marginValue: 300, marginPercent: 30 }),
      }),
      row({
        orderId: "o3",
        itemId: "i3",
        customerId: "c2",
        customerName: "Beta",
        item: item({ netRevenue: 500, marginValue: 250, marginPercent: 50 }),
      }),
    ];
    const ranking = buildSalesOrderMarginByCustomer(items);
    const alpha = ranking.find((r) => r.customerName === "Alpha");
    assert.ok(alpha);
    assert.equal(alpha.netRevenue, 2000);
    assert.equal(alpha.marginValue, 400);
    assert.ok(Math.abs((alpha.marginPercent ?? 0) - 20) < 0.001);
  });

  it("3. ranking por vendedor calcula margem ponderada", () => {
    const items = [
      row({
        responsible: "Maria",
        item: item({ netRevenue: 800, marginValue: 160, marginPercent: 20 }),
      }),
      row({
        orderId: "o2",
        itemId: "i2",
        responsible: "Maria",
        item: item({ netRevenue: 200, marginValue: 60, marginPercent: 30 }),
      }),
    ];
    const ranking = buildSalesOrderMarginBySeller(items);
    const maria = ranking.find((r) => r.sellerName === "Maria");
    assert.ok(maria);
    assert.equal(maria.netRevenue, 1000);
    assert.equal(maria.marginValue, 220);
    assert.ok(Math.abs((maria.marginPercent ?? 0) - 22) < 0.001);
  });

  it("4. ranking por produto calcula margem ponderada", () => {
    const items = [
      row({
        productId: "p1",
        productName: "Parafuso",
        quantity: 5,
        item: item({ netRevenue: 500, marginValue: 100, marginPercent: 20 }),
      }),
      row({
        orderId: "o2",
        itemId: "i2",
        productId: "p1",
        productName: "Parafuso",
        quantity: 3,
        item: item({ netRevenue: 300, marginValue: 90, marginPercent: 30 }),
      }),
    ];
    const ranking = buildSalesOrderMarginByProduct(items);
    assert.equal(ranking[0].productName, "Parafuso");
    assert.equal(ranking[0].quantitySold, 8);
    assert.equal(ranking[0].netRevenue, 800);
    assert.equal(ranking[0].marginValue, 190);
    assert.ok(Math.abs((ranking[0].marginPercent ?? 0) - 23.75) < 0.001);
  });

  it("5. itens sem custo entram em alertas", () => {
    const alerts = buildSalesOrderMarginAlerts([
      row({ item: item({ status: "SEM_CUSTO", statusLabel: "Sem custo", marginValue: null }) }),
    ]);
    assert.equal(alerts.missingCostItems.length, 1);
  });

  it("6. itens sem produto entram em alertas", () => {
    const alerts = buildSalesOrderMarginAlerts([
      row({
        item: item({ status: "SEM_PRODUTO_VINCULADO", statusLabel: "Sem produto", marginValue: 0 }),
      }),
    ]);
    assert.equal(alerts.missingProductItems.length, 1);
  });

  it("7. margem negativa entra em alertas", () => {
    const alerts = buildSalesOrderMarginAlerts([
      row({
        item: item({
          status: "MARGEM_NEGATIVA",
          statusLabel: "Margem negativa",
          marginValue: -50,
          marginPercent: -10,
        }),
      }),
    ]);
    assert.equal(alerts.negativeMarginItems.length, 1);
  });

  it("8. filtro por ano/mês funciona", () => {
    const f = parseSalesOrderMarginIndicatorFilters({ year: "2025", month: "3" });
    assert.equal(f.year, 2025);
    assert.equal(f.month, 3);
  });

  it("9. filtro por cliente funciona", () => {
    const f = parseSalesOrderMarginIndicatorFilters({ customerId: "abc-123" });
    assert.equal(f.customerId, "abc-123");
  });

  it("10. filtro por vendedor funciona", () => {
    const f = parseSalesOrderMarginIndicatorFilters({ responsible: "João" });
    assert.equal(f.responsible, "João");
    const f2 = parseSalesOrderMarginIndicatorFilters({ sellerName: "Maria" });
    assert.equal(f2.responsible, "Maria");
  });

  it("11. não usa média simples de margens percentuais", () => {
    const source = readFileSync(
      join(ROOT, "lib/salesOrderMarginIndicators.server.ts"),
      "utf8"
    );
    assert.match(source, /marginValue \/ marginRevenueCovered|marginRevenueCovered\)/);
    assert.doesNotMatch(source, /marginValue \/ bucket\.netRevenue/);
    assert.doesNotMatch(source, /reduce\([\s\S]*marginPercent[\s\S]*\/\s*items\.length/s);
  });

  it("12. não faz N+1 evidente (uma chamada batch de margem)", () => {
    const source = readFileSync(
      join(ROOT, "lib/salesOrderMarginIndicators.server.ts"),
      "utf8"
    );
    assert.match(source, /await calculateSalesOrderMarginsForOrders\(/);
    assert.doesNotMatch(source, /for\s*\([\s\S]*await\s+calculateSalesOrderMarginsForOrders/s);
  });

  it("13. valores milionários exibem formato compacto executivo", () => {
    const sold = formatKpiCompactCurrency(6_214_384.19);
    assert.match(sold.display, /Mi/);
    assert.ok(sold.title?.includes("6.214.384,19"));
    const margin = formatKpiCompactCurrency(3_701_900.38);
    assert.match(margin.display, /Mi/);
    assert.ok(margin.isCompact);
  });
});
