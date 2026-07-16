import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUDIT_MONEY_CENT_TOLERANCE,
  classifyAllocationCoverage,
  classifyNfeVsReceivablesSum,
  classifyReceivableDueStatus,
  classifyReceivableSettlement,
  compareMoneyCents,
  moneyCentsEqual,
  moneyCentsToNumber,
  resolveFinancialEvidenceWithoutDoubleCount,
  toMoneyCents,
} from "./auditOutputDocumentsFinancial.js";

describe("toMoneyCents / compareMoneyCents", () => {
  it("converte via roundMoney para centavos inteiros", () => {
    assert.equal(toMoneyCents(10.1), 1010);
    assert.equal(toMoneyCents("10,25"), 1025);
    assert.equal(toMoneyCents({ toNumber: () => 1.01 }), 101);
    assert.equal(moneyCentsToNumber(1010), 10.1);
  });

  it("compara com igualdade exata e tolerancia de um centavo", () => {
    assert.equal(AUDIT_MONEY_CENT_TOLERANCE, 1);
    assert.equal(compareMoneyCents(1000, 1000), "equal");
    assert.equal(compareMoneyCents(1000, 1001), "rounding");
    assert.equal(compareMoneyCents(1000, 1002), "less");
    assert.equal(compareMoneyCents(1002, 1000), "greater");
    assert.equal(moneyCentsEqual(1000, 1000), true);
    assert.equal(moneyCentsEqual(1000, 1001, 1), true);
    assert.equal(moneyCentsEqual(1000, 1001, 0), false);
  });
});

describe("classifyAllocationCoverage", () => {
  it("nao alocado quando ha documento sem alocacao", () => {
    const r = classifyAllocationCoverage({
      documentValueCents: 5000,
      allocatedToOrdersCents: 0,
    });
    assert.equal(r.status, "nao_alocado");
    assert.equal(r.differenceCents, 5000);
  });

  it("parcial quando alocacao cobre so parte", () => {
    const r = classifyAllocationCoverage({
      documentValueCents: 10000,
      allocatedToOrdersCents: 4000,
    });
    assert.equal(r.status, "parcial");
    assert.equal(r.differenceCents, 6000);
  });

  it("completo quando iguais", () => {
    const r = classifyAllocationCoverage({
      documentValueCents: 2500,
      allocatedToOrdersCents: 2500,
    });
    assert.equal(r.status, "completo");
    assert.equal(r.differenceCents, 0);
  });

  it("arredondamento quando diferenca e um centavo", () => {
    const r = classifyAllocationCoverage({
      documentValueCents: 10000,
      allocatedToOrdersCents: 9999,
    });
    assert.equal(r.status, "arredondamento");
    assert.equal(Math.abs(r.differenceCents), 1);
  });

  it("superalocado quando alocacao excede documento", () => {
    const r = classifyAllocationCoverage({
      documentValueCents: 10000,
      allocatedToOrdersCents: 12000,
    });
    assert.equal(r.status, "superalocado");
    assert.equal(r.differenceCents, -2000);
  });
});

describe("classifyReceivableSettlement e due", () => {
  it("aberto, parcial e recebido", () => {
    assert.equal(
      classifyReceivableSettlement({
        amountReceivableCents: 10000,
        amountReceivedCents: 0,
        balanceReceivableCents: 10000,
      }).status,
      "aberto"
    );
    assert.equal(
      classifyReceivableSettlement({
        amountReceivableCents: 10000,
        amountReceivedCents: 3000,
        balanceReceivableCents: 7000,
      }).status,
      "parcial"
    );
    assert.equal(
      classifyReceivableSettlement({
        amountReceivableCents: 10000,
        amountReceivedCents: 10000,
        balanceReceivableCents: 0,
      }).status,
      "recebido"
    );
  });

  it("classifica vencido e sem vencimento", () => {
    const ref = new Date(2026, 6, 16);
    assert.equal(
      classifyReceivableDueStatus({
        dueDate: new Date(2026, 6, 10),
        referenceDate: ref,
        settlement: "aberto",
      }),
      "vencido"
    );
    assert.equal(
      classifyReceivableDueStatus({
        dueDate: null,
        referenceDate: ref,
        settlement: "aberto",
      }),
      "sem_vencimento"
    );
    assert.equal(
      classifyReceivableDueStatus({
        dueDate: new Date(2026, 6, 10),
        referenceDate: ref,
        settlement: "recebido",
      }),
      "nao_aplicavel"
    );
  });
});

describe("prevencao de dupla contagem e evidencia", () => {
  it("nao soma Documento + CR da mesma cadeia", () => {
    const r = resolveFinancialEvidenceWithoutDoubleCount({
      receivableCents: 8000,
      documentCents: 8000,
      orderForecastCents: 10000,
    });
    assert.equal(r.wouldDoubleCountIfSummed, true);
    assert.equal(r.coveredByReceivableCents, 8000);
    assert.equal(r.coveredByDocumentIncrementalCents, 0);
    assert.equal(r.dominantCoverageCents, 10000);
    assert.equal(r.coveredByOrderIncrementalCents, 2000);
    assert.equal(r.source, "REAL_RECEIVABLE");
    // Soma ingenua seria 8000+8000=16000 — cobertura dominante nao faz isso.
    assert.ok(r.dominantCoverageCents < 8000 + 8000);
  });

  it("documento so cobre residual alem do CR", () => {
    const r = resolveFinancialEvidenceWithoutDoubleCount({
      receivableCents: 5000,
      documentCents: 8000,
      orderForecastCents: 10000,
    });
    assert.equal(r.source, "MIXED");
    assert.equal(r.coveredByDocumentIncrementalCents, 3000);
    assert.equal(r.coveredByOrderIncrementalCents, 2000);
  });

  it("sem CR usa documento; sem ambos usa previsao do pedido", () => {
    assert.equal(
      resolveFinancialEvidenceWithoutDoubleCount({
        receivableCents: 0,
        documentCents: 7000,
        orderForecastCents: 10000,
      }).source,
      "OUTPUT_DOCUMENT"
    );
    assert.equal(
      resolveFinancialEvidenceWithoutDoubleCount({
        receivableCents: 0,
        documentCents: 0,
        orderForecastCents: 4500,
      }).source,
      "ORDER_PLAN"
    );
  });
});

describe("classifyNfeVsReceivablesSum", () => {
  it("ok, arredondamento e divergente", () => {
    assert.equal(
      classifyNfeVsReceivablesSum({
        nfeValueCents: 15000,
        titlesAmountReceivableCents: 15000,
      }).status,
      "ok"
    );
    assert.equal(
      classifyNfeVsReceivablesSum({
        nfeValueCents: 15000,
        titlesAmountReceivableCents: 15001,
      }).status,
      "arredondamento"
    );
    assert.equal(
      classifyNfeVsReceivablesSum({
        nfeValueCents: 15000,
        titlesAmountReceivableCents: 14000,
      }).status,
      "divergente"
    );
  });
});
