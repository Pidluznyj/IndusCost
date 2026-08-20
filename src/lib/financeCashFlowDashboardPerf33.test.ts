import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildOfficialAccountsPayableRulesResult,
} from "./financeAccountsPayableRulesAdapter.js";
import {
  buildOfficialAccountsReceivableRulesResult,
  computeOfficialArMetrics,
} from "./financeAccountsReceivableRulesAdapter.js";
import {
  buildFinanceCashFlowDashboard,
  filterCashFlowApRows,
  filterCashFlowArRows,
  toApLoadFilters,
  toArLoadFilters,
  toCashFlowPortfolioApFilters,
  toCashFlowPortfolioArFilters,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import type { FinanceCashFlowDashboardPayload } from "./financeCashFlowDashboardTypes.js";
import { buildYtdDashboardFilters, filterArRowsForYtdReceived } from "./financeCashFlowExecutiveYtd.js";
import {
  filterCashFlowApPortfolioRows,
  filterCashFlowArPortfolioRows,
} from "./financeCashFlowRowFilters.js";
import { startOfficialEngineProjectionTracker } from "./financeOfficialEngineProjection.js";

const REF = new Date(2026, 5, 9);

const FILTERS = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
};

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: null,
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    competenceDate: new Date(2026, 5, 1),
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: "Conta 1",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 5, 8),
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: "22222222000122",
    description: null,
    dueDate: new Date(2026, 5, 20),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: new Date(2026, 5, 2),
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: "PIX",
    bankAccountName: "Conta 2",
    sourceInvoiceId: null,
    documentNumber: "DOC-1",
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 5, 8),
    ...overrides,
  };
}

function representativeRows(): {
  ar: FinanceCashFlowArRow[];
  ap: FinanceCashFlowApRow[];
} {
  return {
    ar: [
      arRow({
        externalId: 1,
        balanceReceivable: 1000,
        amountReceivable: 1000,
        dueDate: new Date(2026, 5, 15),
      }),
      arRow({
        externalId: 3,
        balanceReceivable: 0,
        amountReceived: 1500,
        amountReceivable: 1500,
        dueDate: new Date(2026, 1, 8),
        settlementDate: new Date(2026, 2, 15),
      }),
      arRow({
        externalId: 4,
        balanceReceivable: 400,
        amountReceivable: 400,
        dueDate: new Date(2026, 4, 1),
        personName: "Cliente Overdue",
      }),
      arRow({
        externalId: 5,
        balanceReceivable: 800,
        amountReceivable: 800,
        dueDate: new Date(2026, 0, 10),
        personName: "Cliente Jan",
      }),
    ],
    ap: [
      apRow({
        externalId: 2,
        balancePayable: 500,
        amountPayable: 500,
        dueDate: new Date(2026, 5, 20),
      }),
      apRow({
        externalId: 6,
        balancePayable: 0,
        amountPaid: 200,
        amountPayable: 200,
        dueDate: new Date(2026, 5, 5),
        paymentDate: new Date(2026, 5, 5),
        settlementDate: new Date(2026, 5, 5),
      }),
      apRow({
        externalId: 7,
        balancePayable: 300,
        amountPayable: 300,
        dueDate: new Date(2026, 7, 12),
        personName: "Fornecedor Ago",
      }),
    ],
  };
}

function officialFinancialSlice(payload: FinanceCashFlowDashboardPayload) {
  return {
    cards: {
      totalReceivableOpen: payload.cards.totalReceivableOpen,
      totalPayableOpen: payload.cards.totalPayableOpen,
      overdueReceivableAmount: payload.cards.overdueReceivableAmount,
      overduePayableAmount: payload.cards.overduePayableAmount,
      overdueCashImpact: payload.cards.overdueCashImpact,
    },
    receivable: payload.executiveSummary.receivable,
    payable: {
      paidYtd: payload.executiveSummary.payable.paidYtd,
      openFromTodayToYearEnd: payload.executiveSummary.payable.openFromTodayToYearEnd,
      estimatedYearTotal: payload.executiveSummary.payable.estimatedYearTotal,
    },
    net: payload.executiveSummary.net,
    reconciliation: {
      arDashboardOpen: payload.reconciliation.receivable.arDashboardOpen,
      arDashboardReceived: payload.reconciliation.receivable.arDashboardReceived,
      apDashboardOpen: payload.reconciliation.payable.apDashboardOpen,
      apDashboardPaid: payload.reconciliation.payable.apDashboardPaid,
      cashFlowOpenReceivable: payload.reconciliation.receivable.cashFlowOpenPortfolio,
      cashFlowOpenPayable: payload.reconciliation.payable.cashFlowOpenPortfolio,
    },
  };
}

describe("PERF 3.3 cash-flow official metrics", () => {
  it("campos financeiros do dashboard batem com o motor oficial full", () => {
    const { ar, ap } = representativeRows();
    const payload = buildFinanceCashFlowDashboard(ar, ap, FILTERS, REF);
    const arFilters = toArLoadFilters(FILTERS);
    const apFilters = toApLoadFilters(FILTERS);

    const arPortfolioRows = filterCashFlowArPortfolioRows(ar, FILTERS, arFilters, REF);
    const apPortfolioRows = filterCashFlowApPortfolioRows(ap, FILTERS, apFilters, REF);
    const arPeriodRows = filterCashFlowArRows(ar, FILTERS, REF);
    const arPortfolioFull = buildOfficialAccountsReceivableRulesResult({
      rows: arPortfolioRows,
      filters: toCashFlowPortfolioArFilters(FILTERS),
      referenceDate: REF,
    });
    const apPortfolioFull = buildOfficialAccountsPayableRulesResult({
      rows: apPortfolioRows,
      filters: toCashFlowPortfolioApFilters(FILTERS),
      referenceDate: REF,
    });
    const arPeriodFull = buildOfficialAccountsReceivableRulesResult({
      rows: arPeriodRows,
      filters: arFilters,
      referenceDate: REF,
    });
    const apPeriodFull = buildOfficialAccountsPayableRulesResult({
      rows: ap,
      filters: apFilters,
      referenceDate: REF,
      year: FILTERS.year,
      month: FILTERS.month,
    });

    const ytdFilters = buildYtdDashboardFilters(FILTERS, REF);
    const arYtdFull = buildOfficialAccountsReceivableRulesResult({
      rows: filterArRowsForYtdReceived(ar, ytdFilters, REF),
      filters: toArLoadFilters(ytdFilters),
      referenceDate: REF,
      year: ytdFilters.year,
    });
    const apYtdFull = buildOfficialAccountsPayableRulesResult({
      rows: ap,
      filters: toApLoadFilters(ytdFilters),
      referenceDate: REF,
      year: ytdFilters.year,
    });

    assert.equal(payload.cards.totalReceivableOpen, arPortfolioFull.metrics.openAmount);
    assert.equal(payload.cards.overdueReceivableAmount, arPortfolioFull.metrics.overdueAmount);
    assert.equal(payload.cards.totalPayableOpen, apPortfolioFull.metrics.openAmount);
    assert.equal(payload.cards.overduePayableAmount, apPortfolioFull.metrics.overdueAmount);
    assert.equal(payload.executiveSummary.receivable.receivedYtd, arYtdFull.metrics.receivedYtd);
    assert.equal(
      payload.executiveSummary.receivable.openFromTodayToYearEnd,
      arYtdFull.metrics.openUntilYearEnd
    );
    assert.equal(
      payload.executiveSummary.receivable.estimatedYearTotal,
      arYtdFull.metrics.estimatedYearTotal
    );
    assert.equal(payload.executiveSummary.payable.paidYtd, apYtdFull.metrics.paidYtd);
    assert.equal(
      payload.executiveSummary.payable.openFromTodayToYearEnd,
      apYtdFull.metrics.openUntilYearEnd
    );
    assert.equal(
      payload.executiveSummary.payable.estimatedYearTotal,
      apYtdFull.metrics.estimatedYearTotal
    );
    assert.equal(
      payload.reconciliation.receivable.arDashboardOpen,
      arPeriodFull.metrics.openAmount
    );
    assert.equal(
      payload.reconciliation.receivable.arDashboardReceived,
      arPeriodFull.cards.totalReceivedAmount
    );
    assert.equal(
      payload.reconciliation.payable.apDashboardOpen,
      apPeriodFull.cards.totalOpenAmount
    );
    assert.equal(payload.cards.totalReceivableOpen, 2200);
    assert.equal(payload.cards.totalPayableOpen, 800);
  });

  it("payload financeiro é determinístico entre duas execuções", () => {
    const { ar, ap } = representativeRows();
    const a = officialFinancialSlice(buildFinanceCashFlowDashboard(ar, ap, FILTERS, REF));
    const b = officialFinancialSlice(buildFinanceCashFlowDashboard(ar, ap, FILTERS, REF));
    assert.deepEqual(a, b);
  });

  it("reduz construções oficiais e não recalcula a mesma carteira AR", () => {
    const { ar, ap } = representativeRows();
    const tracker = startOfficialEngineProjectionTracker();
    buildFinanceCashFlowDashboard(ar, ap, FILTERS, REF);
    const calls = tracker.stop();

    assert.equal(calls.filter((call) => call.mode === "full").length, 0);
    assert.equal(calls.filter((call) => call.kind === "ar").length, 3);
    assert.equal(calls.filter((call) => call.kind === "ap").length, 3);
    assert.equal(calls.length, 6);
    assert.ok(calls.every((call) => call.mode === "metrics"));

    const arFingerprints = calls.filter((call) => call.kind === "ar").map((call) => call.fingerprint);
    assert.equal(new Set(arFingerprints).size, arFingerprints.length);

    const arFilters = toArLoadFilters(FILTERS);
    const arPortfolioRows = filterCashFlowArPortfolioRows(ar, FILTERS, arFilters, REF);
    const portfolioOnly = startOfficialEngineProjectionTracker();
    computeOfficialArMetrics({
      rows: arPortfolioRows,
      filters: toCashFlowPortfolioArFilters(FILTERS),
      referenceDate: REF,
    });
    const [portfolioCall] = portfolioOnly.stop();
    assert.ok(portfolioCall);
    assert.equal(
      calls.filter((call) => call.fingerprint === portfolioCall.fingerprint).length,
      1
    );
  });

  it("mês filtrado continua sem reutilizar carteira AR no período", () => {
    const { ar, ap } = representativeRows();
    const tracker = startOfficialEngineProjectionTracker();
    buildFinanceCashFlowDashboard(ar, ap, { ...FILTERS, month: 6 }, REF);
    const calls = tracker.stop();
    assert.equal(calls.filter((call) => call.kind === "ar").length, 3);
    assert.equal(new Set(calls.map((call) => call.fingerprint)).size, calls.length);
  });
});

describe("PERF 3.3 guard contra motor paralelo", () => {
  function read(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf8");
  }

  it("Cash Flow usa projeção oficial metrics-only e reuso canônico", () => {
    const dashboard = read("src/lib/financeCashFlowDashboard.ts");
    assert.match(dashboard, /computeOfficialArMetrics/);
    assert.match(dashboard, /computeOfficialApMetrics/);
    assert.match(dashboard, /reuseOfficialEngineResultIfSamePopulation/);
    assert.doesNotMatch(dashboard, /buildOfficialAccountsReceivableRulesResult/);
    assert.doesNotMatch(dashboard, /buildOfficialAccountsPayableRulesResult/);
    assert.doesNotMatch(dashboard, /FINANCE_AR_RULES_ENGINE_VERSION/);
    assert.doesNotMatch(dashboard, /estimatedYearTotal:\s*roundMoney/);
  });

  it("metrics-only e full dashboard compartilham o motor oficial", () => {
    const arAdapter = read("src/lib/financeAccountsReceivableRulesAdapter.ts");
    const apAdapter = read("src/lib/financeAccountsPayableRulesAdapter.ts");
    const arEngine = read("src/lib/financeAccountsReceivableRulesEngine.ts");
    const apEngine = read("src/lib/financeAccountsPayableRulesEngine.ts");
    assert.match(arAdapter, /export function computeOfficialArMetrics/);
    assert.match(arAdapter, /projection: "metrics"/);
    assert.match(arAdapter, /export function buildOfficialAccountsReceivableDashboard/);
    assert.match(arAdapter, /buildOfficialAccountsReceivableRulesResult/);
    assert.match(apAdapter, /export function computeOfficialApMetrics/);
    assert.match(apAdapter, /projection: "metrics"/);
    assert.match(apAdapter, /buildOfficialAccountsPayableRulesResult/);
    assert.match(arEngine, /projection === "metrics" \? "cards"/);
    assert.match(apEngine, /projection === "metrics" \? "cards"/);
    assert.match(arEngine, /buildAccountsReceivableMetrics\(titles, context, dashboard\.cards\)/);
    assert.match(apEngine, /buildAccountsPayableMetrics\(titles, context, dashboard\.cards\)/);
  });

  it("resumo executivo continua nos adapters oficiais", () => {
    const summary = read("src/lib/financeCashFlowExecutiveSummary.ts");
    assert.match(summary, /resolveOfficialArCashFlowExecutiveMetrics/);
    assert.match(summary, /resolveOfficialApCashFlowExecutiveMetrics/);
    assert.doesNotMatch(summary, /openAmount\s*=\s*row\.balanceReceivable/);
  });
});
