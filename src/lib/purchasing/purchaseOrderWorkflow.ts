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
  | "MARK_RECEIVED"
  | "REOPEN_FROM_RECEIPT"
  | "CLOSE";

/**
 * `EMITIDO` é legado INALCANÇÁVEL: nenhuma transição o produz e nenhuma criação
 * o usa (o pedido nasce `RASCUNHO` pela adjudicação ou `APROVADO` pela
 * solicitação). O próprio schema documenta a aposentadoria — `ENVIADO`
 * substituiu o sentido de "enviado ao fornecedor". Continua no enum porque é
 * dado histórico, mas deixou de figurar como origem de transição: aceitar
 * origem impossível só produzia botão morto na tela.
 */
export const PURCHASE_ORDER_LEGACY_UNREACHABLE_STATUSES: readonly PurchaseOrderStatusName[] = [
  "EMITIDO",
];

/** Estados terminais — saem do funil operacional (indicadores já os excluem). */
export const PURCHASE_ORDER_TERMINAL_STATUSES: readonly PurchaseOrderStatusName[] = [
  "CANCELADO",
  "ENCERRADO",
];

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
  SEND: { from: ["APROVADO"], to: "ENVIADO" },
  CONFIRM: { from: ["ENVIADO", "APROVADO"], to: "CONFIRMADO" },
  CANCEL: {
    // EMITIDO continua aceito AQUI e só aqui. É inalcançável por código —
    // nenhum commit da história jamais o gravou — mas o enum do banco
    // permite o valor, e no domínio original ele ocupava o lugar de
    // ENVIADO. Tirá-lo de TODAS as origens deixaria uma eventual linha
    // legada sem nenhuma saída: nem avançar, nem encerrar, nem cancelar.
    // Cancelar é a válvula de escape; nenhum status pode ficar preso.
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
  /**
   * Estorno total do recebimento devolve o pedido a CONFIRMADO. O serviço de
   * recebimento já fazia isso gravando status direto, fora desta tabela —
   * declarar aqui devolve à máquina o papel de fonte única, sem mudar
   * comportamento.
   */
  REOPEN_FROM_RECEIPT: {
    from: ["PARCIALMENTE_RECEBIDO", "RECEBIDO"],
    to: "CONFIRMADO",
  },
  /**
   * Encerramento administrativo. `PARCIALMENTE_RECEBIDO` entra de propósito: é
   * o pedido abandonado com saldo aberto, que antes disto não tinha saída
   * nenhuma e ficava preso para sempre contando no funil.
   */
  CLOSE: {
    from: ["RECEBIDO", "PARCIALMENTE_RECEBIDO"],
    to: "ENCERRADO",
  },
};

/** Motivo é exigido quando se encerra deixando saldo por receber. */
export function closeRequiresReason(current: PurchaseOrderStatusName): boolean {
  return current === "PARCIALMENTE_RECEBIDO";
}

export const PURCHASE_ORDER_CLOSE_REASON_MIN_LENGTH = 5;

export function assertPurchaseOrderCloseReason(
  current: PurchaseOrderStatusName,
  reason: string | null | undefined
): void {
  if (!closeRequiresReason(current)) return;
  if (String(reason ?? "").trim().length < PURCHASE_ORDER_CLOSE_REASON_MIN_LENGTH) {
    throw new PurchaseOrderWorkflowError(
      "Encerrar pedido com saldo pendente exige motivo (mín. 5 caracteres).",
      "CLOSE_REASON"
    );
  }
}

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
