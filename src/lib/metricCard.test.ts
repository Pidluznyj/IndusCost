import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  formatCompactCurrency,
  formatFullCurrency,
  resolveMetricDisplay,
} from "./formatFinancialMetric.js";

const metricCardPath = join(process.cwd(), "src/components/ui/MetricCard.tsx");
const metricGridPath = join(process.cwd(), "src/components/ui/MetricCardGrid.tsx");
const metricCssPath = join(process.cwd(), "src/components/ui/metric-card.css");
const arTitlesTabPath = join(
  process.cwd(),
  "src/components/finance/FinanceArAnalyticalTitlesTab.tsx"
);

describe("formatFinancialMetric", () => {
  it("formatCompactCurrency exibe mil e Mi sem reticências", () => {
    assert.equal(formatCompactCurrency(9_850), "R$\u00a09.850,00");
    assert.equal(formatCompactCurrency(850_200), "R$ 850,2 mil");
    assert.match(formatCompactCurrency(12_400_000), /12,40 Mi|12,4 Mi/);
    assert.doesNotMatch(formatCompactCurrency(12_400_000), /\.\.\./);
  });

  it("formatFullCurrency mantém valor completo", () => {
    assert.equal(formatFullCurrency(12_432_125.55), "R$\u00a012.432.125,55");
  });

  it("resolveMetricDisplay expõe title com valor completo", () => {
    const resolved = resolveMetricDisplay({
      label: "Valor original",
      amount: 12_432_125.55,
      amountFormat: "currency",
    });
    assert.match(resolved.display, /Mi/);
    assert.ok(resolved.title?.includes("12.432.125,55"));
  });

  it("valores inválidos retornam em dash", () => {
    assert.equal(formatCompactCurrency(null), "—");
    assert.equal(formatCompactCurrency(NaN), "—");
    assert.doesNotMatch(formatCompactCurrency(null), /NaN/);
  });
});

describe("MetricCard design system", () => {
  it("MetricCard renderiza label e valor", () => {
    const src = readFileSync(metricCardPath, "utf8");
    assert.match(src, /label/);
    assert.match(src, /data-testid="metric-card-value"/);
    assert.match(src, /data-testid="metric-card"/);
  });

  it("MetricCard não trunca valor monetário com reticências", () => {
    const css = readFileSync(metricCssPath, "utf8");
    assert.match(css, /text-overflow:\s*clip/);
    assert.doesNotMatch(css, /text-overflow:\s*ellipsis/);
    const src = readFileSync(metricCardPath, "utf8");
    assert.match(src, /title=\{displayTitle\}/);
    assert.match(src, /resolveMetricDisplay/);
  });

  it("variante danger aplica estilo de alerta", () => {
    const src = readFileSync(metricCardPath, "utf8");
    assert.match(src, /danger:/);
    assert.match(src, /text-red-700/);
    assert.match(src, /bg-red-50/);
  });

  it("variante success aplica estilo positivo", () => {
    const src = readFileSync(metricCardPath, "utf8");
    assert.match(src, /success:/);
    assert.match(src, /text-emerald-700/);
  });

  it("MetricCardGrid é responsivo com auto-fit", () => {
    const css = readFileSync(metricCssPath, "utf8");
    assert.match(css, /repeat\(auto-fit,\s*minmax/);
    const grid = readFileSync(metricGridPath, "utf8");
    assert.match(grid, /MetricCardGrid/);
    assert.match(grid, /data-testid="metric-card-grid"/);
  });

  it("aba Contas a Receber → Títulos usa MetricCard", () => {
    const tab = readFileSync(arTitlesTabPath, "utf8");
    assert.match(tab, /MetricCard/);
    assert.match(tab, /MetricCardGrid/);
    assert.match(tab, /finance-ar-titles-summary-kpis/);
    assert.match(tab, /summary\.totalOriginalValue/);
    assert.match(tab, /summary\.totalOverdueValue/);
    assert.doesNotMatch(tab, /FinanceBiKpiCard/);
    assert.doesNotMatch(tab, /xl:grid-cols-7/);
  });

  it("cards da aba Títulos continuam usando os mesmos totais da API", () => {
    const tab = readFileSync(arTitlesTabPath, "utf8");
    assert.match(tab, /amount=\{summary\.totalTitles\}/);
    assert.match(tab, /amount=\{summary\.totalOriginalValue\}/);
    assert.match(tab, /amount=\{summary\.totalReceivedValue\}/);
    assert.match(tab, /amount=\{summary\.totalOpenValue\}/);
    assert.match(tab, /amount=\{summary\.totalOverdueValue\}/);
    assert.match(tab, /amount=\{summary\.totalDueValue\}/);
    assert.match(tab, /amount=\{summary\.averageTicket\}/);
  });

  it("MetricCard não importa Prisma ou backend", () => {
    for (const file of [metricCardPath, metricGridPath]) {
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /lib\/prisma/);
    }
  });
});
