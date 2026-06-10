import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCashFlowExecutiveYtdReading,
  buildFinanceCashFlowExecutiveYtd,
  buildYtdDashboardFilters,
  resolveYtdDateRange,
  resolveYtdTrendDirection,
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
        { month: "1", monthLabel: "Jan", inflow: 100, outflow: 0, net: 100, accumulated: 100, status: "positive" },
      ]).label,
      "Dados insuficientes"
    );

    const improving = resolveYtdTrendDirection([
      { month: "1", monthLabel: "Jan", inflow: 100, outflow: 50, net: 50, accumulated: 50, status: "positive" },
      { month: "2", monthLabel: "Fev", inflow: 100, outflow: 50, net: 50, accumulated: 100, status: "positive" },
      { month: "3", monthLabel: "Mar", inflow: 100, outflow: 50, net: 50, accumulated: 150, status: "positive" },
      { month: "4", monthLabel: "Abr", inflow: 200, outflow: 50, net: 150, accumulated: 300, status: "positive" },
    ]);
    assert.equal(improving.direction, "improving");

    const worsening = resolveYtdTrendDirection([
      { month: "1", monthLabel: "Jan", inflow: 200, outflow: 50, net: 150, accumulated: 150, status: "positive" },
      { month: "2", monthLabel: "Fev", inflow: 50, outflow: 100, net: -50, accumulated: 100, status: "negative" },
      { month: "3", monthLabel: "Mar", inflow: 50, outflow: 100, net: -50, accumulated: 50, status: "negative" },
      { month: "4", monthLabel: "Abr", inflow: 50, outflow: 150, net: -100, accumulated: -50, status: "negative" },
    ]);
    assert.equal(worsening.direction, "worsening");

    const stable = resolveYtdTrendDirection([
      { month: "1", monthLabel: "Jan", inflow: 100, outflow: 50, net: 50, accumulated: 50, status: "positive" },
      { month: "2", monthLabel: "Fev", inflow: 100, outflow: 100, net: 0, accumulated: 50, status: "neutral" },
      { month: "3", monthLabel: "Mar", inflow: 100, outflow: 100, net: 0, accumulated: 50, status: "neutral" },
      { month: "4", monthLabel: "Abr", inflow: 100, outflow: 100, net: 0, accumulated: 50, status: "neutral" },
    ]);
    assert.equal(stable.direction, "stable");
  });

  it("leitura executiva YTD menciona acumulado do ano", () => {
    const ytdAr = filterCashFlowArRows([arRow()], filters, REF);
    const ytdAp = filterCashFlowApRows([apRow()], filters, REF);
    const series = buildFinanceCashFlowMonthlySeries(ytdAr, ytdAp, filters, REF);
    const ytd = buildFinanceCashFlowExecutiveYtd(ytdAr, ytdAp, series, filters, REF);
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
});
