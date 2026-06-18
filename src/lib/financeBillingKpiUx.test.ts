import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildBillingMultiYearMonthlyPoints } from "./financeBillingChartData.js";
import {
  computeFinanceBillingComparisonDelta,
  formatFinanceBillingVariationValue,
} from "./financeBillingExecutiveKpi.js";

const pagePath = join(
  process.cwd(),
  "src",
  "components",
  "finance",
  "FinanceBillingPage.tsx"
);

describe("financeBillingKpiUx", () => {
  it("página Billing usa labels curtos e agrupamento claro no resumo executivo", () => {
    const page = readFileSync(pagePath, "utf8");
    const labels = [
      "Faturamento líquido",
      "Bruto encontrado",
      "NF-e no mês",
      "Ticket médio",
      "Previsto no mês",
      "Diferença vs",
      "Variação vs",
      "Diferença YTD",
      "Variação YTD",
    ];
    for (const label of labels) {
      assert.ok(page.includes(label), `label ausente: ${label}`);
    }
    assert.equal(page.includes("Mês anterior"), false);
    assert.equal(page.includes("Ano anterior"), false);
    assert.equal(page.includes("Faturamento líquido (mês)"), false);
    assert.equal(page.includes("Quantidade NF-e (mês)"), false);
    assert.equal(page.includes("xl:grid-cols-8"), false);
    assert.match(page, /FinanceKpiCard/);
    assert.match(page, /FinanceBillingKpiGroup/);
    assert.match(page, /buildFinanceBillingSelectedPeriodTitle/);
    assert.match(page, /buildFinanceBillingComparisonPeriodTitle/);
    assert.match(page, /Acumulado do ano — YTD/);
    assert.match(page, /YTD \$\{selectedYear\}/);
    assert.match(page, /formatFinanceBillingShortMonthYear/);
    assert.match(page, /Mesmo mês do ano anterior/);
  });

  it("fonte padrão NF-e continua preservada na página", () => {
    const page = readFileSync(pagePath, "utf8");
    assert.match(page, /FINANCE_BILLING_SOURCE_DEFAULT|billingSource=nfe/i);
    assert.ok(page.includes("buildFinanceBillingDashboardQuery"));
  });

  it("meses futuros continuam null no motor de gráficos", () => {
    const maps = new Map<number, Map<number, number>>();
    maps.set(2026, new Map([[1, 100], [6, 200]]));
    const points = buildBillingMultiYearMonthlyPoints(2026, maps, 6, true);
    assert.equal(points[5]!.values[2026], 200);
    assert.equal(points[6]!.values[2026], null);
  });

  it("métricas de diferença/variação não retornam NaN ou Infinity", () => {
    const cmp = computeFinanceBillingComparisonDelta(1000, 800);
    assert.ok(cmp.delta != null && Number.isFinite(cmp.delta));
    assert.ok(cmp.variationPercent != null && Number.isFinite(cmp.variationPercent));
    assert.doesNotMatch(formatFinanceBillingVariationValue(cmp.variationPercent), /NaN/);
    assert.equal(formatFinanceBillingVariationValue(computeFinanceBillingComparisonDelta(100, 0).variationPercent), "Sem base comparativa");
  });

  it("página Billing usa formatter KPI compacto e tooltips negociais", () => {
    const page = readFileSync(pagePath, "utf8");
    assert.match(page, /formatFinanceKpiCurrency/);
    assert.ok(page.includes("FINANCE_KPI_BILLING_NET_REVENUE"));
    assert.ok(page.includes("FINANCE_KPI_BILLING_SAME_MONTH_PREV_YEAR"));
    assert.ok(page.includes("FINANCE_KPI_BILLING_YTD_CURRENT"));
    assert.equal(page.includes("formatExecutiveCompactCurrency"), false);
    assert.doesNotMatch(page, /R\$ 5\.827\.010/);
  });
});
