import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SOLD_PRODUCT_INACTIVE_DAYS,
  aggregateSoldProductCustomers,
  applySoldProductCustomerPostFilters,
  buildAllCustomerRevenueMap,
  buildSoldProductSuggestedAction,
  computeAverageDaysBetweenPurchases,
  resolveLastUnitPrice,
  sortSoldProductCustomerRows,
  type SoldProductCustomerLineInput,
} from "./soldProductCustomers.js";
import { filterSoldProductsLines, type SoldProductsLineContext } from "./salesProductRanking.js";
import {
  matchesSoldProductsCustomerScope,
  orderMatchesSoldProductsStatus,
  parseSalesProductRankingFilters,
} from "./salesProductRankingFilters.js";

const REF = new Date(2026, 5, 17, 12, 0, 0, 0);

function line(
  partial: Partial<SoldProductCustomerLineInput> &
    Pick<SoldProductCustomerLineInput, "customerId" | "orderId" | "quantity" | "lineAmount">
): SoldProductCustomerLineInput {
  return {
    customerName: partial.customerName ?? "Cliente",
    customerTaxId: partial.customerTaxId ?? "12345678000199",
    orderDate: partial.orderDate ?? new Date(2026, 2, 10),
    unitPrice: partial.unitPrice ?? partial.lineAmount / Math.max(partial.quantity, 1),
    orderStatus: partial.orderStatus ?? "SENT_TO_NOMUS",
    ...partial,
  };
}

describe("soldProductCustomers", () => {
  it("agrupa clientes por produto e soma quantidade/receita", () => {
    const lines = [
      line({ customerId: "c1", orderId: "o1", quantity: 10, lineAmount: 1000, unitPrice: 100 }),
      line({ customerId: "c1", orderId: "o2", quantity: 5, lineAmount: 600, unitPrice: 120 }),
      line({ customerId: "c2", orderId: "o3", quantity: 20, lineAmount: 2000, unitPrice: 100 }),
    ];
    const revenue = buildAllCustomerRevenueMap(lines);
    const { summary, rows } = aggregateSoldProductCustomers(lines, revenue, REF);
    assert.equal(summary.customersCount, 2);
    assert.equal(summary.totalQuantity, 35);
    assert.equal(summary.totalRevenue, 3600);
    const c1 = rows.find((r) => r.customerId === "c1");
    assert.equal(c1?.quantity, 15);
    assert.equal(c1?.totalRevenue, 1600);
    assert.equal(c1?.ordersCount, 2);
  });

  it("calcula preço médio ponderado, min/max e último preço", () => {
    const lines = [
      line({
        customerId: "c1",
        orderId: "o1",
        quantity: 2,
        lineAmount: 200,
        unitPrice: 100,
        orderDate: new Date(2026, 0, 10),
      }),
      line({
        customerId: "c1",
        orderId: "o2",
        quantity: 3,
        lineAmount: 450,
        unitPrice: 150,
        orderDate: new Date(2026, 3, 10),
      }),
    ];
    const { rows, summary } = aggregateSoldProductCustomers(
      lines,
      buildAllCustomerRevenueMap(lines),
      REF
    );
    assert.equal(rows[0]?.averageUnitPrice, 130);
    assert.equal(rows[0]?.minUnitPrice, 100);
    assert.equal(rows[0]?.maxUnitPrice, 150);
    assert.equal(rows[0]?.lastUnitPrice, 150);
    assert.equal(summary.averageUnitPrice, 130);
    assert.equal(summary.minUnitPrice, 100);
    assert.equal(summary.maxUnitPrice, 150);
  });

  it("resolveLastUnitPrice usa compra mais recente", () => {
    const last = resolveLastUnitPrice([
      { orderDate: new Date(2026, 0, 1), unitPrice: 80, orderId: "a" },
      { orderDate: new Date(2026, 4, 1), unitPrice: 95, orderId: "b" },
    ]);
    assert.equal(last, 95);
  });

  it("calcula dias desde última compra e intervalo médio com 2+ pedidos", () => {
    const lines = [
      line({
        customerId: "c1",
        orderId: "o1",
        quantity: 1,
        lineAmount: 100,
        orderDate: new Date(2026, 0, 1),
      }),
      line({
        customerId: "c1",
        orderId: "o2",
        quantity: 1,
        lineAmount: 100,
        orderDate: new Date(2026, 2, 1),
      }),
    ];
    const { rows } = aggregateSoldProductCustomers(
      lines,
      buildAllCustomerRevenueMap(lines),
      REF
    );
    assert.equal(rows[0]?.daysSinceLastPurchase, daysBetween(new Date(2026, 2, 1), REF));
    assert.equal(rows[0]?.averageDaysBetweenPurchases, 59);
    assert.equal(rows[0]?.averageDaysBetweenPurchasesLabel, "59 dias");
  });

  it("intervalo médio retorna null com histórico insuficiente", () => {
    assert.equal(computeAverageDaysBetweenPurchases([new Date(2026, 0, 1)]), null);
    const lines = [
      line({ customerId: "c1", orderId: "o1", quantity: 1, lineAmount: 50 }),
    ];
    const { rows } = aggregateSoldProductCustomers(
      lines,
      buildAllCustomerRevenueMap(lines),
      REF
    );
    assert.equal(rows[0]?.averageDaysBetweenPurchases, null);
    assert.equal(rows[0]?.averageDaysBetweenPurchasesLabel, "Histórico insuficiente");
  });

  it("calcula participação do cliente no produto e no faturamento do cliente", () => {
    const allLines = [
      line({ customerId: "c1", orderId: "o1", quantity: 10, lineAmount: 1000 }),
      line({ customerId: "c1", orderId: "o2", quantity: 5, lineAmount: 500 }),
      line({ customerId: "c2", orderId: "o3", quantity: 5, lineAmount: 500 }),
    ];
    const allRevenue = buildAllCustomerRevenueMap(allLines);
    const productLines = [allLines[0]!, allLines[2]!];
    const { rows } = aggregateSoldProductCustomers(productLines, allRevenue, REF);
    const c1 = rows.find((r) => r.customerId === "c1");
    assert.equal(c1?.shareOfProductRevenue, 66.67);
    assert.equal(c1?.shareOfCustomerRevenue, 66.67);
  });

  it("exclui pedidos cancelados/erro via orderMatchesSoldProductsStatus", () => {
    assert.equal(orderMatchesSoldProductsStatus("CANCELLED", "valid"), false);
    assert.equal(orderMatchesSoldProductsStatus("ERROR", "valid"), false);
    assert.equal(orderMatchesSoldProductsStatus("SENT_TO_NOMUS", "valid"), true);
  });

  it("respeita filtros de período em filterSoldProductsLines", () => {
    const filters = parseSalesProductRankingFilters(
      { startDate: "2026-03-01", endDate: "2026-03-31", orderStatus: "valid" },
      REF
    );
    const ctx: SoldProductsLineContext[] = [
      {
        lineId: "1",
        productId: "p1",
        productCode: "A",
        productName: "A",
        productNcm: null,
        quantity: 1,
        unitPrice: 10,
        lineAmount: 10,
        orderId: "o1",
        orderCode: "o1",
        orderDate: new Date(2026, 2, 15),
        orderStatus: "SENT_TO_NOMUS",
        sellerName: null,
        companyLabel: null,
        customerId: "c1",
        customerName: "C1",
        customerTaxId: null,
      },
      {
        lineId: "2",
        productId: "p1",
        productCode: "A",
        productName: "A",
        productNcm: null,
        quantity: 1,
        unitPrice: 10,
        lineAmount: 10,
        orderId: "o2",
        orderCode: "o2",
        orderDate: new Date(2026, 0, 15),
        orderStatus: "SENT_TO_NOMUS",
        sellerName: null,
        companyLabel: null,
        customerId: "c2",
        customerName: "C2",
        customerTaxId: null,
      },
    ];
    const filtered = filterSoldProductsLines(ctx, filters);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.customerId, "c1");
  });

  it("respeita customerScope external/all", () => {
    const external = matchesSoldProductsCustomerScope(
      { taxId: "12345678000199", companyName: "Cliente Externo" },
      "external"
    );
    assert.equal(external, true);
  });

  it("não retorna NaN/Infinity nos agregados", () => {
    const lines = [
      line({ customerId: "c1", orderId: "o1", quantity: 0, lineAmount: 0, unitPrice: 0 }),
    ];
    const { summary, rows } = aggregateSoldProductCustomers(
      lines,
      buildAllCustomerRevenueMap(lines),
      REF
    );
    assert.ok(Number.isFinite(summary.totalRevenue));
    assert.ok(summary.averageUnitPrice == null || Number.isFinite(summary.averageUnitPrice));
    assert.ok(rows[0]?.shareOfProductRevenue != null && Number.isFinite(rows[0].shareOfProductRevenue));
  });

  it("produto sem compradores retorna summary zerado seguro", () => {
    const { summary, rows } = aggregateSoldProductCustomers([], new Map(), REF);
    assert.equal(summary.customersCount, 0);
    assert.equal(summary.totalQuantity, 0);
    assert.equal(summary.totalRevenue, 0);
    assert.deepEqual(rows, []);
  });

  it("suggestedAction é determinística", () => {
    assert.equal(
      buildSoldProductSuggestedAction({
        ordersCount: 1,
        daysSinceLastPurchase: 200,
        averageUnitPrice: 10,
        lastUnitPrice: 10,
        productAverageUnitPrice: 12,
        overdueAmount: 0,
      }),
      "Cliente inativo para este produto"
    );
    assert.equal(
      buildSoldProductSuggestedAction({
        ordersCount: 3,
        daysSinceLastPurchase: 30,
        averageUnitPrice: 10,
        lastUnitPrice: 10,
        productAverageUnitPrice: 12,
        overdueAmount: 500,
      }),
      "Avaliar inadimplência antes da abordagem"
    );
    assert.equal(
      buildSoldProductSuggestedAction({
        ordersCount: 3,
        daysSinceLastPurchase: 30,
        averageUnitPrice: 10,
        lastUnitPrice: 10,
        productAverageUnitPrice: 12,
        overdueAmount: 0,
      }),
      "Bom alvo para promoção"
    );
  });

  it("filtros pós-consulta respeitam quantidade mínima e inatividade", () => {
    const rows = [
      {
        customerId: "c1",
        customerName: "A",
        customerCnpj: null,
        ordersCount: 2,
        quantity: 5,
        totalRevenue: 500,
        averageUnitPrice: 100,
        minUnitPrice: 100,
        maxUnitPrice: 100,
        lastUnitPrice: 100,
        firstPurchaseDate: "2026-01-01",
        lastPurchaseDate: "2026-01-01",
        daysSinceLastPurchase: 200,
        averageDaysBetweenPurchases: null,
        averageDaysBetweenPurchasesLabel: "Histórico insuficiente",
        shareOfProductRevenue: 50,
        shareOfCustomerRevenue: 50,
        commercialHealth: "Inativo",
        suggestedAction: "Cliente inativo para este produto",
        customerCode: null,
        city: null,
        state: "SP",
        region: "Sudeste",
        commercialOwner: null,
        openPortfolioAmount: 0,
        overdueAmount: 0,
      },
    ];
    const filtered = applySoldProductCustomerPostFilters(rows, {
      minQuantity: 10,
      activityFilter: "all",
      onlyWithoutOverdue: false,
      sortBy: "totalRevenue",
      sortDirection: "desc",
      topN: null,
    });
    assert.equal(filtered.length, 0);

    const inactiveOnly = applySoldProductCustomerPostFilters(rows, {
      activityFilter: "inactive",
      onlyWithoutOverdue: false,
      sortBy: "totalRevenue",
      sortDirection: "desc",
      topN: null,
    });
    assert.equal(inactiveOnly.length, 1);
    assert.equal(SOLD_PRODUCT_INACTIVE_DAYS, 180);
  });

  it("ordenação por receita funciona", () => {
    const rows = [
      {
        customerId: "c1",
        customerName: "A",
        customerCnpj: null,
        ordersCount: 1,
        quantity: 1,
        totalRevenue: 100,
        averageUnitPrice: 100,
        minUnitPrice: 100,
        maxUnitPrice: 100,
        lastUnitPrice: 100,
        firstPurchaseDate: null,
        lastPurchaseDate: null,
        daysSinceLastPurchase: 10,
        averageDaysBetweenPurchases: null,
        averageDaysBetweenPurchasesLabel: "Histórico insuficiente",
        shareOfProductRevenue: 50,
        shareOfCustomerRevenue: 50,
        commercialHealth: "Ativo",
        suggestedAction: "Abordar",
        customerCode: null,
        city: null,
        state: null,
        region: null,
        commercialOwner: null,
        openPortfolioAmount: null,
        overdueAmount: null,
      },
      {
        customerId: "c2",
        customerName: "B",
        customerCnpj: null,
        ordersCount: 1,
        quantity: 1,
        totalRevenue: 500,
        averageUnitPrice: 500,
        minUnitPrice: 500,
        maxUnitPrice: 500,
        lastUnitPrice: 500,
        firstPurchaseDate: null,
        lastPurchaseDate: null,
        daysSinceLastPurchase: 10,
        averageDaysBetweenPurchases: null,
        averageDaysBetweenPurchasesLabel: "Histórico insuficiente",
        shareOfProductRevenue: 50,
        shareOfCustomerRevenue: 50,
        commercialHealth: "Ativo",
        suggestedAction: "Abordar",
        customerCode: null,
        city: null,
        state: null,
        region: null,
        commercialOwner: null,
        openPortfolioAmount: null,
        overdueAmount: null,
      },
    ];
    const sorted = sortSoldProductCustomerRows(rows, {
      sortBy: "totalRevenue",
      sortDirection: "desc",
      activityFilter: "all",
      onlyWithoutOverdue: false,
      topN: null,
    });
    assert.equal(sorted[0]?.customerId, "c2");
  });
});

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}
