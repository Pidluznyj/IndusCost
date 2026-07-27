import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TREASURY_DAILY_CLOSING_ABSOLUTE_BLOCK_CODES,
  TREASURY_DAILY_CLOSING_CAVEAT_REQUIRED_CODES,
} from "../contracts/treasuryEnums.js";
import {
  buildTreasuryDailyClosingPreview,
  buildTreasuryDailyClosingSourceHash,
  type TreasuryDailyClosingPreviewFacts,
} from "./treasuryDailyClosingPreviewRules.js";

function baseFacts(
  overrides: Partial<TreasuryDailyClosingPreviewFacts> = {}
): TreasuryDailyClosingPreviewFacts {
  return {
    civilDate: "2026-08-17",
    companyCode: "EMP1",
    generatedAtIso: "2026-08-17T18:00:00.000-03:00",
    staleBalanceHours: 36,
    syncMaxAgeHours: 24,
    syncAgeHours: 2,
    currentClosingStatus: null,
    hasSourceData: true,
    openSuspectedDuplicateCount: 0,
    accounts: [
      {
        accountId: "acc-1",
        code: "CX1",
        name: "Caixa",
        includeInConsolidated: true,
        openingBalance: "1000.00",
        realizedInflows: "100.00",
        realizedOutflows: "50.00",
        pendenciesAmount: "0.00",
        closingBalance: "1050.00",
        observedBalance: "1050.00",
        reconciledBalance: "1050.00",
        minimumBalance: "100.00",
        allowNegativeBalance: false,
        lastBalanceAtIso: "2026-08-17T12:00:00.000-03:00",
        balanceAgeHours: 1,
      },
    ],
    pendingReceivables: [],
    pendingPayables: [],
    unreconciledMovements: [],
    expiredPromises: [],
    transfersInTransit: [],
    ...overrides,
  };
}

describe("treasuryDailyClosingPreviewRules", () => {
  it("fecha sem ressalvas quando limpo", () => {
    const dto = buildTreasuryDailyClosingPreview(baseFacts());
    assert.equal(dto.canCloseWithoutCaveats, true);
    assert.equal(dto.canCloseWithCaveats, true);
    assert.equal(dto.absoluteBlocks.length, 0);
    assert.equal(dto.requiredCaveatCodes.length, 0);
    assert.equal(dto.sourceHash.length, 64);
    assert.equal(dto.summary.observedBalance, "1050.00");
    assert.equal(dto.accounts.length, 1);
  });

  it("bloqueia absolutamente dia já fechado e saldo ausente/negativo", () => {
    const closed = buildTreasuryDailyClosingPreview(
      baseFacts({ currentClosingStatus: "CLOSED" })
    );
    assert.equal(closed.canCloseWithCaveats, false);
    assert.equal(closed.canCloseWithoutCaveats, false);
    assert.ok(
      closed.absoluteBlocks.some((b) => b.code === "DAY_ALREADY_CLOSED")
    );

    const missing = buildTreasuryDailyClosingPreview(
      baseFacts({
        accounts: [
          {
            ...baseFacts().accounts[0]!,
            observedBalance: null,
            closingBalance: "0.00",
          },
        ],
      })
    );
    assert.ok(
      missing.absoluteBlocks.some((b) => b.code === "MISSING_OBSERVED_BALANCE")
    );

    const negative = buildTreasuryDailyClosingPreview(
      baseFacts({
        accounts: [
          {
            ...baseFacts().accounts[0]!,
            observedBalance: "-10.00",
            closingBalance: "-10.00",
            allowNegativeBalance: false,
          },
        ],
      })
    );
    assert.ok(
      negative.absoluteBlocks.some(
        (b) => b.code === "NEGATIVE_BALANCE_FORBIDDEN"
      )
    );
  });

  it("permite fechar com ressalva para pendências/divergências/trânsito", () => {
    const dto = buildTreasuryDailyClosingPreview(
      baseFacts({
        accounts: [
          {
            ...baseFacts().accounts[0]!,
            observedBalance: "1000.00",
            reconciledBalance: "990.00",
            balanceAgeHours: 48,
            minimumBalance: "2000.00",
          },
        ],
        pendingReceivables: [
          {
            side: "RECEIVABLE",
            officialTitleId: "ar-1",
            nomusExternalId: 1,
            counterpartyName: "Cliente A",
            openAmount: "200.00",
            dueDate: "2026-08-17",
            expectedDate: null,
            accountId: "acc-1",
          },
          {
            side: "RECEIVABLE",
            officialTitleId: "ar-2",
            nomusExternalId: 2,
            counterpartyName: "Cliente B",
            openAmount: "50.00",
            dueDate: "2026-09-01",
            expectedDate: null,
            accountId: null,
          },
        ],
        pendingPayables: [
          {
            side: "PAYABLE",
            officialTitleId: "ap-1",
            nomusExternalId: 9,
            counterpartyName: "Forn",
            openAmount: "80.00",
            dueDate: "2026-08-10",
            expectedDate: null,
            accountId: "acc-1",
          },
        ],
        unreconciledMovements: [
          {
            id: "mov-1",
            accountId: "acc-1",
            amount: "15.00",
            label: "OFX sem match",
          },
        ],
        expiredPromises: [
          {
            id: "prm-1",
            officialTitleId: "ar-1",
            promisedAmount: "100.00",
            promisedDate: "2026-08-01",
            status: "EXPIRED",
          },
        ],
        transfersInTransit: [
          {
            id: "tr-1",
            fromAccountId: "acc-1",
            toAccountId: "acc-2",
            amount: "30.00",
            status: "SENT",
          },
        ],
        syncAgeHours: 40,
      })
    );

    assert.equal(dto.canCloseWithoutCaveats, false);
    assert.equal(dto.canCloseWithCaveats, true);
    assert.equal(dto.absoluteBlocks.length, 0);
    for (const code of [
      "RECONCILIATION_DIFFERENCE",
      "STALE_BALANCE",
      "PENDING_RECEIVABLE",
      "PENDING_PAYABLE",
      "UNRECONCILED_MOVEMENT",
      "EXPIRED_PROMISE",
      "TRANSFER_IN_TRANSIT",
      "ACCOUNT_BELOW_MINIMUM",
      "SYNC_DELAYED",
    ]) {
      assert.ok(dto.requiredCaveatCodes.includes(code), code);
    }
    assert.equal(dto.pendingReceivables.length, 2);
    assert.equal(dto.staleBalances.length, 1);
    assert.equal(dto.expiredPromises.length, 1);
    assert.equal(dto.transfersInTransit.length, 1);
    assert.equal(dto.unreconciledMovements.length, 1);
    assert.ok(dto.warnings.some((w) => w.code === "PENDING_RECEIVABLE_FUTURE"));
  });

  it("bloqueia fonte indisponível e duplicidade suspeita", () => {
    const noSource = buildTreasuryDailyClosingPreview(
      baseFacts({ hasSourceData: false, accounts: [] })
    );
    assert.ok(
      noSource.absoluteBlocks.some((b) => b.code === "SOURCE_DATA_UNAVAILABLE")
    );
    assert.equal(noSource.canCloseWithCaveats, false);

    const dup = buildTreasuryDailyClosingPreview(
      baseFacts({ openSuspectedDuplicateCount: 2 })
    );
    assert.ok(
      dup.absoluteBlocks.some((b) => b.code === "OPEN_SUSPECTED_DUPLICATE")
    );
  });

  it("sourceHash é determinístico", () => {
    const a = buildTreasuryDailyClosingSourceHash({ x: 1, y: ["b", "a"] });
    const b = buildTreasuryDailyClosingSourceHash({ y: ["b", "a"], x: 1 });
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  it("catálogo de códigos absolutos e com ressalva está completo", () => {
    assert.ok(TREASURY_DAILY_CLOSING_ABSOLUTE_BLOCK_CODES.includes("DAY_ALREADY_CLOSED"));
    assert.ok(
      TREASURY_DAILY_CLOSING_CAVEAT_REQUIRED_CODES.includes("EXPIRED_PROMISE")
    );
    assert.ok(
      TREASURY_DAILY_CLOSING_CAVEAT_REQUIRED_CODES.includes("TRANSFER_IN_TRANSIT")
    );
  });
});
