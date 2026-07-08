import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("FinanceCashFlowExecutiveMetricCard", () => {
  it("delega visual para MetricCard com paleta executiva suave", () => {
    const card = read("src/components/finance/cash-flow/FinanceCashFlowExecutiveMetricCard.tsx");
    const css = read("src/components/finance/cash-flow/finance-cash-flow-executive-summary.css");
    assert.match(card, /MetricCard/);
    assert.match(card, /FinanceBiCalcTooltip/);
    assert.match(card, /formatCashFlowKpiDisplay/);
    assert.match(css, /font-weight: 600/);
    assert.match(css, /finance-cash-flow-metric-grid/);
    assert.doesNotMatch(card, /text-3xl/);
    assert.doesNotMatch(card, /font-black/);
  });

  it("painel executivo usa ExecutiveSummarySection e não FinanceCashFlowKpiCard", () => {
    const panel = read("src/components/finance/cash-flow/FinanceCashFlowExecutiveSummaryPanel.tsx");
    assert.match(panel, /ExecutiveSummarySection/);
    assert.match(panel, /FinanceCashFlowExecutiveMetricCard/);
    assert.match(panel, /finance-cash-flow-executive-summary/);
    assert.doesNotMatch(panel, /FinanceCashFlowKpiCard/);
    assert.doesNotMatch(panel, /text-\[#DC2626\]/);
    assert.doesNotMatch(panel, /font-bold tabular-nums text-xl/);
    assert.match(panel, /exec-kpi-received-ytd/);
    assert.match(panel, /exec-kpi-estimated-year-net/);
  });
});
