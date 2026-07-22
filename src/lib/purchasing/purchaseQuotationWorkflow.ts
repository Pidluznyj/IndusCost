/**
 * Workflow puro de cotação SC — coleta (OP-15).
 * Sem adjudicação / PO / Contas a Pagar.
 */

export const PURCHASE_QUOTATION_COLLECTION_STATUSES = [
  "RASCUNHO",
  "ENVIADA",
  "EM_ANALISE",
  "CANCELADA",
  "EXPIRADA",
] as const;

export type PurchaseQuotationCollectionStatus =
  (typeof PURCHASE_QUOTATION_COLLECTION_STATUSES)[number];

export type PurchaseQuotationCollectionAction =
  | "MARK_SENT"
  | "MARK_IN_ANALYSIS"
  | "CANCEL";

const TRANSITIONS: Record<
  PurchaseQuotationCollectionAction,
  { from: readonly PurchaseQuotationCollectionStatus[]; to: PurchaseQuotationCollectionStatus }
> = {
  MARK_SENT: { from: ["RASCUNHO"], to: "ENVIADA" },
  MARK_IN_ANALYSIS: { from: ["RASCUNHO", "ENVIADA"], to: "EM_ANALISE" },
  CANCEL: { from: ["RASCUNHO", "ENVIADA", "EM_ANALISE"], to: "CANCELADA" },
};

export class PurchaseQuotationWorkflowError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "PurchaseQuotationWorkflowError";
  }
}

export function isPurchaseQuotationCollectionStatus(
  value: unknown
): value is PurchaseQuotationCollectionStatus {
  return (
    typeof value === "string" &&
    (PURCHASE_QUOTATION_COLLECTION_STATUSES as readonly string[]).includes(value)
  );
}

export function resolvePurchaseQuotationTransition(
  current: PurchaseQuotationCollectionStatus,
  action: PurchaseQuotationCollectionAction
): PurchaseQuotationCollectionStatus {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    throw new PurchaseQuotationWorkflowError(
      `Ação ${action} não permitida a partir do status ${current}.`,
      "INVALID_TRANSITION"
    );
  }
  return rule.to;
}

/** Conteúdo da cotação (itens demanda) só editável em rascunho — OP-15 mantém itens da SC. */
export function canEditQuotationMeta(status: string): boolean {
  return status === "RASCUNHO" || status === "ENVIADA" || status === "EM_ANALISE";
}

/**
 * Oferta inicial editável só enquanto RASCUNHO e sem rodada de negociação.
 * Após RECEBIDA ou início de negociação, initial* fica congelado.
 */
export function canEditInitialOffer(input: {
  offerStatus: string;
  negotiationStarted: boolean;
}): boolean {
  if (input.negotiationStarted) return false;
  return input.offerStatus === "RASCUNHO";
}

export function assertCanEditInitialOffer(input: {
  offerStatus: string;
  negotiationStarted: boolean;
}): void {
  if (!canEditInitialOffer(input)) {
    throw new PurchaseQuotationWorkflowError(
      "Oferta inicial congelada após registro da proposta ou início da negociação.",
      "INITIAL_OFFER_LOCKED"
    );
  }
}
