import assert from "node:assert/strict";
import test from "node:test";
import {
  filterAndSortPricingRows,
  pricingListSafeNumber,
  type PricingListRow,
} from "./pricingListFilters";

const rows: PricingListRow[] = [
  {
    id: "1",
    productId: "p1",
    taxRuleId: "tax-a",
    desiredMargin: 8,
    commission: 5,
    Product: { name: "Produto Alpha", sku: "ALP-001" },
    TaxRule: { name: "Mercado Interno" },
  },
  {
    id: "2",
    productId: "p2",
    taxRuleId: "tax-b",
    desiredMargin: 22.5,
    commission: 12,
    Product: { name: "Produto Beta", sku: "BET-002" },
    TaxRule: { name: "Exportacao" },
  },
  {
    id: "3",
    productId: "p3",
    taxRuleId: "tax-a",
    desiredMargin: -3,
    commission: 0,
    Product: { name: "Gamma Especial", sku: "GAM-003" },
    TaxRule: { name: "Mercado Interno" },
  },
  {
    id: "4",
    productId: "p4",
    taxRuleId: "tax-a",
    desiredMargin: "texto-invalido",
    commission: null,
    Product: { name: "Item Sem Numero", sku: "SEM-004" },
    TaxRule: { name: "Mercado Interno" },
  },
];

test("busca por nome", () => {
  const result = filterAndSortPricingRows(rows, {
    search: "alpha",
    taxRuleId: "",
    marginBand: "ALL",
    commissionBand: "ALL",
    sortBy: "NAME_ASC",
  });
  assert.deepEqual(result.map((row) => row.id), ["1"]);
});

test("busca por sku", () => {
  const result = filterAndSortPricingRows(rows, {
    search: "bet-002",
    taxRuleId: "",
    marginBand: "ALL",
    commissionBand: "ALL",
    sortBy: "NAME_ASC",
  });
  assert.deepEqual(result.map((row) => row.id), ["2"]);
});

test("filtra por regra tributaria", () => {
  const result = filterAndSortPricingRows(rows, {
    search: "",
    taxRuleId: "tax-b",
    marginBand: "ALL",
    commissionBand: "ALL",
    sortBy: "NAME_ASC",
  });
  assert.deepEqual(result.map((row) => row.id), ["2"]);
});

test("filtra por faixa de margem", () => {
  const result = filterAndSortPricingRows(rows, {
    search: "",
    taxRuleId: "",
    marginBand: "UP_TO_10",
    commissionBand: "ALL",
    sortBy: "NAME_ASC",
  });
  assert.deepEqual(result.map((row) => row.id), ["1"]);
});

test("filtra por comissao e ordena por maior margem", () => {
  const result = filterAndSortPricingRows(rows, {
    search: "",
    taxRuleId: "",
    marginBand: "ALL",
    commissionBand: "ABOVE_10",
    sortBy: "MARGIN_DESC",
  });
  assert.deepEqual(result.map((row) => row.id), ["2"]);
});

test("limpar filtros volta a lista completa", () => {
  const result = filterAndSortPricingRows(rows, {
    search: "",
    taxRuleId: "",
    marginBand: "ALL",
    commissionBand: "ALL",
    sortBy: "NAME_ASC",
  });
  assert.equal(result.length, rows.length);
});

test("safe number evita NaN null undefined", () => {
  assert.equal(pricingListSafeNumber("12.5"), 12.5);
  assert.equal(pricingListSafeNumber(null), null);
  assert.equal(pricingListSafeNumber(undefined), null);
  assert.equal(pricingListSafeNumber("invalido"), null);
});
