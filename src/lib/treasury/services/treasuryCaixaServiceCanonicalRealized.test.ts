/**
 * Realizado da linha do tempo da Caixa: conversão dos conjuntos canônicos do
 * Fluxo de Caixa (por ano) em entradas de dia. CR usa a regra dos N dias
 * (`resolveFinanceEffectiveSettlementDate`); CP ancora sempre no vencimento
 * (baixa Nomus retroativa não desloca o mês do caixa).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
} from "@/src/lib/financeCashFlowDashboard.js";
import type { FinanceCashFlowCanonicalRealizedYearSets } from "@/src/lib/finance/financeCashFlowCanonicalRealized.server.js";
import {
  FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS,
  FINANCE_SETTLEMENT_RECONCILIATION_LEGACY,
} from "@/src/lib/finance/financeSettlementReconciliation.js";
import {
  buildTreasuryCaixaCanonicalRealizedInputs,
  computeTreasuryCaixaHistoricalArMonthlyInflowDeltas,
  resolveTreasuryCaixaChainYears,
} from "./treasuryCaixaService.server.js";

/** Política ativa em produção (TreasuryScenarioPolicy default): 3 dias. */
const POLICY = FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS;

function arRow(over: Partial<FinanceCashFlowArRow>): FinanceCashFlowArRow {
  return {
    dueDate: null,
    settlementDate: null,
    amountReceived: 0,
    balanceReceivable: 0,
    ...over,
  } as unknown as FinanceCashFlowArRow;
}

function apRow(over: Partial<FinanceCashFlowApRow>): FinanceCashFlowApRow {
  return {
    dueDate: null,
    paymentDate: null,
    settlementDate: null,
    amountPayable: 0,
    amountPaid: 0,
    balancePayable: 0,
    suspendPayment: false,
    description: "titulo normal",
    paymentMethodName: null,
    ...over,
  } as unknown as FinanceCashFlowApRow;
}

function ctx(
  year: number,
  arReceivedRows: FinanceCashFlowArRow[],
  apPaidRows: FinanceCashFlowApRow[]
): FinanceCashFlowCanonicalRealizedYearSets {
  return { year, arReceivedRows, apPaidRows };
}

describe("resolveTreasuryCaixaChainYears", () => {
  it("ano da gênese → só ele; ano futuro → da gênese até ele; ano pré-gênese → só ele", () => {
    assert.deepEqual(resolveTreasuryCaixaChainYears(2026, "2026-01-01"), [2026]);
    assert.deepEqual(resolveTreasuryCaixaChainYears(2028, "2026-01-01"), [
      2026, 2027, 2028,
    ]);
    assert.deepEqual(resolveTreasuryCaixaChainYears(2025, "2026-01-01"), [2025]);
  });
});

describe("buildTreasuryCaixaCanonicalRealizedInputs", () => {
  it("CR sem dueDate usa settlementDate (nada para aplicar a regra dos N dias)", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
      [
        ctx(
          2026,
          [arRow({ settlementDate: new Date(2026, 1, 10), amountReceived: 1500.5 })],
          []
        ),
      ],
      POLICY
    );
    assert.deepEqual(inputs.receivables, [
      { settlementDate: "2026-02-10", amountReceived: 1500.5 },
    ]);
  });

  it("CR sem baixa ou com valor zero não vira dia", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
      [
        ctx(
          2026,
          [
            arRow({ settlementDate: null, amountReceived: 100 }),
            arRow({ settlementDate: new Date(2026, 2, 1), amountReceived: 0 }),
          ],
          []
        ),
      ],
      POLICY
    );
    assert.deepEqual(inputs.receivables, []);
  });

  it("baixa fora do ano do contexto fica fora — mesmo recorte da tabela anual do Fluxo", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
      [
        ctx(
          2026,
          [
            // Título do ano 2026 baixado só em jan/2027: a tabela de 2026 do
            // Fluxo não o mostra (nenhum mês de 2026 contém a baixa).
            arRow({ settlementDate: new Date(2027, 0, 5), amountReceived: 999 }),
          ],
          []
        ),
      ],
      POLICY
    );
    assert.deepEqual(inputs.receivables, []);
  });

  it("CP quitado sem amountPaid informado realiza pelo amountPayable (regra canônica)", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
      [
        ctx(2026, [], [
          apRow({
            dueDate: new Date(2026, 4, 2),
            amountPayable: 1200,
            amountPaid: 0,
            balancePayable: 0,
          }),
        ]),
      ],
      POLICY
    );
    assert.deepEqual(inputs.payables, [
      { dueDate: null, paymentDate: "2026-05-02", amountPaid: 1200 },
    ]);
  });

  it("CP cancelado ou em aberto (nada realizado) não vira saída", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
      [
        ctx(2026, [], [
          apRow({
            dueDate: new Date(2026, 2, 15),
            amountPayable: 500,
            amountPaid: 500,
            balancePayable: 0,
            description: "TITULO CANCELADO",
          }),
          apRow({
            dueDate: new Date(2026, 2, 20),
            amountPayable: 300,
            amountPaid: 0,
            balancePayable: 300,
          }),
        ]),
      ],
      POLICY
    );
    assert.deepEqual(inputs.payables, []);
  });

  it("vários anos de contexto se somam, cada um com o próprio recorte", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
      [
        ctx(
          2026,
          [arRow({ settlementDate: new Date(2026, 6, 1), amountReceived: 10 })],
          []
        ),
        ctx(
          2027,
          [arRow({ settlementDate: new Date(2027, 0, 2), amountReceived: 20 })],
          []
        ),
      ],
      POLICY
    );
    assert.deepEqual(inputs.receivables, [
      { settlementDate: "2026-07-01", amountReceived: 10 },
      { settlementDate: "2027-01-02", amountReceived: 20 },
    ]);
  });

  // ── Regra dos N dias: só CR. CP sempre ancora no vencimento. ───────────
  describe("regra dos N dias — dueDate=05/08, valor 100 (R01-R06); CP sempre em D", () => {
    const DUE = new Date(2026, 7, 5); // 05/08/2026

    it("R01 — baixa NO vencimento (D) conta em D", () => {
      const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
        [
          ctx(2026, [
            arRow({ dueDate: DUE, settlementDate: new Date(2026, 7, 5), amountReceived: 100 }),
          ], [
            apRow({ dueDate: DUE, paymentDate: new Date(2026, 7, 5), amountPayable: 100, amountPaid: 100, balancePayable: 0 }),
          ]),
        ],
        POLICY
      );
      assert.deepEqual(inputs.receivables, [{ settlementDate: "2026-08-05", amountReceived: 100 }]);
      assert.deepEqual(inputs.payables, [{ dueDate: null, paymentDate: "2026-08-05", amountPaid: 100 }]);
    });

    it("R02 — baixa em D+1: CR conta em D; CP conta em D (vencimento)", () => {
      const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
        [
          ctx(2026, [
            arRow({ dueDate: DUE, settlementDate: new Date(2026, 7, 6), amountReceived: 100 }),
          ], [
            apRow({ dueDate: DUE, paymentDate: new Date(2026, 7, 6), amountPayable: 100, amountPaid: 100, balancePayable: 0 }),
          ]),
        ],
        POLICY
      );
      assert.deepEqual(inputs.receivables, [{ settlementDate: "2026-08-05", amountReceived: 100 }]);
      assert.deepEqual(inputs.payables, [{ dueDate: null, paymentDate: "2026-08-05", amountPaid: 100 }]);
    });

    it("R03 — baixa em D+2: CR conta em D; CP conta em D", () => {
      const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
        [
          ctx(2026, [
            arRow({ dueDate: DUE, settlementDate: new Date(2026, 7, 7), amountReceived: 100 }),
          ], [
            apRow({ dueDate: DUE, paymentDate: new Date(2026, 7, 7), amountPayable: 100, amountPaid: 100, balancePayable: 0 }),
          ]),
        ],
        POLICY
      );
      assert.deepEqual(inputs.receivables, [{ settlementDate: "2026-08-05", amountReceived: 100 }]);
      assert.deepEqual(inputs.payables, [{ dueDate: null, paymentDate: "2026-08-05", amountPaid: 100 }]);
    });

    it("R04 — baixa em D+3: CR conta em D; CP conta em D", () => {
      const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
        [
          ctx(2026, [
            arRow({ dueDate: DUE, settlementDate: new Date(2026, 7, 8), amountReceived: 100 }),
          ], [
            apRow({ dueDate: DUE, paymentDate: new Date(2026, 7, 8), amountPayable: 100, amountPaid: 100, balancePayable: 0 }),
          ]),
        ],
        POLICY
      );
      assert.deepEqual(inputs.receivables, [{ settlementDate: "2026-08-05", amountReceived: 100 }]);
      assert.deepEqual(inputs.payables, [{ dueDate: null, paymentDate: "2026-08-05", amountPaid: 100 }]);
    });

    it("R05 — baixa ALÉM da tolerância (4 dias ÚTEIS: qua 05→ter 11): CR na data real; CP permanece no vencimento", () => {
      // Tolerância conta dias ÚTEIS: 09/08 (domingo, D+4 corridos) são só 2
      // úteis e ficou DENTRO — por isso o atraso real aqui usa 11/08 (terça,
      // qui+sex+seg+ter = 4 úteis).
      const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
        [
          ctx(2026, [
            arRow({ dueDate: DUE, settlementDate: new Date(2026, 7, 11), amountReceived: 100 }),
          ], [
            apRow({ dueDate: DUE, paymentDate: new Date(2026, 7, 11), amountPayable: 100, amountPaid: 100, balancePayable: 0 }),
          ]),
        ],
        POLICY
      );
      assert.deepEqual(inputs.receivables, [{ settlementDate: "2026-08-11", amountReceived: 100 }]);
      assert.deepEqual(inputs.payables, [{ dueDate: null, paymentDate: "2026-08-05", amountPaid: 100 }]);
    });

    it("R05b — baixa no DOMINGO D+4 corridos (2 úteis) fica DENTRO da tolerância → dueDate", () => {
      const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
        [
          ctx(2026, [
            arRow({ dueDate: DUE, settlementDate: new Date(2026, 7, 9), amountReceived: 100 }),
          ], []),
        ],
        POLICY
      );
      assert.deepEqual(inputs.receivables, [{ settlementDate: "2026-08-05", amountReceived: 100 }]);
    });

    it("R06 — baixa ANTECIPADA: CR na data real; CP permanece no vencimento", () => {
      const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
        [
          ctx(2026, [
            arRow({ dueDate: DUE, settlementDate: new Date(2026, 7, 2), amountReceived: 100 }),
          ], [
            apRow({ dueDate: DUE, paymentDate: new Date(2026, 7, 2), amountPayable: 100, amountPaid: 100, balancePayable: 0 }),
          ]),
        ],
        POLICY
      );
      assert.deepEqual(inputs.receivables, [{ settlementDate: "2026-08-02", amountReceived: 100 }]);
      assert.deepEqual(inputs.payables, [{ dueDate: null, paymentDate: "2026-08-05", amountPaid: 100 }]);
    });

    it("R07 — o título CR não reaparece na data real da baixa quando dentro da tolerância (não duplica)", () => {
      const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
        [
          ctx(2026, [
            arRow({ dueDate: DUE, settlementDate: new Date(2026, 7, 7), amountReceived: 100 }),
          ], []),
        ],
        POLICY
      );
      // Só UMA entrada, em D — nenhuma entrada em 07/08 (a data real da baixa).
      assert.equal(inputs.receivables.length, 1);
      assert.equal(inputs.receivables[0]!.settlementDate, "2026-08-05");
    });
  });

  it("CP ignora política ligada: baixa meses depois ainda conta no vencimento", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
      [
        ctx(2026, [], [
          apRow({
            dueDate: new Date(2026, 0, 1),
            paymentDate: new Date(2026, 5, 30),
            amountPayable: 700,
            amountPaid: 700,
            balancePayable: 0,
          }),
        ]),
      ],
      POLICY
    );
    assert.deepEqual(inputs.payables, [
      { dueDate: null, paymentDate: "2026-01-01", amountPaid: 700 },
    ]);
  });

  it("política LEGACY (desligada) preserva o comportamento histórico do AP: sempre dueDate, mesmo além de qualquer tolerância", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
      [
        ctx(2026, [], [
          apRow({
            dueDate: new Date(2026, 0, 1),
            paymentDate: new Date(2026, 5, 30),
            amountPayable: 700,
            amountPaid: 700,
            balancePayable: 0,
          }),
        ]),
      ],
      FINANCE_SETTLEMENT_RECONCILIATION_LEGACY
    );
    assert.deepEqual(inputs.payables, [
      { dueDate: null, paymentDate: "2026-01-01", amountPaid: 700 },
    ]);
  });
});

describe("overlay histórico mensal AR — Tesouraria", () => {
  it("default NÃO aplica o overlay (dias/regra dos 3 dias intactos)", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
      [
        ctx(2026, [
          arRow({
            dueDate: new Date(2025, 11, 1),
            settlementDate: new Date(2026, 1, 5),
            amountReceived: 100,
          }),
        ], []),
      ],
      POLICY
    );
    assert.deepEqual(inputs.receivables, [
      { settlementDate: "2026-02-05", amountReceived: 100 },
    ]);
  });

  it("historicalMonthlyAttribution: lote >15 vai ao dueDate; ano 2026 perde o título de 2025", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
      [
        ctx(2026, [
          arRow({
            dueDate: new Date(2025, 11, 1),
            settlementDate: new Date(2026, 1, 5),
            amountReceived: 100,
          }),
        ], []),
      ],
      POLICY,
      { historicalMonthlyAttribution: true }
    );
    assert.deepEqual(inputs.receivables, []);
  });

  it("D+1 / D+2 / D+3 continuam na regra canônica mesmo com overlay ligado", () => {
    const DUE = new Date(2026, 7, 5);
    for (const [label, settled] of [
      ["D+1", new Date(2026, 7, 6)],
      ["D+2", new Date(2026, 7, 7)],
      ["D+3", new Date(2026, 7, 8)],
    ] as const) {
      const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
        [ctx(2026, [arRow({ dueDate: DUE, settlementDate: settled, amountReceived: 100 })], [])],
        POLICY,
        { historicalMonthlyAttribution: true }
      );
      assert.deepEqual(
        inputs.receivables,
        [{ settlementDate: "2026-08-05", amountReceived: 100 }],
        label
      );
    }
  });

  it("lag >15 fora dos quatro dias permanece na data efetiva normal", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
      [
        ctx(2026, [
          arRow({
            dueDate: new Date(2026, 0, 1),
            settlementDate: new Date(2026, 1, 20),
            amountReceived: 300,
          }),
        ], []),
      ],
      POLICY,
      { historicalMonthlyAttribution: true }
    );
    assert.deepEqual(inputs.receivables, [
      { settlementDate: "2026-02-20", amountReceived: 300 },
    ]);
  });

  it("AP permanece idêntico com overlay ligado", () => {
    const ap = [
      apRow({
        dueDate: new Date(2026, 1, 10),
        paymentDate: new Date(2026, 1, 20),
        amountPayable: 50,
        amountPaid: 50,
        balancePayable: 0,
      }),
    ];
    const without = buildTreasuryCaixaCanonicalRealizedInputs(
      [ctx(2026, [], ap)],
      POLICY
    );
    const withOverlay = buildTreasuryCaixaCanonicalRealizedInputs(
      [ctx(2026, [], ap)],
      POLICY,
      { historicalMonthlyAttribution: true }
    );
    assert.deepEqual(withOverlay.payables, without.payables);
    assert.deepEqual(withOverlay.payables, [
      { dueDate: null, paymentDate: "2026-02-10", amountPaid: 50 },
    ]);
  });

  it("deltas mensais: lote histórico sai de Fev e não duplica; título 20/02 fica", () => {
    const contexts = [
      ctx(2026, [
        arRow({
          dueDate: new Date(2025, 11, 6),
          settlementDate: new Date(2026, 1, 5),
          amountReceived: 100,
        }),
        arRow({
          dueDate: new Date(2026, 0, 31),
          settlementDate: new Date(2026, 1, 2),
          amountReceived: 200,
        }),
        arRow({
          dueDate: new Date(2026, 0, 1),
          settlementDate: new Date(2026, 1, 20),
          amountReceived: 300,
        }),
      ], []),
    ];
    const deltas = computeTreasuryCaixaHistoricalArMonthlyInflowDeltas(
      contexts,
      POLICY
    );
    assert.equal(deltas["2026-02"], -100);
    assert.equal(deltas["2026-01"], undefined);
    assert.equal(Object.keys(deltas).includes("2026-02"), true);
  });
});
