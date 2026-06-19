import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertChartNarrativeFinite,
  buildBillingComparisonChartNarrative,
  buildCashFlowChartNarrative,
  buildSalesOrdersChartNarrative,
} from "./financeExecutiveChartNarratives.js";
import { EXECUTIVE_REPORT_MONTH_LABELS_PT } from "./financeExecutiveReportPresentation.js";

describe("financeExecutiveChartNarratives", () => {
  it("narrativa do fluxo identifica acumulado final negativo", () => {
    const rows = EXECUTIVE_REPORT_MONTH_LABELS_PT.map((monthLabel, i) => ({
      month: i + 1,
      monthLabel,
      isCurrentMonth: false,
      inflow: 1000,
      outflow: 2000,
      netFlow: -1000,
      accumulated: -1000 * (i + 1),
      isNegative: true,
    }));
    const text = buildCashFlowChartNarrative(rows);
    assert.match(text, /negativo/i);
    assert.ok(assertChartNarrativeFinite(text));
  });

  it("narrativa do fluxo identifica pressão no último trimestre", () => {
    const rows = EXECUTIVE_REPORT_MONTH_LABELS_PT.map((monthLabel, i) => {
      const month = i + 1;
      const netFlow = month >= 10 ? -5000 : 10000;
      return {
        month,
        monthLabel,
        isCurrentMonth: false,
        inflow: 10000,
        outflow: month >= 10 ? 15000 : 5000,
        netFlow,
        accumulated: month <= 9 ? 10000 * month : 90000 - 5000 * (month - 9),
        isNegative: netFlow < 0,
      };
    });
    const text = buildCashFlowChartNarrative(rows);
    assert.match(text, /último trimestre|pressão de caixa/i);
  });

  it("narrativa de faturamento identifica abaixo da meta", () => {
    const text = buildBillingComparisonChartNarrative({
      rows: [{ month: 6, monthLabel: "Jun", monthLabelPt: "Jun", isCurrentMonth: true, values: { 2026: 50000 } }],
      selectedYear: 2026,
      currentMonth: 6,
      target: 100000,
      actual: 50000,
    });
    assert.match(text, /abaixo da referência/i);
  });

  it("narrativa de pedidos explica comercial/faturamento futuro", () => {
    const text = buildSalesOrdersChartNarrative({
      rows: [],
      currentMonth: 6,
      target: 100,
      actual: 80,
    });
    assert.match(text, /pedidos|faturamento|comercial/i);
  });

  it("texto é curto e leigo", () => {
    const text = buildCashFlowChartNarrative([
      {
        month: 12,
        monthLabel: "Dez",
        isCurrentMonth: false,
        inflow: 100,
        outflow: 50,
        netFlow: 50,
        accumulated: 500,
        isNegative: false,
      },
    ]);
    assert.ok(text.length < 220);
    assert.doesNotMatch(text, /prisma|nomus|sql/i);
  });

  it("documento do relatório inclui Leitura do cenário", () => {
    const doc = readFileSync(
      join(process.cwd(), "src/components/finance/executive-report/ExecutiveReportDocument.tsx"),
      "utf8"
    );
    assert.match(doc, /buildExecutiveChartNarrative/);
    assert.match(doc, /scenarioText=/);
    const scenario = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/executive-report/charts/ExecutiveChartScenario.tsx"
      ),
      "utf8"
    );
    assert.match(scenario, /Leitura do cenário/);
  });

  it("print CSS mantém bloco de explicação", () => {
    const css = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/executive-report/finance-executive-report-print.css"
      ),
      "utf8"
    );
    assert.match(css, /executive-chart-scenario/);
  });
});
