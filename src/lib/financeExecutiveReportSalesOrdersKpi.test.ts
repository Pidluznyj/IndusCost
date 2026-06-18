import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computeAchievementPercent,
  isCancelledSalesOrderStatus,
} from "./salesOrderDashboardRules.js";
import {
  getExecutiveReportKpiHint,
  EXECUTIVE_REPORT_KPI_HINTS,
} from "./financeExecutiveReportUxCopy.js";
import { mapSalesOrdersMonthlyToChart } from "./financeExecutiveReportPresentation.js";
import type { DashboardMonthlySeriesPoint } from "./executiveDashboardTypes.js";

describe("financeExecutiveReportSalesOrdersKpi", () => {
  it("documento expõe card Vendido no mês na seção Pedidos de Venda", () => {
    const document = readFileSync(
      join(process.cwd(), "src/components/finance/executive-report/ExecutiveReportDocument.tsx"),
      "utf8"
    );
    assert.match(document, /label="Vendido no mês"/);
    assert.match(document, /pageId="sales-orders"/);
    assert.match(document, /Pedidos de Venda/);
    assert.match(document, /columns=\{5\}/);
    assert.match(document, /salesTab\.target\?\.formatted\.actual/);
    assert.match(document, /label="Realizado YTD"/);
  });

  it("pedidos usam buildSalesOrdersDashboardTab (SalesOrder) — não NF-e nem Proposta", () => {
    const report = readFileSync(join(process.cwd(), "src/lib/financeExecutiveReport.ts"), "utf8");
    const metrics = readFileSync(
      join(process.cwd(), "src/lib/salesOrdersDashboardMetrics.ts"),
      "utf8"
    );
    assert.ok(report.includes("buildSalesOrdersDashboardTab"));
    assert.ok(metrics.includes("prisma.salesOrder.aggregate"));
    assert.ok(metrics.includes('status: { not: "CANCELLED" }'));
    assert.ok(!metrics.includes("nomusNfe"));
    assert.ok(!metrics.includes("proposal"));
  });

  it("vendido no mês vem de target.actual (monthAgg) — separado do YTD", () => {
    const metrics = readFileSync(
      join(process.cwd(), "src/lib/salesOrdersDashboardMetrics.ts"),
      "utf8"
    );
    assert.match(metrics, /aggregateByIssueDate\(monthStart, monthEnd\)/);
    assert.match(metrics, /const monthlyTarget = buildTargetBlock\(monthAgg\.net/);
    assert.match(metrics, /target: monthlyTarget/);
    assert.match(metrics, /metricCard\("realized-ytd"/);
    assert.match(metrics, /metricCard\("realized-month"/);
    assert.match(metrics, /ytdAgg\.net/);
  });

  it("atingimento mensal usa vendido no mês ÷ meta mês — não YTD", () => {
    const actual = 642_000;
    const target = 800_000;
    const ytd = 8_287_706.76;
    const monthAchievement = computeAchievementPercent(actual, target);
    const wrongYtdAchievement = computeAchievementPercent(ytd, target);
    assert.equal(monthAchievement, 80.25);
    assert.notEqual(wrongYtdAchievement, monthAchievement);
    assert.ok(!Number.isNaN(monthAchievement!));
    assert.ok(monthAchievement !== Infinity && monthAchievement !== -Infinity);
  });

  it("atingimento retorna null quando meta é null — sem NaN", () => {
    assert.equal(computeAchievementPercent(1000, null), null);
    assert.equal(computeAchievementPercent(null, 1000), null);
    assert.equal(computeAchievementPercent(0, 0), 0);
  });

  it("pedidos cancelados são excluídos da agregação", () => {
    assert.equal(isCancelledSalesOrderStatus("CANCELLED"), true);
    assert.equal(isCancelledSalesOrderStatus("OPEN"), false);
  });

  it("gráfico mensal usa monthlySeries — mesmo mês que target.actual", () => {
    const series: DashboardMonthlySeriesPoint[] = [
      {
        month: 6,
        monthLabel: "Jun",
        periodLabel: "junho de 2026",
        currentYearValue: 642_000,
        previousYearValue: 500_000,
        targetValue: 780_000,
        projectedValue: 700_000,
        achievementPercent: 82.3,
        differenceToTarget: -138_000,
      },
    ];
    const chart = mapSalesOrdersMonthlyToChart(series, 6);
    assert.equal(chart.rows[0]?.currentYear, 642_000);
    assert.ok(chart.hasData);
  });

  it("projeção mês permanece independente do vendido no mês", () => {
    const metrics = readFileSync(
      join(process.cwd(), "src/lib/salesOrdersDashboardMetrics.ts"),
      "utf8"
    );
    assert.match(metrics, /computeMonthProjection\(dailyAvgYtd, workdaysInMonth\)/);
    assert.match(metrics, /monthlyProjection: formatExecutiveCurrency\(projectedMonth\)/);
  });

  it("KPI card inclui tooltip com valor completo", () => {
    const card = readFileSync(
      join(process.cwd(), "src/components/finance/executive-report/ExecutiveKpiCard.tsx"),
      "utf8"
    );
    assert.match(card, /finance-executive-kpi-value.*title=\{value\}/s);
  });

  it("hint de Vendido no mês explica regra sem propostas", () => {
    const hint = getExecutiveReportKpiHint("Vendido no mês");
    assert.ok(hint);
    assert.match(hint!, /pedidos de venda/i);
    assert.match(hint!, /propostas/i);
    assert.ok(EXECUTIVE_REPORT_KPI_HINTS["Atingimento mês pedidos"]);
  });

  it("documento trata meta ausente no atingimento mensal", () => {
    const document = readFileSync(
      join(process.cwd(), "src/components/finance/executive-report/ExecutiveReportDocument.tsx"),
      "utf8"
    );
    assert.match(document, /salesTargetMissing/);
    assert.match(document, /EXECUTIVE_REPORT_NO_TARGET_MESSAGE/);
    assert.match(document, /Atingimento mês pedidos/);
  });

  it("print/PDF inclui grid de 5 colunas para pedidos", () => {
    const css = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/executive-report/finance-executive-report-print.css"
      ),
      "utf8"
    );
    assert.match(css, /data-columns="5"/);
  });

  it("faturamento não é alterado pelo card de pedidos", () => {
    const document = readFileSync(
      join(process.cwd(), "src/components/finance/executive-report/ExecutiveReportDocument.tsx"),
      "utf8"
    );
    const billingSection = document.slice(
      document.indexOf('pageId="billing-comparison"'),
      document.indexOf('pageId="billing-projection"')
    );
    assert.match(billingSection, /Realizado mês/);
    assert.doesNotMatch(billingSection, /Vendido no mês/);
  });
});
