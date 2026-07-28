/**
 * Transições de status da solicitação de compra (OP-14) — puro, sem Prisma.
 */

export const PURCHASE_REQUEST_STATUSES = [
  "RASCUNHO",
  "AGUARDANDO_APROVACAO",
  "ABERTA",
  "REJEITADA",
  "EM_COTACAO",
  "CANCELADA",
  "ENCERRADA",
] as const;

export type PurchaseRequestWorkflowStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];

export type PurchaseRequestWorkflowAction =
  | "SUBMIT"
  | "APPROVE"
  | "REJECT"
  | "CANCEL"
  | "FORWARD_TO_QUOTATION"
  | "REOPEN_DRAFT"
  | "CLOSE";

const TRANSITIONS: Record<
  PurchaseRequestWorkflowAction,
  { from: readonly PurchaseRequestWorkflowStatus[]; to: PurchaseRequestWorkflowStatus }
> = {
  SUBMIT: { from: ["RASCUNHO", "REJEITADA"], to: "AGUARDANDO_APROVACAO" },
  APPROVE: { from: ["AGUARDANDO_APROVACAO"], to: "ABERTA" },
  REJECT: { from: ["AGUARDANDO_APROVACAO"], to: "REJEITADA" },
  CANCEL: {
    from: ["RASCUNHO", "AGUARDANDO_APROVACAO", "ABERTA", "REJEITADA", "EM_COTACAO"],
    to: "CANCELADA",
  },
  FORWARD_TO_QUOTATION: { from: ["ABERTA"], to: "EM_COTACAO" },
  REOPEN_DRAFT: { from: ["REJEITADA"], to: "RASCUNHO" },
  CLOSE: { from: ["ABERTA", "EM_COTACAO"], to: "ENCERRADA" },
};

export class PurchaseRequestWorkflowError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "PurchaseRequestWorkflowError";
  }
}

export function isPurchaseRequestStatus(value: unknown): value is PurchaseRequestWorkflowStatus {
  return (
    typeof value === "string" &&
    (PURCHASE_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

export function canEditPurchaseRequestContent(status: PurchaseRequestWorkflowStatus): boolean {
  return status === "RASCUNHO" || status === "REJEITADA";
}

export function resolvePurchaseRequestTransition(
  current: PurchaseRequestWorkflowStatus,
  action: PurchaseRequestWorkflowAction
): PurchaseRequestWorkflowStatus {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    throw new PurchaseRequestWorkflowError(
      `Ação ${action} não permitida a partir do status ${current}.`,
      "INVALID_TRANSITION"
    );
  }
  return rule.to;
}

export function assertReasonRequired(
  action: PurchaseRequestWorkflowAction,
  reason: string | null | undefined
): string {
  const needsReason = action === "REJECT" || action === "CANCEL";
  const trimmed = String(reason ?? "").trim();
  if (needsReason && !trimmed) {
    throw new PurchaseRequestWorkflowError(
      action === "REJECT" ? "Motivo da rejeição é obrigatório." : "Motivo do cancelamento é obrigatório.",
      "REASON_REQUIRED"
    );
  }
  return trimmed;
}
