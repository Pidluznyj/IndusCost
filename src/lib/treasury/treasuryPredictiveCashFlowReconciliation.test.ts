import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  TreasuryGuidedDailyClosingAccountDto,
  TreasuryGuidedDailyOpeningAccountDto,
} from "./contracts/treasuryDto.js";
import {
  buildPredictiveCashFlowReconciliationBoard,
  buildPredictiveCashFlowReconciliationBoardFromLocal,
  filterPredictiveCashFlowReconciliationBoardByAccountIds,
} from "./treasuryPredictiveCashFlowReconciliation.js";

function closingAcc(
  partial: Partial<TreasuryGuidedDailyClosingAccountDto> & {
    accountId: string;
    accountName: string;
  }
): TreasuryGuidedDailyClosingAccountDto {
  return {
    accountCode: partial.accountCode ?? "C1",
    bank: partial.bank ?? "Viacredi",
    openingBalance: partial.openingBalance ?? "100.00",
    realizedInflows: partial.realizedInflows ?? "50.00",
    realizedOutflows: partial.realizedOutflows ?? "20.00",
    transfersReceived: "0.00",
    transfersSent: "0.00",
    transfersNet: "0.00",
    localInflows: "0.00",
    localOutflows: "0.00",
    localNet: "0.00",
    realizedClosingBalance: partial.realizedClosingBalance ?? "130.00",
    informedClosingBalance: partial.informedClosingBalance ?? "131.00",
    divergence: partial.divergence ?? "1.00",
    expectedVersion: 1,
    situation: partial.situation ?? "HAS_DIVERGENCE",
    situationLabel: partial.situationLabel ?? "Há diferença",
    divergenceMessage: null,
    canInformClosing: true,
    ...partial,
  };
}

function openingAcc(
  partial: Partial<TreasuryGuidedDailyOpeningAccountDto> & {
    accountId: string;
    accountName: string;
  }
): TreasuryGuidedDailyOpeningAccountDto {
  return {
    accountCode: "C1",
    bank: "Viacredi",
    previousClosingBalance: "99.00",
    previousClosingCivilDate: "2026-07-28",
    previousClosingId: null,
    suggestedOpeningBalance: "99.00",
    currentOpeningBalance: "100.00",
    expectedVersion: 1,
    situation: "CONFIRMED",
    situationLabel: "Confirmado",
    requiresManualInput: false,
    canConfirmSuggested: false,
    ...partial,
  };
}

describe("treasuryPredictiveCashFlowReconciliation", () => {
  it("monta linhas conta a conta e totais consolidados", () => {
    const board = buildPredictiveCashFlowReconciliationBoard({
      civilDate: "2026-07-29",
      openingAccounts: [
        openingAcc({
          accountId: "a1",
          accountName: "Viacredi - Koppetel",
          suggestedOpeningBalance: "60.00",
          currentOpeningBalance: "60.35",
        }),
        openingAcc({
          accountId: "a2",
          accountName: "Viacredi - Lazarios",
          suggestedOpeningBalance: "200.00",
          currentOpeningBalance: "200.00",
        }),
      ],
      closingAccounts: [
        closingAcc({
          accountId: "a1",
          accountName: "Viacredi - Koppetel",
          openingBalance: "60.35",
          realizedInflows: "10.00",
          realizedOutflows: "5.00",
          realizedClosingBalance: "65.35",
          informedClosingBalance: "66.00",
          divergence: "0.65",
        }),
        closingAcc({
          accountId: "a2",
          accountName: "Viacredi - Lazarios",
          openingBalance: "200.00",
          realizedInflows: "0.00",
          realizedOutflows: "0.00",
          realizedClosingBalance: "200.00",
          informedClosingBalance: "200.00",
          divergence: "0.00",
          situation: "INFORMED_OK",
          situationLabel: "Saldo conferido",
        }),
      ],
    });

    assert.equal(board.rows.length, 2);
    assert.equal(board.totals.accountCount, 2);
    assert.equal(board.totals.divergenceCount, 1);
    assert.ok(board.totals.informedOpening != null);
    assert.equal(Number(board.totals.informedOpening!.toFixed(2)), 260.35);
    assert.equal(Number(board.totals.calculatedClosing!.toFixed(2)), 265.35);
    assert.equal(Number(board.totals.informedClosing!.toFixed(2)), 266);
    assert.equal(Number(board.totals.closingDiff!.toFixed(2)), 0.65);

    const kop = board.rows.find((r) => r.accountId === "a1")!;
    assert.equal(kop.informedOpening, 60.35);
    assert.equal(kop.calculatedOpening, 60);
    assert.equal(Number(kop.openingDiff!.toFixed(2)), 0.35);
    assert.equal(kop.receivables, 10);
    assert.equal(kop.payables, 5);
  });

  it("fallback local usa CR/CP do dia por conta", () => {
    const board = buildPredictiveCashFlowReconciliationBoardFromLocal({
      civilDate: "2026-07-29",
      accounts: [
        {
          id: "a1",
          name: "A",
          institutionName: "B",
          initialBalance: 100,
          isActive: true,
          includeInConsolidated: true,
        },
      ],
      transactions: [
        {
          accountId: "a1",
          date: "2026-07-29",
          type: "receivable",
          amount: 40,
        },
        {
          accountId: "a1",
          date: "2026-07-29",
          type: "payable",
          amount: 15,
        },
      ],
    });
    assert.equal(board.rows[0]!.calculatedOpening, 100);
    assert.equal(board.rows[0]!.calculatedClosing, 125);
    assert.equal(board.rows[0]!.informedOpening, null);
  });

  it("recorta board canônico pelas contas da empresa e recalcula totais", () => {
    const board = buildPredictiveCashFlowReconciliationBoard({
      civilDate: "2026-07-29",
      openingAccounts: [
        openingAcc({
          accountId: "a1",
          accountName: "Koppetel",
          currentOpeningBalance: "100.00",
          suggestedOpeningBalance: "100.00",
        }),
        openingAcc({
          accountId: "a2",
          accountName: "Lazarios",
          currentOpeningBalance: "200.00",
          suggestedOpeningBalance: "200.00",
        }),
      ],
      closingAccounts: [
        closingAcc({
          accountId: "a1",
          accountName: "Koppetel",
          openingBalance: "100.00",
          realizedInflows: "10.00",
          realizedOutflows: "5.00",
          realizedClosingBalance: "105.00",
          informedClosingBalance: "105.00",
          divergence: "0.00",
          situation: "OK",
        }),
        closingAcc({
          accountId: "a2",
          accountName: "Lazarios",
          openingBalance: "200.00",
          realizedInflows: "0.00",
          realizedOutflows: "0.00",
          realizedClosingBalance: "200.00",
          informedClosingBalance: "200.00",
          divergence: "0.00",
          situation: "OK",
        }),
      ],
    });
    const scoped = filterPredictiveCashFlowReconciliationBoardByAccountIds(
      board,
      ["a1"]
    );
    assert.equal(scoped.rows.length, 1);
    assert.equal(scoped.rows[0]!.accountId, "a1");
    assert.equal(scoped.totals.accountCount, 1);
    assert.equal(scoped.totals.informedOpening, 100);
    assert.equal(scoped.totals.informedClosing, 105);
  });
});
