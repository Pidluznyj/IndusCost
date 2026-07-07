/**
 * Auditoria estática — blocos KPI/resumo vs padrão MetricCard (referência CC Mapa).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

const REFERENCE_SUMMARY =
  "src/components/finance/cost-centers/FinanceCostCenterExpenseMapExecutiveSummary.tsx";

const EXPENSE_MAP_CARDS =
  "src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx";

/** Telas financeiras migradas para ExecutiveSummarySection + MetricCard. */
const FINANCE_KPI_ALIGNED = [
  REFERENCE_SUMMARY,
  "src/components/finance/FinanceAccountsReceivablePage.tsx",
  "src/components/finance/FinanceAccountsPayablePage.tsx",
  "src/components/finance/FinanceBillingPage.tsx",
  "src/components/finance/FinanceSalesOrdersPage.tsx",
  "src/components/finance/FinanceArAnalyticalTitlesTab.tsx",
  "src/components/finance/cost-centers/FinanceCostCenterOverviewTab.tsx",
  "src/components/finance/cost-centers/FinanceCostCenterDetailPage.tsx",
  "src/components/finance/shared/FinanceHorizonSection.tsx",
  "src/components/finance/cash-flow/FinanceCashFlowYtdSummary.tsx",
  "src/components/finance/cash-flow/FinanceCashFlowExecutiveSummaryPanel.tsx",
  "src/components/finance/executive-report/ExecutiveKpiCard.tsx",
];

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("kpiSummaryCardsVisualAudit", () => {
  it("documento de auditoria existe", () => {
    const doc = join(ROOT, "docs/audits/kpi-summary-cards-visual-audit.md");
    assert.ok(existsSync(doc), "docs/audits/kpi-summary-cards-visual-audit.md");
    const content = readFileSync(doc, "utf8");
    assert.match(content, /FinanceCostCenterExpenseMapExecutiveSummary/);
    assert.match(content, /MetricCard/);
    assert.match(content, /ExpenseMapCard/);
  });

  it("referência usa ExecutiveSummarySection + SummaryKpiGrid + MetricCard", () => {
    const ref = read(REFERENCE_SUMMARY);
    assert.match(ref, /ExecutiveSummarySection/);
    assert.match(ref, /SummaryKpiGrid/);
    assert.match(ref, /MetricCard/);
    assert.match(ref, /Resumo geral dos centros filtrados/);
  });

  it("mapa de gastos (cards individuais) permanece intacto na auditoria", () => {
    const section = read(EXPENSE_MAP_CARDS);
    assert.match(section, /ExpenseMapCard/);
    assert.match(section, /finance-cc-expense-map-card-/);
  });

  it("telas financeiras alinhadas usam ExecutiveSummarySection ou MetricCard", () => {
    for (const file of FINANCE_KPI_ALIGNED) {
      const src = read(file);
      const aligned =
        /ExecutiveSummarySection/.test(src) ||
        /SummaryKpiGrid/.test(src) ||
        /MetricCard/.test(src);
      assert.ok(aligned, `${file} deve usar padrão executivo MetricCard`);
    }
  });

  it("FinanceBiKpiCard delega visual para MetricCard", () => {
    const bi = read("src/components/finance/bi/FinanceBiKpiCard.tsx");
    assert.match(bi, /MetricCard/);
    assert.doesNotMatch(bi, /indus-kpi-card commercial-kpi-card/);
  });

  it("MetricCard define faixa lateral e label uppercase", () => {
    const css = read("src/components/ui/metric-card.css");
    assert.match(css, /border-left-width/);
    assert.match(css, /text-transform: uppercase/);
  });
});
