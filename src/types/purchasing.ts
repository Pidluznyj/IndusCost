/**
 * Tipos frontend do domínio aditivo de Compras SC (OP-13).
 * Sem @prisma/client — espelham enums/campos para uso futuro de UI/API.
 */

export type PurchaseQuotationStatus =
  | "RASCUNHO"
  | "ENVIADA"
  | "EM_ANALISE"
  | "ADJUDICADA"
  | "CANCELADA"
  | "EXPIRADA";

export type PurchaseOrderStatus =
  | "RASCUNHO"
  | "EMITIDO"
  | "CONFIRMADO"
  | "PARCIALMENTE_RECEBIDO"
  | "RECEBIDO"
  | "CANCELADO"
  | "ENCERRADO";

export type PurchaseReceiptStatus =
  | "RASCUNHO"
  | "EM_CONFERENCIA"
  | "DIVERGENTE"
  | "APROVADO"
  | "ESTORNADO"
  | "CANCELADO";

export type PurchaseApprovalStatus = "PENDENTE" | "APROVADA" | "REJEITADA" | "CANCELADA";
