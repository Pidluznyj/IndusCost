import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("Pedidos de Venda usa CustomerAutocompleteFilter", () => {
  const page = readFileSync(
    join(process.cwd(), "src", "components", "SalesOrdersModule.tsx"),
    "utf8"
  );
  assert.ok(page.includes("CustomerAutocompleteFilter"));
  assert.ok(!page.includes('fetchJsonOk<Customer[]>("/api/customers")'));
  assert.ok(page.includes("customerId"));
});

test("limpar filtros limpa seleção de cliente", () => {
  const page = readFileSync(
    join(process.cwd(), "src", "components", "SalesOrdersModule.tsx"),
    "utf8"
  );
  assert.ok(page.includes("setCustomerSelection(null)"));
});

test("Resultado tem filtro Vínculo NF (Com NF / Sem NF)", () => {
  const page = readFileSync(
    join(process.cwd(), "src", "components", "SalesOrdersModule.tsx"),
    "utf8"
  );
  assert.ok(page.includes("INVOICE_FILTER_OPTIONS"));
  assert.ok(page.includes('params.set("hasInvoice", hasInvoice)'));
  assert.ok(page.includes("setHasInvoice(\"\")"));
});

test("Produtos Vendidos usa autocomplete no filtro de cliente", () => {
  const page = readFileSync(
    join(process.cwd(), "src", "components", "commercial", "SoldProductsReportPage.tsx"),
    "utf8"
  );
  assert.ok(page.includes("CustomerAutocompleteFilter"));
  assert.ok(page.includes("draftFilters"));
  assert.ok(page.includes("appliedFilters"));
});

test("exportação Produtos Vendidos usa appliedFilters", () => {
  const page = readFileSync(
    join(process.cwd(), "src", "components", "commercial", "SoldProductsReportPage.tsx"),
    "utf8"
  );
  assert.ok(page.includes("buildSoldProductsDashboardQuery(appliedFilters"));
});
