import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("Pedidos de Venda abre com ano e mês correntes", () => {
  const page = readFileSync(
    join(process.cwd(), "src", "components", "SalesOrdersModule.tsx"),
    "utf8"
  );
  assert.ok(page.includes("const currentMonth = useMemo(() => new Date().getMonth() + 1, [])"));
  assert.ok(page.includes('useState<string>(() => String(currentYear))'));
  assert.ok(page.includes('useState<string>(() => String(currentMonth))'));
});

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
  assert.ok(page.includes('params.set("hasInvoice", appliedFilters.hasInvoice)'));
  assert.ok(page.includes('setHasInvoice("")'));
});

test("Pedidos de Venda tem filtro Valor De/Até com atalhos", () => {
  const page = readFileSync(
    join(process.cwd(), "src", "components", "SalesOrdersModule.tsx"),
    "utf8"
  );
  assert.ok(page.includes('params.set("minNetValue", appliedFilters.minNetValue)'));
  assert.ok(page.includes('params.set("maxNetValue", appliedFilters.maxNetValue)'));
  assert.ok(page.includes("sales-orders-filter-net-value"));
  assert.ok(page.includes("SALES_ORDER_NET_VALUE_PRESETS"));
  assert.ok(page.includes('setMinNetValue("")'));
  assert.ok(page.includes('setMaxNetValue("")'));
  assert.ok(page.includes("sales-orders-apply-filters"));
  assert.ok(page.includes("applyListFilters"));
  assert.ok(page.includes("appliedFilters"));
});

test("filtro de valor não entra nos gráficos mensais", () => {
  const page = readFileSync(
    join(process.cwd(), "src", "components", "SalesOrdersModule.tsx"),
    "utf8"
  );
  const charts = readFileSync(
    join(process.cwd(), "src", "components", "sales", "SalesOrderListMonthlyCharts.tsx"),
    "utf8"
  );
  assert.ok(page.includes("Valor líquido De/Até filtra só o grid"));
  const chartsBlock = page.slice(
    page.indexOf("const monthlyChartsFilters"),
    page.indexOf("const applyListFilters")
  );
  assert.ok(!chartsBlock.includes("minNetValue"));
  assert.ok(!chartsBlock.includes("maxNetValue"));
  assert.ok(!charts.includes("filters.minNetValue"));
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
