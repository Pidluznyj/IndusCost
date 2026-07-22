/**
 * Tipos frontend do domínio aditivo de Compras SC (OP-13/OP-15).
 * Sem @prisma/client — espelham enums/campos para uso de UI/API.
 */

export type PurchaseQuotationStatus =
  | "RASCUNHO"
  | "ENVIADA"
  | "EM_ANALISE"
  | "ADJUDICADA"
  | "CANCELADA"
  | "EXPIRADA";

export type PurchaseQuotationSupplierStatus =
  | "CONVIDADO"
  | "RESPONDIDO"
  | "DESCARTADO"
  | "VENCEDOR"
  | "RECUSADO";

export type PurchaseQuotationOfferStatus = "RASCUNHO" | "RECEBIDA" | "DESCARTADA" | "VENCEDORA";

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

export interface PurchaseQuotationListRow {
  id: string;
  code: string;
  status: PurchaseQuotationStatus;
  title: string | null;
  currency: string;
  purchaseRequestId: string | null;
  createdAt: string;
  updatedAt: string;
  purchaseRequest?: { id: string; number: number; status: string } | null;
  _count?: { items: number; suppliers: number; offers: number };
}

export interface PurchaseQuotationItemRow {
  id: string;
  lineNumber: number;
  description: string;
  quantity: string | number;
  unit: string;
  materialId: string | null;
  materialCodeSnapshot: string | null;
  materialDescriptionSnapshot: string | null;
  materialUnitSnapshot: string | null;
  notes: string | null;
}

export interface PurchaseQuotationOfferItemRow {
  id: string;
  quotationItemId: string;
  initialUnitPrice: string | number;
  initialQuantity: string | number | null;
  initialLeadTimeDays: number | null;
  initialFreightValue: string | number | null;
  initialNonRecoverableTaxes: string | number | null;
  initialExpenses: string | number | null;
  initialDiscounts: string | number | null;
  initialMinOrderQty: string | number | null;
  initialNotes: string | null;
  quotationItem?: {
    id: string;
    lineNumber: number;
    description: string;
    quantity: string | number;
    unit: string;
    materialCodeSnapshot?: string | null;
  };
}

export interface PurchaseQuotationOfferRow {
  id: string;
  status: PurchaseQuotationOfferStatus;
  currency: string;
  initialPaymentTerms: string | null;
  initialDeliveryTerms: string | null;
  initialFreightValue: string | number | null;
  initialNonRecoverableTaxes: string | number | null;
  initialExpenses: string | number | null;
  initialDiscounts: string | number | null;
  initialMinOrderQty: string | number | null;
  initialValidityDate: string | null;
  initialLeadTimeDays: number | null;
  proposalReceived: boolean;
  proposalReceivedAt: string | null;
  proposalReceivedNotes: string | null;
  submittedAt: string | null;
  notes: string | null;
  selectionJustification?: string | null;
  selectedAt?: string | null;
  selectedByUserId?: string | null;
  selectedByUserName?: string | null;
  items: PurchaseQuotationOfferItemRow[];
}

export interface PurchaseQuotationSupplierRow {
  id: string;
  supplierId: string;
  status: PurchaseQuotationSupplierStatus;
  supplierDisplayNameSnapshot: string;
  supplierDocumentSnapshot: string | null;
  invitedAt: string;
  respondedAt: string | null;
  notes: string | null;
  offers: PurchaseQuotationOfferRow[];
}

export interface PurchaseQuotationDetail {
  id: string;
  code: string;
  status: PurchaseQuotationStatus;
  title: string | null;
  currency: string;
  neededByDate: string | null;
  expiresAt: string | null;
  justification: string | null;
  notes: string | null;
  purchaseRequestId: string | null;
  purchaseRequest?: { id: string; number: number; status: string; justification: string } | null;
  items: PurchaseQuotationItemRow[];
  suppliers: PurchaseQuotationSupplierRow[];
  rounds?: Array<{ id: string; roundNumber: number; status: string }>;
}

export const PURCHASE_QUOTATION_STATUS_LABEL: Record<PurchaseQuotationStatus, string> = {
  RASCUNHO: "Rascunho",
  ENVIADA: "Enviada",
  EM_ANALISE: "Em análise",
  ADJUDICADA: "Adjudicada",
  CANCELADA: "Cancelada",
  EXPIRADA: "Expirada",
};
