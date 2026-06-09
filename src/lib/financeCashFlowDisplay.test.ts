import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCashFlowNetPositionChartRows,
  cashFlowMonthlySeriesHasData,
  computeCashFlowNetPosition,
  formatCashFlowKpiDisplay,
  resolveCashFlowNetPositionTone,
} from "./financeCashFlowDisplay.js";

describe("financeCashFlowDisplay", () => {
  it("posição líquida = receber − pagar", () => {
    assert.equal(computeCashFlowNetPosition(1_000_000, 250_000), 750_000);
    assert.equal(computeCashFlowNetPosition(100_000, 500_000), -400_000);
  });

  it("posição positiva renderiza superávit", () => {
    const tone = resolveCashFlowNetPositionTone(10);
    assert.equal(tone.isSurplus, true);
    assert.equal(tone.statusLabel, "Superávit projetado");
  });

  it("posição negativa renderiza déficit", () => {
    const tone = resolveCashFlowNetPositionTone(-1);
    assert.equal(tone.isSurplus, false);
    assert.equal(tone.statusLabel, "Déficit projetado");
  });

  it("empty state quando série vazia ou só null", () => {
    assert.equal(cashFlowMonthlySeriesHasData([]), false);
    assert.equal(
      cashFlowMonthlySeriesHasData([
        {
          year: 2026,
          month: 8,
          monthLabel: "Ago",
          inflowAmount: null,
          outflowAmount: null,
          netFlowAmount: null,
          accumulatedBalance: null,
          status: null,
          inflowCount: 0,
          outflowCount: 0,
        },
      ]),
      false
    );
  });

  it("série mensal com apenas líquido conta como dados", () => {
    assert.equal(
      cashFlowMonthlySeriesHasData([
        {
          year: 2026,
          month: 1,
          monthLabel: "Jan",
          inflowAmount: 0,
          outflowAmount: 0,
          netFlowAmount: 500,
          accumulatedBalance: 500,
          status: "positive",
          inflowCount: 0,
          outflowCount: 0,
        },
      ]),
      true
    );
  });

  it("chart rows preservam posição líquida mensal positiva e negativa", () => {
    const rows = buildCashFlowNetPositionChartRows([
      {
        year: 2026,
        month: 3,
        monthLabel: "Mar/26",
        inflowAmount: 1000,
        outflowAmount: 400,
        netFlowAmount: 600,
        accumulatedBalance: 1200,
        status: "positive",
        inflowCount: 2,
        outflowCount: 1,
      },
      {
        year: 2026,
        month: 4,
        monthLabel: "Abr/26",
        inflowAmount: 200,
        outflowAmount: 800,
        netFlowAmount: -600,
        accumulatedBalance: 600,
        status: "negative",
        inflowCount: 1,
        outflowCount: 3,
      },
    ]);
    assert.ok(rows[0]!.netPosition > 0);
    assert.equal(rows[0]!.status, "positive");
    assert.ok(rows[1]!.netPosition < 0);
    assert.equal(rows[1]!.status, "negative");
  });

  it("KPI compacto preserva valor completo para tooltip", () => {
    const { display, full } = formatCashFlowKpiDisplay(4_920_000);
    assert.ok(display.includes("Mi"));
    assert.ok(full.includes("4.920.000"));
  });

  it("gráfico principal usa altura explícita e posição líquida mensal", () => {
    const charts = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowCharts.tsx"),
      "utf8"
    );
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowPage.tsx"),
      "utf8"
    );
    assert.ok(charts.includes("FINANCE_CASH_FLOW_CHART_HEIGHT"));
    assert.ok(charts.includes("cash-flow-main-chart"));
    assert.ok(charts.includes("Posição Líquida Mensal"));
    assert.ok(page.includes("netCashPosition"));
    assert.ok(page.includes("FinanceCashFlowNetPositionHero"));
    assert.ok(page.includes("FinanceCashFlowExecutiveReading"));
  });
});
