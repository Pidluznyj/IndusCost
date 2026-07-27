import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("Financeiro Fluxo de Caixa — expandir gráficos (apresentação)", () => {
  it("modal e botão de expand compartilhados existem", () => {
    const modal = read("src/components/finance/bi/FinanceBiChartExpandModal.tsx");
    const button = read("src/components/finance/bi/FinanceBiChartExpandButton.tsx");
    assert.match(modal, /createPortal/);
    assert.match(modal, /Escape/);
    assert.match(modal, /aria-modal/);
    assert.match(button, /Maximize2/);
    assert.match(button, /Ampliar gráfico/);
  });

  it("ChartShell oferece botão e modal com altura maior via render prop", () => {
    const shell = read("src/components/finance/cash-flow/FinanceCashFlowChartShell.tsx");
    assert.match(shell, /FinanceBiChartExpandButton/);
    assert.match(shell, /FinanceBiChartExpandModal/);
    assert.match(shell, /useFinanceBiExpandedChartHeight/);
    assert.match(shell, /expanded:\s*boolean/);
    assert.match(shell, /\$\{testId\}-expand/);
  });

  it("gráfico planejado mensal usa shell expansível e altura dinâmica", () => {
    const monthly = read(
      "src/components/finance/cash-flow/FinanceCashFlowMonthlyPlannedChart.tsx"
    );
    assert.match(monthly, /FinanceCashFlowChartShell/);
    assert.match(monthly, /\(\{\s*height\s*\}\)\s*=>/);
    assert.match(monthly, /showLineValueLabels=\{false\}/);
  });

  it("fluxo anual e tendência YTD têm botão de ampliar", () => {
    const annual = read(
      "src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChart.tsx"
    );
    const ytd = read("src/components/finance/cash-flow/FinanceCashFlowYtdTrendChart.tsx");
    assert.match(annual, /cash-flow-annual-comparison-expand/);
    assert.match(annual, /FinanceBiChartExpandModal/);
    assert.match(ytd, /cash-flow-ytd-trend-chart-expand/);
    assert.match(ytd, /FinanceBiChartExpandModal/);
  });
});
