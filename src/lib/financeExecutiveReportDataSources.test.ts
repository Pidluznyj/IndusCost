import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsReceivableDashboard,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceAccountsPayableDashboard,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import {
  buildExecutiveReportPayablesSection,
  buildExecutiveReportReceivablesSection,
  buildOfficialAccountsPayableDashboardForReport,
  buildOfficialAccountsReceivableDashboardForReport,
  EXECUTIVE_REPORT_PAYABLES_SOURCE,
  EXECUTIVE_REPORT_RECEIVABLES_SOURCE,
} from "./financeExecutiveReportDataSources.js";
import {
  buildExecutiveReportApFilters,
  buildExecutiveReportArFilters,
} from "./financeExecutiveReport.js";
import type { FinanceExecutiveReportFilters } from "./financeExecutiveReportTypes.js";

const REF = new Date(2026, 5, 26, 23, 59, 59, 999);

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function reportFilters(overrides: Partial<FinanceExecutiveReportFilters> = {}): FinanceExecutiveReportFilters {
  return {
    year: 2026,
    month: 6,
    asOfDate: "2026-06-26",
    company: undefined,
    customerType: "external",
    includeInternalCompanies: false,
    nfeFilter: "nfe",
    invoiceIssuedFilter: "all",
    topN: 50,
    mode: "live",
    ...overrides,
  };
}

function arRow(overrides: Partial<FinanceArDashboardRow> = {}): FinanceArDashboardRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: "Recebível teste",
    dueDate: new Date(2026, 5, 20),
    settlementDate: new Date(2026, 5, 15),
    competenceDate: new Date(2026, 5, 1),
    amountReceivable: 1000,
    amountReceived: 400,
    balanceReceivable: 600,
    paymentMethodName: "Boleto",
    bankAccountName: "Conta 1",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 5, 10),
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceApDashboardRow> = {}): FinanceApDashboardRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: "22222222000122",
    description: "Pagável teste",
    dueDate: new Date(2026, 4, 10),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: new Date(2026, 5, 12),
    competenceDate: new Date(2026, 5, 2),
    amountPayable: 500,
    amountPaid: 500,
    balancePayable: 0,
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

describe("financeExecutiveReportDataSources", () => {
  it("relatório usa motor oficial de Contas a Receber", () => {
    const src = read("src/lib/financeExecutiveReportDataSources.ts");
    assert.match(src, /EXECUTIVE_REPORT_RECEIVABLES_SOURCE/);
    assert.match(src, /sumFinanceArReceivedBySettlementInPeriod/);
    assert.match(src, /buildExecutiveReportArKpisFromOfficial/);
  });

  it("relatório usa motor oficial de Contas a Pagar", () => {
    const src = read("src/lib/financeExecutiveReportDataSources.ts");
    assert.match(src, /EXECUTIVE_REPORT_PAYABLES_SOURCE/);
    assert.match(src, /sumFinanceApPaidInPaymentPeriod/);
  });

  it("AR aberto do relatório = AR aberto da tela oficial", () => {
    const filters = reportFilters();
    const arFilters = buildExecutiveReportArFilters(filters);
    const rows = [arRow(), arRow({ externalId: 2, balanceReceivable: 200, amountReceived: 0, settlementDate: null })];
    const official = buildOfficialAccountsReceivableDashboardForReport({
      rows,
      filters: arFilters,
      referenceDate: REF,
      syncCutoff: null,
    });
    const section = buildExecutiveReportReceivablesSection({
      rows,
      filters: arFilters,
      referenceDate: REF,
      syncCutoff: null,
      year: 2026,
      month: 6,
      cards: official.cards,
    });
    assert.equal(section.metricsSource, EXECUTIVE_REPORT_RECEIVABLES_SOURCE);
    assert.equal(section.kpis.openAmount, official.cards.totalOpenAmount);
    assert.equal(section.kpis.overdueAmount, official.cards.overdueAmount);
  });

  it("AP aberto/vencido do relatório = tela oficial", () => {
    const filters = reportFilters();
    const apFilters = buildExecutiveReportApFilters(filters);
    const rows = [
      apRow(),
      apRow({
        externalId: 3,
        balancePayable: 300,
        amountPaid: 0,
        paymentDate: null,
        dueDate: new Date(2026, 4, 1),
      }),
    ];
    const official = buildOfficialAccountsPayableDashboardForReport({
      rows,
      filters: apFilters,
      referenceDate: REF,
      syncCutoff: null,
    });
    const section = buildExecutiveReportPayablesSection({
      rows,
      filters: apFilters,
      referenceDate: REF,
      syncCutoff: null,
      year: 2026,
      month: 6,
      cards: official.cards,
    });
    assert.equal(section.metricsSource, EXECUTIVE_REPORT_PAYABLES_SOURCE);
    assert.equal(section.kpis.openAmount, official.cards.totalOpenAmount);
    assert.equal(section.kpis.overdueAmount, official.cards.overdueAmount);
  });

  it("recebido mês do relatório = recebido mês oficial quando mês = asOfDate", () => {
    const filters = reportFilters();
    const arFilters = buildExecutiveReportArFilters(filters);
    const rows = [arRow({ settlementDate: new Date(2026, 5, 10), amountReceived: 750 })];
    const official = buildFinanceAccountsReceivableDashboard(rows, arFilters, REF, null);
    const section = buildExecutiveReportReceivablesSection({
      rows,
      filters: arFilters,
      referenceDate: REF,
      syncCutoff: null,
      year: 2026,
      month: 6,
      cards: official.cards,
    });
    assert.equal(section.kpis.receivedMonthCurrent, official.cards.receivedThisMonthAmount);
  });

  it("pago mês do relatório = pago mês oficial quando mês = asOfDate", () => {
    const filters = reportFilters();
    const apFilters = buildExecutiveReportApFilters(filters);
    const rows = [apRow({ paymentDate: new Date(2026, 5, 18), amountPaid: 500, balancePayable: 0 })];
    const official = buildFinanceAccountsPayableDashboard(rows, apFilters, REF, null);
    const section = buildExecutiveReportPayablesSection({
      rows,
      filters: apFilters,
      referenceDate: REF,
      syncCutoff: null,
      year: 2026,
      month: 6,
      cards: official.cards,
    });
    assert.equal(section.kpis.paidMonthCurrent, official.cards.paidThisMonthAmount);
  });

  it("variação percentual não produz NaN no payload de KPIs", () => {
    const filters = reportFilters();
    const arFilters = buildExecutiveReportArFilters(filters);
    const section = buildExecutiveReportReceivablesSection({
      rows: [],
      filters: arFilters,
      referenceDate: REF,
      syncCutoff: null,
      year: 2026,
      month: 6,
      cards: buildFinanceAccountsReceivableDashboard([], arFilters, REF, null).cards,
    });
    for (const value of [
      section.kpis.receivedMonthCurrent,
      section.kpis.receivedMonthPrevious,
      section.kpis.receivedYtdCurrent,
      section.kpis.receivedYtdPrevious,
      section.kpis.openAmount,
      section.kpis.overdueAmount,
    ]) {
      assert.ok(Number.isFinite(value));
    }
    assert.ok(
      section.kpis.receivedMonthVariation.percent == null ||
        Number.isFinite(section.kpis.receivedMonthVariation.percent)
    );
  });

  it("UI consome KPIs pré-calculados do payload", () => {
    const doc = read("src/components/finance/executive-report/ExecutiveReportDocument.tsx");
    assert.match(doc, /report\.accountsReceivable\.kpis/);
    assert.match(doc, /report\.accountsPayable\.kpis/);
    assert.doesNotMatch(doc, /buildExecutiveReportArKpis\(/);
  });

  it("layout compacto e gráfico com altura mínima no PDF", () => {
    const css = read("src/components/finance/executive-report/finance-executive-report-print.css");
    assert.match(css, /executive-kpi-grid--compact/);
    assert.match(css, /112mm/);
    assert.match(css, /max-height:\s*22mm/);
  });
});
