import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyTreasuryDailyAccountRoutineDayFlow } from "./treasuryDailyAccountRoutineRules.js";
import {
  TREASURY_GUIDED_DAILY_CLOSING_INVESTIGATION_ACTIONS,
  TREASURY_GUIDED_DAILY_CLOSING_UI_PATH,
  buildTreasuryGuidedDailyClosingWorkspace,
  deriveTreasuryGuidedDailyClosingSituation,
  formatTreasuryGuidedDailyClosingDivergenceMessage,
  planTreasuryGuidedDailyClosingSaveItem,
  type TreasuryGuidedDailyClosingAccountSeed,
} from "./treasuryGuidedDailyClosingRules.js";
import type { TreasuryDailyClosingPreviewDto } from "../contracts/treasuryDto.js";

const CIVIL = "2026-07-28";

function seed(
  partial: Partial<TreasuryGuidedDailyClosingAccountSeed> = {}
): TreasuryGuidedDailyClosingAccountSeed {
  return {
    accountId: "acc-1",
    accountCode: "CX",
    accountName: "Caixa",
    bank: "Banco",
    companyCode: "LZ",
    isActive: true,
    opening: { amount: "1000.00", version: 1 },
    closingBank: null,
    dayFlow: {
      ...emptyTreasuryDailyAccountRoutineDayFlow(),
      settledReceivables: "200.00",
      settledPayables: "50.00",
      realizedLocalInflows: "10.00",
      realizedLocalOutflows: "5.00",
      realizedTransferIn: "0.00",
      realizedTransferOut: "0.00",
    },
    formalClosingStatus: null,
    ...partial,
  };
}

function preview(
  partial: Partial<TreasuryDailyClosingPreviewDto> = {}
): TreasuryDailyClosingPreviewDto {
  return {
    ok: true,
    civilDate: CIVIL,
    companyCode: "LZ",
    sourceHash: "hash-1",
    generatedAt: "2026-07-28T20:00:00.000+00:00",
    summary: {
      openingBalance: "1000.00",
      realizedInflows: "210.00",
      realizedOutflows: "55.00",
      pendenciesAmount: "0.00",
      closingBalance: "1155.00",
      observedBalance: "1155.00",
      reconciledBalance: null,
      differenceAmount: "0.00",
      accountCount: 1,
      pendingReceivablesCount: 0,
      pendingPayablesCount: 0,
      absoluteBlockCount: 0,
      warningCount: 0,
      caveatRequiredCount: 0,
    },
    accounts: [],
    absoluteBlocks: [],
    warnings: [],
    pendingReceivables: [],
    pendingPayables: [],
    unreconciledMovements: [],
    staleBalances: [],
    expiredPromises: [],
    transfersInTransit: [],
    canCloseWithoutCaveats: true,
    canCloseWithCaveats: true,
    requiredCaveatCodes: [],
    ...partial,
  };
}

describe("treasuryGuidedDailyClosingRules", () => {
  it("calcula divergência zero, positiva e negativa", () => {
    assert.equal(
      formatTreasuryGuidedDailyClosingDivergenceMessage("0.00"),
      null
    );
    assert.match(
      formatTreasuryGuidedDailyClosingDivergenceMessage("12.50") ?? "",
      /diferença de R\$ 12,50/
    );
    assert.match(
      formatTreasuryGuidedDailyClosingDivergenceMessage("-3.00") ?? "",
      /diferença de R\$ 3,00/
    );
  });

  it("monta workspace com saldo realizado e situação", () => {
    const zero = buildTreasuryGuidedDailyClosingWorkspace({
      civilDate: CIVIL,
      accounts: [
        seed({
          closingBank: { amount: "1155.00", version: 2 },
        }),
      ],
      preview: preview(),
    });
    assert.equal(zero.accounts[0]?.situation, "INFORMED_OK");
    assert.equal(zero.accounts[0]?.realizedClosingBalance, "1155.00");
    assert.equal(zero.accounts[0]?.divergence, "0.00");
    assert.equal(zero.companyCode, "LZ");
    assert.equal(zero.closeGates.canCloseWithoutCaveats, true);

    const positive = buildTreasuryGuidedDailyClosingWorkspace({
      civilDate: CIVIL,
      accounts: [
        seed({
          closingBank: { amount: "1200.00", version: 2 },
        }),
      ],
      preview: preview({
        canCloseWithoutCaveats: false,
        canCloseWithCaveats: true,
        requiredCaveatCodes: ["RECONCILIATION_DIFFERENCE"],
      }),
    });
    assert.equal(positive.accounts[0]?.situation, "HAS_DIVERGENCE");
    assert.equal(positive.accounts[0]?.divergence, "45.00");
    assert.match(
      positive.accounts[0]?.divergenceMessage ?? "",
      /diferença de R\$ 45,00/
    );

    const negative = buildTreasuryGuidedDailyClosingWorkspace({
      civilDate: CIVIL,
      accounts: [
        seed({
          closingBank: { amount: "1100.00", version: 2 },
        }),
      ],
      preview: null,
    });
    assert.equal(negative.accounts[0]?.divergence, "-55.00");
  });

  it("bloqueia saldo final sem abertura e permite planejamento com concorrência", () => {
    assert.equal(
      deriveTreasuryGuidedDailyClosingSituation({
        isActive: true,
        openingBalance: null,
        informedClosingBalance: null,
        divergence: null,
        formalClosingStatus: null,
      }),
      "NEEDS_OPENING"
    );

    const planned = planTreasuryGuidedDailyClosingSaveItem({
      seed: seed(),
      civilDate: CIVIL,
      item: {
        accountId: "acc-1",
        expectedVersion: 1,
        amount: "1155.00",
      },
      actorUserId: "u1",
      recordedAt: "2026-07-28T20:00:00.000Z",
    });
    assert.equal(planned.next.closingBankBalance?.amount, "1155.00");
    assert.equal(planned.next.divergence, "0.00");
    assert.match(planned.snapshotIdempotencyKey, /daily-closing-bank:2026-07-28:v2/);

    assert.throws(() =>
      planTreasuryGuidedDailyClosingSaveItem({
        seed: seed({ opening: null }),
        civilDate: CIVIL,
        item: {
          accountId: "acc-1",
          expectedVersion: 0,
          amount: "100.00",
        },
        actorUserId: "u1",
        recordedAt: "2026-07-28T20:00:00.000Z",
      })
    );

    assert.throws(() =>
      planTreasuryGuidedDailyClosingSaveItem({
        seed: seed({ formalClosingStatus: "CLOSED" }),
        civilDate: CIVIL,
        item: {
          accountId: "acc-1",
          expectedVersion: 1,
          amount: "1155.00",
        },
        actorUserId: "u1",
        recordedAt: "2026-07-28T20:00:00.000Z",
      })
    );
  });

  it("oferece ações de investigação sem auto-lançamento e rota guiada", () => {
    assert.equal(TREASURY_GUIDED_DAILY_CLOSING_UI_PATH, "/finance/treasury/today/closing");
    assert.ok(
      TREASURY_GUIDED_DAILY_CLOSING_INVESTIGATION_ACTIONS.some(
        (a) => a.id === "IMPORT_STATEMENT"
      )
    );
    assert.ok(
      TREASURY_GUIDED_DAILY_CLOSING_INVESTIGATION_ACTIONS.some(
        (a) => a.id === "CLOSE_WITH_CAVEAT"
      )
    );
    const corpus = TREASURY_GUIDED_DAILY_CLOSING_INVESTIGATION_ACTIONS.map(
      (a) => a.label
    ).join(" ");
    assert.doesNotMatch(corpus, /\bSETTLED\b|\bOPEN\b/);
  });
});
