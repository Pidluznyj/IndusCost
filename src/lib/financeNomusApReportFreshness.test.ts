import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsPayableDashboard,
  filterFinanceApRows,
  roundMoney,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import { buildFinanceApExportCsv } from "./financeAccountsPayableExport.js";
import { buildFinanceApTitlesPayload } from "./financeAccountsPayableTitles.js";
import {
  buildExecutiveMonthlyTimeline,
  sumApOpenDueInPeriod,
} from "./financeCashFlowExecutiveSummary.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowApRow,
} from "./financeCashFlowDashboard.js";
import { startOfLocalDay } from "./financeAccountsReceivableDashboard.js";
import {
  buildNomusApReportSyncCutoff,
  buildNomusApCurrentSyncPrismaWhere,
  isFinanceApExcludedFromReports,
  isNomusApStaleForReports,
  NOMUS_AP_STALE_SYNC_FALLBACK_WINDOW_MS,
  resolveNomusApReportSyncCutoffFromRows,
} from "./financeNomusApReportFreshness.js";
import { isIntercompanyPayable } from "./financeInternalGroupExclusions.js";

const LATEST_SYNC = new Date("2026-06-16T10:00:00.000Z");
const STALE_SYNC = new Date("2026-06-12T10:00:00.000Z");
const REF = new Date(2026, 5, 16);

function cutoff() {
  return buildNomusApReportSyncCutoff(LATEST_SYNC)!;
}

function apRow(
  partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">
): FinanceApDashboardRow {
  return {
    companyName: "KOPPETEL",
    personName: "Fornecedor Externo Ltda",
    personCnpj: "22.222.222/0001-22",
    description: "Nota fiscal serviço",
    dueDate: new Date(2026, 5, 20),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    ...partial,
  };
}

function cashFlowApRow(
  partial: Partial<FinanceCashFlowApRow> & Pick<FinanceCashFlowApRow, "externalId">
): FinanceCashFlowApRow {
  return {
    ...apRow(partial),
    competenceDate: null,
    ...partial,
  };
}

const cristalMasterStale = [
  apRow({
    externalId: 16218,
    personName: "Cristal Master",
    documentNumber: "8003",
    amountPayable: 1306.8,
    amountPaid: 0,
    balancePayable: 1306.8,
    dueDate: new Date(2026, 5, 10),
    syncedAt: STALE_SYNC,
  }),
  apRow({
    externalId: 16219,
    personName: "Cristal Master",
    documentNumber: "8003",
    amountPayable: 1306.8,
    amountPaid: 0,
    balancePayable: 1306.8,
    dueDate: new Date(2026, 5, 12),
    syncedAt: STALE_SYNC,
  }),
  apRow({
    externalId: 16220,
    personName: "Cristal Master",
    documentNumber: "8003",
    amountPayable: 1346.4,
    amountPaid: 0,
    balancePayable: 1346.4,
    dueDate: new Date(2026, 5, 14),
    syncedAt: STALE_SYNC,
  }),
] as const;

const cristalMasterCurrent = [
  apRow({
    externalId: 16984,
    personName: "Cristal Master",
    documentNumber: "8003",
    amountPayable: 1320,
    amountPaid: 0,
    balancePayable: 1320,
    dueDate: new Date(2026, 5, 10),
    syncedAt: LATEST_SYNC,
  }),
  apRow({
    externalId: 16985,
    personName: "Cristal Master",
    documentNumber: "8003",
    amountPayable: 1320,
    amountPaid: 0,
    balancePayable: 1320,
    dueDate: new Date(2026, 5, 12),
    syncedAt: LATEST_SYNC,
  }),
  apRow({
    externalId: 16986,
    personName: "Cristal Master",
    documentNumber: "8003",
    amountPayable: 1320,
    amountPaid: 0,
    balancePayable: 1320,
    dueDate: new Date(2026, 5, 14),
    syncedAt: LATEST_SYNC,
  }),
] as const;

describe("financeNomusApReportFreshness", () => {
  it("cutoff usa MAX(syncedAt) - 1 hora como fallback", () => {
    const c = cutoff();
    assert.equal(c.strategy, "MAX_SYNCED_AT_MINUS_WINDOW");
    assert.equal(
      c.minEligibleSyncedAt.getTime(),
      LATEST_SYNC.getTime() - NOMUS_AP_STALE_SYNC_FALLBACK_WINDOW_MS
    );
    assert.equal(isNomusApStaleForReports({ syncedAt: STALE_SYNC }, c), true);
    assert.equal(isNomusApStaleForReports({ syncedAt: LATEST_SYNC }, c), false);
  });

  it("resolve cutoff a partir do lote de linhas", () => {
    const resolved = resolveNomusApReportSyncCutoffFromRows([
      { syncedAt: STALE_SYNC },
      { syncedAt: LATEST_SYNC },
    ]);
    assert.ok(resolved);
    assert.equal(isNomusApStaleForReports({ syncedAt: STALE_SYNC }, resolved), true);
  });

  it("prisma where exige syncedAt >= minEligibleSyncedAt", () => {
    const where = buildNomusApCurrentSyncPrismaWhere(cutoff());
    assert.deepEqual(where, {
      syncedAt: { gte: cutoff().minEligibleSyncedAt },
    });
  });

  it("AP atual entra; AP stale não entra", () => {
    const rows = [
      apRow({ externalId: 16984, syncedAt: LATEST_SYNC, balancePayable: 1320 }),
      apRow({ externalId: 16218, syncedAt: STALE_SYNC, balancePayable: 1306.8 }),
    ];
    const filtered = filterFinanceApRows(
      rows,
      { status: "open", year: 2026, month: 6 },
      REF,
      cutoff()
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.externalId, 16984);
  });

  it("documento 8003/Cristal Master: IDs antigos fora, IDs novos dentro", () => {
    const rows = [...cristalMasterStale, ...cristalMasterCurrent];
    const filtered = filterFinanceApRows(
      rows,
      { status: "all", year: 2026, month: 6 },
      REF,
      cutoff()
    );
    assert.deepEqual(
      filtered.map((r) => r.externalId).sort((a, b) => a - b),
      [16984, 16985, 16986]
    );
    assert.equal(
      roundMoney(filtered.reduce((sum, row) => sum + row.amountPayable, 0)),
      3960
    );
  });

  it("dashboard AP não soma stale no total em aberto", () => {
    const rows = [
      apRow({ externalId: 16984, balancePayable: 1320, syncedAt: LATEST_SYNC }),
      apRow({ externalId: 16218, balancePayable: 1306.8, syncedAt: STALE_SYNC }),
    ];
    const dash = buildFinanceAccountsPayableDashboard(
      rows,
      { status: "open", year: 2026, month: 6 },
      REF,
      cutoff()
    );
    assert.equal(dash.cards.totalOpenAmount, 1320);
    assert.equal(dash.cards.openTitlesCount, 1);
    assert.equal(dash.dataSanitization.ignoredStalePayables, 1);
  });

  it("fluxo de caixa não soma AP stale na timeline mensal de junho/2026", () => {
    const rows = cristalMasterCurrent.map(cashFlowApRow);
    const staleRows = cristalMasterStale.map(cashFlowApRow);
    const juneStart = startOfLocalDay(new Date(2026, 5, 1));
    const juneEnd = startOfLocalDay(new Date(2026, 5, 30));

    const withStale = sumApOpenDueInPeriod([...rows, ...staleRows], juneStart, juneEnd);
    assert.equal(roundMoney(withStale), 7920);

    const eligible = [...rows, ...staleRows].filter(
      (row) => !isFinanceApExcludedFromReports(row, cutoff())
    );
    const juneOpen = sumApOpenDueInPeriod(eligible, juneStart, juneEnd);
    assert.equal(juneOpen, 3960);

    const payload = buildFinanceCashFlowDashboard(
      [],
      [...rows, ...staleRows],
      {
        viewMode: "projected",
        dateBase: "due",
        status: "open",
        year: 2026,
        month: 6,
      },
      REF,
      null,
      cutoff()
    );
    const jun = payload.executiveSummary.monthlyTimeline.find((r) => r.month === 6);
    assert.ok(jun);
    assert.equal(jun!.payableOpenDue, 3960);
  });

  it("timeline mensal com base saneada não inclui stale na agregação", () => {
    const allRows = [
      cashFlowApRow({
        externalId: 16984,
        balancePayable: 500,
        dueDate: new Date(2026, 5, 28),
        syncedAt: LATEST_SYNC,
      }),
      cashFlowApRow({
        externalId: 16218,
        balancePayable: 999,
        dueDate: new Date(2026, 5, 28),
        syncedAt: STALE_SYNC,
      }),
    ];
    const eligible = filterFinanceApRows(
      allRows,
      { status: "open", year: 2026 },
      new Date(2026, 5, 9),
      cutoff()
    );
    const timeline = buildExecutiveMonthlyTimeline(
      [],
      eligible as FinanceCashFlowApRow[],
      2026,
      new Date(2026, 5, 9)
    );
    const jun = timeline.find((r) => r.month === 6);
    assert.equal(jun?.payableOpenDue, 500);
  });

  it("export AP não exporta stale", () => {
    const rows = [...cristalMasterStale, ...cristalMasterCurrent];
    const csv = buildFinanceApExportCsv(
      rows,
      { status: "all", year: 2026, month: 6 },
      REF,
      cutoff()
    );
    assert.match(csv, /16984/);
    assert.doesNotMatch(csv, /16218/);
    assert.doesNotMatch(csv, /16219/);
    assert.doesNotMatch(csv, /16220/);
  });

  it("títulos AP não listam stale na visão padrão", () => {
    const rows = [...cristalMasterStale, ...cristalMasterCurrent];
    const payload = buildFinanceApTitlesPayload(
      rows,
      {
        page: 1,
        limit: 50,
        sortBy: "dueDate",
        sortDirection: "asc",
        filters: { status: "all", year: 2026, month: 6 },
        localFilter: "all",
      },
      REF,
      cutoff()
    );
    assert.equal(payload.total, 3);
    assert.ok(payload.items.every((item) => item.externalId >= 16984));
  });

  it("intercompany continua excluído", () => {
    const row = apRow({
      externalId: 99,
      companyName: "LAZARIOS",
      personName: "Koppetel Comercio de Plasticos LTDA",
      personCnpj: "14.055.501/0001-80",
      syncedAt: LATEST_SYNC,
    });
    assert.equal(isIntercompanyPayable(row), true);
    assert.equal(isFinanceApExcludedFromReports(row, cutoff()), true);
    const filtered = filterFinanceApRows(
      [row],
      { status: "all", year: 2026, month: 6, companyName: "LAZARIOS" },
      REF,
      cutoff()
    );
    assert.equal(filtered.length, 0);
  });

  it("pedido de compra continua excluído", () => {
    const row = apRow({
      externalId: 88,
      description: "Pedido de compra PC 7788",
      syncedAt: LATEST_SYNC,
    });
    assert.equal(isFinanceApExcludedFromReports(row, cutoff()), true);
  });

  it("AP externo da Koppetel continua entrando", () => {
    const row = apRow({
      externalId: 77,
      companyName: "KOPPETEL",
      personName: "Fornecedor Nacional Ltda",
      personCnpj: "33.333.333/0001-33",
      syncedAt: LATEST_SYNC,
    });
    const filtered = filterFinanceApRows(
      [row],
      { status: "all", year: 2026, month: 6, companyName: "KOPPETEL" },
      REF,
      cutoff()
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.externalId, 77);
  });
});
