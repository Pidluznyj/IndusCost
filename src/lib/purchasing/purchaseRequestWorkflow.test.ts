import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertReasonRequired,
  canEditPurchaseRequestContent,
  PurchaseRequestWorkflowError,
  resolvePurchaseRequestTransition,
} from "./purchaseRequestWorkflow.js";

describe("purchaseRequestWorkflow (OP-14)", () => {
  it("permite rascunho → aprovação → aberta → cotação", () => {
    assert.equal(resolvePurchaseRequestTransition("RASCUNHO", "SUBMIT"), "AGUARDANDO_APROVACAO");
    assert.equal(resolvePurchaseRequestTransition("AGUARDANDO_APROVACAO", "APPROVE"), "ABERTA");
    assert.equal(resolvePurchaseRequestTransition("ABERTA", "FORWARD_TO_QUOTATION"), "EM_COTACAO");
  });

  it("permite rejeição, reabertura e cancelamento", () => {
    assert.equal(resolvePurchaseRequestTransition("AGUARDANDO_APROVACAO", "REJECT"), "REJEITADA");
    assert.equal(resolvePurchaseRequestTransition("REJEITADA", "REOPEN_DRAFT"), "RASCUNHO");
    assert.equal(resolvePurchaseRequestTransition("REJEITADA", "SUBMIT"), "AGUARDANDO_APROVACAO");
    assert.equal(resolvePurchaseRequestTransition("EM_COTACAO", "CANCEL"), "CANCELADA");
  });

  it("bloqueia transições inválidas", () => {
    assert.throws(
      () => resolvePurchaseRequestTransition("ABERTA", "APPROVE"),
      (e: unknown) => e instanceof PurchaseRequestWorkflowError && e.code === "INVALID_TRANSITION"
    );
    assert.throws(
      () => resolvePurchaseRequestTransition("RASCUNHO", "FORWARD_TO_QUOTATION"),
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
