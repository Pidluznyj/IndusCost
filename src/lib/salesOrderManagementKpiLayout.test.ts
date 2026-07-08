import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

describe("salesOrderManagementKpiLayout", () => {
  it("1. gestão renderiza blocos na nova ordem", () => {
    const dashboard = read("src/components/sales/SalesOrderManagementKpiDashboard.tsx");
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /SalesOrderManagementKpiDashboard/);
    const overviewIdx = dashboard.indexOf('testId="sales-order-management-overview"');
    const marginIdx = dashboard.indexOf("<SalesOrderManagementMarginOverview");
    const alertsIdx = dashboard.indexOf('testId="sales-order-management-alerts"');
    const secondaryIdx = dashboard.indexOf("<SalesOrderManagementKpiSecondaryPanel");
    assert.ok(overviewIdx >= 0);
    assert.ok(marginIdx > overviewIdx);
    assert.ok(alertsIdx > marginIdx);
    assert.ok(secondaryIdx > alertsIdx);
  });

  it("2. bloco Visão Geral aparece primeiro com no máximo 5 cards principais", () => {
    const dashboard = read("src/components/sales/SalesOrderManagementKpiDashboard.tsx");
    const labels = read("src/lib/salesOrderManagementKpiLabels.ts");
    assert.match(labels, /Visão Geral/);
    assert.match(dashboard, /SALES_ORDER_MGMT_KPI_SECTIONS\.overview/);
    assert.match(dashboard, /Total de pedidos/);
    assert.match(dashboard, /Valor vendido/);
    assert.match(dashboard, /Valor faturado/);
    assert.match(dashboard, /Gap vendido × faturado/);
    assert.match(dashboard, /% no prazo/);
    const overviewBlock = dashboard.slice(
      dashboard.indexOf('testId="sales-order-management-overview"'),
      dashboard.indexOf("<SalesOrderManagementMarginOverview")
    );
    const metricCardsInOverview = (overviewBlock.match(/<MetricCard[\s\n/>]/g) ?? []).length;
    assert.equal(metricCardsInOverview, 5);
  });

  it("3. bloco Alertas aparece antes dos blocos secundários", () => {
    const dashboard = read("src/components/sales/SalesOrderManagementKpiDashboard.tsx");
    const alertsIdx = dashboard.indexOf('testId="sales-order-management-alerts"');
    const secondaryIdx = dashboard.indexOf("<SalesOrderManagementKpiSecondaryPanel");
    assert.ok(alertsIdx < secondaryIdx);
  });

  it("4. logística separada de margem via abas secundárias", () => {
    const secondary = read("src/components/sales/SalesOrderManagementKpiSecondaryPanel.tsx");
    const marginOverview = read("src/components/sales/SalesOrderManagementMarginOverview.tsx");
    assert.match(secondary, /sales-order-management-logistics/);
    assert.match(secondary, /sales-order-management-economic-summary/);
    assert.match(secondary, /sales-order-margin-drill-/);
    assert.match(marginOverview, /amountFormat="currency"/);
    assert.match(marginOverview, /amountFormat="percent"/);
  });

  it("5. cards principais usam MetricCard oficial com superfície visível", () => {
    const css = read("src/components/ui/metric-card.css");
    const section = read("src/components/sales/SalesOrderKpiSection.tsx");
    assert.match(css, /background:\s*var\(--color-card/);
    assert.match(css, /metric-card-grid > \*/);
    assert.match(css, /overflow:\s*hidden/);
    assert.match(css, /box-shadow:/);
    assert.match(section, /data-panel/);
    assert.match(section, /bg-card shadow-sm/);
  });

  it("6. cards de alerta usam compact e variantes semânticas", () => {
    const dashboard = read("src/components/sales/SalesOrderManagementKpiDashboard.tsx");
    assert.match(dashboard, /sales-order-alert-card-/);
    assert.match(dashboard, /compact/);
    assert.match(dashboard, /resolveNegativeMarginCountVariant/);
    assert.match(dashboard, /resolveAlertCountVariant/);
  });

  it("7. alertas acionáveis aplicam filtros existentes", () => {
    const dashboard = read("src/components/sales/SalesOrderManagementKpiDashboard.tsx");
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(dashboard, /onToggleInvoiceFilter/);
    assert.match(dashboard, /onToggleMarginStatusFilter/);
    assert.match(page, /marginStatus/);
    assert.match(page, /clear-management-margin-status-filter/);
  });

  it("8. diagnóstico UX e performance documentado", () => {
    const ux = read("docs/sales-order-cards-ux-diagnosis.md");
    const perf = read("docs/sales-order-dashboard-ux-performance-diagnosis.md");
    assert.match(ux, /Pedidos de Venda/);
    assert.match(perf, /transparentes/);
    assert.match(perf, /lazy/);
  });

  it("9. listagem usa seção Visão Geral com MetricCard e grid executivo", () => {
    const list = read("src/components/sales/SalesOrderListSummaryCards.tsx");
    const module = read("src/components/SalesOrdersModule.tsx");
    assert.match(list, /sales-order-list-overview/);
    assert.match(list, /Pedidos filtrados/);
    assert.match(list, /Valor vendido/);
    assert.match(list, /sales-order-list-summary-grid/);
    assert.match(module, /SalesOrderListSummaryCards/);
    assert.doesNotMatch(module, /FinanceBiKpiCard/);
  });

  it("10. fulfillment monolítico removido da página principal", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.doesNotMatch(page, /SalesOrderManagementFulfillmentKpis/);
    assert.doesNotMatch(page, /Indicadores de fulfillment \(NF-e\)/);
  });
});

describe("salesOrderManagementKpiLayout — performance e regressão", () => {
  it("dashboard e listagem memoizados", () => {
    const dashboard = read("src/components/sales/SalesOrderManagementKpiDashboard.tsx");
    const list = read("src/components/sales/SalesOrderListSummaryCards.tsx");
    assert.match(dashboard, /memo\(function SalesOrderManagementKpiDashboard/);
    assert.match(list, /memo\(function SalesOrderListSummaryCards/);
    assert.match(read("src/components/sales/SalesOrderManagementKpiSecondaryPanel.tsx"), /memo\(/);
  });

  it("gráficos fulfillment carregados com lazy + suspense", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /lazy\(/);
    assert.match(page, /Suspense/);
    assert.match(page, /sales-order-fulfillment-charts-skeleton/);
  });

  it("margem só aparece na aba quando consolidated existe", () => {
    const secondary = read("src/components/sales/SalesOrderManagementKpiSecondaryPanel.tsx");
    assert.match(secondary, /showEconomics/);
    assert.match(secondary, /marginEconomics\?\.consolidated/);
  });

  it("MetricCard loading usa skeleton, não valor zero", () => {
    const card = read("src/components/ui/MetricCard.tsx");
    assert.match(card, /metric-card-loading/);
    assert.match(card, /loading \?/);
  });

  it("filtros, busca e paginação preservados na gestão", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /params\.set\("q", search\)/);
    assert.match(page, /setPage\(/);
    assert.match(page, /SalesOrderManagementFiltersBar/);
  });

  it("helpers de métrica não alteram cálculo de negócio", () => {
    const helpers = read("src/lib/salesOrderManagementMetricCards.ts");
    assert.doesNotMatch(helpers, /buildSalesOrderManagement/);
    assert.doesNotMatch(helpers, /marginValue\s*=/);
  });

  it("cards não importam Prisma", () => {
    for (const file of [
      "src/components/ui/MetricCard.tsx",
      "src/components/sales/SalesOrderManagementKpiDashboard.tsx",
      "src/components/sales/SalesOrderListSummaryCards.tsx",
    ]) {
      const src = read(file);
      assert.doesNotMatch(src, /@prisma\/client/);
    }
  });
});
