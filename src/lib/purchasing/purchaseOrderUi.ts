/**
 * Vocabulário visual do Pedido de Compra — rótulo + tom, num lugar só.
 *
 * Antes disto o mapa de rótulos estava copiado em três arquivos
 * (`PurchaseOrderModule`, `SupplierPerformanceTab`, `PurchaseReceivingStationModule`)
 * e nenhum deles tinha cor: o status — a informação mais importante da tela —
 * saía como texto cinza solto. Os tons batem com `OverlayBadgeTone`, então o
 * consumo é direto: `<OverlayBadge tone={TONES[status]}>{LABELS[status]}</OverlayBadge>`.
 *
 * Sem JSX aqui de propósito: é dado, não componente.
 */
import type { PurchaseOrderStatusName } from "./purchaseOrderWorkflow.js";

export type PurchaseOrderBadgeTone =
  | "sky"
  | "emerald"
  | "amber"
  | "rose"
  | "violet"
  | "slate"
  | "primary";

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatusName, string> = {
  RASCUNHO: "Rascunho",
  APROVADO: "Aprovado",
  ENVIADO: "Enviado ao fornecedor",
  // Legado inalcançável — mantido só para não quebrar a leitura de dado antigo.
  EMITIDO: "Emitido (legado)",
  CONFIRMADO: "Confirmado pelo fornecedor",
  PARCIALMENTE_RECEBIDO: "Parcialmente recebido",
  RECEBIDO: "Recebido",
  CANCELADO: "Cancelado",
  ENCERRADO: "Encerrado",
};

/**
 * Tom por significado, não por bonito: âmbar = espera alguém agir, sky = em
 * trânsito com o fornecedor, emerald = deu certo, rose = morreu, slate = saiu
 * do fluxo sem drama.
 */
export const PURCHASE_ORDER_STATUS_TONES: Record<PurchaseOrderStatusName, PurchaseOrderBadgeTone> = {
  RASCUNHO: "slate",
  APROVADO: "amber",
  ENVIADO: "sky",
  EMITIDO: "slate",
  CONFIRMADO: "violet",
  PARCIALMENTE_RECEBIDO: "amber",
  RECEBIDO: "emerald",
  CANCELADO: "rose",
  ENCERRADO: "slate",
};

export function purchaseOrderStatusLabel(status: string): string {
  return PURCHASE_ORDER_STATUS_LABELS[status as PurchaseOrderStatusName] ?? status;
}

export function purchaseOrderStatusTone(status: string): PurchaseOrderBadgeTone {
  return PURCHASE_ORDER_STATUS_TONES[status as PurchaseOrderStatusName] ?? "slate";
}

/** Rótulos pt-BR das ações do histórico, que hoje aparecem cruas na tela. */
export const PURCHASE_ORDER_HISTORY_ACTION_LABELS: Record<string, string> = {
  CREATED_FROM_AWARD: "Gerado pela adjudicação",
  APPROVE: "Aprovado",
  SEND: "Enviado ao fornecedor",
  CONFIRM: "Confirmado pelo fornecedor",
  CANCEL: "Cancelado",
  CLOSE: "Encerrado",
  RECEIPT_PARCIALMENTE_RECEBIDO: "Recebimento parcial registrado",
  RECEIPT_RECEBIDO: "Recebimento total registrado",
  RECEIPT_CONFIRMADO: "Recebimento estornado",
  SUPPLIER_EVALUATION_CREATED: "Fornecedor avaliado",
  SUPPLIER_EVALUATION_REVISED: "Avaliação do fornecedor revisada",
};

export function purchaseOrderHistoryActionLabel(action: string): string {
  return PURCHASE_ORDER_HISTORY_ACTION_LABELS[action] ?? action;
}
