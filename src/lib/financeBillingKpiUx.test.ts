import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildBillingMultiYearMonthlyPoints } from "./financeBillingChartData.js";

const pagePath = join(
  process.cwd(),
  "src",
  "components",
  "finance",
  "FinanceBillingPage.tsx"
);

describe("financeBillingKpiUx", () => {
  it("página Billing usa labels curtos no resumo executivo", () => {
    const page = readFileSync(pagePath, "utf8");
    const labels = [
      "Faturamento líquido",
      "Bruto encontrado",
      "NF-e no mês",
      "Ticket médio",
      "Mês anterior",
      "Ano anterior",
      "Acumulado YTD",
      "Previsto no mês",
    ];
    for (const label of labels) {
      assert.ok(page.includes(label), `label ausente: ${label}`);
    }
    assert.equal(page.includes("Faturamento líquido (mês)"), false);
    assert.equal(page.includes("Faturamento bruto encontrado"), false);
    assert.equal(page.includes("Quantidade NF-e (mês)"), false);
    assert.equal(page.includes("Comparativo ano anterior"), false);
    assert.equal(page.includes("xl:grid-cols-8"), false);
    assert.match(page, /FinanceKpiCard/);
    assert.match(page, /lg:grid-cols-4 xl:grid-cols-4/);
  });

  it("fonte padrão NF-e continua preservada na página", () => {
    const page = readFileSync(pagePath, "utf8");
    assert.match(page, /billingSource=nfe|NF-e fiscal|fonte NF-e/i);
    assert.ok(page.includes("buildFinanceBillingDashboardQuery"));
  });

  it("meses futuros continuam null no motor de gráficos", () => {
    const maps = new Map<number, Map<number, number>>();
    maps.set(2026, new Map([[1, 100], [6, 200]]));
    const points = buildBillingMultiYearMonthlyPoints(2026, maps, 6, true);
    assert.equal(points[5]!.values[2026], 200);
    assert.equal(points[6]!.values[2026], null);
  });
});
