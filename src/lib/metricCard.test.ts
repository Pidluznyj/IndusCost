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
  it("MetricCard renderiza fundo neutro por padrão", () => {
    const css = readFileSync(metricCssPath, "utf8");
    assert.match(css, /background:\s*var\(--color-card/);
    assert.match(css, /border:\s*1px solid var\(--color-border/);
    assert.match(css, /box-shadow:/);
    assert.doesNotMatch(css, /bg-emerald-50/);
    assert.doesNotMatch(css, /bg-red-50/);
    assert.doesNotMatch(css, /bg-blue-50/);
  });

  it("MetricCard renderiza label e valor", () => {
    const src = readFileSync(metricCardPath, "utf8");
    assert.match(src, /metric-card-label/);
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

  it("variante success aplica acento verde, não fundo inteiro verde forte", () => {
    const css = readFileSync(metricCssPath, "utf8");
    assert.match(css, /\.metric-card--success[\s\S]*--metric-accent:\s*#059669/);
    assert.doesNotMatch(css, /background:.*#059669/);
    assert.doesNotMatch(readFileSync(metricCardPath, "utf8"), /bg-emerald/);
  });

  it("variante danger aplica acento vermelho e valor vermelho", () => {
    const css = readFileSync(metricCssPath, "utf8");
    assert.match(css, /\.metric-card--danger[\s\S]*--metric-accent:\s*#dc2626/);
    assert.match(css, /\.metric-card--danger \.metric-card-value[\s\S]*color:\s*#dc2626/);
    assert.doesNotMatch(readFileSync(metricCardPath, "utf8"), /bg-red/);
  });

  it("valor grande continua em formato compacto", () => {
    const resolved = resolveMetricDisplay({
      label: "Valor recebido",
      amount: 7_481_134.82,
      amountFormat: "currency",
    });
    assert.match(resolved.display, /Mi|mil/);
  });

  it("valor completo aparece em title e subtítulo", () => {
    const src = readFileSync(metricCardPath, "utf8");
    assert.match(src, /title=\{displayTitle\}/);
    assert.match(src, /metric-card-subtitle/);
  });

  it("MetricCardGrid é responsivo com auto-fit", () => {
    const css = readFileSync(metricCssPath, "utf8");
    assert.match(css, /repeat\(auto-fit,\s*minmax\(var\(--metric-card-min,\s*220px\)/);
    assert.match(css, /min-height:\s*118px/);
    const grid = readFileSync(metricGridPath, "utf8");
    assert.match(grid, /MetricCardGrid/);
    assert.match(grid, /data-testid="metric-card-grid"/);
  });

  it("aba Contas a Receber → Títulos usa o novo padrão MetricCard", () => {
    const tab = readFileSync(arTitlesTabPath, "utf8");
    assert.match(tab, /MetricCard/);
    assert.match(tab, /MetricCardGrid/);
    assert.match(tab, /finance-ar-titles-summary-kpis/);
    assert.match(tab, /variant="info"/);
    assert.match(tab, /variant="danger"/);
    assert.match(tab, /variant="success"/);
    assert.match(tab, /variant="neutral"/);
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
