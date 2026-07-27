import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreasuryDashboardDto } from "./contracts/treasuryDto.js";
import {
  buildTreasuryDashboardQuery,
  createEmptyTreasuryDashboardFilters,
  divergenceStatusLabel,
  formatTreasuryDashboardMoney,
  isTreasuryDashboardRecalculating,
  resolveTreasuryDashboardStaleState,
  resolveTreasuryDashboardViewKind,
} from "./treasuryDashboardUi.js";

function sampleDto(
  overrides: Partial<TreasuryDashboardDto> = {}
): TreasuryDashboardDto {
  return {
    ok: true,
    civilDate: "2026-07-27",
    scenario: "PROBABLE",
    accountIds: null,
    asOf: "2026-07-27T23:59:59.000-03:00",
    freshness: {
      asOf: "2026-07-27T23:59:59.000-03:00",
      sources: [
        {
          source: "BALANCE_SNAPSHOTS",
          label: "Snapshots",
          lastSuccessAt: "2026-07-27T10:00:00.000-03:00",
          isStale: true,
          detail: "stale",
        },
      ],
      hasStaleSource: true,
      staleSourceCount: 1,
    },
    observedBalance: "100.00",
    calculatedBalance: "90.00",
    reconciledBalance: null,
    divergence: "10.00",
    hasDivergence: true,
    receipts: {
      kind: "RECEIPTS",
      plannedAmount: "20.00",
      plannedTitleCount: 1,
      realizedAmount: "0.00",
      realizedTitleCount: 0,
      pendingAmount: "20.00",
      pendingTitleCount: 1,
    },
    payments: {
      kind: "PAYMENTS",
      plannedAmount: "5.00",
      plannedTitleCount: 1,
      realizedAmount: "0.00",
      realizedTitleCount: 0,
      pendingAmount: "5.00",
      pendingTitleCount: 1,
    },
    currentBalance: "100.00",
    currentBalanceOrigin: "CONSOLIDATED_OBSERVED",
    projectedClosingBalance: "115.00",
    projectedClosingOrigin: "CURRENT_PLUS_PLANNED_RECEIPTS_MINUS_PLANNED_PAYMENTS",
    titleCount: {
      receivablesPlanned: 1,
      receivablesRealized: 0,
      receivablesPending: 1,
      payablesPlanned: 1,
      payablesRealized: 0,
      payablesPending: 1,
      totalBucketSum: 2,
      openOnDay: 2,
    },
    accounts: [],
    consolidated: {
      accountCount: 0,
      includedAccountCount: 0,
      excludedAccountCount: 0,
      accountsMissingSnapshot: 0,
      observedBalance: "100.00",
      operationalAvailableBalance: "100.00",
      calculatedBalance: "90.00",
      reconciledBalance: null,
      divergence: "10.00",
      hasDivergence: true,
      blockedBalance: "0.00",
      investmentsBalance: "0.00",
      usedLimit: "0.00",
      alerts: [],
    },
    priorityExceptions: [],
    alerts: [],
    composition: [],
    origins: {},
    ...overrides,
  };
}

describe("treasuryDashboardUi — viewKind e query", () => {
  it("resolve estados denied/loading/empty/ready/recalculating/stale", () => {
    assert.equal(
      resolveTreasuryDashboardViewKind({
        canView: false,
        loading: false,
        error: null,
        hasData: false,
        hasFilters: false,
      }),
      "denied"
    );
    assert.equal(
      resolveTreasuryDashboardViewKind({
        canView: true,
        loading: true,
        error: null,
        hasData: false,
        hasFilters: false,
      }),
      "loading"
    );
    assert.equal(
      resolveTreasuryDashboardViewKind({
        canView: true,
        loading: false,
        error: "falha",
        hasData: false,
        hasFilters: false,
      }),
      "error"
    );
    assert.equal(
      resolveTreasuryDashboardViewKind({
        canView: true,
        loading: false,
        error: null,
        hasData: false,
        hasFilters: true,
      }),
      "empty-filtered"
    );
    assert.equal(
      resolveTreasuryDashboardViewKind({
        canView: true,
        loading: false,
        error: null,
        hasData: true,
        hasFilters: false,
      }),
      "ready"
    );
    assert.equal(
      isTreasuryDashboardRecalculating({ loading: true, hasData: true }),
      true
    );
    const stale = resolveTreasuryDashboardStaleState(sampleDto());
    assert.ok(stale && stale.includes("desatualizados"));
  });

  it("monta query de dashboard e formata money pt-BR", () => {
    const filters = createEmptyTreasuryDashboardFilters("2026-07-27");
    filters.accountId = "acc-1";
    filters.scenario = "CONFIRMED";
    filters.period = "week";
    const q = buildTreasuryDashboardQuery({ filters });
    assert.equal(q.date, "2026-07-27");
    assert.deepEqual(q.accountIds, ["acc-1"]);
    assert.equal(q.scenario, "CONFIRMED");
    assert.equal(q.hasFilters, true);
    assert.match(formatTreasuryDashboardMoney("1234.50"), /1\.234,50|R\$/);
    assert.match(divergenceStatusLabel(true, "10.00"), /Divergência/);
    assert.equal(divergenceStatusLabel(false, "0.00"), "Sem divergência");
  });
});
