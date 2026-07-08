import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { formatFinanceKpiCurrency } from "./financeKpiFormat.js";
import { formatKpiCompactCurrency } from "./kpiDisplayFormat.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("salesOrderListSummaryCards visual", () => {
  it("usa grid e CSS executivo estável", () => {
    const cards = read("src/components/sales/SalesOrderListSummaryCards.tsx");
    const css = read("src/components/sales/sales-order-list-summary-cards.css");
    assert.match(cards, /sales-order-list-summary-grid/);
    assert.match(cards, /sales-order-list-summary-cards\.css/);
    assert.match(css, /white-space: nowrap/);
    assert.match(css, /font-weight: 600/);
    assert.match(css, /min-height: 108px/);
    assert.doesNotMatch(cards, /absolute top-2 right-10/);
    assert.match(cards, /sales-order-list-summary-margin-badge/);
    assert.match(cards, /footer=/);
  });

  it("badge Margem parcial não usa posicionamento absoluto sobre o valor", () => {
    const cards = read("src/components/sales/SalesOrderListSummaryCards.tsx");
    assert.doesNotMatch(cards, /absolute top-2/);
    assert.match(cards, /sales-order-list-general-margin-partial-badge/);
  });

  it("formatação compacta mantém unidade ligada ao número", () => {
    const scenarios = [
      { amount: 9_630_000, label: "todos os meses" },
      { amount: 1_530_000, label: "junho" },
      { amount: 449_300, label: "julho" },
      { amount: 21_400, label: "ticket julho" },
    ];
    for (const { amount } of scenarios) {
      const display = formatFinanceKpiCurrency(amount);
      assert.match(display, /\u00a0/);
      assert.doesNotMatch(display, / mil$/);
      assert.doesNotMatch(display, / Mi$/);
    }
    const viaMetric = formatKpiCompactCurrency(449_300);
    assert.match(viaMetric.display, /\u00a0/);
  });
});
