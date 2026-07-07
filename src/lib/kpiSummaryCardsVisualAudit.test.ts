/**
 * Auditoria estática — blocos KPI/resumo vs padrão MetricCard (referência CC Mapa).
 * Fase visual: não altera runtime; documenta cobertura para próximas migrações.
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

/** Telas prioritárias para próxima fase visual (ainda em FinanceKpiCard). */
const HIGH_PRIORITY_FINANCE_KPI_SCREENS = [
  "src/components/commissions/pages/CommissionsReceiptClosingPage.tsx",
  "src/components/commissions/pages/CommissionsVisualAuditPage.tsx",
  "src/components/finance/cost-centers/FinanceCostCenterOverviewTab.tsx",
  "src/components/finance/FinanceAccountsPayablePage.tsx",
  "src/components/finance/FinanceAccountsReceivablePage.tsx",
];

/** Telas já no padrão MetricCard (referência ou alinhadas). */
const METRIC_CARD_ALIGNED = [
  REFERENCE_SUMMARY,
  "src/components/finance/FinanceArAnalyticalTitlesTab.tsx",
  "src/components/inventory/InventoryDashboardTab.tsx",
  "src/components/sales/SalesOrderResultPage.tsx",
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

  it("referência usa MetricCard + MetricCardGrid", () => {
    const ref = read(REFERENCE_SUMMARY);
    assert.match(ref, /MetricCard/);
    assert.match(ref, /MetricCardGrid/);
    assert.match(ref, /Resumo geral dos centros filtrados/);
  });

  it("mapa de gastos (cards individuais) permanece intacto na auditoria", () => {
    const section = read(EXPENSE_MAP_CARDS);
    assert.match(section, /ExpenseMapCard/);
    assert.match(section, /finance-cc-expense-map-card-/);
  });

  it("telas prioritárias ainda usam padrão BI legado (próxima fase)", () => {
    for (const file of HIGH_PRIORITY_FINANCE_KPI_SCREENS) {
      const src = read(file);
      const usesLegacyBi =
        /FinanceKpiCard/.test(src) || /FinanceBiKpiCard/.test(src);
      assert.ok(usesLegacyBi, `${file} ainda em FinanceKpiCard/FinanceBiKpiCard`);
    }
  });

  it("telas alinhadas usam MetricCard", () => {
    for (const file of METRIC_CARD_ALIGNED) {
      const src = read(file);
      assert.match(src, /MetricCard/, `${file} deve usar MetricCard`);
    }
  });

  it("MetricCard define faixa lateral e label uppercase", () => {
    const css = read("src/components/ui/metric-card.css");
    assert.match(css, /border-left-width/);
    assert.match(css, /text-transform: uppercase/);
  });
});
