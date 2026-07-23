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
import { buildSalesOrderListWhere } from "./salesOrdersListSummary.js";
import { resolveOfficialSalesOrderExecutiveMetrics } from "./salesOrderRulesAdapter.js";
import type { SalesOrderRulesOrderInput } from "./salesOrderRulesEngine.types.js";

describe("financeExecutiveReportSalesOrdersKpi", () => {
  it("documento expõe card Pedidos mês na seção Pedidos de Venda", () => {
    const document = readFileSync(
      join(process.cwd(), "src/components/finance/executive-report/ExecutiveReportDocument.tsx"),
      "utf8"
    );
    assert.match(document, /label="Pedidos mês"/);
    assert.match(document, /pageId="sales-orders"/);
    assert.match(document, /Pedidos de Venda/);
    assert.match(document, /salesTab\.target/);
    assert.match(document, /label="Pedidos YTD"/);
  });

  it("pedidos usam buildSalesOrdersDashboardTab (SalesOrder) — não NF-e nem Proposta", () => {
    const report = readFileSync(join(process.cwd(), "src/lib/financeExecutiveReport.ts"), "utf8");
    const metrics = readFileSync(
      join(process.cwd(), "src/lib/salesOrdersDashboardMetrics.ts"),
      "utf8"
    );
    assert.ok(report.includes("buildSalesOrdersDashboardTab"));
    assert.ok(metrics.includes("resolveOfficialSalesOrderExecutiveMetrics"));
    assert.ok(metrics.includes("OFFICIAL_SO_RULES_SOURCE") || metrics.includes("salesOrderRulesAdapter"));
    assert.ok(!metrics.includes("nomusNfe"));
    assert.ok(!metrics.includes("proposal"));
  });

  it("Presidencial alinha população e universo à listagem Comercial de Pedidos", () => {
    const report = readFileSync(join(process.cwd(), "src/lib/financeExecutiveReport.ts"), "utf8");
    const metrics = readFileSync(
      join(process.cwd(), "src/lib/salesOrdersDashboardMetrics.ts"),
      "utf8"
    );
    assert.match(metrics, /buildSalesOrderListWhere\(\{\s*year\s*\}\)/);
    assert.match(metrics, /excludeGroupCompanyCustomers\s*=\s*options\.excludeGroupCompanyCustomers\s*\?\?\s*false/);
    assert.match(
      report,
      /buildSalesOrdersDashboardTab\(\s*yearCtx,\s*\{\s*companyIssuer,\s*month:\s*highlightMonth,\s*excludeGroupCompanyCustomers:\s*false,/
    );
    assert.match(metrics, /MISSING_CONFIRMED/);
  });

  it("capa do Presidencial não usa financeBiCardClass nos meta-cards (contraste)", () => {
    const cover = readFileSync(
      join(process.cwd(), "src/components/finance/executive-report/ExecutiveReportCover.tsx"),
      "utf8"
    );
    assert.doesNotMatch(cover, /financeBiCardClass/);
    assert.match(cover, /bg-slate-950\/35/);
    assert.match(cover, /text-white/);
    assert.match(cover, /text-slate-200/);
  });

  it("where da listagem (mesmo do Presidencial) exclui MISSING_CONFIRMED com flag on", () => {
    const where = buildSalesOrderListWhere(
      { year: 2026, month: 7 },
      { env: { NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENABLED: "true" } }
    );
    assert.match(JSON.stringify(where), /MISSING_CONFIRMED/);
  });

  it("Pedidos mês com excludeGroupCompanyCustomers=false soma Σ totalNetValue do mês (paridade listagem)", () => {
    const ref = new Date(2026, 6, 22, 23, 59, 59, 999);
    const market: SalesOrderRulesOrderInput = {
      id: "a",
      orderCode: "PD 1",
      status: "SENT_TO_NOMUS",
      issueDate: new Date(2026, 6, 5),
      expectedDeliveryDate: null,
      totalNetValue: 667_071.6,
      totalItems: 1,
      companyIssuer: "Lazarios",
      Customer: { companyName: "Cliente Mercado", taxId: "12345678000199" },
      items: [{ id: "i1", quantity: 1 }],
    };
    const group: SalesOrderRulesOrderInput = {
      ...market,
      id: "b",
      orderCode: "PD 2",
      issueDate: new Date(2026, 6, 10),
      totalNetValue: 10_000,
      Customer: {
        companyName: "Koppetel Comercio de Plasticos LTDA",
        taxId: "14.055.501/0001-80",
      },
      items: [{ id: "i2", quantity: 1 }],
    };
    const cancelled: SalesOrderRulesOrderInput = {
      ...market,
      id: "c",
      orderCode: "PD 3",
      status: "CANCELLED",
      issueDate: new Date(2026, 6, 12),
      totalNetValue: 50_000,
      items: [{ id: "i3", quantity: 1 }],
    };
    const orders = [market, group, cancelled];
    const withGroup = resolveOfficialSalesOrderExecutiveMetrics(orders, ref, 2026, 7, undefined, {
      excludeGroupCompanyCustomers: false,
    });
    const marketOnly = resolveOfficialSalesOrderExecutiveMetrics(orders, ref, 2026, 7, undefined, {
      excludeGroupCompanyCustomers: true,
    });
    assert.equal(withGroup.metrics.soldAmountMonth, 677_071.6);
    assert.equal(marketOnly.metrics.soldAmountMonth, 667_071.6);
  });

  it("vendido no mês vem de target.actual (monthAgg) — separado do YTD", () => {
    const metrics = readFileSync(
      join(process.cwd(), "src/lib/salesOrdersDashboardMetrics.ts"),
      "utf8"
    );
    assert.match(metrics, /soldAmountMonth/);
    assert.match(metrics, /const monthlyTarget = buildTargetBlock\(monthAgg\.net/);
    assert.match(metrics, /target: monthlyTarget/);
    assert.match(metrics, /metricCard\("realized-ytd"/);
    assert.match(metrics, /metricCard\("realized-month"/);
    assert.match(metrics, /soldAmountYtd/);
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
    assert.match(card, /valueTitle=\{value\}/);
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
    assert.match(document, /EXECUTIVE_REPORT_AUTO_TARGET_SHORT/);
    assert.match(document, /label="Meta mês"/);
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
      document.indexOf('pageId="accounts-receivable"')
    );
    assert.match(billingSection, /Faturamento mês/);
    assert.doesNotMatch(billingSection, /label="Pedidos mês"/);
  });
});
