/**
 * Realizado da linha do tempo da Caixa: conversão dos conjuntos canônicos do
 * Fluxo de Caixa (por ano) em entradas de dia, usando a MESMA autoridade de
 * data efetiva (`resolveFinanceEffectiveSettlementDate`, regra dos N dias)
 * que o motor único-de-dia e o fluxo de HOJE já usam — não mais a regra
 * antiga (CR por settlementDate cru; CP sempre por vencimento).
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

  // ── Regra final: D <= S <= D+3 → atribui SEMPRE a D (R01-R06) ───────────
  describe("regra dos N dias — dueDate=05/08, valor 100 (R01-R06)", () => {
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

    it("R02 — baixa em D+1 conta em D, nunca em D+1", () => {
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

    it("R03 — baixa em D+2 conta em D", () => {
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

    it("R04 — baixa em D+3 (limite da tolerância) conta em D", () => {
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

    it("R05 — baixa ALÉM da tolerância (D+4) preserva a política existente: conta na data REAL da baixa, não em D", () => {
      const inputs = buildTreasuryCaixaCanonicalRealizedInputs(
        [
          ctx(2026, [
            arRow({ dueDate: DUE, settlementDate: new Date(2026, 7, 9), amountReceived: 100 }),
          ], [
            apRow({ dueDate: DUE, paymentDate: new Date(2026, 7, 9), amountPayable: 100, amountPaid: 100, balancePayable: 0 }),
          ]),
        ],
        POLICY
      );
      assert.deepEqual(inputs.receivables, [{ settlementDate: "2026-08-09", amountReceived: 100 }]);
      assert.deepEqual(inputs.payables, [{ dueDate: null, paymentDate: "2026-08-09", amountPaid: 100 }]);
    });

    it("R06 — baixa ANTECIPADA (antes de D) preserva a política existente: conta na data REAL da baixa, não em D", () => {
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
      assert.deepEqual(inputs.payables, [{ dueDate: null, paymentDate: "2026-08-02", amountPaid: 100 }]);
    });

    it("R07 — o título não reaparece na data real da baixa quando dentro da tolerância (não duplica)", () => {
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
