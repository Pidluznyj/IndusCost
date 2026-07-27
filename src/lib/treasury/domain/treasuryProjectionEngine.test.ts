import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addTreasuryMoney } from "../treasuryMoney.js";
import {
  applyExpectationOverlays,
  applyProgrammingOverlays,
  applyPromiseOverlays,
  calculateProjectionDayLine,
  enumerateTreasuryProjectionCivilDates,
  identifyProjectionRisk,
  removeCancelledProjectionItems,
  resolveProjectionOpenBalance,
  runTreasuryProjectionEngine,
  TREASURY_PROJECTION_ALGORITHM_VERSION,
  type TreasuryProjectionAccountBase,
  type TreasuryProjectionEngineInput,
  type TreasuryProjectionPayableSeed,
  type TreasuryProjectionReceivableSeed,
} from "./treasuryProjectionEngine.js";

const ACC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACC_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TITLE_AR = "11111111-1111-4111-8111-111111111111";
const TITLE_AP = "22222222-2222-4222-8222-222222222222";

function account(
  partial: Partial<TreasuryProjectionAccountBase> & { accountId: string }
): TreasuryProjectionAccountBase {
  return {
    code: "CX",
    includeInConsolidated: true,
    minimumBalance: "0.00",
    openingBalance: "1000.00",
    ...partial,
  };
}

function baseInput(
  overrides: Partial<TreasuryProjectionEngineInput> = {}
): TreasuryProjectionEngineInput {
  return {
    scenario: "CONTRACTUAL",
    asOfCivilDate: "2026-07-27",
    periodFrom: "2026-07-27",
    periodTo: "2026-07-29",
    accounts: [account({ accountId: ACC_A, code: "A", openingBalance: "1000.00" })],
    receivables: [],
    payables: [],
    settlements: [],
    expectations: [],
    promises: [],
    programming: [],
    ledgerEntries: [],
    transfers: [],
    fallbackAccountId: ACC_A,
    ...overrides,
  };
}

function ar(
  partial: Partial<TreasuryProjectionReceivableSeed> & { id: string }
): TreasuryProjectionReceivableSeed {
  return {
    officialTitleId: TITLE_AR,
    nomusExternalId: 1001,
    accountId: ACC_A,
    dueDate: "2026-07-28",
    originalAmount: "200.00",
    openBalance: "200.00",
    settledAmount: "0.00",
    installmentNumber: 1,
    ...partial,
  };
}

function ap(
  partial: Partial<TreasuryProjectionPayableSeed> & { id: string }
): TreasuryProjectionPayableSeed {
  return {
    officialTitleId: TITLE_AP,
    nomusExternalId: 2001,
    accountId: ACC_A,
    dueDate: "2026-07-28",
    originalAmount: "150.00",
    openBalance: "150.00",
    settledAmount: "0.00",
    installmentNumber: 1,
    ...partial,
  };
}

describe("treasuryProjectionEngine — utilitários", () => {
  it("enumera dias civis inclusive e versiona algoritmo", () => {
    assert.deepEqual(
      enumerateTreasuryProjectionCivilDates("2026-07-27", "2026-07-29"),
      ["2026-07-27", "2026-07-28", "2026-07-29"]
    );
    assert.equal(TREASURY_PROJECTION_ALGORITHM_VERSION, "1.3.0");
  });

  it("remove cancelados e resolve saldo aberto sem negativo", () => {
    assert.equal(
      removeCancelledProjectionItems([
        { id: "1", isCancelled: true },
        { id: "2", isCancelled: false },
      ]).length,
      1
    );
    assert.equal(
      resolveProjectionOpenBalance({
        originalAmount: "100.00",
        openBalance: "-5.00",
      }),
      "0.00"
    );
  });

  it("aplica overlays de expectativa, promessa e programação", () => {
    const withExp = applyExpectationOverlays(
      [ar({ id: "r1", expectedDate: null })],
      [{ officialTitleId: TITLE_AR, expectedDate: "2026-07-29", accountId: ACC_B }]
    );
    assert.equal(withExp[0]?.expectedDate, "2026-07-29");
    assert.equal(withExp[0]?.accountId, ACC_B);

    const withPromise = applyPromiseOverlays(withExp, [
      {
        officialTitleId: TITLE_AR,
        promisedDate: "2026-07-30",
        status: "ACTIVE",
      },
    ]);
    assert.equal(withPromise[0]?.activePromiseDate, "2026-07-30");

    const withProg = applyProgrammingOverlays(
      [ap({ id: "p1", openBalance: "150.00" })],
      [
        {
          officialTitleId: TITLE_AP,
          scheduledDate: "2026-07-28",
          scheduledAmount: "80.00",
          programmingStatus: "PROGRAMMED",
        },
      ]
    );
    assert.equal(withProg[0]?.scheduledDate, "2026-07-28");
    assert.equal(withProg[0]?.openBalance, "80.00");
  });

  it("classifica risco CRITICAL / HIGH / LOW / NONE no disponível operacional", () => {
    assert.equal(
      identifyProjectionRisk({
        availableBalance: "-10.00",
        minimumBalance: "0.00",
        uncertainReceivables: "0.00",
      }).riskCode,
      "CRITICAL"
    );
    assert.equal(
      identifyProjectionRisk({
        availableBalance: "50.00",
        minimumBalance: "100.00",
        uncertainReceivables: "20.00",
      }).riskCode,
      "HIGH"
    );
    assert.equal(
      identifyProjectionRisk({
        availableBalance: "200.00",
        minimumBalance: "0.00",
        uncertainReceivables: "15.00",
      }).riskCode,
      "LOW"
    );
    assert.equal(
      identifyProjectionRisk({
        availableBalance: "200.00",
        minimumBalance: "0.00",
        uncertainReceivables: "0.00",
      }).riskCode,
      "NONE"
    );
  });
});

describe("treasuryProjectionEngine — fluxo determinístico", () => {
  it("projeta AR+AP no vencimento contratual e faz roll-forward de saldo", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        receivables: [ar({ id: "r1" })],
        payables: [ap({ id: "p1" })],
      })
    );

    assert.equal(result.lineCount, 3);
    const day28 = result.dayLines.find((l) => l.civilDate === "2026-07-28");
    assert.ok(day28);
    assert.equal(day28!.inflows, "200.00");
    assert.equal(day28!.outflows, "150.00");
    // 1000 + 200 - 150 = 1050
    assert.equal(day28!.closingBalance, "1050.00");

    const day29 = result.dayLines.find((l) => l.civilDate === "2026-07-29");
    assert.equal(day29!.openingBalance, "1050.00");
    assert.equal(day29!.closingBalance, "1050.00");
    assert.ok(day28!.composition.length >= 2);
    assert.ok(day28!.composition.every((c) => c.sourceRef.length > 0));
  });

  it("cenário PROBABLE usa promessa ativa na data", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        scenario: "PROBABLE",
        periodTo: "2026-07-30",
        receivables: [
          ar({
            id: "r1",
            dueDate: "2026-07-20", // vencido
            openBalance: "200.00",
          }),
        ],
        promises: [
          {
            officialTitleId: TITLE_AR,
            promisedDate: "2026-07-30",
            status: "ACTIVE",
          },
        ],
      })
    );
    const day30 = result.dayLines.find((l) => l.civilDate === "2026-07-30");
    assert.equal(day30?.inflows, "200.00");
    assert.equal(day30?.uncertainReceivables, "200.00");
    assert.equal(day30?.riskCode, "LOW");
  });

  it("vencido sem previsão no PROBABLE não entra (não empurra para hoje)", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        scenario: "PROBABLE",
        receivables: [
          ar({
            id: "r1",
            dueDate: "2026-07-01",
            openBalance: "90.00",
          }),
        ],
      })
    );
    const totalIn = result.dayLines.reduce(
      (s, l) => s + Number(l.inflows),
      0
    );
    assert.equal(totalIn, 0);
    assert.ok(result.skipped.some((s) => s.id === "r1"));
  });

  it("cancelados não projetam", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        receivables: [
          ar({ id: "r1", isCancelled: true, openBalance: "500.00" }),
          ar({
            id: "r2",
            officialTitleId: "33333333-3333-4333-8333-333333333333",
            nomusExternalId: 1002,
            openBalance: "50.00",
            originalAmount: "50.00",
          }),
        ],
      })
    );
    const day28 = result.dayLines.find((l) => l.civilDate === "2026-07-28");
    assert.equal(day28?.inflows, "50.00");
  });

  it("baixa realizada não soma previsão do mesmo título", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        receivables: [
          ar({
            id: "r1",
            openBalance: "0.00",
            settledAmount: "200.00",
            realizedDate: "2026-07-27",
          }),
        ],
        settlements: [
          {
            id: "set1",
            side: "AR",
            officialTitleId: TITLE_AR,
            accountId: ACC_A,
            civilDate: "2026-07-27",
            amount: "200.00",
            isReconciled: false,
          },
        ],
      })
    );
    const day27 = result.dayLines.find((l) => l.civilDate === "2026-07-27")!;
    assert.equal(day27.realized, "200.00");
    assert.equal(day27.inflows, "200.00");
    // Sem segunda fatia de previsão
    assert.equal(
      day27.composition.filter((c) => c.itemKind === "RECEIVABLE").length,
      0
    );
    assert.equal(day27.closingBalance, "1200.00");
  });

  it("parcela parcial: realizado + saldo aberto na data do cenário", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        receivables: [
          ar({
            id: "r1",
            originalAmount: "1000.00",
            openBalance: "400.00",
            settledAmount: "600.00",
          }),
        ],
        settlements: [
          {
            id: "set-partial",
            side: "AR",
            officialTitleId: TITLE_AR,
            accountId: ACC_A,
            civilDate: "2026-07-27",
            amount: "600.00",
          },
        ],
      })
    );
    const day27 = result.dayLines.find((l) => l.civilDate === "2026-07-27")!;
    const day28 = result.dayLines.find((l) => l.civilDate === "2026-07-28")!;
    assert.equal(day27.realized, "600.00");
    assert.equal(day28.inflows, "400.00");
    assert.equal(day28.closingBalance, "2000.00"); // 1000+600+400
  });

  it("transferência move entre contas sem alterar consolidado", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        accounts: [
          account({
            accountId: ACC_A,
            code: "A",
            openingBalance: "1000.00",
            includeInConsolidated: true,
          }),
          account({
            accountId: ACC_B,
            code: "B",
            openingBalance: "500.00",
            includeInConsolidated: true,
          }),
        ],
        transfers: [
          {
            id: "t1",
            transferGroupId: "g1",
            fromAccountId: ACC_A,
            toAccountId: ACC_B,
            civilDate: "2026-07-27",
            amount: "100.00",
          },
        ],
      })
    );

    const a27 = result.dayLines.find(
      (l) => l.accountId === ACC_A && l.civilDate === "2026-07-27"
    )!;
    const b27 = result.dayLines.find(
      (l) => l.accountId === ACC_B && l.civilDate === "2026-07-27"
    )!;
    assert.equal(a27.transfers, "-100.00");
    assert.equal(b27.transfers, "100.00");
    assert.equal(a27.closingBalance, "900.00");
    assert.equal(b27.closingBalance, "600.00");
    // Consolidado invariante: 900+600 = 1500 = 1000+500
    const consolidated =
      Number(a27.closingBalance) + Number(b27.closingBalance);
    assert.equal(consolidated, 1500);
  });

  it("lançamento manual CREDIT/DEBIT altera saldo com Decimal string", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        ledgerEntries: [
          {
            id: "l1",
            accountId: ACC_A,
            civilDate: "2026-07-27",
            amount: "10.55",
            direction: "CREDIT",
            status: "ACTIVE",
            nature: "MANUAL",
          },
          {
            id: "l2",
            accountId: ACC_A,
            civilDate: "2026-07-27",
            amount: "0.55",
            direction: "DEBIT",
            status: "ACTIVE",
            nature: "MANUAL",
          },
          {
            id: "l3",
            accountId: ACC_A,
            civilDate: "2026-07-27",
            amount: "999.00",
            direction: "CREDIT",
            status: "REVERSED",
          },
        ],
      })
    );
    const day = result.dayLines.find((l) => l.civilDate === "2026-07-27")!;
    assert.equal(day.inflows, "10.55");
    assert.equal(day.outflows, "0.55");
    assert.equal(day.closingBalance, "1010.00");
  });

  it("programação parcial CP reduz saída ao valor programado", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        scenario: "PROBABLE",
        payables: [ap({ id: "p1", openBalance: "150.00", originalAmount: "150.00" })],
        programming: [
          {
            officialTitleId: TITLE_AP,
            scheduledDate: "2026-07-28",
            scheduledAmount: "40.00",
            programmingStatus: "PROGRAMMED",
            accountId: ACC_A,
          },
        ],
      })
    );
    const day28 = result.dayLines.find((l) => l.civilDate === "2026-07-28")!;
    assert.equal(day28.outflows, "40.00");
  });

  it("CONFIRMED exige confirmação — sem confirmedDate não projeta AR", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        scenario: "CONFIRMED",
        receivables: [ar({ id: "r1", confirmedDate: null })],
      })
    );
    const totalIn = result.dayLines.reduce(
      (acc, l) => acc + Number(l.inflows),
      0
    );
    assert.equal(totalIn, 0);
  });

  it("CONFIRMED com confirmedDate projeta na data confirmada", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        scenario: "CONFIRMED",
        receivables: [
          ar({ id: "r1", confirmedDate: "2026-07-29", dueDate: "2026-07-28" }),
        ],
      })
    );
    const day29 = result.dayLines.find((l) => l.civilDate === "2026-07-29")!;
    assert.equal(day29.inflows, "200.00");
  });

  it("risco CRITICAL quando saldo fica negativo abaixo do mínimo", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        accounts: [
          account({
            accountId: ACC_A,
            openingBalance: "100.00",
            minimumBalance: "50.00",
            allowNegativeBalance: false,
          }),
        ],
        payables: [
          ap({
            id: "p1",
            openBalance: "180.00",
            originalAmount: "180.00",
            dueDate: "2026-07-27",
          }),
        ],
      })
    );
    const day27 = result.dayLines.find((l) => l.civilDate === "2026-07-27")!;
    assert.equal(day27.closingBalance, "-80.00");
    assert.equal(day27.riskCode, "CRITICAL");
    assert.equal(day27.riskAmount, "80.00");
  });

  it("é determinístico: duas execuções idênticas produzem o mesmo JSON", () => {
    const input = baseInput({
      receivables: [ar({ id: "r1" }), ar({
        id: "r2",
        officialTitleId: "33333333-3333-4333-8333-333333333333",
        nomusExternalId: 1002,
        dueDate: "2026-07-27",
        openBalance: "10.00",
        originalAmount: "10.00",
      })],
      payables: [ap({ id: "p1" })],
      ledgerEntries: [
        {
          id: "l1",
          accountId: ACC_A,
          civilDate: "2026-07-28",
          amount: "1.00",
          direction: "CREDIT",
          status: "ACTIVE",
        },
      ],
    });
    const a = runTreasuryProjectionEngine(input);
    const b = runTreasuryProjectionEngine(input);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  it("composição rastreável referencia título e sourceRef", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        receivables: [ar({ id: "r1" })],
      })
    );
    const item = result.dayLines
      .flatMap((l) => l.composition)
      .find((c) => c.officialTitleId === TITLE_AR);
    assert.ok(item);
    assert.match(item!.sourceRef, /FORECAST|AR/);
    assert.equal(item!.nomusExternalId, 1001);
  });

  it("calculateProjectionDayLine isola transfers de inflows/outflows", () => {
    const line = calculateProjectionDayLine({
      account: account({ accountId: ACC_A, openingBalance: "100.00" }),
      civilDate: "2026-07-27",
      openingBalance: "100.00",
      movements: [
        {
          id: "t-out",
          accountId: ACC_A,
          civilDate: "2026-07-27",
          amount: "30.00",
          direction: "OUTFLOW",
          itemKind: "TRANSFER",
          isRealized: true,
          isUncertain: false,
          affectsConsolidated: false,
          officialTitleId: null,
          nomusExternalId: null,
          ledgerEntryId: null,
          transferGroupId: "g",
          sourceRef: "TRANSFER|g|OUT|inst:none",
          label: "out",
          metadata: {},
        },
        {
          id: "ar",
          accountId: ACC_A,
          civilDate: "2026-07-27",
          amount: "20.00",
          direction: "INFLOW",
          itemKind: "RECEIVABLE",
          isRealized: false,
          isUncertain: false,
          affectsConsolidated: true,
          officialTitleId: TITLE_AR,
          nomusExternalId: 1,
          ledgerEntryId: null,
          transferGroupId: null,
          sourceRef: "x",
          label: "ar",
          metadata: {},
        },
      ],
    });
    assert.equal(line.inflows, "20.00");
    assert.equal(line.outflows, "0.00");
    assert.equal(line.transfers, "-30.00");
    assert.equal(line.closingBalance, "90.00");
  });

  it("não importa Express nem depende de req/res", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("./treasuryProjectionEngine.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(src, /from ["']express["']/);
    assert.doesNotMatch(src, /@prisma\/client/);
    assert.doesNotMatch(src, /\.server/);
  });
});

describe("treasuryProjectionEngine — precisão e liquidez", () => {
  it("centavos em recebimento parcial", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        receivables: [
          ar({
            id: "r1",
            originalAmount: "100.03",
            openBalance: "33.34",
            settledAmount: "66.69",
          }),
        ],
        settlements: [
          {
            id: "set-cents",
            side: "AR",
            officialTitleId: TITLE_AR,
            accountId: ACC_A,
            civilDate: "2026-07-27",
            amount: "66.69",
          },
        ],
      })
    );
    const day27 = result.dayLines.find((l) => l.civilDate === "2026-07-27")!;
    const day28 = result.dayLines.find((l) => l.civilDate === "2026-07-28")!;
    assert.equal(day27.realized, "66.69");
    assert.equal(day28.inflows, "33.34");
    assert.equal(day28.closingBalance, "1100.03");
  });

  it("transferência com centavos mantém consolidado", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        accounts: [
          account({
            accountId: ACC_A,
            openingBalance: "100.01",
            includeInConsolidated: true,
          }),
          account({
            accountId: ACC_B,
            openingBalance: "50.02",
            includeInConsolidated: true,
          }),
        ],
        transfers: [
          {
            id: "t-cents",
            transferGroupId: "gc",
            fromAccountId: ACC_A,
            toAccountId: ACC_B,
            civilDate: "2026-07-27",
            amount: "0.03",
          },
        ],
      })
    );
    const a = result.dayLines.find(
      (l) => l.accountId === ACC_A && l.civilDate === "2026-07-27"
    )!;
    const b = result.dayLines.find(
      (l) => l.accountId === ACC_B && l.civilDate === "2026-07-27"
    )!;
    assert.equal(a.availableBalance, "99.98");
    assert.equal(b.availableBalance, "50.05");
    assert.equal(
      addTreasuryMoney(a.availableBalance, b.availableBalance),
      "150.03"
    );
  });

  it("aplicação indisponível até a data de liquidez (D+2)", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        periodFrom: "2026-07-27",
        periodTo: "2026-07-30",
        accounts: [
          account({
            accountId: ACC_A,
            openingBalance: "500.00",
            blockedBalance: "0.00",
          }),
        ],
        applications: [
          {
            id: "app1",
            accountId: ACC_A,
            amount: "200.00",
            investedOn: "2026-07-27",
            liquidity: "D_PLUS_2",
          },
        ],
      })
    );
    const d27 = result.dayLines.find((l) => l.civilDate === "2026-07-27")!;
    const d28 = result.dayLines.find((l) => l.civilDate === "2026-07-28")!;
    const d29 = result.dayLines.find((l) => l.civilDate === "2026-07-29")!;
    // D+2 a partir de 27 → disponível em 29
    assert.equal(d27.investmentsBalance, "200.00");
    assert.equal(d27.investmentsMaturedToday, "0.00");
    assert.equal(d27.availableBalance, "500.00");
    assert.equal(d28.investmentsBalance, "200.00");
    assert.equal(d29.investmentsMaturedToday, "200.00");
    assert.equal(d29.investmentsBalance, "0.00");
    assert.equal(d29.availableBalance, "700.00");
  });

  it("IMMEDIATE / D+1 / D+3 respeitam offsets", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        periodFrom: "2026-07-27",
        periodTo: "2026-07-30",
        accounts: [account({ accountId: ACC_A, openingBalance: "0.00" })],
        applications: [
          {
            id: "imm",
            accountId: ACC_A,
            amount: "10.00",
            investedOn: "2026-07-27",
            liquidity: "IMMEDIATE",
          },
          {
            id: "d1",
            accountId: ACC_A,
            amount: "20.00",
            investedOn: "2026-07-27",
            liquidity: "D_PLUS_1",
          },
          {
            id: "d3",
            accountId: ACC_A,
            amount: "30.00",
            investedOn: "2026-07-27",
            liquidity: "D_PLUS_3",
          },
        ],
      })
    );
    const byDate = Object.fromEntries(
      result.dayLines.map((l) => [l.civilDate, l])
    );
    assert.equal(byDate["2026-07-27"]?.investmentsMaturedToday, "10.00");
    assert.equal(byDate["2026-07-27"]?.availableBalance, "10.00");
    assert.equal(byDate["2026-07-28"]?.investmentsMaturedToday, "20.00");
    assert.equal(byDate["2026-07-28"]?.availableBalance, "30.00");
    assert.equal(byDate["2026-07-29"]?.investmentsMaturedToday, "0.00");
    assert.equal(byDate["2026-07-30"]?.investmentsMaturedToday, "30.00");
    assert.equal(byDate["2026-07-30"]?.availableBalance, "60.00");
  });

  it("saldo bloqueado e limite de crédito ficam separados do disponível", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        accounts: [
          account({
            accountId: ACC_A,
            openingBalance: "100.00",
            blockedBalance: "40.00",
            creditLimit: "500.00",
            usedLimit: "125.50",
            minimumBalance: "80.00",
          }),
        ],
      })
    );
    const day = result.dayLines.find((l) => l.civilDate === "2026-07-27")!;
    assert.equal(day.availableBalance, "100.00");
    assert.equal(day.blockedBalance, "40.00");
    assert.equal(day.creditLimit, "500.00");
    assert.equal(day.usedLimit, "125.50");
    assert.equal(day.creditAvailable, "374.50");
    assert.equal(day.totalPosition, "140.00");
    // crédito não entra no totalPosition nem no disponível
    assert.notEqual(day.availableBalance, "474.50");
  });

  it("conta que não permite negativo marca CRITICAL; que permite, não", () => {
    const denied = runTreasuryProjectionEngine(
      baseInput({
        accounts: [
          account({
            accountId: ACC_A,
            openingBalance: "10.00",
            allowNegativeBalance: false,
            minimumBalance: "0.00",
          }),
        ],
        payables: [
          ap({
            id: "p1",
            dueDate: "2026-07-27",
            openBalance: "25.00",
            originalAmount: "25.00",
          }),
        ],
      })
    );
    assert.equal(
      denied.dayLines.find((l) => l.civilDate === "2026-07-27")?.riskCode,
      "CRITICAL"
    );

    const allowed = runTreasuryProjectionEngine(
      baseInput({
        accounts: [
          account({
            accountId: ACC_A,
            openingBalance: "10.00",
            allowNegativeBalance: true,
            minimumBalance: "0.00",
          }),
        ],
        payables: [
          ap({
            id: "p1",
            dueDate: "2026-07-27",
            openBalance: "25.00",
            originalAmount: "25.00",
          }),
        ],
      })
    );
    const line = allowed.dayLines.find((l) => l.civilDate === "2026-07-27")!;
    assert.equal(line.availableBalance, "-15.00");
    assert.notEqual(line.riskCode, "CRITICAL");
  });

  it("milhares de movimentos mantêm precisão Decimal", () => {
    const settlements = Array.from({ length: 5000 }, (_, i) => ({
      id: `s-${i}`,
      side: "AR" as const,
      officialTitleId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      accountId: ACC_A,
      civilDate: "2026-07-27",
      amount: "0.01",
    }));
    const receivables = settlements.map((s, i) =>
      ar({
        id: `r-${i}`,
        officialTitleId: s.officialTitleId,
        nomusExternalId: 10_000 + i,
        openBalance: "0.00",
        settledAmount: "0.01",
        originalAmount: "0.01",
        dueDate: "2026-07-27",
      })
    );
    const result = runTreasuryProjectionEngine(
      baseInput({
        accounts: [account({ accountId: ACC_A, openingBalance: "0.00" })],
        receivables,
        settlements,
      })
    );
    const day = result.dayLines.find((l) => l.civilDate === "2026-07-27")!;
    assert.equal(day.realized, "50.00");
    assert.equal(day.availableBalance, "50.00");
  });
});

describe("treasuryProjectionEngine — auditoria Prompt 36 (lacunas)", () => {
  it("múltiplas baixas parciais somam todas + saldo aberto", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        receivables: [
          ar({
            id: "r1",
            openBalance: "400.00",
            settledAmount: "600.00",
            originalAmount: "1000.00",
          }),
        ],
        settlements: [
          {
            id: "set1",
            side: "AR",
            officialTitleId: TITLE_AR,
            accountId: ACC_A,
            civilDate: "2026-07-27",
            amount: "300.00",
          },
          {
            id: "set2",
            side: "AR",
            officialTitleId: TITLE_AR,
            accountId: ACC_A,
            civilDate: "2026-07-28",
            amount: "300.00",
          },
        ],
      })
    );
    const d27 = result.dayLines.find((l) => l.civilDate === "2026-07-27")!;
    const d28 = result.dayLines.find((l) => l.civilDate === "2026-07-28")!;
    assert.equal(d27.realized, "300.00");
    assert.equal(d28.realized, "300.00");
    assert.equal(d28.inflows, addTreasuryMoney("300.00", "400.00"));
    // 1000 opening + 300 + 300 + 400 forecast = 2000
    assert.equal(d28.closingBalance, "2000.00");
  });

  it("promessa ACTIVE com promisedAmount < openBalance limita inflow", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        scenario: "PROBABLE",
        periodTo: "2026-07-30",
        receivables: [
          ar({
            id: "r1",
            dueDate: "2026-07-20",
            openBalance: "200.00",
          }),
        ],
        promises: [
          {
            officialTitleId: TITLE_AR,
            promisedDate: "2026-07-30",
            status: "ACTIVE",
            promisedAmount: "50.00",
          },
        ],
      })
    );
    const day30 = result.dayLines.find((l) => l.civilDate === "2026-07-30");
    assert.equal(day30?.inflows, "50.00");
    assert.equal(day30?.uncertainReceivables, "50.00");
  });

  it("duas seeds AR mesmo officialTitleId não duplicam", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        receivables: [
          ar({ id: "r-dup-a", openBalance: "100.00", originalAmount: "100.00" }),
          ar({ id: "r-dup-b", openBalance: "100.00", originalAmount: "100.00" }),
        ],
        settlements: [
          {
            id: "set1",
            side: "AR",
            officialTitleId: TITLE_AR,
            accountId: ACC_A,
            civilDate: "2026-07-27",
            amount: "40.00",
          },
        ],
      })
    );
    const totalIn = result.dayLines.reduce(
      (acc, l) => addTreasuryMoney(acc, l.inflows),
      "0.00"
    );
    // 40 realized + 100 forecast (open), não 2×
    assert.equal(totalIn, "140.00");
  });

  it("transferência com destino ausente não altera caixa da origem", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        accounts: [
          account({
            accountId: ACC_A,
            openingBalance: "1000.00",
            includeInConsolidated: true,
          }),
        ],
        transfers: [
          {
            id: "t-orphan",
            transferGroupId: "g-orphan",
            fromAccountId: ACC_A,
            toAccountId: ACC_B,
            civilDate: "2026-07-27",
            amount: "100.00",
          },
        ],
      })
    );
    const a27 = result.dayLines.find(
      (l) => l.accountId === ACC_A && l.civilDate === "2026-07-27"
    )!;
    assert.equal(a27.transfers, "0.00");
    assert.equal(a27.closingBalance, "1000.00");
    assert.ok(result.skipped.some((s) => s.id === "t-orphan"));
  });

  it("ledger linkado a settlement não duplica caixa", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        receivables: [
          ar({
            id: "r1",
            openBalance: "0.00",
            settledAmount: "80.00",
            originalAmount: "80.00",
          }),
        ],
        settlements: [
          {
            id: "set-link",
            side: "AR",
            officialTitleId: TITLE_AR,
            accountId: ACC_A,
            civilDate: "2026-07-27",
            amount: "80.00",
          },
        ],
        ledgerEntries: [
          {
            id: "led-dup",
            accountId: ACC_A,
            civilDate: "2026-07-27",
            amount: "80.00",
            direction: "CREDIT",
            status: "ACTIVE",
            nature: "MANUAL",
            linkedSettlementId: "set-link",
          },
        ],
      })
    );
    const day = result.dayLines.find((l) => l.civilDate === "2026-07-27")!;
    assert.equal(day.inflows, "80.00");
    assert.ok(result.skipped.some((s) => s.id === "led-dup"));
  });

  it("CONTRACTUAL ignora expectedDate (dueDate intacto)", () => {
    const seed = ar({
      id: "r1",
      dueDate: "2026-07-28",
      expectedDate: "2026-07-29",
      openBalance: "70.00",
      originalAmount: "70.00",
    });
    const overlaid = applyExpectationOverlays(
      [seed],
      [
        {
          officialTitleId: TITLE_AR,
          expectedDate: "2026-07-29",
        },
      ]
    );
    assert.equal(overlaid[0]!.dueDate, "2026-07-28");
    assert.equal(overlaid[0]!.expectedDate, "2026-07-29");

    const result = runTreasuryProjectionEngine(
      baseInput({
        scenario: "CONTRACTUAL",
        receivables: overlaid,
      })
    );
    const d28 = result.dayLines.find((l) => l.civilDate === "2026-07-28")!;
    const d29 = result.dayLines.find((l) => l.civilDate === "2026-07-29")!;
    assert.equal(d28.inflows, "70.00");
    assert.equal(d29.inflows, "0.00");
  });

  it("conta fora do consolidado gera dayLine mas marca affectsConsolidated=false", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        accounts: [
          account({
            accountId: ACC_A,
            openingBalance: "1000.00",
            includeInConsolidated: true,
          }),
          account({
            accountId: ACC_B,
            code: "B",
            openingBalance: "100.00",
            includeInConsolidated: false,
          }),
        ],
        receivables: [
          ar({
            id: "r-b",
            accountId: ACC_B,
            openBalance: "25.00",
            originalAmount: "25.00",
          }),
        ],
      })
    );
    const b28 = result.dayLines.find(
      (l) => l.accountId === ACC_B && l.civilDate === "2026-07-28"
    )!;
    assert.equal(b28.inflows, "25.00");
    assert.ok(
      b28.composition.every(
        (c) => c.metadata?.affectsConsolidated === false
      )
    );
    const consolidatedClosing = result.dayLines
      .filter(
        (l) =>
          l.civilDate === "2026-07-28" &&
          l.accountId === ACC_A
      )
      .reduce((acc, l) => addTreasuryMoney(acc, l.closingBalance), "0.00");
    assert.equal(consolidatedClosing, "1000.00");
  });

  it("composição mantém rastreabilidade (title/settlement/sourceRef)", () => {
    const result = runTreasuryProjectionEngine(
      baseInput({
        receivables: [
          ar({
            id: "r1",
            openBalance: "0.00",
            settledAmount: "15.00",
            originalAmount: "15.00",
          }),
        ],
        settlements: [
          {
            id: "set-trace",
            side: "AR",
            officialTitleId: TITLE_AR,
            accountId: ACC_A,
            civilDate: "2026-07-27",
            amount: "15.00",
          },
        ],
      })
    );
    const item = result.dayLines
      .flatMap((l) => l.composition)
      .find((c) => c.officialTitleId === TITLE_AR);
    assert.ok(item);
    assert.equal(item!.officialTitleId, TITLE_AR);
    assert.match(item!.sourceRef, /OFFICIAL_SETTLEMENT|RECONCILED/);
    assert.ok(item!.nomusExternalId === 1001);
  });
});
