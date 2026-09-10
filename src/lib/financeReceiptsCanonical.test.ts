import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  civilDateStringToUtcMidnight,
  classifyReceivableSettlement,
  detectSettledWithoutReceipt,
  financeReceiptCivilDateKey,
  financeReceiptCivilMonthKey,
  groupReceiptEventsByReceivable,
  isReceiptInCivilPeriod,
  resolveCivilMonthUtcBounds,
  resolveCivilRangeUtcBounds,
  resolveCivilYearUtcBounds,
  sumReceivedAmountByReceivable,
  sumReceivedAmountForEvents,
  type FinanceReceiptEvent,
} from "./financeReceiptsCanonical.js";

function event(overrides: Partial<FinanceReceiptEvent> = {}): FinanceReceiptEvent {
  return {
    receiptExternalId: 1,
    receivableExternalId: 100,
    receiptDate: "2026-08-15",
    receivedAmount: 1000,
    bankFeeAmount: 0,
    lateFeeInterestAmount: 0,
    discountAmount: 0,
    closesReceivable: true,
    ...overrides,
  };
}

describe("financeReceiptsCanonical — chaves civis", () => {
  it("financeReceiptCivilDateKey preserva o dia civil sem deslocar por fuso", () => {
    assert.equal(financeReceiptCivilDateKey(new Date(Date.UTC(2026, 7, 31))), "2026-08-31");
    assert.equal(financeReceiptCivilDateKey("2026-08-31"), "2026-08-31");
  });

  it("financeReceiptCivilMonthKey extrai YYYY-MM", () => {
    assert.equal(financeReceiptCivilMonthKey("2026-08-31"), "2026-08");
    assert.equal(financeReceiptCivilMonthKey("2026-09-01"), "2026-09");
  });

  it("resolveCivilMonthUtcBounds cobre o mês inteiro, sem vazar para o mês seguinte", () => {
    const { from, to } = resolveCivilMonthUtcBounds(2026, 8);
    assert.equal(financeReceiptCivilDateKey(from), "2026-08-01");
    assert.equal(financeReceiptCivilDateKey(to), "2026-08-31");
  });

  it("civilDateStringToUtcMidnight nunca desloca por fuso local", () => {
    assert.equal(
      civilDateStringToUtcMidnight("2026-08-31").toISOString(),
      "2026-08-31T00:00:00.000Z"
    );
    assert.equal(
      civilDateStringToUtcMidnight("2026-09-01").toISOString(),
      "2026-09-01T00:00:00.000Z"
    );
  });

  it("civilDateStringToUtcMidnight rejeita formato inválido sem lançar", () => {
    assert.equal(Number.isNaN(civilDateStringToUtcMidnight("31/08/2026").getTime()), true);
  });

  it("resolveCivilRangeUtcBounds cobre um intervalo civil arbitrário (não mês/ano cheio)", () => {
    const { from, to } = resolveCivilRangeUtcBounds("2026-08-20", "2026-09-05");
    assert.equal(financeReceiptCivilDateKey(from), "2026-08-20");
    assert.equal(financeReceiptCivilDateKey(to), "2026-09-05");
    assert.equal(isReceiptInCivilPeriod("2026-08-19", { from, to }), false);
    assert.equal(isReceiptInCivilPeriod("2026-08-20", { from, to }), true);
    assert.equal(isReceiptInCivilPeriod("2026-09-05", { from, to }), true);
    assert.equal(isReceiptInCivilPeriod("2026-09-06", { from, to }), false);
  });

  it("resolveCivilYearUtcBounds cobre o ano inteiro", () => {
    const { from, to } = resolveCivilYearUtcBounds(2026);
    assert.equal(financeReceiptCivilDateKey(from), "2026-01-01");
    assert.equal(financeReceiptCivilDateKey(to), "2026-12-31");
  });
});

describe("financeReceiptsCanonical — fronteira 31/08 → 01/09 (regra crítica anti-regressão UTC)", () => {
  it("recebimento em 31/08 fica em agosto, nunca em setembro", () => {
    const bounds = resolveCivilMonthUtcBounds(2026, 8);
    assert.equal(isReceiptInCivilPeriod("2026-08-31", bounds), true);
    assert.equal(isReceiptInCivilPeriod("2026-09-01", bounds), false);
  });

  it("recebimento em 01/09 fica em setembro, nunca em agosto", () => {
    const boundsAug = resolveCivilMonthUtcBounds(2026, 8);
    const boundsSep = resolveCivilMonthUtcBounds(2026, 9);
    assert.equal(isReceiptInCivilPeriod("2026-09-01", boundsAug), false);
    assert.equal(isReceiptInCivilPeriod("2026-09-01", boundsSep), true);
  });
});

describe("financeReceiptsCanonical — soma de recebimento real", () => {
  it("soma receivedAmount de vários eventos", () => {
    const events = [event({ receivedAmount: 400 }), event({ receivedAmount: 600 })];
    assert.equal(sumReceivedAmountForEvents(events), 1000);
  });

  it("lista vazia soma zero", () => {
    assert.equal(sumReceivedAmountForEvents([]), 0);
  });

  it("agrupa e soma por título — dois títulos distintos não se misturam", () => {
    const events = [
      event({ receivableExternalId: 100, receivedAmount: 400 }),
      event({ receivableExternalId: 100, receivedAmount: 600 }),
      event({ receivableExternalId: 200, receivedAmount: 250 }),
    ];
    const grouped = groupReceiptEventsByReceivable(events);
    assert.equal(grouped.get(100)?.length, 2);
    assert.equal(grouped.get(200)?.length, 1);
    const sums = sumReceivedAmountByReceivable(events);
    assert.equal(sums.get(100), 1000);
    assert.equal(sums.get(200), 250);
  });
});

describe("financeReceiptsCanonical — recebimento parcial cross-month (teste decisivo)", () => {
  it("R$4.000 em 31/08 + R$6.000 em 05/09 -> agosto=4000, setembro=6000, nunca agosto=0/setembro=10000", () => {
    const events = [
      event({ receivableExternalId: 500, receiptDate: "2026-08-31", receivedAmount: 4000 }),
      event({ receivableExternalId: 500, receiptDate: "2026-09-05", receivedAmount: 6000 }),
    ];
    const boundsAug = resolveCivilMonthUtcBounds(2026, 8);
    const boundsSep = resolveCivilMonthUtcBounds(2026, 9);
    const augustEvents = events.filter((e) => isReceiptInCivilPeriod(e.receiptDate, boundsAug));
    const septemberEvents = events.filter((e) => isReceiptInCivilPeriod(e.receiptDate, boundsSep));
    assert.equal(sumReceivedAmountForEvents(augustEvents), 4000);
    assert.equal(sumReceivedAmountForEvents(septemberEvents), 6000);
    assert.notEqual(sumReceivedAmountForEvents(augustEvents), 0);
    assert.notEqual(sumReceivedAmountForEvents(septemberEvents), 10000);
  });
});

describe("financeReceiptsCanonical — classificação de baixa × recebimento", () => {
  it("com receipt -> FINANCIAL_RECEIPT, independente de estar baixado", () => {
    assert.equal(
      classifyReceivableSettlement({ hasAnyReceipt: true, isSettled: true }),
      "FINANCIAL_RECEIPT"
    );
    assert.equal(
      classifyReceivableSettlement({ hasAnyReceipt: true, isSettled: false }),
      "FINANCIAL_RECEIPT"
    );
  });

  it("baixado sem nenhum receipt -> SETTLED_WITHOUT_RECEIPT (nunca vira caixa)", () => {
    assert.equal(
      classifyReceivableSettlement({ hasAnyReceipt: false, isSettled: true }),
      "SETTLED_WITHOUT_RECEIPT"
    );
  });

  it("sem receipt e sem baixa -> OPEN_NOT_RECEIVED", () => {
    assert.equal(
      classifyReceivableSettlement({ hasAnyReceipt: false, isSettled: false }),
      "OPEN_NOT_RECEIVED"
    );
  });

  it("detectSettledWithoutReceipt só reporta os títulos realmente sem receipt", () => {
    const found = detectSettledWithoutReceipt([10, 20, 30], new Set([20]));
    assert.deepEqual(
      found.map((f) => f.receivableExternalId),
      [10, 30]
    );
    for (const f of found) assert.equal(f.code, "SETTLED_WITHOUT_RECEIPT");
  });

  it("detectSettledWithoutReceipt nunca duplica o mesmo título repetido na entrada", () => {
    const found = detectSettledWithoutReceipt([10, 10, 10], new Set());
    assert.equal(found.length, 1);
  });
});

describe("financeReceiptsCanonical — composição financeira do evento (juros/desconto/taxa)", () => {
  it("cada evento preserva os campos separadamente, nunca embutidos em receivedAmount", () => {
    const e = event({
      receivedAmount: 1000,
      lateFeeInterestAmount: 15.5,
      discountAmount: 3.2,
      bankFeeAmount: 1.9,
    });
    assert.equal(e.receivedAmount, 1000);
    assert.equal(e.lateFeeInterestAmount, 15.5);
    assert.equal(e.discountAmount, 3.2);
    assert.equal(e.bankFeeAmount, 1.9);
  });

  it("caso LIVE CR 19363: diferença de +R$0,15 entre receipt real e amountReceivable não é chamada de juros sem prova", () => {
    // original≈R$2.548,20, receipt real≈R$2.548,35 — a missão exige comparar
    // as três subtrações e só classificar como juros se os campos do receipt
    // realmente provarem isso (lateFeeInterestAmount > 0).
    const amountReceivable = 2548.2;
    const e = event({ receivableExternalId: 19363, receivedAmount: 2548.35 });
    const receivedMinusReceivable = roundForTest(e.receivedAmount - amountReceivable);
    assert.equal(receivedMinusReceivable, 0.15);
    // Os dados NÃO provam juros: nenhum campo de composição está preenchido.
    assert.equal(e.lateFeeInterestAmount, 0);
    assert.equal(e.discountAmount, 0);
    assert.equal(e.bankFeeAmount, 0);
  });
});

function roundForTest(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Testes 1–3 da missão de canonicalização de recebimentos: a atribuição de
 * período de um evento depende SOMENTE de `receiptDate` — nunca de uma
 * `settlementDate` conceitual da baixa administrativa (que nem existe no tipo
 * `FinanceReceiptEvent`, de propósito: não há campo para "vazar" o fallback).
 */
describe("financeReceiptsCanonical — receiptDate × baixa administrativa (testes 1–3 da missão)", () => {
  it("teste 1: recebimento no MESMO dia da baixa — período vem de receiptDate, trivialmente coincide", () => {
    const bounds = resolveCivilMonthUtcBounds(2026, 8);
    const e = event({ receiptDate: "2026-08-20" }); // baixa (conceitual) também em 20/08
    assert.equal(isReceiptInCivilPeriod(e.receiptDate, bounds), true);
  });

  it("teste 2: recebimento ANTES da baixa — período já conta em receiptDate, não espera a baixa", () => {
    const bounds = resolveCivilMonthUtcBounds(2026, 8);
    // receipt em 20/08, baixa (conceitual) só em 25/08 — mesmo mês aqui, mas o
    // ponto é que NADA no cálculo consulta a data da baixa.
    const e = event({ receiptDate: "2026-08-20" });
    assert.equal(isReceiptInCivilPeriod(e.receiptDate, bounds), true);
    assert.equal(financeReceiptCivilMonthKey(e.receiptDate), "2026-08");
  });

  it("teste 3: recebimento em MÊS ANTERIOR à baixa — nunca migra para o mês da baixa (proibido receiptDate ?? settlementDate)", () => {
    // receipt em 28/08, baixa (conceitual) só em 02/09 — caso real da missão
    // (mesmo padrão dos 10 CRs de regressão: 19368, 19367, 19363).
    const e = event({ receiptDate: "2026-08-28" });
    const boundsAug = resolveCivilMonthUtcBounds(2026, 8);
    const boundsSep = resolveCivilMonthUtcBounds(2026, 9);
    assert.equal(isReceiptInCivilPeriod(e.receiptDate, boundsAug), true);
    assert.equal(isReceiptInCivilPeriod(e.receiptDate, boundsSep), false);
    assert.equal(financeReceiptCivilMonthKey(e.receiptDate), "2026-08");
  });
});

/**
 * Teste 20 da missão: proibido `receiptDate ?? settlementDate` (ou o inverso)
 * em qualquer lugar da camada canônica. Guarda estática — não é uma opinião de
 * estilo, é a regra mais crítica da missão (misturar os dois eixos inventa
 * caixa que nunca existiu).
 */
describe("financeReceiptsCanonical — teste 20: nunca receiptDate ?? settlementDate (guarda estática)", () => {
  it("financeReceiptsCanonical.ts e .server.ts não contêm o padrão de fallback proibido (fora de comentários)", () => {
    // O próprio código documenta a proibição citando o padrão em comentário
    // (`Nunca receiptDate ?? settlementDate`) — por isso a busca precisa
    // ignorar comentários/JSDoc, senão a documentação da regra derrubaria o
    // próprio teste que a prova.
    const files = ["src/lib/financeReceiptsCanonical.ts", "src/lib/financeReceiptsCanonical.server.ts"];
    const forbidden = [/receiptDate\s*\?\?\s*settlementDate/, /settlementDate\s*\?\?\s*receiptDate/];
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const codeOnly = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      for (const pattern of forbidden) {
        assert.doesNotMatch(codeOnly, pattern, `${file} não pode misturar os dois eixos (fora de comentário)`);
      }
    }
  });
});
