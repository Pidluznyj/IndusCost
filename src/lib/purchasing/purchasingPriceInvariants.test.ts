import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAwardDoesNotOverwriteInitial,
  assertFutureInventoryMovementLink,
  assertInitialPriceImmutable,
  assertPartialReceiptWithinOrdered,
  assertRoundHistoryAppendOnly,
  awardOfferItemFromRoundLine,
  PurchasingInvariantError,
  resolveEffectiveUnitPrice,
} from "./purchasingPriceInvariants.js";

describe("purchasingPriceInvariants", () => {
  it("1. preço inicial não pode ser sobrescrito", () => {
    assert.throws(
      () =>
        assertInitialPriceImmutable(
          { initialUnitPrice: 10, awardedUnitPrice: null, awardedRoundLineId: null },
          { initialUnitPrice: 9, awardedUnitPrice: null, awardedRoundLineId: null }
        ),
      (e: unknown) => e instanceof PurchasingInvariantError && e.code === "INITIAL_PRICE_IMMUTABLE"
    );
  });

  it("2. adjudicação copia rodada para awarded sem mudar initial", () => {
    const before = {
      initialUnitPrice: 10,
      awardedUnitPrice: null as number | null,
      awardedRoundLineId: null as string | null,
    };
    const after = awardOfferItemFromRoundLine(before, {
      id: "rl-1",
      roundNumber: 2,
      offerItemId: "oi-1",
      unitPrice: 8.5,
      createdAt: "2026-07-21T12:00:00.000Z",
    });
    assert.equal(after.initialUnitPrice, 10);
    assert.equal(after.awardedUnitPrice, 8.5);
    assert.equal(after.awardedRoundLineId, "rl-1");
    assert.equal(resolveEffectiveUnitPrice(after), 8.5);
    assert.equal(resolveEffectiveUnitPrice(before), 10);
  });

  it("3. rodadas são append-only (sem update in-place)", () => {
    const existing = [
      {
        id: "rl-1",
        roundNumber: 1,
        offerItemId: "oi-1",
        unitPrice: 10,
        createdAt: "2026-07-21T10:00:00.000Z",
      },
    ];
    assert.throws(
      () =>
        assertRoundHistoryAppendOnly(existing, {
          id: "rl-1",
          roundNumber: 1,
          offerItemId: "oi-1",
          unitPrice: 9,
          createdAt: "2026-07-21T11:00:00.000Z",
        }),
      (e: unknown) => e instanceof PurchasingInvariantError && e.code === "ROUND_LINE_IMMUTABLE"
    );
    assert.throws(
      () =>
        assertRoundHistoryAppendOnly(existing, {
          id: "rl-2",
          roundNumber: 1,
          offerItemId: "oi-1",
          unitPrice: 9,
          createdAt: "2026-07-21T11:00:00.000Z",
        }),
      (e: unknown) => e instanceof PurchasingInvariantError && e.code === "ROUND_LINE_DUPLICATE"
    );
    assert.doesNotThrow(() =>
      assertRoundHistoryAppendOnly(existing, {
        id: "rl-2",
        roundNumber: 2,
        offerItemId: "oi-1",
        unitPrice: 8,
        createdAt: "2026-07-21T12:00:00.000Z",
      })
    );
  });

  it("4. initial e awarded são campos distintos", () => {
    assert.doesNotThrow(() => assertAwardDoesNotOverwriteInitial(10, 8));
    assert.throws(
      () => assertAwardDoesNotOverwriteInitial(-1, 8),
      (e: unknown) => e instanceof PurchasingInvariantError
    );
  });

  it("5. recebimento parcial não excede pedido", () => {
    assert.doesNotThrow(() =>
      assertPartialReceiptWithinOrdered({
        quantityOrdered: 100,
        previouslyAccepted: 40,
        quantityAcceptedNow: 60,
      })
    );
    assert.throws(
      () =>
        assertPartialReceiptWithinOrdered({
          quantityOrdered: 100,
          previouslyAccepted: 40,
          quantityAcceptedNow: 61,
        }),
      (e: unknown) => e instanceof PurchasingInvariantError && e.code === "RECEIPT_OVER_ORDERED"
    );
  });

  it("6. vínculo futuro estoque só em recebimento aprovado", () => {
    assert.throws(
      () =>
        assertFutureInventoryMovementLink({
          receiptStatus: "RASCUNHO",
          inventoryMovementId: "mov-1",
        }),
      (e: unknown) => e instanceof PurchasingInvariantError && e.code === "MOVEMENT_LINK_STATUS"
    );
    assert.doesNotThrow(() =>
      assertFutureInventoryMovementLink({
        receiptStatus: "APROVADO",
        inventoryMovementId: "mov-1",
      })
    );
  });
});
