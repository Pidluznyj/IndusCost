/**
 * Workflow puro de Recebimento de Compra (OP-22).
 * Ledger só na confirmação; cancelamento pós-confirmação = reversão formal.
 */

export const PURCHASE_RECEIPT_STATUSES = [
  "RASCUNHO",
  "EM_CONFERENCIA",
  "DIVERGENTE",
  "APROVADO",
  "ESTORNADO",
  "CANCELADO",
] as const;

export type PurchaseReceiptStatusName = (typeof PURCHASE_RECEIPT_STATUSES)[number];

export class PurchaseReceiptError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "PurchaseReceiptError";
  }
}

export type ReceiptLineQuantities = {
  purchaseOrderItemId: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityAccepted: number;
  quantityRejected: number;
};

export type PoLineAcceptedAgg = {
  purchaseOrderItemId: string;
  quantityOrdered: number;
  quantityAcceptedConfirmed: number;
};

/** Quantidade pendente = pedida − aceita confirmada (rejeitada não entra no estoque). */
export function computeQuantityPending(ordered: number, acceptedConfirmed: number): number {
  const pending = round6(ordered) - round6(acceptedConfirmed);
  return pending > 0 ? round6(pending) : 0;
}

export function assertReceiptLineQuantities(line: ReceiptLineQuantities): void {
  const received = round6(line.quantityReceived);
  const accepted = round6(line.quantityAccepted);
  const rejected = round6(line.quantityRejected);
  if (received < 0 || accepted < 0 || rejected < 0) {
    throw new PurchaseReceiptError("Quantidades não podem ser negativas.", "INVALID_QUANTITY");
  }
  if (accepted + rejected - received > 1e-9) {
    throw new PurchaseReceiptError(
      "Aceita + rejeitada não pode exceder a quantidade recebida.",
      "QTY_SPLIT_OVERFLOW"
    );
  }
  if (Math.abs(accepted + rejected - received) > 1e-6 && accepted + rejected < received - 1e-9) {
    // permite received > accepted+rejected (divergência em conferência), mas accepted+rejected <= received
  }
  if (accepted + rejected > received + 1e-9) {
    throw new PurchaseReceiptError(
      "Aceita + rejeitada não pode exceder a quantidade recebida.",
      "QTY_SPLIT_OVERFLOW"
    );
  }
}

export function assertAcceptanceWithinOpenBalance(
  line: ReceiptLineQuantities,
  alreadyAcceptedConfirmed: number
): void {
  assertReceiptLineQuantities(line);
  const pending = computeQuantityPending(line.quantityOrdered, alreadyAcceptedConfirmed);
  if (round6(line.quantityAccepted) - pending > 1e-9) {
    throw new PurchaseReceiptError(
      `Quantidade aceita (${line.quantityAccepted}) excede pendente (${pending}).`,
      "ACCEPTANCE_EXCEEDS_PENDING"
    );
  }
}

export function resolvePurchaseOrderReceiptStatus(
  lines: PoLineAcceptedAgg[]
): "PARCIALMENTE_RECEBIDO" | "RECEBIDO" | null {
  if (lines.length === 0) return null;
  let anyAccepted = false;
  let allComplete = true;
  for (const line of lines) {
    const accepted = round6(line.quantityAcceptedConfirmed);
    const ordered = round6(line.quantityOrdered);
    if (accepted > 1e-9) anyAccepted = true;
    if (accepted + 1e-9 < ordered) allComplete = false;
  }
  if (!anyAccepted) return null;
  return allComplete ? "RECEBIDO" : "PARCIALMENTE_RECEBIDO";
}

export function buildReceiptConfirmIdempotencyKey(receiptId: string, clientKey?: string | null): string {
  const suffix = clientKey?.trim() || "default";
  return `purchase-receipt-confirm:${receiptId}:${suffix}`;
}

export function buildReceiptLineMovementIdempotencyKey(receiptItemId: string): string {
  return `purchase-receipt-line:${receiptItemId}:PURCHASE_RECEIPT`;
}

export function buildReceiptLineOriginId(receiptItemId: string): string {
  return `purchase-receipt-item:${receiptItemId}`;
}

export function computeEffectiveLineCost(input: {
  quantityAccepted: number;
  effectiveUnitCost: number | null;
  unitCostSnapshot: number | null;
}): number | null {
  const unit = input.effectiveUnitCost ?? input.unitCostSnapshot;
  if (unit == null || !Number.isFinite(unit)) return null;
  return round6(round6(input.quantityAccepted) * round6(unit));
}

export function assertCanConfirmReceipt(status: string): void {
  if (status !== "RASCUNHO" && status !== "EM_CONFERENCIA" && status !== "DIVERGENTE") {
    throw new PurchaseReceiptError(
      `Recebimento em status ${status} não pode ser confirmado.`,
      "INVALID_STATUS_FOR_CONFIRM"
    );
  }
}

export function assertCanReverseConfirmedReceipt(status: string): void {
  if (status !== "APROVADO") {
    throw new PurchaseReceiptError(
      "Somente recebimento confirmado (APROVADO) pode ser estornado formalmente.",
      "INVALID_STATUS_FOR_REVERSE"
    );
  }
}

export function assertDraftEditable(status: string): void {
  if (status !== "RASCUNHO" && status !== "EM_CONFERENCIA" && status !== "DIVERGENTE") {
    throw new PurchaseReceiptError(
      "Recebimento confirmado/cancelado não é editável.",
      "RECEIPT_LOCKED"
    );
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
