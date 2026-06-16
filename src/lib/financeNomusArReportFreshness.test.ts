import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsReceivableDashboard,
  filterFinanceArRows,
  roundMoney,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildNomusArReportSyncCutoff,
  buildNomusArCurrentSyncPrismaWhere,
  isFinanceArExcludedFromReports,
  isNomusArStaleForReports,
  NOMUS_AR_STALE_SYNC_FALLBACK_WINDOW_MS,
  resolveNomusArReportSyncCutoffFromRows,
} from "./financeNomusArReportFreshness.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import { sumArOpenDueInPeriod } from "./financeCashFlowExecutiveSummary.js";
import { startOfLocalDay } from "./financeAccountsReceivableDashboard.js";

const LATEST_SYNC = new Date("2026-06-16T10:00:00.000Z");
const STALE_SYNC = new Date("2026-06-08T10:00:00.000Z");

function cutoff() {
  return buildNomusArReportSyncCutoff(LATEST_SYNC)!;
}

function arRow(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">
): FinanceArDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "12.345.678/0001-90",
    description: null,
    dueDate: new Date(2026, 6, 15),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: "Bradesco",
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    ...partial,
  };
}

function cashFlowArRow(
  partial: Partial<FinanceCashFlowArRow> & Pick<FinanceCashFlowArRow, "externalId">
): FinanceCashFlowArRow {
  return {
    ...arRow(partial),
    competenceDate: null,
    ...partial,
  };
}

describe("financeNomusArReportFreshness", () => {
  it("cutoff usa MAX(syncedAt) - 1 hora como fallback", () => {
    const c = cutoff();
    assert.equal(c.strategy, "MAX_SYNCED_AT_MINUS_WINDOW");
    assert.equal(
      c.minEligibleSyncedAt.getTime(),
      LATEST_SYNC.getTime() - NOMUS_AR_STALE_SYNC_FALLBACK_WINDOW_MS
    );
    assert.equal(isNomusArStaleForReports({ syncedAt: STALE_SYNC }, c), true);
    assert.equal(isNomusArStaleForReports({ syncedAt: LATEST_SYNC }, c), false);
  });

  it("resolve cutoff a partir do lote de linhas", () => {
    const resolved = resolveNomusArReportSyncCutoffFromRows([
      { syncedAt: STALE_SYNC },
      { syncedAt: LATEST_SYNC },
    ]);
    assert.ok(resolved);
    assert.equal(isNomusArStaleForReports({ syncedAt: STALE_SYNC }, resolved), true);
  });

  it("prisma where exige syncedAt >= minEligibleSyncedAt", () => {
    const where = buildNomusArCurrentSyncPrismaWhere(cutoff());
    assert.deepEqual(where, {
      syncedAt: { gte: cutoff().minEligibleSyncedAt },
    });
  });

  it("recebível atual entra; stale não entra", () => {
    const rows = [
      arRow({ externalId: 16771, syncedAt: LATEST_SYNC, balanceReceivable: 339053.55 }),
      arRow({ externalId: 16470, syncedAt: STALE_SYNC, balanceReceivable: 392270.15 }),
    ];
    const filtered = filterFinanceArRows(
      rows,
      { status: "open", year: 2026, month: 7 },
      new Date(2026, 5, 16),
      cutoff()
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.externalId, 16771);
  });

  it("título fantasma continua excluído", () => {
    const ghost = arRow({
      externalId: 99,
      amountReceivable: 500,
      amountReceived: 0,
      balanceReceivable: 0,
      syncedAt: LATEST_SYNC,
    });
    assert.equal(isFinanceArExcludedFromReports(ghost, cutoff()), true);
  });

  it("julho/2026 — soma open due exclui stale (PD 02534 / Esmaltec)", () => {
    const julyStart = startOfLocalDay(new Date(2026, 6, 1));
    const julyEnd = startOfLocalDay(new Date(2026, 6, 31));

    const rows: FinanceCashFlowArRow[] = [
      cashFlowArRow({
        externalId: 16771,
        personName: "Esmaltec",
        description: "PD 02534",
        balanceReceivable: 339053.55,
        dueDate: new Date(2026, 6, 10),
        syncedAt: LATEST_SYNC,
      }),
      cashFlowArRow({
        externalId: 16470,
        personName: "Esmaltec",
        description: "PD 02534",
        balanceReceivable: 392270.15,
        dueDate: new Date(2026, 6, 11),
        syncedAt: STALE_SYNC,
      }),
      cashFlowArRow({
        externalId: 30001,
        balanceReceivable: 1_254_426.16,
        dueDate: new Date(2026, 6, 20),
        syncedAt: LATEST_SYNC,
      }),
      cashFlowArRow({
        externalId: 20001,
        balanceReceivable: 135_680.81,
        dueDate: new Date(2026, 6, 25),
        syncedAt: STALE_SYNC,
      }),
    ];

    const withStale = sumArOpenDueInPeriod(rows, julyStart, julyEnd);
    assert.equal(roundMoney(withStale), 2_121_430.67);

    const eligible = rows.filter((row) => !isFinanceArExcludedFromReports(row, cutoff()));
    const julyOpen = sumArOpenDueInPeriod(eligible, julyStart, julyEnd);
    assert.equal(roundMoney(julyOpen), 1_593_479.71);
    assert.equal(eligible.length, 2);
    assert.ok(!eligible.some((r) => r.externalId === 16470));
    assert.ok(eligible.some((r) => r.externalId === 16771));

    const payload = buildFinanceCashFlowDashboard(
      rows,
      [],
      {
        viewMode: "projected",
        dateBase: "due",
        status: "open",
        year: 2026,
        month: 7,
      },
      new Date(2026, 5, 16),
      cutoff()
    );
    const july = payload.executiveSummary.monthlyTimeline.find((r) => r.month === 7);
    assert.ok(july);
    assert.equal(july!.receivableOpenDue, 1_593_479.71);
  });

  it("dashboard AR não soma stale no total em aberto", () => {
    const rows = [
      arRow({ externalId: 1, balanceReceivable: 100, syncedAt: LATEST_SYNC }),
      arRow({ externalId: 2, balanceReceivable: 900, syncedAt: STALE_SYNC }),
    ];
    const dash = buildFinanceAccountsReceivableDashboard(
      rows,
      { status: "open", year: 2026, month: 7 },
      new Date(2026, 5, 16),
      cutoff()
    );
    assert.equal(dash.cards.totalOpenAmount, 100);
    assert.equal(dash.cards.openTitlesCount, 1);
  });
});
