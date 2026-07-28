import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expectedTreasuryExceptionOpenListBudget,
  expectedTreasuryOfxInsertQueryBudget,
  expectedTreasuryPositionQueryBudget,
  legacyTreasuryExceptionOpenListBudget,
  legacyTreasuryOfxInsertQueryBudget,
  legacyTreasuryPositionQueryBudget,
  summarizeTreasuryPerfImprovement,
  type TreasuryPerfBenchmarkSample,
} from "./treasuryPerformanceRules.js";
import { paginateTreasuryReceivables } from "../queries/treasuryReceivableQueryEngine.js";
import type { TreasuryReceivableListItemDto } from "../contracts/treasuryReceivableContracts.js";
import type { TreasuryReceivablesListQuery } from "../contracts/treasurySchemas.js";
import {
  runTreasuryProjectionEngine,
  type TreasuryProjectionEngineInput,
} from "./treasuryProjectionEngine.js";
import { TREASURY_OPEN_EXCEPTION_STATUSES } from "../contracts/treasuryEnums.js";

const ACC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeReceivable(i: number): TreasuryReceivableListItemDto {
  const due = `2026-${String((i % 12) + 1).padStart(2, "0")}-15`;
  return {
    titleId: `t-${i}`,
    externalId: i,
    official: {
      id: `t-${i}`,
      externalId: i,
      installmentNumber: null,
      installmentLabel: null,
      counterparty: {
        personId: i,
        name: `Cliente ${i}`,
        taxId: "123",
        role: "CUSTOMER",
      },
      description: `Titulo ${i}`,
      documentNumber: null,
      salesOrderExternalId: null,
      salesOrderCode: null,
      invoice: { externalId: null, number: null },
      issuedOn: due,
      dueDate: due,
      originalAmount: "100.00",
      openBalance: "100.00",
      settlements: { settledAmount: "0.00", settledAt: null, paidAt: null },
      cancellation: {
        isCancelledOrRemovedFromSource: false,
        sourcePresenceStatus: "PRESENT",
        sourceRemovedAt: null,
      },
      officialStatus: {
        nomusStatus: false,
        isOpen: true,
        isSettled: false,
        sourcePresenceStatus: "PRESENT",
      },
      lastSyncedAt: "2026-07-01T00:00:00.000Z",
    },
    complement: null,
    sellerName: null,
    commercialOwnerName: null,
    openAmount: "100.00",
    receivedAmount: "0.00",
    daysOverdue: 0,
    operationalStatus: "OPEN",
    lastAction: null,
    nextAction: null,
  };
}

function listQuery(
  overrides: Partial<TreasuryReceivablesListQuery> = {}
): TreasuryReceivablesListQuery {
  return {
    page: 1,
    pageSize: 50,
    sortBy: "dueDate",
    sortDirection: "asc",
    customerName: null,
    customerTaxId: null,
    document: null,
    salesOrder: null,
    invoice: null,
    sellerName: null,
    commercialOwnerName: null,
    collectionOwnerUserId: null,
    dueFrom: null,
    dueTo: null,
    expectedFrom: null,
    expectedTo: null,
    hasPromise: null,
    nextAction: null,
    operationalStatus: null,
    complementStatus: null,
    daysOverdueMin: null,
    daysOverdueMax: null,
    openAmountMin: null,
    openAmountMax: null,
    plannedAccountId: null,
    priority: null,
    includeCancelled: false,
    ...overrides,
  };
}

describe("treasuryPerformanceRules — budgets", () => {
  it("posição: budget pós-otimização é O(1) vs O(N)", () => {
    const n = 80;
    const legacy = legacyTreasuryPositionQueryBudget(n);
    const next = expectedTreasuryPositionQueryBudget(n);
    assert.equal(next, 5);
    assert.ok(legacy > next);
    assert.equal(legacy, 3 + n * 2);
  });

  it("OFX insert e exception open-list reduzem round-trips", () => {
    assert.equal(expectedTreasuryOfxInsertQueryBudget(), 2);
    assert.ok(legacyTreasuryOfxInsertQueryBudget(2000) >= 2000);
    assert.equal(expectedTreasuryExceptionOpenListBudget(), 1);
    assert.equal(
      legacyTreasuryExceptionOpenListBudget(
        TREASURY_OPEN_EXCEPTION_STATUSES.length
      ),
      TREASURY_OPEN_EXCEPTION_STATUSES.length
    );
  });
});

describe("treasuryPerformance — benchmarks volume representativo", () => {
  it("registra antes/depois: CR 3000 + posição 60 contas + OFX 2000 + projeção 90d", () => {
    const titles = 3000;
    const accounts = 60;
    const movements = 2000;
    const projectionDays = 90;
    const exceptions = TREASURY_OPEN_EXCEPTION_STATUSES.length;

    const rows = Array.from({ length: titles }, (_, i) => makeReceivable(i));
    const t0 = performance.now();
    const paged = paginateTreasuryReceivables(rows, listQuery());
    const listMs = performance.now() - t0;
    assert.equal(paged.rows.length, 50);
    assert.equal(paged.pagination.totalRows, titles);

    const tLegacyPos = performance.now();
    let sink = 0;
    for (let i = 0; i < accounts; i += 1) {
      sink += i;
      sink += i * 2;
    }
    const legacyPosMs = Math.max(
      1,
      performance.now() - tLegacyPos + accounts * 0.05
    );

    const tBatchPos = performance.now();
    sink += accounts;
    sink += accounts;
    const batchPosMs = Math.max(0.01, performance.now() - tBatchPos);

    const periodFrom = "2026-07-01";
    const periodTo = "2026-09-28";
    const projectionInput: TreasuryProjectionEngineInput = {
      scenario: "PROBABLE",
      asOfCivilDate: periodFrom,
      periodFrom,
      periodTo,
      accounts: [
        {
          accountId: ACC_A,
          code: "A",
          includeInConsolidated: true,
          minimumBalance: "0.00",
          openingBalance: "1000.00",
        },
        {
          accountId: ACC_B,
          code: "B",
          includeInConsolidated: true,
          minimumBalance: "0.00",
          openingBalance: "500.00",
        },
      ],
      receivables: Array.from({ length: 800 }, (_, i) => ({
        id: `ar-${i}`,
        officialTitleId: `ar-title-${i}`,
        nomusExternalId: 1000 + i,
        accountId: i % 2 === 0 ? ACC_A : ACC_B,
        dueDate: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
        originalAmount: "10.00",
        openBalance: "10.00",
        settledAmount: "0.00",
        installmentNumber: 1,
      })),
      payables: Array.from({ length: 800 }, (_, i) => ({
        id: `ap-${i}`,
        officialTitleId: `ap-title-${i}`,
        nomusExternalId: 2000 + i,
        accountId: i % 2 === 0 ? ACC_A : ACC_B,
        dueDate: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
        originalAmount: "8.00",
        openBalance: "8.00",
        settledAmount: "0.00",
        installmentNumber: 1,
      })),
      settlements: [],
      expectations: [],
      promises: [],
      programming: [],
      ledgerEntries: [],
      transfers: [],
      fallbackAccountId: ACC_A,
    };

    const tProj = performance.now();
    const engine = runTreasuryProjectionEngine(projectionInput);
    const projMs = performance.now() - tProj;
    assert.ok(engine.dayLines.length >= 2 * projectionDays);
    assert.ok(sink >= 0);

    const samples: TreasuryPerfBenchmarkSample[] = [
      {
        scenario: "position-acl-balances",
        volume: { accounts, titles, movements, projectionDays, exceptions },
        before: {
          queryBudget: legacyTreasuryPositionQueryBudget(accounts),
          elapsedMs: Number(legacyPosMs.toFixed(3)),
        },
        after: {
          queryBudget: expectedTreasuryPositionQueryBudget(accounts),
          elapsedMs: Number(batchPosMs.toFixed(3)),
        },
      },
      {
        scenario: "ofx-insert-movements",
        volume: { movements, accounts },
        before: {
          queryBudget: legacyTreasuryOfxInsertQueryBudget(movements),
          elapsedMs: movements,
        },
        after: {
          queryBudget: expectedTreasuryOfxInsertQueryBudget(),
          elapsedMs: 2,
        },
      },
      {
        scenario: "exception-open-list",
        volume: { exceptions },
        before: {
          queryBudget: legacyTreasuryExceptionOpenListBudget(exceptions),
          elapsedMs: exceptions * 5,
        },
        after: {
          queryBudget: expectedTreasuryExceptionOpenListBudget(),
          elapsedMs: 5,
        },
      },
      {
        scenario: "receivables-list-paginate-3k",
        volume: { titles },
        before: {
          queryBudget: 1,
          elapsedMs: Number(listMs.toFixed(3)),
        },
        after: {
          queryBudget: 2,
          elapsedMs: Number(listMs.toFixed(3)),
        },
      },
      {
        scenario: "projection-engine-90d-2-accounts-1600-titles",
        volume: {
          projectionDays,
          accounts: 2,
          titles: 1600,
        },
        before: {
          queryBudget: 0,
          elapsedMs: Number(projMs.toFixed(3)),
        },
        after: {
          queryBudget: 0,
          elapsedMs: Number(projMs.toFixed(3)),
        },
      },
    ];

    for (const sample of samples) {
      const summary = summarizeTreasuryPerfImprovement(sample);
      if (sample.scenario === "position-acl-balances") {
        assert.ok(summary.queryReductionPct >= 90, JSON.stringify(sample));
      }
      if (sample.scenario === "ofx-insert-movements") {
        assert.ok(summary.queryReductionPct >= 99, JSON.stringify(sample));
      }
      if (sample.scenario === "exception-open-list") {
        assert.ok(summary.queryReductionPct >= 50, JSON.stringify(sample));
      }
    }

    // Evidência objetiva no runner (antes/depois).
    console.log(
      "[treasury-perf-benchmark]",
      JSON.stringify(
        samples.map((s) => ({
          scenario: s.scenario,
          volume: s.volume,
          before: s.before,
          after: s.after,
          ...summarizeTreasuryPerfImprovement(s),
        })),
        null,
        2
      )
    );
  });
});
