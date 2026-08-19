import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertReasonRequired,
  canEditPurchaseRequestContent,
  PurchaseRequestWorkflowError,
  resolvePurchaseRequestTransition,
} from "./purchaseRequestWorkflow.js";

describe("purchaseRequestWorkflow (OP-14)", () => {
  it("fluxo simplificado: abertura → comprador → orçamentos → gestor → pedido", () => {
    assert.equal(resolvePurchaseRequestTransition("RASCUNHO", "SUBMIT"), "ABERTA");
    assert.equal(resolvePurchaseRequestTransition("ABERTA", "VALIDATE"), "EM_COTACAO");
    assert.equal(resolvePurchaseRequestTransition("EM_COTACAO", "SEND_TO_APPROVAL"), "AGUARDANDO_APROVACAO");
    assert.equal(resolvePurchaseRequestTransition("AGUARDANDO_APROVACAO", "APPROVE"), "ENCERRADA");
  });

  it("ciclo formal de cotação SC continua disponível", () => {
    assert.equal(resolvePurchaseRequestTransition("ABERTA", "FORWARD_TO_QUOTATION"), "EM_COTACAO");
    assert.equal(resolvePurchaseRequestTransition("EM_COTACAO", "FORWARD_TO_QUOTATION"), "EM_COTACAO");
  });

  it("permite rejeição, reaberturas e cancelamento", () => {
    assert.equal(resolvePurchaseRequestTransition("AGUARDANDO_APROVACAO", "REJECT"), "REJEITADA");
    assert.equal(resolvePurchaseRequestTransition("REJEITADA", "REOPEN_DRAFT"), "RASCUNHO");
    assert.equal(resolvePurchaseRequestTransition("REJEITADA", "REOPEN_QUOTING"), "EM_COTACAO");
    assert.equal(resolvePurchaseRequestTransition("EM_COTACAO", "CANCEL"), "CANCELADA");
  });

  it("bloqueia transições inválidas", () => {
    assert.throws(
      () => resolvePurchaseRequestTransition("RASCUNHO", "APPROVE"),
      (e: unknown) => e instanceof PurchaseRequestWorkflowError && e.code === "INVALID_TRANSITION"
    );
    assert.throws(
      () => resolvePurchaseRequestTransition("RASCUNHO", "SEND_TO_APPROVAL"),
      PurchaseRequestWorkflowError
    );
  });

  it("exige motivo em rejeição e cancelamento", () => {
    assert.throws(
      () => assertReasonRequired("REJECT", "  "),
      (e: unknown) => e instanceof PurchaseRequestWorkflowError && e.code === "REASON_REQUIRED"
    );
    assert.equal(assertReasonRequired("CANCEL", " duplicidade "), "duplicidade");
    assert.equal(assertReasonRequired("APPROVE", null), "");
  });

  it("conteúdo editável só em rascunho ou rejeitada", () => {
    assert.equal(canEditPurchaseRequestContent("RASCUNHO"), true);
    assert.equal(canEditPurchaseRequestContent("REJEITADA"), true);
    assert.equal(canEditPurchaseRequestContent("AGUARDANDO_APROVACAO"), false);
    assert.equal(canEditPurchaseRequestContent("ABERTA"), false);
    assert.equal(canEditPurchaseRequestContent("EM_COTACAO"), false);
  });
});
