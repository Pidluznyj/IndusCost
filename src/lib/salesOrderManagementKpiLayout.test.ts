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
    const alertsIdx = dashboard.indexOf('testId="sales-order-management-alerts"');
    const logisticsIdx = dashboard.indexOf('testId="sales-order-management-logistics"');
    const economicsIdx = dashboard.indexOf('testId="sales-order-management-economic-summary"');
    const fulfillmentIdx = dashboard.indexOf('testId="sales-order-management-fulfillment"');
    assert.ok(overviewIdx >= 0);
    assert.ok(alertsIdx > overviewIdx);
    assert.ok(logisticsIdx > alertsIdx);
    assert.ok(economicsIdx > logisticsIdx);
    assert.ok(fulfillmentIdx > economicsIdx);
  });

  it("2. bloco Visão Geral aparece primeiro", () => {
    const dashboard = read("src/components/sales/SalesOrderManagementKpiDashboard.tsx");
    const labels = read("src/lib/salesOrderManagementKpiLabels.ts");
    assert.match(labels, /Visão Geral/);
    assert.match(dashboard, /SALES_ORDER_MGMT_KPI_SECTIONS\.overview/);
    assert.match(dashboard, /Total de pedidos/);
    assert.match(dashboard, /Valor vendido/);
    assert.match(dashboard, /Valor faturado/);
    assert.match(dashboard, /Gap vendido × faturado/);
    assert.match(dashboard, /% no prazo/);
  });

  it("3. bloco Alertas aparece antes dos blocos secundários", () => {
    const dashboard = read("src/components/sales/SalesOrderManagementKpiDashboard.tsx");
    const alertsIdx = dashboard.indexOf('testId="sales-order-management-alerts"');
    const logisticsIdx = dashboard.indexOf('testId="sales-order-management-logistics"');
    assert.ok(alertsIdx < logisticsIdx);
  });

  it("4. logística separada de análise econômica", () => {
    const dashboard = read("src/components/sales/SalesOrderManagementKpiDashboard.tsx");
    const logisticsIdx = dashboard.indexOf('testId="sales-order-management-logistics"');
    const economicsIdx = dashboard.indexOf('testId="sales-order-management-economic-summary"');
    assert.ok(logisticsIdx >= 0 && economicsIdx > logisticsIdx);
    assert.match(dashboard, /management-status-card-total/);
    assert.match(dashboard, /Margem R\$/);
  });

  it("5. cards principais usam MetricCard oficial", () => {
    const dashboard = read("src/components/sales/SalesOrderManagementKpiDashboard.tsx");
    assert.match(dashboard, /MetricCard/);
    assert.match(dashboard, /MetricCardGrid/);
    assert.doesNotMatch(dashboard, /FinanceBiKpiCard/);
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
    assert.match(dashboard, /onToggleReviewDataFilter/);
    assert.match(dashboard, /onToggleCutFilter/);
    assert.match(page, /onToggleOverdueOnly/);
    assert.match(dashboard, /data-filter-disabled/);
  });

  it("8. diagnóstico UX documentado", () => {
    const doc = read("docs/sales-order-cards-ux-diagnosis.md");
    assert.match(doc, /Pedidos de Venda/);
    assert.match(doc, /Gestão de Pedidos/);
    assert.match(doc, /Visão Geral/);
  });

  it("9. listagem usa seção Visão Geral com MetricCard", () => {
    const list = read("src/components/sales/SalesOrderListSummaryCards.tsx");
    const module = read("src/components/SalesOrdersModule.tsx");
    assert.match(list, /sales-order-list-overview/);
    assert.match(list, /Valor vendido/);
    assert.match(module, /SalesOrderListSummaryCards/);
    assert.doesNotMatch(module, /FinanceBiKpiCard/);
  });

  it("10. fulfillment monolítico removido da página principal", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.doesNotMatch(page, /SalesOrderManagementFulfillmentKpis/);
    assert.doesNotMatch(page, /Indicadores de fulfillment \(NF-e\)/);
  });
});

describe("salesOrderManagementKpiLayout — regressão", () => {
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
});
