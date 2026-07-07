import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  formatOrderCountLabel,
  resolveAlertCountVariant,
  resolveFulfillmentKpiVariant,
  resolveLogisticStatusCardVariant,
  resolveMarginMoneyVariant,
  resolveMarginPercentVariant,
  resolveNegativeMarginCountVariant,
  toFiniteMetricNumber,
} from "./salesOrderManagementMetricCards.js";
import { formatCompactCurrency, resolveMetricDisplay } from "./formatFinancialMetric.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("salesOrderManagementMetricCards", () => {
  it("1. Gestão de Pedidos renderiza cards com MetricCard oficial", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    const dashboard = read("src/components/sales/SalesOrderManagementKpiDashboard.tsx");
    assert.match(page, /SalesOrderManagementKpiDashboard/);
    assert.match(dashboard, /MetricCard/);
    assert.match(dashboard, /SummaryKpiGrid/);
    assert.doesNotMatch(page, /FinanceBiKpiCard/);
  });

  it("2. valor grande não é truncado com reticências", () => {
    const resolved = resolveMetricDisplay({
      amount: 12_400_000,
      amountFormat: "currency",
    });
    assert.ok(!resolved.display.includes("..."));
    assert.ok(!resolved.display.includes("…"));
    assert.ok(resolved.title);
  });

  it("3. valor monetário compacto exibe corretamente", () => {
    const display = formatCompactCurrency(1_320_000);
    assert.match(display, /Mi|mil/);
    const resolved = resolveMetricDisplay({ amount: 1_320_000, amountFormat: "currency" });
    assert.equal(resolved.display, display);
  });

  it("4. valor percentual exibe corretamente", () => {
    const resolved = resolveMetricDisplay({ amount: 88.7, amountFormat: "percent" });
    assert.match(resolved.display, /%/);
  });

  it("5. valor null/undefined exibe em dash", () => {
    assert.equal(toFiniteMetricNumber(null), null);
    assert.equal(toFiniteMetricNumber(undefined), null);
    assert.equal(formatOrderCountLabel(null), "—");
    const resolved = resolveMetricDisplay({ amount: null, amountFormat: "currency" });
    assert.equal(resolved.display, "—");
  });

  it("6. card positivo usa variant success", () => {
    assert.equal(resolveLogisticStatusCardVariant("deliveredOnTime"), "success");
    assert.equal(resolveMarginMoneyVariant(1500), "success");
  });

  it("7. card de alerta usa variant warning", () => {
    assert.equal(resolveLogisticStatusCardVariant("reviewData"), "warning");
    assert.equal(resolveAlertCountVariant(3), "warning");
  });

  it("8. card de problema usa variant danger", () => {
    assert.equal(resolveLogisticStatusCardVariant("overduePending"), "danger");
    assert.equal(resolveFulfillmentKpiVariant("late", 2), "danger");
  });

  it("9. margem negativa aparece com destaque danger", () => {
    assert.equal(resolveMarginMoneyVariant(-100), "danger");
    assert.equal(resolveNegativeMarginCountVariant(4), "danger");
  });

  it("10. sem custo/sem produto aparece como alerta", () => {
    assert.equal(resolveAlertCountVariant(1), "warning");
    assert.equal(resolveAlertCountVariant(0), "neutral");
  });

  it("11. status logístico separado de margem na página", () => {
    const dashboard = read("src/components/sales/SalesOrderManagementKpiDashboard.tsx");
    const logisticsIdx = dashboard.indexOf("sales-order-management-logistics");
    const marginIdx = dashboard.indexOf("sales-order-management-economic-summary");
    assert.ok(logisticsIdx >= 0 && marginIdx > logisticsIdx);
    assert.match(dashboard, /resolveLogisticStatusCardVariant/);
    assert.match(dashboard, /resolveMarginMoneyVariant/);
  });

  it("12–14. filtros, busca e paginação preservados", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    const bar = read("src/components/sales/SalesOrderManagementFiltersBar.tsx");
    const dashboard = read("src/components/sales/SalesOrderManagementKpiDashboard.tsx");
    assert.match(dashboard, /onToggleLogisticStatus/);
    assert.match(page, /setSearch\(/);
    assert.match(page, /setPage\(/);
    assert.match(bar, /CustomerAutocompleteFilter/);
  });

  it("15. nenhuma regra de negócio alterada nos helpers", () => {
    const helpers = read("src/lib/salesOrderManagementMetricCards.ts");
    assert.doesNotMatch(helpers, /prisma|PrismaClient/);
    assert.doesNotMatch(helpers, /marginValue\s*=/);
    assert.doesNotMatch(helpers, /buildSalesOrder/);
  });

  it("16. MetricCard não importa Prisma", () => {
    const card = read("src/components/ui/MetricCard.tsx");
    assert.doesNotMatch(card, /prisma|PrismaClient/);
  });

  it("drawer e análise econômica usam MetricCard", () => {
    const panel = read("src/components/sales/SalesOrderEconomicAnalysisPanel.tsx");
    const grid = read("src/components/sales/SalesOrderMarginMetricGrid.tsx");
    assert.match(panel, /SalesOrderMarginMetricGrid/);
    assert.match(grid, /MetricCard/);
  });

  it("margem % baixa usa warning", () => {
    assert.equal(resolveMarginPercentVariant(5), "warning");
    assert.equal(resolveMarginPercentVariant(-1), "danger");
  });
});
