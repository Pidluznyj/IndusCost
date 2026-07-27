import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("Pedidos de venda — expandir gráficos (apresentação)", () => {
  it("FinanceBillingChartShell oferece botão e modal com altura dinâmica via render prop", () => {
    const shell = read("src/components/finance/billing/FinanceBillingChartShell.tsx");
    assert.match(shell, /FinanceBiChartExpandButton/);
    assert.match(shell, /FinanceBiChartExpandModal/);
    assert.match(shell, /useFinanceBiExpandedChartHeight/);
    assert.match(shell, /expanded:\s*boolean/);
    assert.match(shell, /typeof children === "function"/);
    assert.match(shell, /Comercial · Pedidos de venda/);
  });

  it("modal aceita eyebrow configurável", () => {
    const modal = read("src/components/finance/bi/FinanceBiChartExpandModal.tsx");
    assert.match(modal, /eyebrow/);
    assert.match(modal, /Financeiro · Fluxo de caixa/);
  });

  it("gráficos da listagem de Pedidos usam shell expansível", () => {
    const monthly = read(
      "src/components/finance/sales-orders/FinanceSalesOrdersMonthlyChart.tsx"
    );
    const margin = read(
      "src/components/sales/SalesOrderListMonthlyMarginPercentChart.tsx"
    );
    assert.match(monthly, /\(\{\s*height\s*\}\)\s*=>/);
    assert.match(monthly, /sales-orders-monthly-comparison-chart/);
    assert.match(margin, /\(\{\s*height\s*\}\)\s*=>/);
    assert.match(margin, /sales-orders-monthly-margin-percent-chart/);
  });

  it("Resultado de Pedidos tem botão de ampliar no gráfico mensal", () => {
    const result = read("src/components/sales/SalesOrderResultMonthlyMarginChart.tsx");
    assert.match(result, /FinanceBiChartExpandButton/);
    assert.match(result, /sales-order-result-monthly-chart-expand/);
    assert.match(result, /FinanceBiChartExpandModal/);
    assert.match(result, /Comercial · Pedidos de venda/);
  });
});
