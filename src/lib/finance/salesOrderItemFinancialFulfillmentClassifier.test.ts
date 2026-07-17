/**
 * FIN-03 — testes do classificador canônico de atendimento financeiro do item.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySalesOrderItemFinancialFulfillment,
  classifySalesOrderItemFinancialFulfillmentFromParsed,
} from "./salesOrderItemFinancialFulfillmentClassifier.js";
import { parseNomusSalesOrderItemStatus } from "@/src/lib/sales/nomusSalesOrderItemStatus.js";

describe("classifySalesOrderItemFinancialFulfillment — status conhecidos", () => {
  it("1 / PENDING → NOT_FULFILLED com obrigação futura", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: 1,
      orderedQuantity: 10,
      fulfilledQuantity: 0,
    });
    assert.equal(r.classification, "NOT_FULFILLED");
    assert.equal(r.remainingQuantity, 10);
    assert.equal(r.hasFutureObligation, true);
    assert.equal(r.isCut, false);
    assert.equal(r.evidence.statusNormalized, "PENDING");
  });

  it("2 / RELEASED → NOT_FULFILLED", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: 2,
      orderedQuantity: 8,
      fulfilledQuantity: 0,
    });
    assert.equal(r.classification, "NOT_FULFILLED");
    assert.equal(r.hasFutureObligation, true);
    assert.equal(r.evidence.statusNormalized, "RELEASED");
  });

  it("3 / PARTIAL → PARTIALLY_FULFILLED com saldo residual", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: 3,
      orderedQuantity: 100,
      fulfilledQuantity: 40,
    });
    assert.equal(r.classification, "PARTIALLY_FULFILLED");
    assert.equal(r.remainingQuantity, 60);
    assert.equal(r.hasFutureObligation, true);
    assert.equal(r.isCut, false);
  });

  it("texto Atendido parcialmente → PARTIALLY_FULFILLED", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: "Atendido parcialmente",
      orderedQuantity: 50,
      fulfilledQuantity: 20,
    });
    assert.equal(r.classification, "PARTIALLY_FULFILLED");
    assert.equal(r.remainingQuantity, 30);
    assert.equal(r.hasFutureObligation, true);
  });

  it("4 / FULFILLED → FULLY_FULFILLED residual zero", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: 4,
      orderedQuantity: 8,
      fulfilledQuantity: 8,
    });
    assert.equal(r.classification, "FULLY_FULFILLED");
    assert.equal(r.remainingQuantity, 0);
    assert.equal(r.hasFutureObligation, false);
    assert.equal(r.isCut, false);
  });

  it("texto Atendido totalmente → FULLY_FULFILLED", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: "Atendido totalmente",
      orderedQuantity: 5,
      fulfilledQuantity: 5,
    });
    assert.equal(r.classification, "FULLY_FULFILLED");
  });

  it("5 / FULFILLED_WITH_CUT → corte oficial, residual zero", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: 5,
      orderedQuantity: 100,
      fulfilledQuantity: 60,
    });
    assert.equal(r.classification, "FULFILLED_WITH_CUT");
    assert.equal(r.isCut, true);
    assert.equal(r.remainingQuantity, 0);
    assert.equal(r.hasFutureObligation, false);
    assert.equal(r.evidence.cutByOfficialStatus, true);
  });

  it("texto Atendido com corte → FULFILLED_WITH_CUT", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: "Atendido com corte",
      orderedQuantity: 10,
      fulfilledQuantity: 7,
    });
    assert.equal(r.classification, "FULFILLED_WITH_CUT");
    assert.equal(r.isCut, true);
    assert.equal(r.remainingQuantity, 0);
  });

  it("6 / CANCELED → residual zero sem obrigação", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: 6,
      orderedQuantity: 16.5,
      fulfilledQuantity: 0,
    });
    assert.equal(r.classification, "CANCELED");
    assert.equal(r.remainingQuantity, 0);
    assert.equal(r.hasFutureObligation, false);
    assert.equal(r.isCut, false);
  });

  it("flag nomusIsCanceled força CANCELED", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: 2,
      nomusIsCanceled: true,
      orderedQuantity: 4,
      fulfilledQuantity: 0,
    });
    assert.equal(r.classification, "CANCELED");
    assert.equal(r.remainingQuantity, 0);
  });
});

describe("classifySalesOrderItemFinancialFulfillment — quantidade parcial e excesso", () => {
  it("parcial com qty: remaining = ordered − fulfilled", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      statusNormalized: "PARTIAL",
      orderedQuantity: 200,
      fulfilledQuantity: 50,
    });
    assert.equal(r.classification, "PARTIALLY_FULFILLED");
    assert.equal(r.orderedQuantity, 200);
    assert.equal(r.fulfilledQuantity, 50);
    assert.equal(r.remainingQuantity, 150);
    assert.equal(r.hasFutureObligation, true);
  });

  it("fulfilled > ordered marca inconsistência e não inventa corte", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: 4,
      orderedQuantity: 10,
      fulfilledQuantity: 15,
    });
    assert.equal(r.classification, "FULLY_FULFILLED");
    assert.equal(r.evidence.quantityInconsistency, true);
    assert.equal(r.isCut, false);
    assert.equal(r.remainingQuantity, 0);
    assert.match(r.reason, /inconsistência/i);
  });

  it("shortfall de quantidade sem status 5 não é corte", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: 2,
      orderedQuantity: 100,
      fulfilledQuantity: 40,
      nomusIsCut: true,
    });
    assert.equal(r.classification, "NOT_FULFILLED");
    assert.equal(r.isCut, false);
    assert.equal(r.evidence.cutByOfficialStatus, false);
    assert.equal(r.evidence.quantityShortfallWithoutCutStatus, true);
  });
});

describe("classifySalesOrderItemFinancialFulfillment — ausência de quantidade", () => {
  it("sem quantidades: status parcial mantém obrigação; remaining null", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: 3,
    });
    assert.equal(r.classification, "PARTIALLY_FULFILLED");
    assert.equal(r.orderedQuantity, null);
    assert.equal(r.fulfilledQuantity, null);
    assert.equal(r.remainingQuantity, null);
    assert.equal(r.hasFutureObligation, true);
  });

  it("só ordered em não atendido: remaining = ordered", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: "Liberado",
      orderedQuantity: 12,
    });
    assert.equal(r.classification, "NOT_FULFILLED");
    assert.equal(r.remainingQuantity, 12);
  });
});

describe("classifySalesOrderItemFinancialFulfillment — quantidade negativa", () => {
  it("bloqueia ordered negativo", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: 2,
      orderedQuantity: -5,
      fulfilledQuantity: 0,
    });
    assert.equal(r.evidence.negativeQuantityBlocked, true);
    assert.equal(r.orderedQuantity, null);
    assert.equal(r.remainingQuantity, null);
    assert.equal(r.classification, "NOT_FULFILLED");
  });

  it("bloqueia fulfilled negativo", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: 3,
      orderedQuantity: 10,
      fulfilledQuantity: -1,
    });
    assert.equal(r.evidence.negativeQuantityBlocked, true);
    assert.equal(r.fulfilledQuantity, null);
    assert.equal(r.remainingQuantity, null);
  });
});

describe("classifySalesOrderItemFinancialFulfillment — UNKNOWN", () => {
  it("código não mapeado → UNKNOWN com alerta; não é corte", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: 99,
      orderedQuantity: 30,
      fulfilledQuantity: 10,
    });
    assert.equal(r.classification, "UNKNOWN");
    assert.equal(r.isCut, false);
    assert.equal(r.hasFutureObligation, true);
    assert.equal(r.remainingQuantity, 20);
    assert.equal(r.evidence.classificationPendingAlert, true);
    assert.match(r.reason, /provisória|classificação pendente/i);
  });

  it("UNKNOWN nunca zera residual silenciosamente quando há ordered", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      status: "???",
      orderedQuantity: 7,
    });
    assert.equal(r.classification, "UNKNOWN");
    assert.equal(r.remainingQuantity, 7);
    assert.equal(r.hasFutureObligation, true);
  });

  it("diff de qty em UNKNOWN não vira FULFILLED_WITH_CUT", () => {
    const r = classifySalesOrderItemFinancialFulfillment({
      statusNormalized: "UNKNOWN",
      orderedQuantity: 100,
      fulfilledQuantity: 60,
      nomusIsCut: true,
    });
    assert.equal(r.classification, "UNKNOWN");
    assert.equal(r.isCut, false);
    assert.equal(r.evidence.quantityShortfallWithoutCutStatus, true);
  });
});

describe("classifySalesOrderItemFinancialFulfillmentFromParsed", () => {
  it("integra parser oficial PD-style cancelado e corte", () => {
    const canceled = classifySalesOrderItemFinancialFulfillmentFromParsed(
      parseNomusSalesOrderItemStatus({
        status: 6,
        quantidade: 16.5,
        valorUnitario: 1,
      })
    );
    assert.equal(canceled.classification, "CANCELED");
    assert.equal(canceled.remainingQuantity, 0);

    const cut = classifySalesOrderItemFinancialFulfillmentFromParsed(
      parseNomusSalesOrderItemStatus({
        status: 5,
        quantidade: 100,
        quantidadeAtendida: 60,
        valorUnitario: 1,
      })
    );
    assert.equal(cut.classification, "FULFILLED_WITH_CUT");
    assert.equal(cut.isCut, true);
    assert.equal(cut.remainingQuantity, 0);
  });
});
