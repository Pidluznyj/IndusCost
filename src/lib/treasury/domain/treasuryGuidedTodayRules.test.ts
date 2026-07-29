import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  TreasuryDashboardDto,
  TreasuryDailyClosingPreviewDto,
} from "../contracts/treasuryDto.js";
import {
  TREASURY_GUIDED_TODAY_TITLE,
  buildTreasuryGuidedTodayExperience,
} from "./treasuryGuidedTodayRules.js";

function sampleDashboard(
  overrides: Partial<TreasuryDashboardDto> = {}
): TreasuryDashboardDto {
  return {
    ok: true,
    civilDate: "2026-07-28",
    scenario: "PROBABLE",
    accountIds: null,
    asOf: "2026-07-28T12:00:00.000-03:00",
    freshness: {
      asOf: "2026-07-28T12:00:00.000-03:00",
      sources: [],
      hasStaleSource: false,
      staleSourceCount: 0,
    },
    observedBalance: null,
    calculatedBalance: "1000.00",
    reconciledBalance: null,
    divergence: null,
    hasDivergence: false,
    receipts: {
      kind: "RECEIPTS",
      plannedAmount: "200.00",
      plannedTitleCount: 2,
      realizedAmount: "50.00",
      realizedTitleCount: 1,
      pendingAmount: "150.00",
      pendingTitleCount: 1,
    },
    payments: {
      kind: "PAYMENTS",
      plannedAmount: "80.00",
      plannedTitleCount: 1,
      realizedAmount: "20.00",
      realizedTitleCount: 1,
      pendingAmount: "60.00",
      pendingTitleCount: 1,
    },
    currentBalance: null,
    currentBalanceOrigin: "MISSING",
    projectedClosingBalance: "1120.00",
    projectedClosingOrigin: "PLANNED",
    titleCount: {
      receivablesPlanned: 2,
      receivablesRealized: 1,
      receivablesPending: 1,
      payablesPlanned: 1,
      payablesRealized: 1,
      payablesPending: 1,
      totalBucketSum: 4,
      openOnDay: 2,
    },
    accounts: [],
    consolidated: {
      accountCount: 0,
      includedAccountCount: 0,
      excludedAccountCount: 0,
      accountsMissingSnapshot: 0,
      observedBalance: null,
      operationalAvailableBalance: null,
      calculatedBalance: null,
      reconciledBalance: null,
      divergence: null,
      hasDivergence: false,
      blockedBalance: null,
      investmentsBalance: null,
      usedLimit: null,
      alerts: [],
    },
    priorityExceptions: [],
    alerts: [],
    composition: [],
    origins: {},
    ...overrides,
  };
}

function accountRow(
  id: string,
  opts: { hasSnapshot?: boolean; divergence?: string | null } = {}
) {
  const hasSnapshot = opts.hasSnapshot ?? false;
  return {
    accountId: id,
    accountCode: "CX01",
    accountName: "Caixa",
    accountType: "CHECKING",
    includeInConsolidated: true,
    liquidity: "IMMEDIATE",
    allowNegativeBalance: false,
    isNegative: false,
    hasSnapshot,
    snapshotId: hasSnapshot ? "s1" : null,
    snapshotReferenceAt: hasSnapshot ? "2026-07-28T08:00:00.000-03:00" : null,
    snapshotOrigin: hasSnapshot ? "MANUAL" : null,
    observedBalance: hasSnapshot ? "1000.00" : null,
    operationalAvailableBalance: hasSnapshot ? "1000.00" : null,
    calculatedBalance: hasSnapshot ? "950.00" : null,
    reconciledBalance: null,
    divergence: opts.divergence ?? null,
    hasDivergence: Boolean(opts.divergence && opts.divergence !== "0.00"),
    blockedBalance: "0.00",
    investmentsBalance: "0.00",
    usedLimit: "0.00",
    officialMovementCount: 0,
    officialMovementNet: "0.00",
    origins: {
      observed: { origin: "MISSING", detail: "" },
      operationalAvailable: { origin: "MISSING", detail: "" },
      calculated: { origin: "MISSING", detail: "" },
      reconciled: { origin: "MISSING", detail: "" },
      blocked: { origin: "MISSING", detail: "" },
      investments: { origin: "MISSING", detail: "" },
      usedLimit: { origin: "MISSING", detail: "" },
    },
    alerts: [],
    layers: [],
  };
}

describe("treasuryGuidedTodayRules", () => {
  it("estado vazio sem contas", () => {
    const dto = buildTreasuryGuidedTodayExperience({
      dashboard: sampleDashboard(),
      closingPreview: null,
    });
    assert.equal(dto.title, TREASURY_GUIDED_TODAY_TITLE);
    assert.equal(dto.empty, true);
    assert.equal(dto.accounts.length, 0);
    assert.equal(dto.consolidated.plannedInflows, "200.00");
    assert.equal(dto.steps.length, 6);
  });

  it("monta contas, pendências e status", () => {
    const dto = buildTreasuryGuidedTodayExperience({
      dashboard: sampleDashboard({
        accounts: [accountRow("acc-1", { hasSnapshot: false })],
        priorityExceptions: [
          {
            id: "ex-ofx",
            type: "BANK_MOVEMENT_UNIDENTIFIED",
            severity: "WARNING",
            status: "OPEN",
            title: "Movimento sem match",
            accountId: "acc-1",
            nomusExternalId: null,
            source: "OFX",
          },
          {
            id: "ex-unmap",
            type: "HIGH_PRIORITY_RECEIVABLES",
            severity: "WARNING",
            status: "OPEN",
            title: "Título sem conta",
            accountId: null,
            nomusExternalId: "99",
            source: "TITLES",
          },
        ],
      }),
      closingPreview: null,
      accountMeta: [
        {
          id: "acc-1",
          name: "Caixa Matriz",
          code: "CX01",
          institutionName: "Itaú",
        },
      ],
    });

    assert.equal(dto.empty, false);
    assert.equal(dto.accounts[0]?.name, "Caixa Matriz");
    assert.equal(dto.accounts[0]?.bank, "Itaú");
    assert.equal(dto.accounts[0]?.status, "NOT_STARTED");
    assert.equal(
      dto.accounts[0]?.openHref,
      "/finance/treasury/today/opening"
    );
    assert.equal(dto.accounts[0]?.predictedClosingBalance, null);
    assert.ok(
      dto.attention.some((a) => a.code === "MISSING_OPENING_BALANCE")
    );
    assert.ok(dto.attention.some((a) => a.code === "PENDING_RECEIPT"));
    assert.ok(dto.attention.some((a) => a.code === "PENDING_PAYMENT"));
    assert.ok(
      dto.attention.some((a) => a.code === "UNIDENTIFIED_BANK_MOVEMENT")
    );
    assert.ok(dto.attention.some((a) => a.code === "UNMAPPED_TITLE"));
    assert.equal(
      dto.steps.find((s) => s.id === "OPENING_BALANCES")?.status,
      "NEEDS_ATTENTION"
    );
  });

  it("usa preview de fechamento para saldos finais e divergência", () => {
    const preview: TreasuryDailyClosingPreviewDto = {
      ok: true,
      civilDate: "2026-07-28",
      companyCode: null,
      sourceHash: "abc",
      generatedAt: "2026-07-28T18:00:00.000-03:00",
      summary: {
        openingBalance: "1000.00",
        realizedInflows: "50.00",
        realizedOutflows: "20.00",
        pendenciesAmount: "0.00",
        closingBalance: "1030.00",
        observedBalance: "1100.00",
        reconciledBalance: null,
        differenceAmount: "70.00",
        accountCount: 1,
        pendingReceivablesCount: 0,
        pendingPayablesCount: 0,
        absoluteBlockCount: 0,
        warningCount: 0,
        caveatRequiredCount: 0,
      },
      accounts: [
        {
          accountId: "acc-1",
          code: "CX01",
          name: "Caixa",
          openingBalance: "1000.00",
          realizedInflows: "50.00",
          realizedOutflows: "20.00",
          pendenciesAmount: "0.00",
          closingBalance: "1030.00",
          observedBalance: "1100.00",
          reconciledBalance: null,
          differenceAmount: "70.00",
          minimumBalance: "0.00",
          allowNegativeBalance: false,
          balanceStale: false,
          lastBalanceAt: null,
        },
      ],
      absoluteBlocks: [],
      warnings: [],
      pendingReceivables: [],
      pendingPayables: [],
      unreconciledMovements: [],
      staleBalances: [],
      expiredPromises: [],
      transfersInTransit: [],
      canCloseWithoutCaveats: false,
      canCloseWithCaveats: true,
      requiredCaveatCodes: ["RECONCILIATION_DIFFERENCE"],
    };

    const dto = buildTreasuryGuidedTodayExperience({
      dashboard: sampleDashboard({
        receipts: {
          kind: "RECEIPTS",
          plannedAmount: "0.00",
          plannedTitleCount: 0,
          realizedAmount: "50.00",
          realizedTitleCount: 1,
          pendingAmount: "0.00",
          pendingTitleCount: 0,
        },
        payments: {
          kind: "PAYMENTS",
          plannedAmount: "0.00",
          plannedTitleCount: 0,
          realizedAmount: "20.00",
          realizedTitleCount: 1,
          pendingAmount: "0.00",
          pendingTitleCount: 0,
        },
        accounts: [accountRow("acc-1", { hasSnapshot: true })],
      }),
      closingPreview: preview,
    });

    assert.equal(dto.consolidated.openingBalance, "1000.00");
    assert.equal(dto.consolidated.informedClosingBalance, "1100.00");
    assert.equal(dto.consolidated.divergence, "70.00");
    assert.equal(dto.accounts[0]?.status, "NEEDS_REVIEW");
    assert.equal(
      dto.accounts[0]?.predictedClosingBalance,
      "1030.00"
    );
    assert.equal(
      dto.accounts[0]?.openHref,
      "/finance/treasury/bank"
    );
    assert.ok(dto.attention.some((a) => a.code === "BALANCE_DIVERGENCE"));
    assert.equal(
      dto.attention.find((a) => a.code === "BALANCE_DIVERGENCE")?.href,
      "/finance/treasury/bank"
    );
    assert.equal(
      dto.steps.find((s) => s.id === "RESOLVE_DIVERGENCES")?.status,
      "NEEDS_ATTENTION"
    );
    assert.equal(
      dto.steps.find((s) => s.id === "RESOLVE_DIVERGENCES")?.continueHref,
      "/finance/treasury/bank"
    );
  });
});
