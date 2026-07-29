import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPredictiveAccountCrCpBoard } from "./treasuryPredictiveAccountCrCp.js";

describe("treasuryPredictiveAccountCrCp", () => {
  it("agrega CR e CP por conta no intervalo", () => {
    const board = buildPredictiveAccountCrCpBoard({
      fromDate: "2026-07-01",
      toDate: "2026-07-31",
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
      transactions: [
        {
          id: "1",
          description: "CR 1",
          amount: 50,
          date: "2026-07-10",
          type: "receivable",
          accountId: "a1",
          isPaid: false,
          itemKind: "RECEIVABLE",
        },
        {
          id: "2",
          description: "CP 1",
          amount: 20,
          date: "2026-07-12",
          type: "payable",
          accountId: "a1",
          isPaid: false,
          itemKind: "PAYABLE",
        },
        {
          id: "3",
          description: "fora",
          amount: 999,
          date: "2026-08-01",
          type: "receivable",
          accountId: "a1",
          isPaid: false,
          itemKind: "RECEIVABLE",
        },
        {
          id: "4",
          description: "CR 2",
          amount: 80,
          date: "2026-07-15",
          type: "receivable",
          accountId: "a2",
          isPaid: false,
          itemKind: "RECEIVABLE",
        },
      ],
    });

    const a1 = board.rows.find((r) => r.accountId === "a1")!;
    const a2 = board.rows.find((r) => r.accountId === "a2")!;
    assert.equal(a1.receivables, 50);
    assert.equal(a1.payables, 20);
    assert.equal(a1.net, 30);
    assert.equal(a2.receivables, 80);
    assert.equal(board.totals.receivables, 130);
    assert.equal(board.totals.payables, 20);
    assert.equal(board.totals.net, 110);
  });
});
