/**
 * Workflow puro do Pedido de Compra (OP-20/OP-22).
 * Recebimento físico atualiza status via serviço de receipts (sem AP / Nomus / custo publicado).
 */

export const PURCHASE_ORDER_STATUSES = [
  "RASCUNHO",
  "APROVADO",
  "ENVIADO",
  "EMITIDO",
  "CONFIRMADO",
  "PARCIALMENTE_RECEBIDO",
  "RECEBIDO",
  "CANCELADO",
  "ENCERRADO",
] as const;

export type PurchaseOrderStatusName = (typeof PURCHASE_ORDER_STATUSES)[number];

export type PurchaseOrderAction =
  | "APPROVE"
  | "SEND"
  | "CONFIRM"
  | "CANCEL"
  | "MARK_PARTIAL_RECEIVED"
  | "MARK_RECEIVED";

export class PurchaseOrderWorkflowError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "PurchaseOrderWorkflowError";
  }
}

const TRANSITIONS: Record<
  PurchaseOrderAction,
  { from: readonly PurchaseOrderStatusName[]; to: PurchaseOrderStatusName }
> = {
  APPROVE: { from: ["RASCUNHO"], to: "APROVADO" },
  SEND: { from: ["APROVADO", "EMITIDO"], to: "ENVIADO" },
  CONFIRM: { from: ["ENVIADO", "EMITIDO", "APROVADO"], to: "CONFIRMADO" },
  CANCEL: {
    from: ["RASCUNHO", "APROVADO", "ENVIADO", "EMITIDO"],
    to: "CANCELADO",
  },
  MARK_PARTIAL_RECEIVED: {
    from: ["CONFIRMADO", "PARCIALMENTE_RECEBIDO", "RECEBIDO"],
    to: "PARCIALMENTE_RECEBIDO",
  },
  MARK_RECEIVED: {
    from: ["CONFIRMADO", "PARCIALMENTE_RECEBIDO"],
    to: "RECEBIDO",
  },
};

export function resolvePurchaseOrderTransition(
  current: PurchaseOrderStatusName,
  action: PurchaseOrderAction
): PurchaseOrderStatusName {
  const rule = TRANSITIONS[action];
  if (!(PURCHASE_ORDER_STATUSES as readonly string[]).includes(current)) {
    throw new PurchaseOrderWorkflowError(`Status inválido: ${current}.`, "STATUS_INVALID");
  }
  if (!rule.from.includes(current)) {
    throw new PurchaseOrderWorkflowError(
      `Ação ${action} não permitida a partir de ${current}.`,
      "INVALID_TRANSITION"
    );
  }
  return rule.to;
}

export function assertAwardApprovedForPo(awardStatus: string): void {
  if (awardStatus !== "APROVADA") {
    throw new PurchaseOrderWorkflowError(
      "Só adjudicações APROVADAS geram pedido de compra.",
      "AWARD_NOT_APPROVED"
    );
  }
}

export function assertQuotationAdjudicated(quotationStatus: string): void {
  if (quotationStatus !== "ADJUDICADA") {
    throw new PurchaseOrderWorkflowError(
      "Cotação precisa estar ADJUDICADA para gerar pedido.",
      "QUOTATION_NOT_AWARDED"
    );
  }
}

/** Aprovação cria compromisso operacional + marca entrada futura (sem AP). */
export function buildOperationalCommitmentMeta(nowIso: string) {
  return {
    operationalCommitmentAt: nowIso,
    futureEntryPending: true,
    futureEntryMarkedAt: nowIso,
    createsAccountsPayable: false,
    increasesStock: false,
  };
}
