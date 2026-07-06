import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsReceivableDashboard,
  filterFinanceArManagementReportRows,
  isFinanceArAllowedInManagementReport,
  isFinanceArOverdueWithoutFiscalDocument,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceArOverdueExportWorkbook,
} from "./financeAccountsReceivableOverdueExport.js";
import {
  buildFinanceArOverduePayload,
  isFinanceArOverdueRow,
} from "./financeAccountsReceivableOverdue.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import { buildFinanceCashFlowCalendar } from "./financeCashFlowCalendar.js";
import { buildNomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

const LATEST_SYNC = new Date("2026-06-17T10:00:00.000Z");
const STALE_SYNC = new Date("2026-06-12T10:00:00.000Z");
const REF = new Date(2026, 5, 17);
const TODAY = new Date(2026, 5, 17);

function cutoff() {
  return buildNomusArReportSyncCutoff(LATEST_SYNC)!;
}

function arRow(overrides: Partial<FinanceArDashboardRow> = {}): FinanceArDashboardRow {
  return {
    externalId: 1,
    companyName: "KOPPETEL",
    personName: "Cliente Alpha Ltda",
    personCnpj: "11.111.111/0001-11",
    description: "Pedido 100",
    dueDate: new Date(2026, 5, 10),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: null,
    sourceInvoiceId: 500,
    sourceInvoiceNumber: "NF-500",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    ...overrides,
  };
}

function cashFlowArRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "KOPPETEL",
    personName: "Cliente Alpha",
    personCnpj: "11.111.111/0001-11",
    description: "Pedido",
    dueDate: new Date(2026, 5, 10),
    settlementDate: null,
    competenceDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: null,
    sourceInvoiceId: 500,
    sourceInvoiceNumber: "NF-500",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    ...overrides,
  };
}

const BASE_FILTERS = { status: "all" as const, year: 2026 };

describe("financeAccountsReceivableFiscalBacking", () => {
  it("vencido aberto fresh com NF entra na visão gerencial", () => {
    const row = arRow({ dueDate: new Date(2026, 5, 1), balanceReceivable: 800 });
    assert.equal(isFinanceArOverdueWithoutFiscalDocument(row, REF), false);
    assert.equal(isFinanceArAllowedInManagementReport(row, REF), true);
    assert.equal(isFinanceArOverdueRow(row, REF), true);

    const dash = buildFinanceAccountsReceivableDashboard([row], BASE_FILTERS, REF, cutoff());
    assert.equal(dash.cards.overdueAmount, 800);

    const overdue = buildFinanceArOverduePayload([row], BASE_FILTERS, REF, cutoff(), {
      paginate: false,
    });
    assert.equal(overdue.summary.overdueTitlesCount, 1);

    const cashFlow = buildFinanceCashFlowDashboard(
      [cashFlowArRow({ externalId: row.externalId, balanceReceivable: 800 })],
      [],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF,
      cutoff()
    );
    assert.equal(cashFlow.overdueReceivables.length, 1);
  });

  it("vencido aberto fresh sem NF é excluído de atrasados, ranking, aging, fluxo e export", () => {
    const row = arRow({
      externalId: 99,
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
      balanceReceivable: 4200,
      dueDate: new Date(2026, 4, 20),
    });
    assert.equal(isFinanceArOverdueWithoutFiscalDocument(row, REF), true);
    assert.equal(isFinanceArAllowedInManagementReport(row, REF), false);
    assert.equal(isFinanceArOverdueRow(row, REF), false);

    const dash = buildFinanceAccountsReceivableDashboard([row], BASE_FILTERS, REF, cutoff());
    assert.equal(dash.cards.overdueAmount, 0);
    assert.equal(dash.dataSanitization.ignoredOverdueWithoutFiscalDocumentReceivables, 1);

    const overdue = buildFinanceArOverduePayload([row], BASE_FILTERS, REF, cutoff(), {
      paginate: false,
    });
    assert.equal(overdue.summary.overdueTitlesCount, 0);
    assert.equal(overdue.customerRanking.length, 0);
    assert.ok(overdue.agingBuckets.every((b) => b.amount === 0));

    const wb = buildFinanceArOverdueExportWorkbook(overdue, overdue.overdueTitles);
    assert.equal(wb.SheetNames.includes("Títulos Atrasados"), true);

    const cashFlow = buildFinanceCashFlowDashboard(
      [
        cashFlowArRow({
          externalId: 99,
          sourceInvoiceId: null,
          sourceInvoiceNumber: null,
          balanceReceivable: 4200,
          dueDate: new Date(2026, 4, 20),
        }),
      ],
      [],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF,
      cutoff()
    );
    assert.equal(cashFlow.overdueReceivables.length, 0);
  });

  it("futuro aberto fresh sem NF permanece como previsão", () => {
    const row = arRow({
      externalId: 10,
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
      dueDate: new Date(2026, 7, 1),
      balanceReceivable: 1500,
    });
    assert.equal(isFinanceArOverdueWithoutFiscalDocument(row, REF), false);
    assert.equal(isFinanceArAllowedInManagementReport(row, REF), true);
    assert.equal(isFinanceArOverdueRow(row, REF), false);

    const dash = buildFinanceAccountsReceivableDashboard([row], BASE_FILTERS, REF, cutoff());
    assert.equal(dash.cards.upcomingAmount, 1500);
    assert.equal(dash.cards.overdueAmount, 0);

    const cashFlow = buildFinanceCashFlowDashboard(
      [
        cashFlowArRow({
          externalId: 10,
          sourceInvoiceId: null,
          sourceInvoiceNumber: null,
          dueDate: new Date(2026, 7, 1),
          balanceReceivable: 1500,
        }),
      ],
      [],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026, month: 8 },
      REF,
      cutoff()
    );
    assert.ok(cashFlow.largestProjectedInflows.some((r) => r.externalId === 10));

    const calendar = buildFinanceCashFlowCalendar(
      [
        cashFlowArRow({
          externalId: 10,
          sourceInvoiceId: null,
          sourceInvoiceNumber: null,
          dueDate: new Date(2026, 7, 5),
          balanceReceivable: 1500,
        }),
      ],
      [],
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026, month: 8 },
      REF
    );
    const day = calendar.days.find((d) => d.date === "2026-08-05");
    assert.ok(day && day.inflow >= 1500);
  });

  it("vencimento hoje sem NF não é tratado como vencido sem lastro fiscal", () => {
    const row = arRow({
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
      dueDate: TODAY,
      balanceReceivable: 900,
    });
    assert.equal(isFinanceArOverdueWithoutFiscalDocument(row, REF), false);
    assert.equal(isFinanceArOverdueRow(row, REF), false);

    const dash = buildFinanceAccountsReceivableDashboard([row], BASE_FILTERS, REF, cutoff());
    assert.equal(dash.cards.dueTodayAmount, 900);
    assert.equal(dash.cards.overdueAmount, 0);
  });

  it("vencido recebido/liquidado não aparece como atrasado com ou sem NF", () => {
    const settledWithNf = arRow({
      externalId: 1,
      balanceReceivable: 0,
      amountReceived: 1000,
      settlementDate: new Date(2026, 5, 12),
    });
    const settledWithoutNf = arRow({
      externalId: 2,
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
      balanceReceivable: 0,
      amountReceived: 1000,
      settlementDate: new Date(2026, 5, 12),
    });
    assert.equal(isFinanceArOverdueRow(settledWithNf, REF), false);
    assert.equal(isFinanceArOverdueRow(settledWithoutNf, REF), false);
  });

  it("título stale não aparece com ou sem NF", () => {
    const staleWithNf = arRow({ externalId: 1, syncedAt: STALE_SYNC, balanceReceivable: 5000 });
    const staleWithoutNf = arRow({
      externalId: 2,
      syncedAt: STALE_SYNC,
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
      balanceReceivable: 5000,
    });
    const managed = filterFinanceArManagementReportRows(
      [staleWithNf, staleWithoutNf],
      BASE_FILTERS,
      REF,
      cutoff()
    );
    assert.equal(managed.length, 0);
  });

  it("filtro Todos exclui vencidos sem NF e mantém futuros sem NF", () => {
    const rows = [
      arRow({ externalId: 1, sourceInvoiceId: 10, balanceReceivable: 1000 }),
      arRow({
        externalId: 2,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        balanceReceivable: 700,
      }),
      arRow({
        externalId: 3,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        dueDate: new Date(2026, 8, 1),
        balanceReceivable: 400,
      }),
    ];
    const all = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026, invoiceIssued: "all" },
      REF,
      cutoff(),
      { paginate: false }
    );
    assert.equal(all.summary.overdueTitlesCount, 1);
    assert.equal(all.overdueTitles[0]!.externalId, 1);

    const dashAll = buildFinanceAccountsReceivableDashboard(
      rows,
      { status: "all", year: 2026, invoiceIssued: "all" },
      REF,
      cutoff()
    );
    assert.equal(dashAll.cards.overdueAmount, 1000);
    assert.equal(dashAll.cards.upcomingAmount, 400);
  });

  it("filtro Com NF restringe vencidos e futuros a títulos com NF", () => {
    const rows = [
      arRow({ externalId: 1, sourceInvoiceId: 10, balanceReceivable: 1000 }),
      arRow({
        externalId: 2,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        dueDate: new Date(2026, 8, 1),
        balanceReceivable: 400,
      }),
    ];
    const withNf = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026, invoiceIssued: "yes" },
      REF,
      cutoff(),
      { paginate: false }
    );
    assert.equal(withNf.summary.overdueTitlesCount, 1);
    assert.equal(withNf.overdueTitles[0]!.externalId, 1);

    const dash = buildFinanceAccountsReceivableDashboard(
      rows,
      { status: "all", year: 2026, invoiceIssued: "yes" },
      REF,
      cutoff()
    );
    assert.equal(dash.cards.upcomingAmount, 0);
  });

  it("filtro Sem NF mostra apenas futuros sem NF — vencidos sem NF nunca entram", () => {
    const rows = [
      arRow({ externalId: 1, sourceInvoiceId: 10, balanceReceivable: 1000 }),
      arRow({
        externalId: 2,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        balanceReceivable: 700,
      }),
      arRow({
        externalId: 3,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        dueDate: new Date(2026, 8, 1),
        balanceReceivable: 400,
      }),
    ];
    const withoutNf = buildFinanceArOverduePayload(
      rows,
      { status: "all", year: 2026, invoiceIssued: "no" },
      REF,
      cutoff(),
      { paginate: false }
    );
    assert.equal(withoutNf.summary.overdueTitlesCount, 0);

    const managed = filterFinanceArManagementReportRows(
      rows,
      { status: "all", year: 2026, invoiceIssued: "no" },
      REF,
      cutoff()
    );
    assert.ok(managed.some((r) => r.externalId === 3));
    assert.ok(!managed.some((r) => r.externalId === 2));
  });

  it("paridade: total, ranking, aging e export usam a mesma base filtrada", () => {
    const rows = [
      arRow({ externalId: 1, balanceReceivable: 1200 }),
      arRow({
        externalId: 2,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        balanceReceivable: 9000,
      }),
      arRow({ externalId: 3, dueDate: new Date(2026, 6, 1), balanceReceivable: 300 }),
    ];
    const payload = buildFinanceArOverduePayload(rows, BASE_FILTERS, REF, cutoff(), {
      paginate: false,
    });
    const tableTotal = payload.overdueTitles.reduce((s, r) => s + r.balanceReceivable, 0);
    const rankingTotal = payload.customerRanking.reduce((s, r) => s + r.overdueAmount, 0);
    const agingTotal = payload.agingBuckets.reduce((s, b) => s + b.amount, 0);
    assert.equal(payload.summary.totalOverdueAmount, tableTotal);
    assert.equal(rankingTotal, tableTotal);
    assert.equal(agingTotal, tableTotal);
    assert.equal(tableTotal, 1200);
  });

  it("visão padrão já exclui vencidos sem NF — filtro Com NF não corrige divergência de atraso", () => {
    const rows = [
      arRow({ externalId: 1, balanceReceivable: 1000 }),
      arRow({
        externalId: 2,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        balanceReceivable: 9000,
      }),
    ];

    const defaultView = buildFinanceArOverduePayload(rows, BASE_FILTERS, REF, cutoff(), {
      paginate: false,
    });
    const withNfView = buildFinanceArOverduePayload(
      rows,
      { ...BASE_FILTERS, invoiceIssued: "yes" },
      REF,
      cutoff(),
      { paginate: false }
    );
    assert.equal(defaultView.summary.totalOverdueAmount, withNfView.summary.totalOverdueAmount);
    assert.equal(defaultView.summary.overdueTitlesCount, withNfView.summary.overdueTitlesCount);
  });
});
