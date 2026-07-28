import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCanEditInitialOffer,
  canEditInitialOffer,
  PurchaseQuotationWorkflowError,
  resolvePurchaseQuotationTransition,
} from "./purchaseQuotationWorkflow.js";

describe("purchaseQuotationWorkflow (OP-15)", () => {
  it("transições de coleta sem adjudicação", () => {
    assert.equal(resolvePurchaseQuotationTransition("RASCUNHO", "MARK_SENT"), "ENVIADA");
    assert.equal(resolvePurchaseQuotationTransition("ENVIADA", "MARK_IN_ANALYSIS"), "EM_ANALISE");
    assert.equal(resolvePurchaseQuotationTransition("EM_ANALISE", "CANCEL"), "CANCELADA");
  });

  it("congela oferta inicial após RECEBIDA ou início de negociação", () => {
    assert.equal(canEditInitialOffer({ offerStatus: "RASCUNHO", negotiationStarted: false }), true);
    assert.equal(canEditInitialOffer({ offerStatus: "RECEBIDA", negotiationStarted: false }), false);
    assert.equal(canEditInitialOffer({ offerStatus: "RASCUNHO", negotiationStarted: true }), false);
    assert.throws(
      () => assertCanEditInitialOffer({ offerStatus: "RECEBIDA", negotiationStarted: false }),
      (e: unknown) => e instanceof PurchaseQuotationWorkflowError && e.code === "INITIAL_OFFER_LOCKED"
    );
  });
});
