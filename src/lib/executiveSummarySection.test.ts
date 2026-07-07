/**
 * Testes estáticos — bloco reutilizável ExecutiveSummarySection + SummaryKpi*.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

const SECTION = "src/components/ui/ExecutiveSummarySection.tsx";
const GRID = "src/components/ui/SummaryKpiGrid.tsx";
const CARD = "src/components/ui/SummaryKpiCard.tsx";
const CSS = "src/components/ui/executive-summary-section.css";
const REFERENCE =
  "src/components/finance/cost-centers/FinanceCostCenterExpenseMapExecutiveSummary.tsx";
const EXPENSE_MAP =
  "src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx";

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("executiveSummarySection", () => {
  it("componentes reutilizáveis existem", () => {
    for (const file of [SECTION, GRID, CARD, CSS]) {
      assert.ok(existsSync(join(ROOT, file)), file);
    }
  });

  it("ExecutiveSummarySection expõe título, eyebrow, actions e footer", () => {
    const src = read(SECTION);
    assert.match(src, /ExecutiveSummarySection/);
    assert.match(src, /eyebrow/);
    assert.match(src, /footer/);
    assert.match(src, /data-testid=\{testId\}/);
  });

  it("SummaryKpiCard delega para MetricCard com description", () => {
    const src = read(CARD);
    assert.match(src, /MetricCard/);
    assert.match(src, /description/);
    assert.match(src, /subtitle=\{description/);
  });

  it("SummaryKpiGrid envolve MetricCardGrid com classe de print", () => {
    const src = read(GRID);
    assert.match(src, /MetricCardGrid/);
    assert.match(src, /summary-kpi-grid/);
    const css = read(CSS);
    assert.match(css, /@media print/);
    assert.match(css, /break-inside:\s*avoid/);
  });

  it("referência visual usa o novo wrapper sem alterar MetricCard", () => {
    const ref = read(REFERENCE);
    assert.match(ref, /ExecutiveSummarySection/);
    assert.match(ref, /SummaryKpiGrid/);
    assert.match(ref, /MetricCard/);
    assert.match(ref, /Resumo geral dos centros filtrados/);
    assert.match(ref, /finance-cc-expense-map-metric-grid/);
  });

  it("mapa de gastos (ExpenseMapCard) permanece intacto", () => {
    const section = read(EXPENSE_MAP);
    assert.match(section, /ExpenseMapCard/);
    assert.match(section, /finance-cc-expense-map-card-/);
    assert.doesNotMatch(section, /ExecutiveSummarySection/);
  });
});
