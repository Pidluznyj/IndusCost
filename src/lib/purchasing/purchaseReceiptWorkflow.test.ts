import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAcceptanceWithinOpenBalance,
  assertCanConfirmReceipt,
  assertCanReverseConfirmedReceipt,
  buildReceiptConfirmIdempotencyKey,
  buildReceiptLineMovementIdempotencyKey,
  computeEffectiveLineCost,
  computeQuantityPending,
  PurchaseReceiptError,
  resolvePurchaseOrderReceiptStatus,
} from "./purchaseReceiptWorkflow.js";

describe("purchaseReceiptWorkflow (OP-22)", () => {
  it("calcula pendente e bloqueia aceite acima do aberto", () => {
    assert.equal(computeQuantityPending(100, 40), 60);
    assert.equal(computeQuantityPending(10, 10), 0);
    assert.doesNotThrow(() =>
      assertAcceptanceWithinOpenBalance(
        {
          purchaseOrderItemId: "i1",
          quantityOrdered: 100,
          quantityReceived: 30,
          quantityAccepted: 25,
          quantityRejected: 5,
        },
        40
      )
    );
    assert.throws(
      () =>
        assertAcceptanceWithinOpenBalance(
          {
            purchaseOrderItemId: "i1",
            quantityOrdered: 100,
            quantityReceived: 80,
            quantityAccepted: 70,
            quantityRejected: 0,
          },
          40
        ),
      (e: unknown) => e instanceof PurchaseReceiptError && e.code === "ACCEPTANCE_EXCEEDS_PENDING"
    );
  });

  it("status do PC: parcial vs total; múltiplos recebimentos agregados", () => {
    assert.equal(
      resolvePurchaseOrderReceiptStatus([
        { purchaseOrderItemId: "a", quantityOrdered: 100, quantityAcceptedConfirmed: 40 },
        { purchaseOrderItemId: "b", quantityOrdered: 50, quantityAcceptedConfirmed: 50 },
      ]),
      "PARCIALMENTE_RECEBIDO"
    );
    assert.equal(
      resolvePurchaseOrderReceiptStatus([
        { purchaseOrderItemId: "a", quantityOrdered: 100, quantityAcceptedConfirmed: 100 },
        { purchaseOrderItemId: "b", quantityOrdered: 50, quantityAcceptedConfirmed: 50 },
      ]),
      "RECEBIDO"
    );
    assert.equal(
      resolvePurchaseOrderReceiptStatus([
        { purchaseOrderItemId: "a", quantityOrdered: 100, quantityAcceptedConfirmed: 0 },
      ]),
      null
    );
  });

  it("chaves de idempotência estáveis e custo efetivo", () => {
    assert.equal(
      buildReceiptConfirmIdempotencyKey("r1", "k"),
      "purchase-receipt-confirm:r1:k"
    );
    assert.match(buildReceiptLineMovementIdempotencyKey("li1"), /PURCHASE_RECEIPT/);
    assert.equal(
      computeEffectiveLineCost({
        quantityAccepted: 10,
        effectiveUnitCost: 2.5,
        unitCostSnapshot: 3,
      }),
      25
    );
  });

  it("confirmação só em rascunho/conferência; estorno só após APROVADO", () => {
    assert.doesNotThrow(() => assertCanConfirmReceipt("RASCUNHO"));
    assert.throws(
      () => assertCanConfirmReceipt("APROVADO"),
      (e: unknown) => e instanceof PurchaseReceiptError && e.code === "INVALID_STATUS_FOR_CONFIRM"
    );
    assert.doesNotThrow(() => assertCanReverseConfirmedReceipt("APROVADO"));
    assert.throws(
      () => assertCanReverseConfirmedReceipt("RASCUNHO"),
      (e: unknown) => e instanceof PurchaseReceiptError && e.code === "INVALID_STATUS_FOR_REVERSE"
    );
  });
});
