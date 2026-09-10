import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceArReceivedDecompositionReport,
  buildFinanceArReceivedDecompositionTitle,
  financeArReceivedDecompositionHasDivergence,
  type FinanceArReceivedDecompositionRow,
} from "./financeArReceivedDecomposition.js";
import type { FinanceReceiptEvent } from "./financeReceiptsCanonical.js";

function row(overrides: Partial<FinanceArReceivedDecompositionRow> = {}): FinanceArReceivedDecompositionRow {
  return {
    externalId: 1,
    personName: "Cliente X",
    personCnpj: "12.345.678/0001-90",
    amountReceivable: 1000,
    amountReceived: 1000,
    balanceReceivable: 0,
    ...overrides,
  };
}

function event(overrides: Partial<FinanceReceiptEvent> = {}): FinanceReceiptEvent {
  return {
    receiptExternalId: 1,
    receivableExternalId: 1,
    receiptDate: "2026-08-15",
    receivedAmount: 1000,
    bankFeeAmount: 0,
    lateFeeInterestAmount: 0,
    discountAmount: 0,
    closesReceivable: true,
    ...overrides,
  };
}

describe("financeArReceivedDecomposition — título individual", () => {
  it("título consistente: as duas decomposições batem em zero", () => {
    const t = buildFinanceArReceivedDecompositionTitle(row(), [event()]);
    assert.equal(t.decompositionAInternal, 0);
    assert.equal(t.decompositionBAgainstReceipts, 0);
    assert.equal(financeArReceivedDecompositionHasDivergence(t), false);
  });

  it("decomposição (a): amountReceived não bate com (amountReceivable - balance) — inconsistência interna do próprio CR", () => {
    // Nomus diz amountReceived=900, mas amountReceivable-balance implica 1000.
    const t = buildFinanceArReceivedDecompositionTitle(
      row({ amountReceivable: 1000, amountReceived: 900, balanceReceivable: 0 }),
      [event({ receivedAmount: 900 })]
    );
    assert.equal(t.decompositionAInternal, -100);
    // (b) continua batendo — o receipt real confere com amountReceived.
    assert.equal(t.decompositionBAgainstReceipts, 0);
    assert.equal(financeArReceivedDecompositionHasDivergence(t), true);
  });

  it("decomposição (b): amountReceived não bate com a soma dos receipts reais — gap de sincronização", () => {
    const t = buildFinanceArReceivedDecompositionTitle(row(), [event({ receivedAmount: 850 })]);
    assert.equal(t.decompositionAInternal, 0);
    assert.equal(t.sumRealReceipts, 850);
    assert.equal(t.decompositionBAgainstReceipts, 150);
    assert.equal(financeArReceivedDecompositionHasDivergence(t), true);
  });

  it("caso LIVE CR 19363: receipt real R$2.548,35 vs amountReceivable R$2.548,20 — diferença de +R$0,15, nunca classificada como juros sem prova", () => {
    const t = buildFinanceArReceivedDecompositionTitle(
      row({
        externalId: 19363,
        amountReceivable: 2548.2,
        amountReceived: 2548.35,
        balanceReceivable: 0,
      }),
      [event({ receivableExternalId: 19363, receivedAmount: 2548.35 })]
    );
    // amountReceived já reflete o valor do receipt — (b) bate.
    assert.equal(t.decompositionBAgainstReceipts, 0);
    // A diferença de +R$0,15 aparece contra o amountReceivable original, não
    // contra o receipt — o instrumento mostra os campos crus para julgamento:
    assert.equal(Math.round((t.amountReceived - t.amountReceivable) * 100) / 100, 0.15);
    // Sem prova nos campos de composição do receipt: nunca chamar de juros.
    assert.equal(t.receiptsFeeComposition?.lateFeeInterestAmount, 0);
    assert.equal(t.receiptsFeeComposition?.discountAmount, 0);
    assert.equal(t.receiptsFeeComposition?.bankFeeAmount, 0);
  });

  it("título baixado sem NENHUM receipt local: (b) expõe o gap inteiro, fee composition é null (nunca 0 fictício)", () => {
    const t = buildFinanceArReceivedDecompositionTitle(row({ amountReceived: 1000 }), []);
    assert.equal(t.receiptCount, 0);
    assert.equal(t.sumRealReceipts, 0);
    assert.equal(t.decompositionBAgainstReceipts, 1000);
    assert.equal(t.receiptsFeeComposition, null);
  });

  it("juros/desconto/taxa aparecem separados — a decomposição (b) soma só receivedAmount, nunca embute juros/desconto/taxa por conta própria", () => {
    // amountReceived (1015,50) inclui os R$15,50 de juros que o ERP já
    // contabilizou; sumRealReceipts soma só receivedAmount (1000) do receipt —
    // a decomposição (b) EXPÕE esses R$15,50 como gap explicável, em vez de
    // escondê-los somando juros dentro do "caixa recebido".
    const t = buildFinanceArReceivedDecompositionTitle(row({ amountReceived: 1015.5 }), [
      event({ receivedAmount: 1000, lateFeeInterestAmount: 15.5 }),
    ]);
    assert.equal(t.sumRealReceipts, 1000);
    assert.equal(t.decompositionBAgainstReceipts, 15.5);
    assert.equal(t.receiptsFeeComposition?.lateFeeInterestAmount, 15.5);
    // A diferença bate exatamente com o juros registrado no receipt — dado
    // que PROVA a classificação (diferente do CR 19363, onde não há prova).
    assert.equal(t.decompositionBAgainstReceipts, t.receiptsFeeComposition?.lateFeeInterestAmount);
  });
});

describe("financeArReceivedDecomposition — relatório da coorte (caso R$563,54)", () => {
  it("reproduz a equação exata do caso real: amountReceived − (original − saldo) = diferença agregada", () => {
    // Reconstituição minimalista e proporcional do caso real (qtd=203,
    // original=1.302.947,31, amountReceived=1.271.862,57, saldo=31.648,28,
    // diferença=563,54) com 2 títulos: um perfeitamente consistente e um que
    // sozinho carrega a diferença — a equação da coorte é o que se testa,
    // não os números absolutos do caso de produção.
    const rows = [
      row({ externalId: 1, amountReceivable: 1000, amountReceived: 1000, balanceReceivable: 0 }),
      row({ externalId: 2, amountReceivable: 2000, amountReceived: 1563.54, balanceReceivable: 500 }),
    ];
    const receiptsByReceivable = new Map<number, FinanceReceiptEvent[]>([
      [1, [event({ receivableExternalId: 1, receivedAmount: 1000 })]],
      [2, [event({ receivableExternalId: 2, receivedAmount: 1500 })]],
    ]);
    const report = buildFinanceArReceivedDecompositionReport(rows, receiptsByReceivable, {
      year: 2026,
      month: 8,
      limit: 500,
      includeAll: true,
    });
    assert.equal(report.totais.valorOriginalTotal, 3000);
    assert.equal(report.totais.amountReceivedAcumuladoTotal, 2563.54);
    assert.equal(report.totais.saldoTotal, 500);
    // amountReceived − (original − saldo) = 2563.54 − (3000 − 500) = 63.54
    assert.equal(report.totais.diferencaDecomposicaoATotal, 63.54);
    // amountReceived − Σ receipts = 2563.54 − 2500 = 63.54 (mesmo título carrega as duas)
    assert.equal(report.totais.diferencaDecomposicaoBTotal, 63.54);
  });

  it("filtra só os títulos divergentes por padrão; --all inclui todos", () => {
    const rows = [
      row({ externalId: 1 }), // consistente
      row({ externalId: 2, amountReceived: 900 }), // divergente
    ];
    const receiptsByReceivable = new Map<number, FinanceReceiptEvent[]>([
      [1, [event({ receivableExternalId: 1, receivedAmount: 1000 })]],
      [2, [event({ receivableExternalId: 2, receivedAmount: 1000 })]],
    ]);
    const onlyDivergent = buildFinanceArReceivedDecompositionReport(rows, receiptsByReceivable, {
      year: 2026,
      month: 8,
      limit: 500,
      includeAll: false,
    });
    assert.equal(onlyDivergent.titulos.length, 1);
    assert.equal(onlyDivergent.titulos[0]!.externalId, 2);
    assert.equal(onlyDivergent.titulosComDivergenciaQtd, 1);
    assert.equal(onlyDivergent.populacaoQtdTitulos, 2);

    const all = buildFinanceArReceivedDecompositionReport(rows, receiptsByReceivable, {
      year: 2026,
      month: 8,
      limit: 500,
      includeAll: true,
    });
    assert.equal(all.titulos.length, 2);
  });

  it("ordena os títulos listados pela magnitude da decomposição (b), maior gap primeiro", () => {
    const rows = [
      row({ externalId: 1, amountReceived: 1010 }), // gap pequeno
      row({ externalId: 2, amountReceived: 1500 }), // gap grande
    ];
    const receiptsByReceivable = new Map<number, FinanceReceiptEvent[]>([
      [1, [event({ receivableExternalId: 1, receivedAmount: 1000 })]],
      [2, [event({ receivableExternalId: 2, receivedAmount: 1000 })]],
    ]);
    const report = buildFinanceArReceivedDecompositionReport(rows, receiptsByReceivable, {
      year: 2026,
      month: 8,
      limit: 500,
      includeAll: true,
    });
    assert.deepEqual(
      report.titulos.map((t) => t.externalId),
      [2, 1]
    );
  });

  it("nunca tenta zerar a diferença: o total agregado reflete exatamente a soma por título, sem ajuste", () => {
    const rows = [row({ externalId: 1, amountReceived: 1300 })];
    const receiptsByReceivable = new Map<number, FinanceReceiptEvent[]>([
      [1, [event({ receivableExternalId: 1, receivedAmount: 1000 })]],
    ]);
    const report = buildFinanceArReceivedDecompositionReport(rows, receiptsByReceivable, {
      year: 2026,
      month: 8,
      limit: 500,
      includeAll: true,
    });
    assert.equal(report.totais.diferencaDecomposicaoBTotal, 300);
    assert.equal(report.titulos[0]!.decompositionBAgainstReceipts, 300);
  });
});
