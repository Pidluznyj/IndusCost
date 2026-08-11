import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type {
  SoldProductsCustomerMixRow,
  SoldProductsDetailRow,
  SoldProductsMonthlyEvolutionRow,
  SoldProductsRankingRow,
} from "./salesProductRankingTypes.js";
import {
  compareNullableValues,
  DEFAULT_RANKING_SORT,
  prepareRankingTableRows,
  sortCustomerMixRows,
  sortDetailRows,
  sortMonthlyEvolutionRows,
  sortRankingRows,
  sortRows,
  toggleSortState,
} from "./soldProductsTableSort.js";

function rankingRow(partial: Partial<SoldProductsRankingRow> & Pick<SoldProductsRankingRow, "productId">): SoldProductsRankingRow {
  return {
    rank: partial.rank ?? 1,
    productCode: partial.productCode ?? "P1",
    productName: partial.productName ?? "Produto Alpha",
    ncm: partial.ncm ?? null,
    quantitySold: partial.quantitySold ?? 10,
    amountSold: partial.amountSold ?? 100,
    averageUnitPrice: partial.averageUnitPrice ?? 10,
    ordersCount: partial.ordersCount ?? 1,
    customersCount: partial.customersCount ?? 1,
    lastSaleDate: partial.lastSaleDate ?? "2026-03-15",
    quantitySharePercent: partial.quantitySharePercent ?? 50,
    amountSharePercent: partial.amountSharePercent ?? 50,
    ...partial,
    productId: partial.productId,
  };
}

function customerMixRow(
  partial: Partial<SoldProductsCustomerMixRow> & Pick<SoldProductsCustomerMixRow, "productId" | "customerId">
): SoldProductsCustomerMixRow {
  return {
    productCode: partial.productCode ?? "P1",
    productName: partial.productName ?? "Produto A",
    customerName: partial.customerName ?? "Cliente X",
    customerTaxId: partial.customerTaxId ?? "12345678000199",
    quantitySold: partial.quantitySold ?? 5,
    amountSold: partial.amountSold ?? 50,
    customerSharePercent: partial.customerSharePercent ?? 25,
    ...partial,
    productId: partial.productId,
    customerId: partial.customerId,
  };
}

function monthlyRow(
  partial: Partial<SoldProductsMonthlyEvolutionRow> & Pick<SoldProductsMonthlyEvolutionRow, "productId" | "year" | "month">
): SoldProductsMonthlyEvolutionRow {
  return {
    productCode: partial.productCode ?? "P1",
    productName: partial.productName ?? "Produto A",
    quantitySold: partial.quantitySold ?? 10,
    amountSold: partial.amountSold ?? 100,
    ...partial,
    productId: partial.productId,
    year: partial.year,
    month: partial.month,
  };
}

function detailRow(partial: Partial<SoldProductsDetailRow> & Pick<SoldProductsDetailRow, "orderId">): SoldProductsDetailRow {
  return {
    orderDate: partial.orderDate ?? "2026-03-10",
    orderCode: partial.orderCode ?? "PV-001",
    customerName: partial.customerName ?? "Cliente A",
    customerTaxId: partial.customerTaxId ?? "12345678000199",
    sellerName: partial.sellerName ?? "Vendedor",
    companyLabel: partial.companyLabel ?? "Empresa A",
    productCode: partial.productCode ?? "P1",
    productName: partial.productName ?? "Produto",
    quantity: partial.quantity ?? 1,
    unitPrice: partial.unitPrice ?? 10,
    lineAmount: partial.lineAmount ?? 10,
    orderStatus: partial.orderStatus ?? "SENT_TO_NOMUS",
    orderStatusLabel: partial.orderStatusLabel ?? "Enviado",
    ...partial,
    orderId: partial.orderId,
  };
}

describe("soldProductsTableSort", () => {
  it("sortRows ordena texto corretamente", () => {
    const rows = [{ name: "Zeta" }, { name: "Alpha" }, { name: "Beta" }];
    const sorted = sortRows(rows, { key: "name", direction: "asc" }, {
      name: { get: (r) => r.name, kind: "text" },
    });
    assert.deepEqual(sorted.map((r) => r.name), ["Alpha", "Beta", "Zeta"]);
  });

  it("sortRows ordena número corretamente", () => {
    const rows = [{ qty: 30 }, { qty: 5 }, { qty: 100 }];
    const sorted = sortRows(rows, { key: "qty", direction: "desc" }, {
      qty: { get: (r) => r.qty, kind: "number" },
    });
    assert.deepEqual(sorted.map((r) => r.qty), [100, 30, 5]);
  });

  it("sortRows ordena valor monetário usando número real", () => {
    const rows = [
      rankingRow({ productId: "a", amountSold: 1500.5 }),
      rankingRow({ productId: "b", amountSold: 999.99 }),
      rankingRow({ productId: "c", amountSold: 2500 }),
    ];
    const sorted = sortRankingRows(rows, { key: "amountSold", direction: "asc" });
    assert.deepEqual(sorted.map((r) => r.productId), ["b", "a", "c"]);
  });

  it("sortRows ordena datas corretamente", () => {
    const rows = [
      detailRow({ orderId: "1", orderDate: "2026-01-15" }),
      detailRow({ orderId: "2", orderDate: "2025-12-31" }),
      detailRow({ orderId: "3", orderDate: "2026-06-01" }),
    ];
    const sorted = sortDetailRows(rows, { key: "orderDate", direction: "asc" });
    assert.deepEqual(sorted.map((r) => r.orderId), ["2", "1", "3"]);
  });

  it("compareNullableValues joga null/vazio para o fim", () => {
    const rows = [
      rankingRow({ productId: "a", productCode: "A" }),
      rankingRow({ productId: "b", productCode: null }),
      rankingRow({ productId: "c", productCode: "C" }),
    ];
    const sorted = sortRankingRows(rows, { key: "productCode", direction: "asc" });
    assert.equal(sorted[2]?.productId, "b");
  });

  it("ranking ordena por quantidade desc/asc", () => {
    const rows = [
      rankingRow({ productId: "a", quantitySold: 10 }),
      rankingRow({ productId: "b", quantitySold: 50 }),
      rankingRow({ productId: "c", quantitySold: 25 }),
    ];
    const desc = sortRankingRows(rows, { key: "quantitySold", direction: "desc" });
    assert.deepEqual(desc.map((r) => r.productId), ["b", "c", "a"]);
    const asc = sortRankingRows(rows, { key: "quantitySold", direction: "asc" });
    assert.deepEqual(asc.map((r) => r.productId), ["a", "c", "b"]);
  });

  it("ranking ordena por valor desc/asc", () => {
    const rows = [
      rankingRow({ productId: "a", amountSold: 100 }),
      rankingRow({ productId: "b", amountSold: 500 }),
      rankingRow({ productId: "c", amountSold: 200 }),
    ];
    const desc = sortRankingRows(rows, { key: "amountSold", direction: "desc" });
    assert.deepEqual(desc.map((r) => r.productId), ["b", "c", "a"]);
    const asc = sortRankingRows(rows, { key: "amountSold", direction: "asc" });
    assert.deepEqual(asc.map((r) => r.productId), ["a", "c", "b"]);
  });

  it("ranking ordena por produto asc/desc", () => {
    const rows = [
      rankingRow({ productId: "a", productName: "Zebra" }),
      rankingRow({ productId: "b", productName: "Alpha" }),
      rankingRow({ productId: "c", productName: "Mango" }),
    ];
    const asc = sortRankingRows(rows, { key: "productName", direction: "asc" });
    assert.deepEqual(asc.map((r) => r.productName), ["Alpha", "Mango", "Zebra"]);
    const desc = sortRankingRows(rows, { key: "productName", direction: "desc" });
    assert.deepEqual(desc.map((r) => r.productName), ["Zebra", "Mango", "Alpha"]);
  });

  it("produto x cliente ordena por cliente", () => {
    const rows = [
      customerMixRow({ productId: "p1", customerId: "c1", customerName: "Zeta Ltda" }),
      customerMixRow({ productId: "p1", customerId: "c2", customerName: "Alpha SA" }),
      customerMixRow({ productId: "p1", customerId: "c3", customerName: "Beta ME" }),
    ];
    const sorted = sortCustomerMixRows(rows, { key: "customerName", direction: "asc" });
    assert.deepEqual(sorted.map((r) => r.customerName), ["Alpha SA", "Beta ME", "Zeta Ltda"]);
  });

  it("produto x cliente ordena por quantidade", () => {
    const rows = [
      customerMixRow({ productId: "p1", customerId: "c1", quantitySold: 5 }),
      customerMixRow({ productId: "p1", customerId: "c2", quantitySold: 20 }),
      customerMixRow({ productId: "p1", customerId: "c3", quantitySold: 12 }),
    ];
    const sorted = sortCustomerMixRows(rows, { key: "quantitySold", direction: "desc" });
    assert.deepEqual(sorted.map((r) => r.quantitySold), [20, 12, 5]);
  });

  it("evolução mensal ordena mês cronologicamente", () => {
    const rows = [
      monthlyRow({ productId: "p1", year: 2026, month: 3 }),
      monthlyRow({ productId: "p1", year: 2025, month: 12 }),
      monthlyRow({ productId: "p1", year: 2026, month: 1 }),
    ];
    const sorted = sortMonthlyEvolutionRows(rows, { key: "period", direction: "asc" });
    assert.deepEqual(
      sorted.map((r) => `${r.year}-${r.month}`),
      ["2025-12", "2026-1", "2026-3"]
    );
  });

  it("detalhamento ordena por data", () => {
    const rows = [
      detailRow({ orderId: "1", orderDate: "2026-02-01" }),
      detailRow({ orderId: "2", orderDate: "2026-01-01" }),
      detailRow({ orderId: "3", orderDate: "2026-03-01" }),
    ];
    const sorted = sortDetailRows(rows, { key: "orderDate", direction: "desc" });
    assert.deepEqual(sorted.map((r) => r.orderId), ["3", "1", "2"]);
  });

  it("detalhamento ordena por valor total", () => {
    const rows = [
      detailRow({ orderId: "1", lineAmount: 100 }),
      detailRow({ orderId: "2", lineAmount: 500 }),
      detailRow({ orderId: "3", lineAmount: 250 }),
    ];
    const sorted = sortDetailRows(rows, { key: "lineAmount", direction: "desc" });
    assert.deepEqual(sorted.map((r) => r.lineAmount), [500, 250, 100]);
  });

  it("busca local + ordenação funcionam juntas", () => {
    const rows = [
      rankingRow({ productId: "a", productName: "Parafuso A", quantitySold: 10 }),
      rankingRow({ productId: "b", productName: "Parafuso B", quantitySold: 50 }),
      rankingRow({ productId: "c", productName: "Porca C", quantitySold: 30 }),
    ];
    const result = prepareRankingTableRows(rows, "parafuso", { key: "quantitySold", direction: "desc" });
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((r) => r.productId), ["b", "a"]);
  });

  it("busca rápida também localiza por NCM; ordenação pela coluna NCM funciona", () => {
    const rows = [
      rankingRow({ productId: "a", productName: "Tampa", ncm: "39269090" }),
      rankingRow({ productId: "b", productName: "Caixa", ncm: "48191000" }),
      rankingRow({ productId: "c", productName: "Sem Cadastro", ncm: null }),
    ];
    const found = prepareRankingTableRows(rows, "48191000", { key: "quantitySold", direction: "desc" });
    assert.deepEqual(found.map((r) => r.productId), ["b"]);
    const sorted = prepareRankingTableRows(rows, "", { key: "ncm", direction: "asc" });
    assert.deepEqual(sorted.map((r) => r.ncm), ["39269090", "48191000", null]);
  });

  it("CSV do ranking usa lista ordenada/filtrada localmente", () => {
    const rows = [
      rankingRow({ productId: "a", productName: "Alpha", productCode: "A", rank: 1, quantitySold: 5 }),
      rankingRow({ productId: "b", productName: "Beta", productCode: "B", rank: 2, quantitySold: 20 }),
    ];
    const visible = prepareRankingTableRows(rows, "", { key: "quantitySold", direction: "desc" });
    const csvLine = visible.map((r) => r.productCode).join(";");
    assert.equal(csvLine, "B;A");
  });

  it("toggleSortState alterna direção na mesma coluna", () => {
    const first = toggleSortState(DEFAULT_RANKING_SORT, "productName", "asc");
    assert.deepEqual(first, { key: "productName", direction: "asc" });
    const second = toggleSortState(first, "productName", "asc");
    assert.deepEqual(second, { key: "productName", direction: "desc" });
  });

  it("compareNullableValues não ordena strings formatadas como moeda", () => {
    assert.ok(compareNullableValues(200, 1000, "number", "asc") < 0);
    assert.ok(compareNullableValues("R$ 2.000,00", "R$ 1.000,00", "text", "asc") > 0);
  });

  it("página contém headers clicáveis com texto/indicador de sort", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "commercial", "SoldProductsReportPage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("SortableTh"));
    assert.ok(page.includes("Clique para ordenar"));
    assert.ok(page.includes("sortIndicator"));
    assert.ok(page.includes("toggleSortState"));
    assert.ok(page.includes("prepareRankingTableRows"));
    assert.ok(page.includes("displayedRankingRows"));
  });
});
