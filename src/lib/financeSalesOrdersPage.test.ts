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

    assert.match(page, /Dashboard gerencial de pedidos emitidos|FINANCE_SALES_ORDERS_EXECUTIVE_SUBTITLE/);

  });



  it("cards principais aparecem", () => {

    const page = read("src/components/finance/FinanceSalesOrdersPage.tsx");

    assert.match(page, /Pedidos emitidos/);

    assert.match(page, /Valor total de pedidos/);

    assert.match(page, /Carteira aberta/);

    assert.match(page, /Valor em carteira/);

    assert.match(page, /Pedidos faturados/);

    assert.match(page, /Ticket médio/);

    assert.match(page, /Média diária/);

    assert.match(page, /Meta mês atual/);

    assert.match(page, /Meta não configurada/);

    assert.match(page, /FinanceKpiCard/);

  });

  it("cards financeiros usam amountFormat currency com campos do summary", () => {
    const page = read("src/components/finance/FinanceSalesOrdersPage.tsx");
    assert.match(page, /amountFormat="currency"/);
    assert.match(page, /summary\.totalOrdersAmount/);
    assert.match(page, /summary\.openPortfolioAmount/);
    assert.match(page, /summary\.invoicedOrdersAmount/);
    assert.match(page, /summary\.averageTicketAmount/);
    assert.match(page, /summary\.dailyAverageAmount/);
    assert.match(page, /formatFinanceKpiCurrency/);
  });



  it("filtros aparecem", () => {

    const page = read("src/components/finance/FinanceSalesOrdersPage.tsx");

    assert.match(page, /FinanceBiFilterPanel/);

    assert.match(page, /CustomerAutocompleteFilter/);

    assert.match(page, /invoiceStatus/);

    assert.match(page, /logisticStatus/);

    assert.match(page, /Status logístico BI/);

  });



  it("gráficos e leitura do cenário", () => {

    const page = read("src/components/finance/FinanceSalesOrdersPage.tsx");

    assert.match(page, /FinanceSalesOrdersMonthlyChart/);

    assert.match(page, /FinanceSalesOrdersProjectionChart/);

    assert.match(page, /FinanceSalesOrdersBreakdownChart/);

    assert.match(page, /FinanceSalesOrdersOpenPortfolioChart/);

    assert.match(page, /ExecutiveChartScenario/);

    assert.match(page, /buildFinanceSalesOrdersMonthlyComparisonNarrative/);

    assert.match(page, /Status fabricação/);

    assert.match(page, /Status logístico BI/);

  });



  it("labels nos gráficos", () => {

    const monthly = read("src/components/finance/sales-orders/FinanceSalesOrdersMonthlyChart.tsx");

    const projection = read("src/components/finance/sales-orders/FinanceSalesOrdersProjectionChart.tsx");

    const breakdown = read("src/components/finance/sales-orders/FinanceSalesOrdersBreakdownChart.tsx");

    assert.match(monthly, /LabelList/);

    assert.match(monthly, /ChartBarValueLabel/);

    assert.match(projection, /LabelList/);

    assert.match(breakdown, /LabelList/);

  });



  it("top vendedores e pedidos críticos", () => {

    const page = read("src/components/finance/FinanceSalesOrdersPage.tsx");

    assert.match(page, /Top vendedores/);

    assert.match(page, /Pedidos críticos/);

    assert.match(page, /topSellers/);

    assert.match(page, /criticalOrders/);

  });



  it("export CSV e auditoria", () => {

    const page = read("src/components/finance/FinanceSalesOrdersPage.tsx");

    assert.match(page, /FINANCE_HEADER_ACTION_EXPORT_CSV|Exportar CSV/);

    assert.match(page, /FinanceDataAuditDrawer/);

    assert.match(page, /\/api\/finance\/sales-orders\/export/);

    assert.match(page, /Última sincronização Nomus/);

    assert.match(page, /Critérios de cálculo/);

  });



  it("exibe erro amigável com detalhe da API", () => {

    const page = read("src/components/finance/FinanceSalesOrdersPage.tsx");

    assert.match(page, /console\.error\("FinanceSalesOrdersPage\.load"/);

    assert.match(page, /buildFinanceTabLoadError/);

    assert.match(page, /Não foi possível carregar o dashboard de Pedidos de Venda/);

  });



  it("renderiza estado vazio na tabela de top clientes", () => {

    const page = read("src/components/finance/FinanceSalesOrdersPage.tsx");

    assert.match(page, /FinanceBiEmptyState|FinanceModuleEmptyState/);

    assert.match(page, /topCustomers\.length === 0/);

  });



  it("não regressão: outras abas financeiras não importam página de pedidos", () => {

    const billing = read("src/components/finance/FinanceBillingPage.tsx");

    const ar = read("src/components/finance/FinanceAccountsReceivablePage.tsx");

    assert.doesNotMatch(billing, /FinanceSalesOrdersPage/);

    assert.doesNotMatch(ar, /FinanceSalesOrdersPage/);

  });



  it("não importa Prisma no frontend", () => {

    assert.doesNotMatch(read("src/components/finance/FinanceSalesOrdersPage.tsx"), /@prisma\/client/);

  });

});

