/**
 * Realizado da linha do tempo da Caixa = MESMAS regras da "Linha do tempo
 * mensal" do Fluxo de Caixa. Estes testes cobrem a parte pura da ponte:
 * anos da cadeia e a conversão dos conjuntos canônicos em entradas de dia
 * (CR pela baixa, CP pela data canônica = vencimento, recorte no ano civil).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
} from "@/src/lib/financeCashFlowDashboard.js";
import type { FinanceCashFlowCanonicalRealizedYearSets } from "@/src/lib/finance/financeCashFlowCanonicalRealized.server.js";
import {
  buildTreasuryCaixaCanonicalRealizedInputs,
  resolveTreasuryCaixaChainYears,
} from "./treasuryCaixaService.server.js";

function arRow(over: Partial<FinanceCashFlowArRow>): FinanceCashFlowArRow {
  return {
    settlementDate: null,
    amountReceived: 0,
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
  it("CR entra no dia da BAIXA (recebimento adiantado/atrasado cai no dia real do dinheiro)", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs([
      ctx(
        2026,
        [
          arRow({
            settlementDate: new Date(2026, 1, 10),
            amountReceived: 1500.5,
          }),
        ],
        []
      ),
    ]);
    assert.deepEqual(inputs.receivables, [
      { settlementDate: "2026-02-10", amountReceived: 1500.5 },
    ]);
  });

  it("CR sem baixa ou com valor zero não vira dia", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs([
      ctx(
        2026,
        [
          arRow({ settlementDate: null, amountReceived: 100 }),
          arRow({ settlementDate: new Date(2026, 2, 1), amountReceived: 0 }),
        ],
        []
      ),
    ]);
    assert.deepEqual(inputs.receivables, []);
  });

  it("baixa fora do ano do contexto fica fora — mesmo recorte da tabela anual do Fluxo", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs([
      ctx(
        2026,
        [
          // Título do ano 2026 baixado só em jan/2027: a tabela de 2026 do
          // Fluxo não o mostra (nenhum mês de 2026 contém a baixa).
          arRow({
            settlementDate: new Date(2027, 0, 5),
            amountReceived: 999,
          }),
        ],
        []
      ),
    ]);
    assert.deepEqual(inputs.receivables, []);
  });

  it("CP entra pela data canônica (vencimento) com o valor realizado", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs([
      ctx(2026, [], [
        apRow({
          dueDate: new Date(2026, 2, 15),
          amountPayable: 800,
          amountPaid: 800,
          balancePayable: 0,
        }),
      ]),
    ]);
    assert.deepEqual(inputs.payables, [
      { dueDate: null, paymentDate: "2026-03-15", amountPaid: 800 },
    ]);
  });

  it("CP quitado sem amountPaid informado realiza pelo amountPayable (regra canônica)", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs([
      ctx(2026, [], [
        apRow({
          dueDate: new Date(2026, 4, 2),
          amountPayable: 1200,
          amountPaid: 0,
          balancePayable: 0,
        }),
      ]),
    ]);
    assert.deepEqual(inputs.payables, [
      { dueDate: null, paymentDate: "2026-05-02", amountPaid: 1200 },
    ]);
  });

  it("CP cancelado ou em aberto (nada realizado) não vira saída", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs([
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
    ]);
    assert.deepEqual(inputs.payables, []);
  });

  it("vários anos de contexto se somam, cada um com o próprio recorte", () => {
    const inputs = buildTreasuryCaixaCanonicalRealizedInputs([
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
    ]);
    assert.deepEqual(inputs.receivables, [
      { settlementDate: "2026-07-01", amountReceived: 10 },
      { settlementDate: "2027-01-02", amountReceived: 20 },
    ]);
  });
});
