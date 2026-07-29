import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPredictiveEvolutionBoard,
  listPredictiveEvolutionCivilDates,
  resolvePredictiveEvolutionStartBalance,
  resolvePredictiveEvolutionStartsFromOpeningWorkspace,
} from "./treasuryPredictiveCashFlowEvolution.js";

describe("treasuryPredictiveCashFlowEvolution", () => {
  it("prioriza abertura informada → fechamento ontem → automático", () => {
    assert.deepEqual(
      resolvePredictiveEvolutionStartBalance({
        informedOpening: 100,
        previousClosing: 90,
        automatic: 80,
      }),
      { amount: 100, source: "informed_opening" }
    );
    assert.deepEqual(
      resolvePredictiveEvolutionStartBalance({
        informedOpening: null,
        previousClosing: 90,
        automatic: 80,
      }),
      { amount: 90, source: "previous_closing" }
    );
    assert.deepEqual(
      resolvePredictiveEvolutionStartBalance({
        informedOpening: null,
        previousClosing: null,
        automatic: 80,
      }),
      { amount: 80, source: "automatic" }
    );
  });

  it("lista dias civis inclusivos", () => {
    assert.deepEqual(listPredictiveEvolutionCivilDates("2026-07-29", "2026-07-31"), [
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
    ]);
  });

  it("projeta consolidado a partir do saldo de partida + CR/CP", () => {
    const board = buildPredictiveEvolutionBoard({
      mode: "consolidated",
      fromDate: "2026-07-29",
      toDate: "2026-07-30",
      accounts: [
        {
          id: "a1",
          name: "Viacredi - Koppetel",
          initialBalance: 100,
          institutionName: "Viacredi",
          includeInConsolidated: true,
          isActive: true,
        },
        {
          id: "a2",
          name: "Viacredi - Lazarios",
          initialBalance: 200,
          institutionName: "Viacredi",
          includeInConsolidated: true,
          isActive: true,
        },
      ],
      starts: [
        { accountId: "a1", amount: 100, source: "informed_opening" },
        { accountId: "a2", amount: 200, source: "previous_closing" },
      ],
      transactions: [
        {
          id: "t1",
          description: "CR",
          amount: 50,
          date: "2026-07-29",
          type: "receivable",
          accountId: "a1",
          isPaid: false,
          itemKind: "RECEIVABLE",
        },
        {
          id: "t2",
          description: "CP",
          amount: 30,
          date: "2026-07-29",
          type: "payable",
          accountId: "a2",
          isPaid: false,
          itemKind: "PAYABLE",
        },
      ],
    });

    assert.equal(board.points.length, 2);
    assert.equal(board.points[0]!.opening, 300);
    assert.equal(board.points[0]!.balance, 320);
    assert.equal(board.points[0]!.byAccount!.a1, 150);
    assert.equal(board.points[0]!.byAccount!.a2, 170);
    assert.equal(board.points[1]!.opening, 320);
    assert.equal(board.points[1]!.balance, 320);
    assert.equal(board.startSourceSummary, "informed_opening");
  });

  it("usa opening workspace na prioridade de partida", () => {
    const starts = resolvePredictiveEvolutionStartsFromOpeningWorkspace({
      accounts: [
        {
          id: "a1",
          name: "A",
          initialBalance: 10,
          institutionName: "B",
          includeInConsolidated: true,
          isActive: true,
        },
      ],
      openingAccounts: [
        {
          accountId: "a1",
          accountCode: "1",
          accountName: "A",
          bank: "B",
          previousClosingBalance: "9.00",
          previousClosingCivilDate: "2026-07-28",
          previousClosingId: null,
          suggestedOpeningBalance: "9.00",
          currentOpeningBalance: "11.00",
          expectedVersion: 1,
          situation: "CONFIRMED",
          situationLabel: "Ok",
          requiresManualInput: false,
          canConfirmSuggested: false,
        },
      ],
    });
    assert.equal(starts[0]!.amount, 11);
    assert.equal(starts[0]!.source, "informed_opening");
  });
});
