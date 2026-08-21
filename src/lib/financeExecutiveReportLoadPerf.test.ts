/**
 * PERF Relatório Presidencial — contagem de cargas/enrich e paridade de KPIs visíveis.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildExecutiveReportPayablesSection,
  buildExecutiveReportReceivablesSection,
} from "./financeExecutiveReportDataSources.js";
import {
  buildExecutiveReportApPortfolioFilters,
  buildExecutiveReportArPortfolioFilters,
} from "./financeExecutiveReport.js";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import {
  buildOfficialAccountsReceivableRulesResult,
} from "./financeAccountsReceivableRulesAdapter.js";
import {
  buildOfficialAccountsPayableRulesResult,
} from "./financeAccountsPayableRulesAdapter.js";
import type { FinanceExecutiveReportFilters } from "./financeExecutiveReportTypes.js";
import { startOfficialEngineProjectionTracker } from "./financeOfficialEngineProjection.js";

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
    dueDate: new Date(2026, 5, 10),
    scheduleDate: null,
    type: 1,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 800,
    amountPaid: 0,
    balancePayable: 800,
    paymentMethodName: "PIX",
    bankAccountName: "Conta 1",
    sourceInvoiceId: null,
    documentNumber: "AP-2",
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 5, 10),
    ...overrides,
  };
}

describe("financeExecutiveReportLoadPerf", () => {
  it("assembler compartilha cutoffs/enrich e não dispara horizon AR nem segundo full AR/AP", () => {
    const assembler = read("src/lib/financeExecutiveReport.ts");
    assert.match(assembler, /loadExecutiveReportYearScopedBundle/);
    assert.match(assembler, /loadExecutiveReportAllYearsBundle/);
    assert.match(assembler, /resolveExecutiveReportSharedCutoffs/);
    assert.doesNotMatch(assembler, /loadFinanceArOpenHorizonRowsFromPrisma/);
    assert.doesNotMatch(assembler, /buildOfficialAccountsReceivableDashboard\(/);
    assert.doesNotMatch(assembler, /buildOfficialAccountsPayableDashboard\(/);
    assert.match(assembler, /exportAll:\s*false/);
    assert.match(assembler, /loadExecutiveReportCostCenterSpending/);
    // CC entra no Promise.all inicial (não após o fan-out de cargas).
    const promiseAllIdx = assembler.indexOf("await Promise.all([");
    const ccIdx = assembler.indexOf("loadExecutiveReportCostCenterSpending(filters, referenceDate)");
    assert.ok(promiseAllIdx > 0 && ccIdx > promiseAllIdx);
    assert.ok(ccIdx < assembler.indexOf("const { yearScoped, allYears }"));
  });

  it("radar first-paint pagina 25; endpoint dedicado permanece exportAll", () => {
    const radar = read("src/lib/financeExecutiveReportCashRadar.ts");
    assert.match(radar, /exportAll:\s*input\.exportAll \?\? false/);
    assert.match(radar, /pageSize:\s*input\.exportAll \? DAILY_RADAR_EXPORT_PAGE_SIZE : 25/);
    assert.match(radar, /exportAll:\s*true/);
    const page = read("src/components/finance/FinanceExecutiveReportPage.tsx");
    assert.match(page, /ensureExecutiveReportCashRadarForPrint/);
    assert.match(page, /exportAll/);
  });

  it("KPIs AR metrics-only batem bit-a-bit com motor full nos cards/YTD", () => {
    const filters = reportFilters();
    const arFilters = buildExecutiveReportArPortfolioFilters(filters);
    const rows = [
      arRow(),
      arRow({
        externalId: 3,
        balanceReceivable: 0,
        amountReceived: 500,
        settlementDate: new Date(2026, 5, 5),
        dueDate: new Date(2026, 4, 20),
      }),
    ];

    const tracker = startOfficialEngineProjectionTracker();
    const section = buildExecutiveReportReceivablesSection({
      rows,
      filters: arFilters,
      referenceDate: REF,
      syncCutoff: null,
      year: 2026,
      month: 6,
    });
    const calls = tracker.stop();
    assert.ok(calls.every((c) => c.mode === "metrics"));
    assert.equal(calls.filter((c) => c.kind === "ar").length, 1);

    const full = buildOfficialAccountsReceivableRulesResult({
      rows,
      filters: arFilters,
      referenceDate: REF,
      syncCutoff: null,
      year: 2026,
      month: 6,
    });

    assert.equal(section.cards.totalOpenAmount, full.cards.totalOpenAmount);
    assert.equal(section.cards.overdueAmount, full.cards.overdueAmount);
    assert.equal(section.cards.upcomingAmount, full.cards.upcomingAmount);
    assert.equal(section.kpis.receivedYtdCurrent, full.metrics.receivedYtd);
    assert.equal(section.kpis.openAmount, full.cards.totalOpenAmount);
  });

  it("KPIs AP metrics-only batem bit-a-bit com motor full (inclui Agendados)", () => {
    const filters = reportFilters();
    const apFilters = buildExecutiveReportApPortfolioFilters(filters);
    const rows = [
      apRow(),
      apRow({
        externalId: 4,
        dueDate: new Date(2026, 5, 20),
        scheduleDate: new Date(2026, 6, 20),
        balancePayable: 200,
        amountPayable: 200,
      }),
    ];

    const tracker = startOfficialEngineProjectionTracker();
    const section = buildExecutiveReportPayablesSection({
      rows,
      filters: apFilters,
      referenceDate: REF,
      syncCutoff: null,
      year: 2026,
      month: 6,
    });
    const calls = tracker.stop();
    assert.ok(calls.every((c) => c.mode === "metrics"));
    assert.equal(calls.filter((c) => c.kind === "ap").length, 1);

    const full = buildOfficialAccountsPayableRulesResult({
      rows,
      filters: apFilters,
      referenceDate: REF,
      syncCutoff: null,
      year: 2026,
      month: 6,
    });

    assert.equal(section.cards.totalOpenAmount, full.cards.totalOpenAmount);
    assert.equal(section.cards.overdueAmount, full.cards.overdueAmount);
    assert.equal(section.kpis.paidYtdCurrent, full.metrics.paidYtd);
    assert.equal(
      section.kpis.scheduledOpenAmount,
      full.purchaseOrderScheduleAudit.rescheduledOpenAmount
    );
    assert.equal(
      section.purchaseOrderScheduleAudit.rescheduledOpenAmount,
      full.purchaseOrderScheduleAudit.rescheduledOpenAmount
    );
  });

  it("CF período com mês recorta vencimento (mesma população projected BASE)", () => {
    const assembler = read("src/lib/financeExecutiveReport.ts");
    const load = read("src/lib/financeExecutiveReportLoad.server.ts");
    assert.match(assembler, /sliceCashFlowRowsToDuePeriod/);
    assert.match(load, /export function sliceCashFlowRowsToDuePeriod/);
    assert.match(load, /resolveFinanceArDueDateBounds/);
  });

  it("guard: relatório não introduz fórmula financeira nova nos loaders", () => {
    const load = read("src/lib/financeExecutiveReportLoad.server.ts");
    assert.doesNotMatch(load, /balanceReceivable\s*\*\s*/);
    assert.doesNotMatch(load, /amountPayable\s*\+\s*amountPaid/);
    assert.match(load, /enrichFinanceCashFlowArLoadBundle/);
    assert.match(load, /startExecutiveReportLoadTracker/);
  });
});
