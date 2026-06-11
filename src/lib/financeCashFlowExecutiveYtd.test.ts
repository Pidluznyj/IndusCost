import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCashFlowExecutiveYtdReading,
  buildExecutiveYtdCarteiraTotals,
  buildFinanceCashFlowExecutiveYtd,
  buildYtdDashboardFilters,
  buildYtdReceivedComparison,
  filterArRowsForYtdReceived,
  isArReceivedInPeriod,
  resolvePreviousYtdComparableRange,
  resolveReceivedComparisonDirection,
  resolveYtdDateRange,
  resolveYtdTrendDirection,
  sumArReceivedInPeriod,
  type FinanceCashFlowExecutiveYtdTrendPoint,
} from "./financeCashFlowExecutiveYtd.js";
import {
  buildFinanceCashFlowDashboard,
  buildFinanceCashFlowMonthlySeries,
  filterCashFlowArRows,
  filterCashFlowApRows,
  financeCashFlowMetricsAreFinite,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import { formatCashFlowKpiDisplay } from "./financeCashFlowDisplay.js";

const REF = new Date(2026, 5, 9);

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: null,
    description: null,
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    competenceDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(),
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: null,
    description: null,
    dueDate: new Date(2026, 5, 20),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date(),
    ...overrides,
  };
}

const filters = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
};

function trendPoint(
  partial: Omit<
    FinanceCashFlowExecutiveYtdTrendPoint,
    "receivedInMonth" | "receivedAccumulated" | "previousYearReceivedAccumulated"
  >
): FinanceCashFlowExecutiveYtdTrendPoint {
  return {
    ...partial,
    receivedInMonth: null,
    receivedAccumulated: null,
    previousYearReceivedAccumulated: null,
  };
}

describe("financeCashFlowExecutiveYtd", () => {
  it("ano vigente usa 01/01 até hoje", () => {
    const range = resolveYtdDateRange(2026, REF);
    assert.equal(range.isCurrentYear, true);
    assert.ok(range.scopeLabel.includes("YTD 2026"));
    assert.ok(range.scopeLabel.includes("até hoje"));
    assert.equal(new Date(range.startDate).getMonth(), 0);
    assert.equal(new Date(range.startDate).getDate(), 1);
  });

  it("ano passado usa ano fechado", () => {
    const range = resolveYtdDateRange(2025, REF);
    assert.equal(range.isCurrentYear, false);
    assert.ok(range.scopeLabel.includes("Ano fechado 2025"));
    assert.equal(new Date(range.endDate).getFullYear(), 2025);
    assert.equal(new Date(range.endDate).getMonth(), 11);
  });

  it("filtro de mês não entra no YTD", () => {
    const ytdFilters = buildYtdDashboardFilters({ ...filters, month: 3 }, REF);
    assert.equal(ytdFilters.month, undefined);
    assert.equal(ytdFilters.year, 2026);
  });

  it("mês filtrado não altera executiveYtd vs YTD sem mês", () => {
    const withMonth = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 5000 })],
      [apRow({ balancePayable: 1000 })],
      { ...filters, month: 3 },
      REF
    );
    const withoutMonth = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 5000 })],
      [apRow({ balancePayable: 1000 })],
      filters,
      REF
    );
    assert.equal(withMonth.executiveYtd.netCashPosition, withoutMonth.executiveYtd.netCashPosition);
    assert.equal(withMonth.executiveYtd.totalReceivableOpen, 5000);
    assert.notEqual(withMonth.cards.inflowAmount, withoutMonth.cards.inflowAmount);
  });

  it("tendência improving, worsening, stable e dados insuficientes", () => {
    assert.equal(
      resolveYtdTrendDirection([
        trendPoint({
          month: "1",
          monthLabel: "Jan",
          inflow: 100,
          outflow: 0,
          net: 100,
          accumulated: 100,
          status: "positive",
        }),
      ]).label,
      "Dados insuficientes"
    );

    const improving = resolveYtdTrendDirection([
      trendPoint({ month: "1", monthLabel: "Jan", inflow: 100, outflow: 50, net: 50, accumulated: 50, status: "positive" }),
      trendPoint({ month: "2", monthLabel: "Fev", inflow: 100, outflow: 50, net: 50, accumulated: 100, status: "positive" }),
      trendPoint({ month: "3", monthLabel: "Mar", inflow: 100, outflow: 50, net: 50, accumulated: 150, status: "positive" }),
      trendPoint({ month: "4", monthLabel: "Abr", inflow: 200, outflow: 50, net: 150, accumulated: 300, status: "positive" }),
    ]);
    assert.equal(improving.direction, "improving");

    const worsening = resolveYtdTrendDirection([
      trendPoint({ month: "1", monthLabel: "Jan", inflow: 200, outflow: 50, net: 150, accumulated: 150, status: "positive" }),
      trendPoint({ month: "2", monthLabel: "Fev", inflow: 50, outflow: 100, net: -50, accumulated: 100, status: "negative" }),
      trendPoint({ month: "3", monthLabel: "Mar", inflow: 50, outflow: 100, net: -50, accumulated: 50, status: "negative" }),
      trendPoint({ month: "4", monthLabel: "Abr", inflow: 50, outflow: 150, net: -100, accumulated: -50, status: "negative" }),
    ]);
    assert.equal(worsening.direction, "worsening");

    const stable = resolveYtdTrendDirection([
      trendPoint({ month: "1", monthLabel: "Jan", inflow: 100, outflow: 50, net: 50, accumulated: 50, status: "positive" }),
      trendPoint({ month: "2", monthLabel: "Fev", inflow: 100, outflow: 100, net: 0, accumulated: 50, status: "neutral" }),
      trendPoint({ month: "3", monthLabel: "Mar", inflow: 100, outflow: 100, net: 0, accumulated: 50, status: "neutral" }),
      trendPoint({ month: "4", monthLabel: "Abr", inflow: 100, outflow: 100, net: 0, accumulated: 50, status: "neutral" }),
    ]);
    assert.equal(stable.direction, "stable");
  });

  it("leitura executiva YTD menciona acumulado do ano", () => {
    const ytdAr = filterCashFlowArRows([arRow()], filters, REF);
    const ytdAp = filterCashFlowApRows([apRow()], filters, REF);
    const series = buildFinanceCashFlowMonthlySeries(ytdAr, ytdAp, filters, REF);
    const ytd = buildFinanceCashFlowExecutiveYtd(ytdAr, ytdAp, series, [arRow()], filters, REF);
    const lines = buildCashFlowExecutiveYtdReading(ytd);
    assert.ok(lines.some((l) => l.includes("No acumulado do ano")));
  });

  it("payload inclui executiveYtd sem NaN", () => {
    const payload = buildFinanceCashFlowDashboard([arRow()], [apRow()], filters, REF);
    assert.ok(payload.executiveYtd);
    assert.ok(payload.executiveYtdReading.length > 0);
    assert.equal(financeCashFlowMetricsAreFinite(payload), true);
  });

  it("cards compactos e textos YTD na página", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowPage.tsx"),
      "utf8"
    );
    const summary = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "cash-flow",
        "FinanceCashFlowYtdSummary.tsx"
      ),
      "utf8"
    );
    assert.ok(page.includes("FinanceCashFlowYtdSummary"));
    assert.ok(summary.includes("Resumo executivo YTD"));
    assert.ok(summary.includes("Topo: YTD"));
    assert.ok(summary.includes("Análises abaixo: filtros aplicados"));
    assert.ok(summary.includes("ytd-kpi-net-position"));
    assert.ok(summary.includes("FinanceCashFlowYtdTrendChart"));
    assert.ok(!page.includes("FinanceCashFlowNetPositionHero"));
  });

  it("valores grandes usam formato compacto com title completo", () => {
    const kpi = formatCashFlowKpiDisplay(4_920_000);
    assert.ok(kpi.display.includes("Mi"));
    assert.ok(kpi.full.includes("4.920.000"));
  });

  it("recebido YTD usa settlementDate e amountReceived", () => {
    const rows = [
      arRow({
        externalId: 1,
        settlementDate: new Date(2026, 2, 10),
        amountReceived: 1500,
        balanceReceivable: 0,
      }),
      arRow({
        externalId: 2,
        dueDate: new Date(2026, 5, 1),
        settlementDate: null,
        amountReceived: 0,
        balanceReceivable: 2000,
      }),
    ];
    const range = resolveYtdDateRange(2026, REF);
    const total = sumArReceivedInPeriod(rows, range.startDate, range.endDate);
    assert.equal(total, 1500);
    assert.equal(
      isArReceivedInPeriod(rows[0]!, range.startDate, range.endDate),
      true
    );
    assert.equal(
      isArReceivedInPeriod(rows[1]!, range.startDate, range.endDate),
      false
    );
  });

  it("recebido YTD não usa vencimento nem saldo aberto", () => {
    const row = arRow({
      dueDate: new Date(2026, 0, 5),
      settlementDate: null,
      amountReceived: 0,
      balanceReceivable: 9000,
    });
    const range = resolveYtdDateRange(2026, REF);
    assert.equal(sumArReceivedInPeriod([row], range.startDate, range.endDate), 0);
  });

  it("comparação ano vigente usa mesmo dia/mês no ano anterior", () => {
    const prev = resolvePreviousYtdComparableRange(2026, REF);
    assert.equal(prev.previousYear, 2025);
    assert.equal(prev.startDate.getFullYear(), 2025);
    assert.equal(prev.startDate.getMonth(), 0);
    assert.equal(prev.endDate.getFullYear(), 2025);
    assert.equal(prev.endDate.getMonth(), REF.getMonth());
    assert.equal(prev.endDate.getDate(), REF.getDate());
  });

  it("comparação ano passado usa ano fechado vs anterior fechado", () => {
    const current = resolveYtdDateRange(2025, REF);
    const prev = resolvePreviousYtdComparableRange(2025, REF);
    assert.equal(current.isCurrentYear, false);
    assert.equal(new Date(current.endDate).getMonth(), 11);
    assert.equal(prev.endDate.getMonth(), 11);
    assert.equal(prev.endDate.getDate(), 31);
    assert.equal(prev.startDate.getFullYear(), 2024);
  });

  it("filtro de mês não altera recebido YTD", () => {
    const rows = [
      arRow({
        externalId: 1,
        settlementDate: new Date(2026, 2, 5),
        amountReceived: 800,
        balanceReceivable: 0,
      }),
    ];
    const withMonth = buildYtdReceivedComparison(
      rows,
      { ...filters, month: 3 },
      REF
    );
    const withoutMonth = buildYtdReceivedComparison(rows, filters, REF);
    assert.equal(withMonth.currentAmount, withoutMonth.currentAmount);
    assert.equal(withMonth.currentAmount, 800);
  });

  it("filtro de empresa afeta recebido YTD", () => {
    const rows = [
      arRow({
        externalId: 1,
        companyName: "Empresa A",
        settlementDate: new Date(2026, 1, 1),
        amountReceived: 100,
        balanceReceivable: 0,
      }),
      arRow({
        externalId: 2,
        companyName: "Empresa B",
        settlementDate: new Date(2026, 1, 2),
        amountReceived: 200,
        balanceReceivable: 0,
      }),
    ];
    const filtered = filterArRowsForYtdReceived(
      rows,
      { ...filters, companyName: "Empresa A" },
      REF
    );
    const range = resolveYtdDateRange(2026, REF);
    assert.equal(sumArReceivedInPeriod(filtered, range.startDate, range.endDate), 100);
  });

  it("deltaAmount, deltaPercent e direction up/down/stable/no_previous", () => {
    const rows = [
      arRow({
        externalId: 1,
        settlementDate: new Date(2026, 1, 1),
        amountReceived: 1200,
        balanceReceivable: 0,
      }),
      arRow({
        externalId: 2,
        settlementDate: new Date(2025, 1, 1),
        amountReceived: 1000,
        balanceReceivable: 0,
      }),
    ];
    const cmp = buildYtdReceivedComparison(rows, filters, REF);
    assert.equal(cmp.currentAmount, 1200);
    assert.equal(cmp.previousAmount, 1000);
    assert.equal(cmp.deltaAmount, 200);
    assert.equal(cmp.deltaPercent, 20);
    assert.equal(cmp.direction, "up");

    assert.equal(resolveReceivedComparisonDirection(0, 0, 0), "stable");
    assert.equal(resolveReceivedComparisonDirection(500, 0, 500), "no_previous");
    assert.equal(resolveReceivedComparisonDirection(900, 1000, -100), "down");
    assert.equal(resolveReceivedComparisonDirection(1000, 1000, 0), "stable");
  });

  it("previousAmount zero não gera NaN/Infinity", () => {
    const cmp = buildYtdReceivedComparison(
      [
        arRow({
          settlementDate: new Date(2026, 0, 10),
          amountReceived: 500,
          balanceReceivable: 0,
        }),
      ],
      filters,
      REF
    );
    assert.equal(cmp.previousAmount, 0);
    assert.equal(cmp.deltaPercent, null);
    assert.equal(cmp.direction, "no_previous");
    assert.equal(Number.isFinite(cmp.deltaAmount), true);
  });

  it("card Recebido YTD e leitura executiva com comparação", () => {
    const summary = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "cash-flow",
        "FinanceCashFlowYtdSummary.tsx"
      ),
      "utf8"
    );
    assert.ok(summary.includes("ytd-kpi-received"));
    assert.ok(summary.includes("Recebido YTD"));

    const rows = [
      arRow({
        externalId: 1,
        settlementDate: new Date(2026, 1, 1),
        amountReceived: 1500,
        balanceReceivable: 0,
      }),
      arRow({
        externalId: 2,
        settlementDate: new Date(2025, 1, 1),
        amountReceived: 1000,
        balanceReceivable: 0,
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(rows, [apRow()], filters, REF);
    assert.ok(payload.executiveYtd.received);
    assert.ok(
      payload.executiveYtdReading.some(
        (l) => l.includes("Recebido YTD") && l.includes("2025")
      )
    );
  });

  it("totais AR somam amountReceivable, amountReceived e balanceReceivable", () => {
    const ar = [
      arRow({
        externalId: 1,
        amountReceivable: 1000,
        amountReceived: 400,
        balanceReceivable: 600,
      }),
      arRow({
        externalId: 2,
        amountReceivable: 500,
        amountReceived: 500,
        balanceReceivable: 0,
      }),
    ];
    const totals = buildExecutiveYtdCarteiraTotals(ar, []);
    assert.equal(totals.receivable.totalAmount, 1500);
    assert.equal(totals.receivable.receivedAmount, 900);
    assert.equal(totals.receivable.openAmount, 600);
  });

  it("totais AP somam amountPayable, amountPaid e balancePayable", () => {
    const ap = [
      apRow({
        externalId: 1,
        amountPayable: 800,
        amountPaid: 300,
        balancePayable: 500,
      }),
    ];
    const totals = buildExecutiveYtdCarteiraTotals([], ap);
    assert.equal(totals.payable.totalAmount, 800);
    assert.equal(totals.payable.paidAmount, 300);
    assert.equal(totals.payable.openAmount, 500);
  });

  it("títulos saneados não entram nos totais YTD", () => {
    const rows = [
      arRow({ externalId: 1, amountReceivable: 1000, balanceReceivable: 1000 }),
      arRow({
        externalId: 2,
        personName: "Koppetel Comercio de Plasticos LTDA",
        personCnpj: "14.055.501/0001-80",
        amountReceivable: 9000,
        balanceReceivable: 9000,
      }),
      arRow({
        externalId: 3,
        amountReceivable: 200,
        amountReceived: 0,
        balanceReceivable: 0,
      }),
    ];
    const ytdAr = filterCashFlowArRows(rows, filters, REF);
    const totals = buildExecutiveYtdCarteiraTotals(ytdAr, []);
    assert.equal(totals.receivable.totalAmount, 1000);
  });

  it("filtro de mês não altera totais YTD", () => {
    const rows = [arRow({ amountReceivable: 2000, balanceReceivable: 1500 })];
    const withMonth = buildFinanceCashFlowDashboard(
      rows,
      [apRow()],
      { ...filters, month: 3 },
      REF
    );
    const withoutMonth = buildFinanceCashFlowDashboard(rows, [apRow()], filters, REF);
    assert.deepEqual(withMonth.executiveYtd.totals, withoutMonth.executiveYtd.totals);
  });

  it("filtro de empresa altera totais YTD", () => {
    const rows = [
      arRow({ externalId: 1, companyName: "Empresa A", amountReceivable: 100 }),
      arRow({ externalId: 2, companyName: "Empresa B", amountReceivable: 200 }),
    ];
    const filtered = buildFinanceCashFlowDashboard(
      rows,
      [apRow()],
      { ...filters, companyName: "Empresa A" },
      REF
    );
    assert.equal(filtered.executiveYtd.totals.receivable.totalAmount, 100);
  });

  it("payload totals finitos e distintos de recebido por liquidação", () => {
    const rows = [
      arRow({
        amountReceivable: 1000,
        amountReceived: 200,
        balanceReceivable: 800,
        settlementDate: new Date(2026, 1, 1),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(rows, [apRow()], filters, REF);
    assert.equal(payload.executiveYtd.totals.receivable.receivedAmount, 200);
    assert.ok(payload.executiveYtd.received.currentAmount >= 0);
    assert.equal(financeCashFlowMetricsAreFinite(payload), true);
  });

  it("componente Totais financeiros YTD na página", () => {
    const panel = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "cash-flow",
        "FinanceCashFlowYtdTotalsPanel.tsx"
      ),
      "utf8"
    );
    const summary = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "cash-flow",
        "FinanceCashFlowYtdSummary.tsx"
      ),
      "utf8"
    );
    assert.ok(panel.includes("Totais financeiros YTD"));
    assert.ok(panel.includes("A RECEBER"));
    assert.ok(panel.includes("A PAGAR"));
    assert.ok(panel.includes("Valor a receber"));
    assert.ok(panel.includes("Valor recebido"));
    assert.ok(panel.includes("Valor em aberto receber"));
    assert.ok(panel.includes("Valor a pagar total"));
    assert.ok(panel.includes("Valor pago"));
    assert.ok(panel.includes("Valor em aberto pagar"));
    assert.ok(panel.includes("title={value.full}"));
    assert.ok(summary.includes("FinanceCashFlowYtdTotalsPanel"));
  });

  it("leitura executiva menciona carteira a receber e a pagar", () => {
    const ytdAr = filterCashFlowArRows(
      [arRow({ amountReceivable: 1000, balanceReceivable: 600 })],
      filters,
      REF
    );
    const ytdAp = filterCashFlowApRows([apRow({ amountPayable: 400, balancePayable: 200 })], filters, REF);
    const series = buildFinanceCashFlowMonthlySeries(ytdAr, ytdAp, filters, REF);
    const ytd = buildFinanceCashFlowExecutiveYtd(ytdAr, ytdAp, series, ytdAr, filters, REF);
    const lines = buildCashFlowExecutiveYtdReading(ytd);
    assert.ok(lines.some((l) => l.includes("carteira soma") && l.includes("a receber")));
    assert.ok(lines.some((l) => l.includes("obrigações somam") && l.includes("a pagar")));
    assert.ok(lines.length <= 6);
  });

  it("série mensal YTD de recebido não retorna NaN/Infinity", () => {
    const rows = [
      arRow({
        settlementDate: new Date(2026, 0, 15),
        amountReceived: 300,
        balanceReceivable: 0,
      }),
      arRow({
        settlementDate: new Date(2025, 0, 20),
        amountReceived: 200,
        balanceReceivable: 0,
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(rows, [apRow()], filters, REF);
    for (const p of payload.executiveYtd.trend.monthlyNetSeries) {
      for (const v of [
        p.receivedInMonth,
        p.receivedAccumulated,
        p.previousYearReceivedAccumulated,
      ]) {
        if (v != null) assert.equal(Number.isFinite(v), true);
      }
    }
  });
});
