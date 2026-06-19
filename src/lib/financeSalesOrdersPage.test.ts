import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("financeSalesOrdersPage", () => {
  it("aba Financeiro → Pedidos de Venda existe", () => {
    assert.match(read("src/lib/financeNavigation.ts"), /sales-orders/);
    assert.match(read("src/lib/financeNavigation.ts"), /Pedidos de Venda/);
    assert.match(read("src/components/FinanceModule.tsx"), /FinanceSalesOrdersPage/);
    assert.match(read("src/components/FinanceModule.tsx"), /sales-orders/);
  });

  it("rota /finance/sales-orders existe", () => {
    assert.equal(
      read("src/lib/financeNavigation.ts").includes('"/finance/sales-orders"'),
      true
    );
  });

  it("header correto", () => {
    const page = read("src/components/finance/FinanceSalesOrdersPage.tsx");
    assert.match(page, /title="Pedidos de Venda"/);
    assert.match(page, /Visão financeira dos pedidos emitidos/);
  });

  it("cards principais aparecem", () => {
    const page = read("src/components/finance/FinanceSalesOrdersPage.tsx");
    assert.match(page, /Vendido no mês/);
    assert.match(page, /Vendido YTD/);
    assert.match(page, /Meta mês/);
    assert.match(page, /Carteira aberta/);
    assert.match(page, /FinanceKpiCard/);
  });

  it("filtros aparecem", () => {
    const page = read("src/components/finance/FinanceSalesOrdersPage.tsx");
    assert.match(page, /FinanceBiFilterPanel/);
    assert.match(page, /CustomerAutocompleteFilter/);
    assert.match(page, /invoiceStatus/);
  });

  it("gráficos e leitura do cenário", () => {
    const page = read("src/components/finance/FinanceSalesOrdersPage.tsx");
    assert.match(page, /FinanceSalesOrdersMonthlyChart/);
    assert.match(page, /FinanceSalesOrdersProjectionChart/);
    assert.match(page, /ExecutiveChartScenario/);
    assert.match(page, /buildFinanceSalesOrdersMonthlyComparisonNarrative/);
  });

  it("labels nos gráficos", () => {
    const monthly = read("src/components/finance/sales-orders/FinanceSalesOrdersMonthlyChart.tsx");
    const projection = read("src/components/finance/sales-orders/FinanceSalesOrdersProjectionChart.tsx");
    assert.match(monthly, /LabelList/);
    assert.match(monthly, /ChartBarValueLabel/);
    assert.match(projection, /LabelList/);
  });

  it("export CSV e auditoria", () => {
    const page = read("src/components/finance/FinanceSalesOrdersPage.tsx");
    assert.match(page, /Exportar CSV/);
    assert.match(page, /FinanceDataAuditDrawer/);
    assert.match(page, /\/api\/finance\/sales-orders\/export/);
  });

  it("não importa Prisma no frontend", () => {
    assert.doesNotMatch(read("src/components/finance/FinanceSalesOrdersPage.tsx"), /@prisma\/client/);
  });
});
