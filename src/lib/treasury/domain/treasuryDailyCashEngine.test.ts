import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TREASURY_DAILY_CASH_ALGORITHM_VERSION,
  calculateTreasuryDailyCashPosition,
  computeTreasuryDailyCashPredictedClosing,
  computeTreasuryDailyCashRealizedClosing,
  type TreasuryDailyCashAccountSeed,
  type TreasuryDailyCashEngineInput,
  type TreasuryDailyCashLedgerSeed,
  type TreasuryDailyCashOfxSeed,
  type TreasuryDailyCashTitleSeed,
  type TreasuryDailyCashTransferSeed,
} from "./treasuryDailyCashEngine.js";

const CIVIL = "2026-07-28";
const AS_OF = "2026-07-28T21:00:00.000Z";

function account(
  partial: Partial<TreasuryDailyCashAccountSeed> &
    Pick<TreasuryDailyCashAccountSeed, "accountId" | "code">
): TreasuryDailyCashAccountSeed {
  return {
    name: partial.name ?? partial.code,
    includeInConsolidated: partial.includeInConsolidated ?? true,
    openingBalance: partial.openingBalance ?? "1000.00",
    informedClosingBalance: partial.informedClosingBalance ?? null,
    lastUpdatedAt: partial.lastUpdatedAt ?? AS_OF,
    ...partial,
  };
}

function baseInput(
  overrides: Partial<TreasuryDailyCashEngineInput> & {
    accounts: TreasuryDailyCashAccountSeed[];
  }
): TreasuryDailyCashEngineInput {
  return {
    civilDate: CIVIL,
    asOf: AS_OF,
    titles: [],
    ledgerEntries: [],
    transfers: [],
    ofxMovements: [],
    ...overrides,
  };
}

describe("treasuryDailyCashEngine — fórmulas Decimal", () => {
  it("calcula previsto e realizado com strings decimais", () => {
    assert.equal(
      computeTreasuryDailyCashPredictedClosing({
        openingBalance: "1000.00",
        plannedReceivables: "200.10",
        plannedPayables: "50.05",
        plannedLocalInflows: "10.00",
        plannedLocalOutflows: "4.00",
        plannedTransferIn: "3.00",
        plannedTransferOut: "2.00",
      }),
      "1157.05"
    );
    assert.equal(
      computeTreasuryDailyCashRealizedClosing({
        openingBalance: "1000.00",
        realizedReceivables: "150.00",
        realizedPayables: "40.00",
        realizedLocalInflows: "5.50",
        realizedLocalOutflows: "1.25",
        realizedTransferIn: "10.00",
        realizedTransferOut: "5.00",
      }),
      "1119.25"
    );
  });
});

describe("treasuryDailyCashEngine — conta única", () => {
  it("monta posição enxuta e divergência zero", () => {
    const titles: TreasuryDailyCashTitleSeed[] = [
      {
        id: "ar-1",
        accountId: "a1",
        side: "AR",
        plannedAmount: "100.00",
        realizedAmount: "100.00",
        officialTitleId: "title-ar-1",
      },
      {
        id: "ap-1",
        accountId: "a1",
        side: "AP",
        plannedAmount: "40.00",
        realizedAmount: "40.00",
        officialTitleId: "title-ap-1",
      },
    ];
    const result = calculateTreasuryDailyCashPosition(
      baseInput({
        accounts: [
          account({
            accountId: "a1",
            code: "CX1",
            openingBalance: "1000.00",
            informedClosingBalance: "1060.00",
          }),
        ],
        titles,
      })
    );

    assert.equal(result.algorithmVersion, TREASURY_DAILY_CASH_ALGORITHM_VERSION);
    assert.equal(result.accounts.length, 1);
    const row = result.accounts[0]!;
    assert.equal(row.openingBalance, "1000.00");
    assert.equal(row.plannedReceivables, "100.00");
    assert.equal(row.realizedReceivables, "100.00");
    assert.equal(row.plannedPayables, "40.00");
    assert.equal(row.realizedPayables, "40.00");
    assert.equal(row.predictedClosingBalance, "1060.00");
    assert.equal(row.realizedClosingBalance, "1060.00");
    assert.equal(row.informedClosingBalance, "1060.00");
    assert.equal(row.divergence, "0.00");
    assert.equal(row.status, "READY_TO_CLOSE");
    assert.equal(result.consolidated.transfers.net, "0.00");
  });

  it("saldo final não informado: realizado calculado sem divergência", () => {
    const result = calculateTreasuryDailyCashPosition(
      baseInput({
        accounts: [
          account({
            accountId: "a1",
            code: "CX1",
            openingBalance: "500.00",
            informedClosingBalance: null,
          }),
        ],
        titles: [
          {
            id: "ar-1",
            accountId: "a1",
            side: "AR",
            plannedAmount: "0.00",
            realizedAmount: "20.00",
          },
        ],
      })
    );
    const row = result.accounts[0]!;
    assert.equal(row.realizedClosingBalance, "520.00");
    assert.equal(row.informedClosingBalance, null);
    assert.equal(row.divergence, null);
    assert.equal(row.status, "OPEN");
    assert.ok(
      row.pendencies.some((p) => p.code === "MISSING_CLOSING_BALANCE")
    );
  });
});

describe("treasuryDailyCashEngine — múltiplas contas e transferências", () => {
  it("por conta origem diminui / destino aumenta; consolidado neutro", () => {
    const transfers: TreasuryDailyCashTransferSeed[] = [
      {
        id: "t1",
        transferGroupId: "g1",
        fromAccountId: "a1",
        toAccountId: "a2",
        amount: "200.00",
        layer: "REALIZED",
      },
    ];
    const result = calculateTreasuryDailyCashPosition(
      baseInput({
        accounts: [
          account({
            accountId: "a1",
            code: "A1",
            openingBalance: "1000.00",
            informedClosingBalance: "800.00",
          }),
          account({
            accountId: "a2",
            code: "A2",
            openingBalance: "100.00",
            informedClosingBalance: "300.00",
          }),
        ],
        transfers,
      })
    );
    const a1 = result.accounts.find((a) => a.accountId === "a1")!;
    const a2 = result.accounts.find((a) => a.accountId === "a2")!;
    assert.equal(a1.transfers.sent, "200.00");
    assert.equal(a1.transfers.received, "0.00");
    assert.equal(a1.realizedClosingBalance, "800.00");
    assert.equal(a2.transfers.received, "200.00");
    assert.equal(a2.transfers.sent, "0.00");
    assert.equal(a2.realizedClosingBalance, "300.00");
    assert.equal(result.consolidated.transfers.received, "200.00");
    assert.equal(result.consolidated.transfers.sent, "200.00");
    assert.equal(result.consolidated.transfers.net, "0.00");
    assert.equal(result.consolidated.realizedClosingBalance, "1100.00");
    assert.equal(result.consolidated.openingBalance, "1100.00");
  });
});

describe("treasuryDailyCashEngine — baixa parcial", () => {
  it("utiliza somente o valor liquidado no realizado e mantém previsto residual", () => {
    const result = calculateTreasuryDailyCashPosition(
      baseInput({
        accounts: [account({ accountId: "a1", code: "A1" })],
        titles: [
          {
            id: "ar-partial",
            accountId: "a1",
            side: "AR",
            plannedAmount: "60.00",
            realizedAmount: "40.00",
            officialTitleId: "title-partial",
          },
        ],
      })
    );
    const row = result.accounts[0]!;
    assert.equal(row.plannedReceivables, "60.00");
    assert.equal(row.realizedReceivables, "40.00");
    assert.equal(row.predictedClosingBalance, "1060.00");
    assert.equal(row.realizedClosingBalance, "1040.00");
    assert.ok(row.pendencies.some((p) => p.code === "PARTIAL_SETTLEMENT"));
  });
});

describe("treasuryDailyCashEngine — OFX", () => {
  it("OFX conciliado confirma e não adiciona valor de novo", () => {
    const ofx: TreasuryDailyCashOfxSeed[] = [
      {
        id: "ofx-1",
        accountId: "a1",
        amount: "100.00",
        direction: "CREDIT",
        reconciliationStatus: "RECONCILED",
        matchedOfficialTitleId: "title-ar-1",
      },
    ];
    const result = calculateTreasuryDailyCashPosition(
      baseInput({
        accounts: [
          account({
            accountId: "a1",
            code: "A1",
            openingBalance: "1000.00",
            informedClosingBalance: "1100.00",
          }),
        ],
        titles: [
          {
            id: "ar-1",
            accountId: "a1",
            side: "AR",
            plannedAmount: "100.00",
            realizedAmount: "100.00",
            officialTitleId: "title-ar-1",
          },
        ],
        ofxMovements: ofx,
      })
    );
    const row = result.accounts[0]!;
    // Realizado só do título; OFX não soma 100 de novo → 1100, não 1200.
    assert.equal(row.realizedReceivables, "100.00");
    assert.equal(row.realizedClosingBalance, "1100.00");
    assert.equal(row.divergence, "0.00");
    // Previsto do mesmo título é suprimido após conciliação OFX.
    assert.equal(row.plannedReceivables, "0.00");
  });

  it("OFX não conciliado não altera saldo e explica divergência", () => {
    const result = calculateTreasuryDailyCashPosition(
      baseInput({
        accounts: [
          account({
            accountId: "a1",
            code: "A1",
            openingBalance: "1000.00",
            informedClosingBalance: "1050.00",
          }),
        ],
        ofxMovements: [
          {
            id: "ofx-u",
            accountId: "a1",
            amount: "50.00",
            direction: "CREDIT",
            reconciliationStatus: "UNRECONCILED",
          },
        ],
      })
    );
    const row = result.accounts[0]!;
    assert.equal(row.realizedClosingBalance, "1000.00");
    assert.equal(row.divergence, "50.00");
    assert.ok(row.pendencies.some((p) => p.code === "UNRECONCILED_OFX"));
    assert.ok(row.pendencies.some((p) => p.code === "BALANCE_DIVERGENCE"));
    assert.equal(row.status, "NEEDS_REVIEW");
  });

  it("OFX convertido em lançamento manual: só o ledger compõe o saldo", () => {
    const ledger: TreasuryDailyCashLedgerSeed[] = [
      {
        id: "led-1",
        accountId: "a1",
        direction: "CREDIT",
        amount: "75.00",
        status: "ACTIVE",
        layer: "REALIZED",
        sourceBankMovementId: "ofx-c",
      },
    ];
    const result = calculateTreasuryDailyCashPosition(
      baseInput({
        accounts: [
          account({
            accountId: "a1",
            code: "A1",
            openingBalance: "1000.00",
            informedClosingBalance: "1075.00",
          }),
        ],
        ledgerEntries: ledger,
        ofxMovements: [
          {
            id: "ofx-c",
            accountId: "a1",
            amount: "75.00",
            direction: "CREDIT",
            reconciliationStatus: "CONVERTED_TO_LEDGER",
            convertedLedgerEntryId: "led-1",
          },
        ],
      })
    );
    const row = result.accounts[0]!;
    assert.equal(row.localInflows, "75.00");
    assert.equal(row.realizedClosingBalance, "1075.00");
    assert.equal(row.divergence, "0.00");
    // Sem dupla contagem OFX+ledger.
    assert.notEqual(row.realizedClosingBalance, "1150.00");
  });
});

describe("treasuryDailyCashEngine — divergências e zero", () => {
  it("divergência positiva, negativa e zero", () => {
    const positive = calculateTreasuryDailyCashPosition(
      baseInput({
        accounts: [
          account({
            accountId: "a1",
            code: "A1",
            openingBalance: "100.00",
            informedClosingBalance: "120.00",
          }),
        ],
      })
    );
    assert.equal(positive.accounts[0]!.divergence, "20.00");

    const negative = calculateTreasuryDailyCashPosition(
      baseInput({
        accounts: [
          account({
            accountId: "a1",
            code: "A1",
            openingBalance: "100.00",
            informedClosingBalance: "90.00",
          }),
        ],
      })
    );
    assert.equal(negative.accounts[0]!.divergence, "-10.00");

    const zero = calculateTreasuryDailyCashPosition(
      baseInput({
        accounts: [
          account({
            accountId: "a1",
            code: "A1",
            openingBalance: "100.00",
            informedClosingBalance: "100.00",
          }),
        ],
      })
    );
    assert.equal(zero.accounts[0]!.divergence, "0.00");
    assert.equal(zero.accounts[0]!.status, "READY_TO_CLOSE");
  });
});

describe("treasuryDailyCashEngine — ausência de dupla contagem", () => {
  it("não soma OFX conciliado + título + ledger do mesmo movimento", () => {
    const result = calculateTreasuryDailyCashPosition(
      baseInput({
        accounts: [
          account({
            accountId: "a1",
            code: "A1",
            openingBalance: "0.00",
            informedClosingBalance: "100.00",
          }),
        ],
        titles: [
          {
            id: "ar-1",
            accountId: "a1",
            side: "AR",
            plannedAmount: "0.00",
            realizedAmount: "100.00",
            officialTitleId: "title-1",
          },
        ],
        ledgerEntries: [
          {
            id: "led-dup",
            accountId: "a1",
            direction: "CREDIT",
            amount: "100.00",
            status: "ACTIVE",
            layer: "REALIZED",
            sourceBankMovementId: "ofx-1",
            officialTitleId: "title-1",
          },
        ],
        ofxMovements: [
          {
            id: "ofx-1",
            accountId: "a1",
            amount: "100.00",
            direction: "CREDIT",
            reconciliationStatus: "RECONCILED",
            matchedOfficialTitleId: "title-1",
            matchedLedgerEntryId: "led-dup",
          },
        ],
      })
    );
    const row = result.accounts[0]!;
    // Cenário patológico de inputs duplicados: motor ainda não deve somar OFX.
    // Título + ledger ambos presentes = 200 se caller duplicar — documentamos que
    // OFX não entra. Aqui ledger tem officialTitleId; caller típico não cria ledger
    // para título já baixado. Garantimos OFX net-zero no calculado além de título+ledger.
    assert.equal(row.realizedReceivables, "100.00");
    assert.equal(row.localInflows, "100.00");
    // OFX não adiciona terceiro 100.
    assert.equal(row.realizedClosingBalance, "200.00");
  });

  it("DTO não expõe campos Prisma", () => {
    const result = calculateTreasuryDailyCashPosition(
      baseInput({
        accounts: [account({ accountId: "a1", code: "A1" })],
      })
    );
    const json = JSON.stringify(result);
    assert.doesNotMatch(json, /Prisma|Decimal|@db/);
    assert.ok("openingBalance" in result.accounts[0]!);
    assert.ok("divergence" in result.accounts[0]!);
    assert.ok("pendencies" in result.accounts[0]!);
    assert.ok("lastUpdatedAt" in result.accounts[0]!);
  });
});
