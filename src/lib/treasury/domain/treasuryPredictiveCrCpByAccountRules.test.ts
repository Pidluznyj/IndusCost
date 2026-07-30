import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TREASURY_CRCP_UNLINKED_ID,
  buildTreasuryCrCpByAccountBoard,
  effectiveTreasuryCrCpFlowDate,
  findActiveDuplicateNomusBankAccountLink,
  normalizeNomusFinancialAccountId,
  resolveTreasuryAccountByNomusFinancialAccountId,
  buildTreasuryNomusAccountLinkIndex,
  type TreasuryCrCpLocalAccount,
  type TreasuryCrCpTitleSeed,
} from "./treasuryPredictiveCrCpByAccountRules.js";

function account(
  partial: Partial<TreasuryCrCpLocalAccount> & { id: string; name: string }
): TreasuryCrCpLocalAccount {
  return {
    code: partial.code ?? partial.name.slice(0, 3).toUpperCase(),
    institutionName: partial.institutionName ?? "Viacredi",
    nomusBankAccountId: partial.nomusBankAccountId ?? null,
    isActive: partial.isActive ?? true,
    includeInConsolidated: partial.includeInConsolidated ?? true,
    sortOrder: partial.sortOrder ?? 0,
    currentBalance: partial.currentBalance ?? "0.00",
    ...partial,
  };
}

describe("treasuryPredictiveCrCpByAccountRules", () => {
  it("normaliza ID Nomus sem misturar por nome", () => {
    assert.equal(normalizeNomusFinancialAccountId(8), "8");
    assert.equal(normalizeNomusFinancialAccountId("08"), "8");
    assert.equal(normalizeNomusFinancialAccountId(" 9 "), "9");
    assert.equal(normalizeNomusFinancialAccountId("Viacredi"), null);
    assert.equal(normalizeNomusFinancialAccountId(null), null);
  });

  it("1+2: CR e CP vinculados a Nomus #8 na conta A", () => {
    const accounts = [
      account({
        id: "a1",
        name: "Viacredi - Koppetel",
        nomusBankAccountId: "8",
        currentBalance: "10000.00",
        sortOrder: 1,
      }),
    ];
    const titles: TreasuryCrCpTitleSeed[] = [
      {
        id: "cr1",
        side: "RECEIVABLE",
        dueDate: "2026-08-05",
        openBalance: "1000.00",
        originalAmount: "1000.00",
        settledAmount: "0.00",
        counterpartyName: "Cliente",
        documentNumber: "NF-1",
        installmentLabel: "1/1",
        nomusFinancialAccountId: 8,
        nomusFinancialAccountName: "0.2 Viacredi - Koppetel",
      },
      {
        id: "cp1",
        side: "PAYABLE",
        dueDate: "2026-08-06",
        openBalance: "400.00",
        originalAmount: "400.00",
        settledAmount: "0.00",
        counterpartyName: "Fornecedor",
        documentNumber: "BOL-1",
        installmentLabel: null,
        nomusFinancialAccountId: "8",
        nomusFinancialAccountName: "0.2 Viacredi - Koppetel",
      },
    ];
    const board = buildTreasuryCrCpByAccountBoard({
      fromDate: "2026-07-30",
      toDate: "2026-08-28",
      accounts,
      titles,
    });
    const row = board.groups.find((g) => g.treasuryAccountId === "a1")!;
    assert.equal(row.accountsReceivableTotal, "1000.00");
    assert.equal(row.accountsReceivableCount, 1);
    assert.equal(row.accountsPayableTotal, "400.00");
    assert.equal(row.accountsPayableCount, 1);
    assert.equal(row.netMovement, "600.00");
    assert.equal(row.projectedBalance, "10600.00");
  });

  it("3: duas contas do mesmo banco não misturam títulos", () => {
    const accounts = [
      account({
        id: "a1",
        name: "Viacredi - Koppetel",
        nomusBankAccountId: "8",
        sortOrder: 1,
      }),
      account({
        id: "a2",
        name: "Viacredi - Lazarios",
        nomusBankAccountId: "9",
        sortOrder: 2,
      }),
    ];
    const board = buildTreasuryCrCpByAccountBoard({
      fromDate: "2026-07-30",
      toDate: "2026-08-28",
      accounts,
      titles: [
        {
          id: "cr8",
          side: "RECEIVABLE",
          dueDate: "2026-08-01",
          openBalance: "100.00",
          originalAmount: "100.00",
          settledAmount: "0.00",
          counterpartyName: null,
          documentNumber: null,
          installmentLabel: null,
          nomusFinancialAccountId: 8,
          nomusFinancialAccountName: "Viacredi Koppetel",
        },
        {
          id: "cr9",
          side: "RECEIVABLE",
          dueDate: "2026-08-01",
          openBalance: "200.00",
          originalAmount: "200.00",
          settledAmount: "0.00",
          counterpartyName: null,
          documentNumber: null,
          installmentLabel: null,
          nomusFinancialAccountId: 9,
          nomusFinancialAccountName: "Viacredi Lazarios",
        },
      ],
    });
    assert.equal(
      board.groups.find((g) => g.treasuryAccountId === "a1")!
        .accountsReceivableTotal,
      "100.00"
    );
    assert.equal(
      board.groups.find((g) => g.treasuryAccountId === "a2")!
        .accountsReceivableTotal,
      "200.00"
    );
  });

  it("4+5: CR sem vínculo e CP sem conta financeira vão para Contas sem vínculo", () => {
    const accounts = [
      account({
        id: "a1",
        name: "Viacredi - Koppetel",
        nomusBankAccountId: "8",
      }),
    ];
    const board = buildTreasuryCrCpByAccountBoard({
      fromDate: "2026-07-30",
      toDate: "2026-08-28",
      accounts,
      titles: [
        {
          id: "cr7",
          side: "RECEIVABLE",
          dueDate: "2026-08-01",
          openBalance: "50.00",
          originalAmount: "50.00",
          settledAmount: "0.00",
          counterpartyName: null,
          documentNumber: null,
          installmentLabel: null,
          nomusFinancialAccountId: 7,
          nomusFinancialAccountName: "0.3 Viacredi - SM",
        },
        {
          id: "cpnull",
          side: "PAYABLE",
          dueDate: "2026-08-01",
          openBalance: "30.00",
          originalAmount: "30.00",
          settledAmount: "0.00",
          counterpartyName: null,
          documentNumber: null,
          installmentLabel: null,
          nomusFinancialAccountId: null,
          nomusFinancialAccountName: null,
        },
      ],
    });
    const unlinked = board.groups.find(
      (g) => g.treasuryAccountId === TREASURY_CRCP_UNLINKED_ID
    )!;
    assert.equal(unlinked.accountsReceivableTotal, "50.00");
    assert.equal(unlinked.accountsPayableTotal, "30.00");
    assert.equal(unlinked.currentBalance, null);
    assert.equal(unlinked.projectedBalance, null);
    assert.equal(
      unlinked.receivableTitles[0]!.unlinkedReason,
      "NOMUS_WITHOUT_LOCAL_LINK"
    );
    assert.equal(
      unlinked.payableTitles[0]!.unlinkedReason,
      "MISSING_NOMUS_ACCOUNT"
    );
  });

  it("6: parcialmente liquidado usa só saldo aberto", () => {
    const board = buildTreasuryCrCpByAccountBoard({
      fromDate: "2026-07-30",
      toDate: "2026-08-28",
      accounts: [
        account({ id: "a1", name: "A", nomusBankAccountId: "8" }),
      ],
      titles: [
        {
          id: "cr",
          side: "RECEIVABLE",
          dueDate: "2026-08-01",
          openBalance: "6000.00",
          originalAmount: "10000.00",
          settledAmount: "4000.00",
          counterpartyName: null,
          documentNumber: null,
          installmentLabel: null,
          nomusFinancialAccountId: 8,
          nomusFinancialAccountName: null,
        },
      ],
    });
    assert.equal(board.totals.accountsReceivableTotal, "6000.00");
  });

  it("7: título vencido acumula no primeiro dia do horizonte", () => {
    assert.equal(
      effectiveTreasuryCrCpFlowDate("2026-07-25", "2026-07-30"),
      "2026-07-30"
    );
    const board = buildTreasuryCrCpByAccountBoard({
      fromDate: "2026-07-30",
      toDate: "2026-08-28",
      accounts: [
        account({ id: "a1", name: "A", nomusBankAccountId: "8" }),
      ],
      titles: [
        {
          id: "cr",
          side: "RECEIVABLE",
          dueDate: "2026-07-25",
          openBalance: "5000.00",
          originalAmount: "5000.00",
          settledAmount: "0.00",
          counterpartyName: null,
          documentNumber: null,
          installmentLabel: null,
          nomusFinancialAccountId: 8,
          nomusFinancialAccountName: null,
        },
      ],
    });
    const t = board.groups[0]!.receivableTitles[0]!;
    assert.equal(t.effectiveDate, "2026-07-30");
    assert.equal(t.situation, "OVERDUE");
    assert.equal(board.totals.accountsReceivableTotal, "5000.00");
  });

  it("8+9: liquidado e saldo zero não entram; cancelados não são passados ao board", () => {
    const board = buildTreasuryCrCpByAccountBoard({
      fromDate: "2026-07-30",
      toDate: "2026-08-28",
      accounts: [
        account({ id: "a1", name: "A", nomusBankAccountId: "8" }),
      ],
      titles: [
        {
          id: "zero",
          side: "RECEIVABLE",
          dueDate: "2026-08-01",
          openBalance: "0.00",
          originalAmount: "100.00",
          settledAmount: "100.00",
          counterpartyName: null,
          documentNumber: null,
          installmentLabel: null,
          nomusFinancialAccountId: 8,
          nomusFinancialAccountName: null,
        },
      ],
    });
    assert.equal(board.totals.accountsReceivableCount, 0);
  });

  it("10+11: sem duplicidade e totais fecham com detalhes", () => {
    const board = buildTreasuryCrCpByAccountBoard({
      fromDate: "2026-07-30",
      toDate: "2026-08-28",
      accounts: [
        account({
          id: "a1",
          name: "A",
          nomusBankAccountId: "8",
          sortOrder: 1,
        }),
      ],
      titles: [
        {
          id: "cr1",
          side: "RECEIVABLE",
          dueDate: "2026-08-01",
          openBalance: "100.00",
          originalAmount: "100.00",
          settledAmount: "0.00",
          counterpartyName: null,
          documentNumber: null,
          installmentLabel: null,
          nomusFinancialAccountId: 8,
          nomusFinancialAccountName: null,
        },
        {
          id: "cr2",
          side: "RECEIVABLE",
          dueDate: "2026-08-01",
          openBalance: "50.00",
          originalAmount: "50.00",
          settledAmount: "0.00",
          counterpartyName: null,
          documentNumber: null,
          installmentLabel: null,
          nomusFinancialAccountId: 7,
          nomusFinancialAccountName: null,
        },
      ],
    });
    const ids = board.groups.flatMap((g) =>
      g.receivableTitles.map((t) => t.id)
    );
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(board.diagnostics.receivableDiff, "0.00");
    assert.equal(
      board.totals.accountsReceivableTotal,
      board.diagnostics.loadedReceivableTotal
    );
  });

  it("12: conta local inativa manda para Contas sem vínculo", () => {
    const index = buildTreasuryNomusAccountLinkIndex([
      account({
        id: "a1",
        name: "Inativa",
        nomusBankAccountId: "8",
        isActive: false,
      }),
    ]);
    const res = resolveTreasuryAccountByNomusFinancialAccountId(index, 8);
    assert.equal(res.kind, "UNLINKED");
    if (res.kind === "UNLINKED") {
      assert.equal(res.reason, "LOCAL_ACCOUNT_INACTIVE");
    }
    const board = buildTreasuryCrCpByAccountBoard({
      fromDate: "2026-07-30",
      toDate: "2026-08-28",
      accounts: [
        account({
          id: "a1",
          name: "Inativa",
          nomusBankAccountId: "8",
          isActive: false,
        }),
      ],
      titles: [
        {
          id: "cr",
          side: "RECEIVABLE",
          dueDate: "2026-08-01",
          openBalance: "10.00",
          originalAmount: "10.00",
          settledAmount: "0.00",
          counterpartyName: null,
          documentNumber: null,
          installmentLabel: null,
          nomusFinancialAccountId: 8,
          nomusFinancialAccountName: null,
        },
      ],
    });
    assert.equal(board.groups.length, 1);
    assert.equal(board.groups[0]!.treasuryAccountId, TREASURY_CRCP_UNLINKED_ID);
    assert.equal(
      board.groups[0]!.receivableTitles[0]!.unlinkedReason,
      "LOCAL_ACCOUNT_INACTIVE"
    );
  });

  it("13: vínculo Nomus duplicado detectado entre contas ativas", () => {
    const dup = findActiveDuplicateNomusBankAccountLink({
      accounts: [
        account({ id: "a1", name: "Viacredi - Koppetel", nomusBankAccountId: "8" }),
        account({ id: "a2", name: "Outra", nomusBankAccountId: "8" }),
      ],
      nomusBankAccountId: "8",
      excludeAccountId: "a2",
    });
    assert.ok(dup);
    assert.equal(dup!.id, "a1");
    assert.equal(dup!.name, "Viacredi - Koppetel");
  });
});
