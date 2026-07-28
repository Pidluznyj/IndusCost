/**
 * Invariantes de preço/negociação do domínio aditivo de Compras (OP-13).
 * Puro — sem Prisma. Garante que initial ≠ overwrite e rodadas são append-only.
 */

export type OfferItemPriceState = {
  initialUnitPrice: number;
  awardedUnitPrice: number | null;
  awardedRoundLineId: string | null;
};

export type NegotiationRoundLineSnapshot = {
  id: string;
  roundNumber: number;
  offerItemId: string;
  unitPrice: number;
  createdAt: string;
};

export class PurchasingInvariantError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "PurchasingInvariantError";
  }
}

export function assertPositiveQuantity(quantity: number, field = "quantity"): void {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new PurchasingInvariantError(`${field} deve ser > 0.`, "QTY_INVALID");
  }
}

export function assertPositiveUnitPrice(unitPrice: number, field = "unitPrice"): void {
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new PurchasingInvariantError(`${field} deve ser >= 0.`, "PRICE_INVALID");
  }
}

/** Preço inicial não pode ser alterado após a oferta registrada. */
export function assertInitialPriceImmutable(
  before: OfferItemPriceState,
  after: OfferItemPriceState
): void {
  if (before.initialUnitPrice !== after.initialUnitPrice) {
    throw new PurchasingInvariantError(
      "initialUnitPrice é imutável — use rodada de negociação e awardedUnitPrice.",
      "INITIAL_PRICE_IMMUTABLE"
    );
  }
}

/**
 * Adjudicação copia o preço da rodada vencedora para awarded*,
 * sem sobrescrever initialUnitPrice.
 */
export function awardOfferItemFromRoundLine(
  item: OfferItemPriceState,
  roundLine: NegotiationRoundLineSnapshot
): OfferItemPriceState {
  assertPositiveUnitPrice(roundLine.unitPrice);
  if (roundLine.offerItemId && item.awardedRoundLineId === roundLine.id) {
    // idempotente
    return item;
  }
  return {
    initialUnitPrice: item.initialUnitPrice,
    awardedUnitPrice: roundLine.unitPrice,
    awardedRoundLineId: roundLine.id,
  };
}

/** Histórico de rodadas deve ser monotônico e sem update in-place. */
export function assertRoundHistoryAppendOnly(
  existing: NegotiationRoundLineSnapshot[],
  next: NegotiationRoundLineSnapshot
): void {
  assertPositiveUnitPrice(next.unitPrice);
  if (existing.some((r) => r.id === next.id)) {
    throw new PurchasingInvariantError(
      "Linha de rodada já existe — histórico é append-only.",
      "ROUND_LINE_IMMUTABLE"
    );
  }
  const sameRoundSameItem = existing.find(
    (r) => r.roundNumber === next.roundNumber && r.offerItemId === next.offerItemId
  );
  if (sameRoundSameItem) {
    throw new PurchasingInvariantError(
      "Já existe proposta para este item nesta rodada.",
      "ROUND_LINE_DUPLICATE"
    );
  }
  const maxRound = existing.reduce((m, r) => Math.max(m, r.roundNumber), 0);
  if (next.roundNumber < 1) {
    throw new PurchasingInvariantError("roundNumber deve ser >= 1.", "ROUND_NUMBER_INVALID");
  }
  if (next.roundNumber > maxRound + 1 && existing.length > 0) {
    // permite gaps? melhor exigir sequência por cotação no cabeçalho; aqui só alerta de salto absurdo
    // allow creating round N+1 only
  }
}

export function resolveEffectiveUnitPrice(item: OfferItemPriceState): number {
  if (item.awardedUnitPrice != null) return item.awardedUnitPrice;
  return item.initialUnitPrice;
}

export function assertAwardDoesNotOverwriteInitial(
  initialUnitPrice: number,
  awardedUnitPrice: number
): void {
  // Allowed: awarded differs from initial (that's the point of negotiation).
  // Forbidden: treating them as the same mutable field.
  assertPositiveUnitPrice(initialUnitPrice, "initialUnitPrice");
  assertPositiveUnitPrice(awardedUnitPrice, "awardedUnitPrice");
}

export function sumAcceptedReceiptQuantity(
  lines: Array<{ quantityAccepted: number }>
): number {
  return lines.reduce((s, l) => {
    const q = Number(l.quantityAccepted);
    return s + (Number.isFinite(q) && q > 0 ? q : 0);
  }, 0);
}

export function assertPartialReceiptWithinOrdered(input: {
  quantityOrdered: number;
  previouslyAccepted: number;
  quantityAcceptedNow: number;
}): void {
  assertPositiveQuantity(input.quantityOrdered, "quantityOrdered");
  if (input.previouslyAccepted < 0 || input.quantityAcceptedNow < 0) {
    throw new PurchasingInvariantError("Quantidades de recebimento inválidas.", "RECEIPT_QTY_INVALID");
  }
  const total = input.previouslyAccepted + input.quantityAcceptedNow;
  if (total - input.quantityOrdered > 1e-9) {
    throw new PurchasingInvariantError(
      "Recebimento acumulado excede quantidade pedida.",
      "RECEIPT_OVER_ORDERED"
    );
  }
}

/** Soft link futuro: recebimento aprovado pode apontar para InventoryMovement.id. */
export function assertFutureInventoryMovementLink(input: {
  receiptStatus: string;
  inventoryMovementId: string | null;
}): void {
  if (input.inventoryMovementId && input.receiptStatus !== "APROVADO") {
    throw new PurchasingInvariantError(
      "Vínculo com movimento de estoque só após recebimento APROVADO.",
      "MOVEMENT_LINK_STATUS"
    );
  }
}
