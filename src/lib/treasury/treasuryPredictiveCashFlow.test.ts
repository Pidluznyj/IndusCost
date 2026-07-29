import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreasuryAgendaDayDto } from "./contracts/treasuryDto.js";
import {
  buildPredictiveCashFlowKpis,
  extractPredictiveTransactionsFromAgendaDays,
  generatePredictiveCashFlowTimeline,
  mapAgendaDaysToPredictiveTimeline,
  resolveCompositionTransactionType,
} from "./treasuryPredictiveCashFlow.js";

function day(
  civilDate: string,
  opening: string,
  closing: string,
  inflows: string,
  outflows: string,
  items: TreasuryAgendaDayDto["items"]
): TreasuryAgendaDayDto {
  return {
    civilDate,
    accountId: null,
    accountCode: null,
    accountName: null,
    openingBalance: opening,
    plannedInflows: inflows,
    confirmedInflows: "0.00",
    realizedInflows: "0.00",
    plannedOutflows: outflows,
    programmedOutflows: "0.00",
    realizedOutflows: "0.00",
    transfers: "0.00",
    closingBalance: closing,
    riskAmount: "0.00",
    riskCode: "NONE",
    riskLabel: "Sem risco",
    inflows,
    outflows,
    net: "0.00",
    realized: "0.00",
    itemCount: items?.length ?? 0,
    items,
    alerts: [],
  };
}

describe("treasuryPredictiveCashFlow", () => {
  it("generateTimeline acumula entradas e saídas a partir do saldo base", () => {
    const timeline = generatePredictiveCashFlowTimeline({
      startingBalance: 1000,
      fromDate: "2026-07-27",
      horizonDays: 3,
      transactions: [
        {
          id: "1",
          description: "CR",
          amount: 200,
          date: "2026-07-27",
          type: "receivable",
          accountId: "a1",
          isPaid: false,
          itemKind: "RECEIVABLE",
        },
        {
          id: "2",
          description: "CP",
          amount: 50,
          date: "2026-07-28",
          type: "payable",
          accountId: "a1",
          isPaid: false,
          itemKind: "PAYABLE",
        },
      ],
    });
    assert.equal(timeline.length, 3);
    assert.equal(timeline[0]!.openingBalance, 1000);
    assert.equal(timeline[0]!.balance, 1200);
    assert.equal(timeline[0]!.receivables, 200);
    assert.equal(timeline[1]!.balance, 1150);
    assert.equal(timeline[1]!.payables, 50);
    assert.equal(timeline[2]!.balance, 1150);
  });

  it("mapeia agenda canônica e KPIs sem inventar LocalStorage", () => {
    const days = [
      day("2026-07-27", "10000.00", "12000.00", "3000.00", "1000.00", [
        {
          id: "i1",
          dayLineId: "l1",
          accountId: "acc-1",
          civilDate: "2026-07-27",
          itemKind: "RECEIVABLE",
          amount: "3000.00",
          label: "Cliente",
          officialTitleId: "t1",
          nomusExternalId: 1,
          ledgerEntryId: null,
          transferGroupId: null,
          sourceRef: null,
          sortOrder: 1,
        },
        {
          id: "i2",
          dayLineId: "l1",
          accountId: "acc-1",
          civilDate: "2026-07-27",
          itemKind: "PAYABLE",
          amount: "-1000.00",
          label: "Fornecedor",
          officialTitleId: "t2",
          nomusExternalId: 2,
          ledgerEntryId: null,
          transferGroupId: null,
          sourceRef: null,
          sortOrder: 2,
        },
      ]),
      day("2026-07-28", "12000.00", "11000.00", "0.00", "1000.00", []),
    ];
    const timeline = mapAgendaDaysToPredictiveTimeline(days);
    assert.equal(timeline[0]!.balance, 12000);
    assert.equal(timeline[0]!.openingBalance, 10000);
    const txs = extractPredictiveTransactionsFromAgendaDays(days);
    assert.equal(txs.length, 2);
    assert.equal(txs[0]!.type, "receivable");
    assert.equal(txs[1]!.type, "payable");
    const kpis = buildPredictiveCashFlowKpis({
      accounts: [
        {
          id: "acc-1",
          name: "Caixa",
          initialBalance: 10000,
          institutionName: "Banco",
          includeInConsolidated: true,
          isActive: true,
        },
      ],
      timeline,
      agendaOpeningBalance: 10000,
    });
    assert.equal(kpis.baseBalance, 10000);
    assert.equal(kpis.totalReceivables, 3000);
    assert.equal(kpis.totalPayables, 2000);
    assert.equal(kpis.finalProjection, 11000);
  });

  it("classifica itemKind RECEIVABLE/PAYABLE", () => {
    assert.equal(
      resolveCompositionTransactionType({
        amount: "10.00",
        itemKind: "RECEIVABLE_DUE",
      }),
      "receivable"
    );
    assert.equal(
      resolveCompositionTransactionType({
        amount: "-10.00",
        itemKind: "PAYABLE",
      }),
      "payable"
    );
  });
});
