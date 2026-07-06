// src/types/commercial.ts
import { Product } from "./product";
import type { CalculationExplanation } from "./calculation";

export type ProposalStatus = 
  | "DRAFT" 
  | "ANALYSIS" 
  | "SENT" 
  | "APPROVED" 
  | "REJECTED" 
  | "EXPIRED" 
  | "CANCELED";

export interface Customer {
  id: string;
  companyName: string;
  tradeName?: string;
  taxId: string;
  stateTaxId?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country: string;
  segment?: string;
  notes?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProposalItem {
  id?: string;
  proposalId?: string;
  externalProductId?: number | null;
  productId: string;
  Product?: Product;
  quantity: number;
  unit?: string;
  unitCost: number;
  suggestedPrice: number;
  negotiatedPrice: number;
  discountPerc: number;
  discountValue: number;
  marginValue: number;
  marginPerc: number;
  taxesPerc: number;
  taxesValue: number;
  commissionPerc: number;
  commissionValue: number;
  freightValue: number;
  notes?: string;
  /** Metadados de transparência vindos do snapshot de preço (unitCost / preço sugerido). */
  calculationExplainability?: {
    unitCost?: CalculationExplanation;
    suggestedPrice?: CalculationExplanation;
  };
  priceTableItemId?: string | null;
  priceSource?: string | null;
  /** Cópia auditável da resposta de preço publicado (ou legível pelo backend). */
  pricingSnapshotJson?: Record<string, unknown> | null;
  /** Rastreio direto da tabela/versão usada no item (proposta mista). */
  priceTableId?: string | null;
  priceTableVersionId?: string | null;
  priceTableCode?: string | null;
  priceTableVersionNumber?: number | null;
}

/** Pedido interno vinculado à proposta (quando existir). */
export type SalesOrderLinkStatus = "DRAFT" | "READY_TO_SEND" | "SENT_TO_NOMUS" | "CANCELLED" | "ERROR";

export interface Proposal {
  id: string;
  number: number;
  title?: string;
  customerId: string;
  Customer?: Customer;
  status: ProposalStatus;
  /** Pedido de venda gerado a partir desta proposta (lista / detalhe). */
  salesOrder?: {
    id: string;
    orderCode: string;
    status: SalesOrderLinkStatus;
  } | null;
  responsible?: string;
  companyIssuer?: string;
  validityDays: number;
  paymentTerms?: string;
  paymentMethod?: string;
  deliveryTimeDays?: number;
  freightCondition: string;
  deliveryLocation?: string;
  notes?: string;
  internalNotes?: string;
  
  totalItems: number;
  totalGrossValue: number;
  totalDiscount: number;
  totalNetValue: number;
  totalCost: number;
  totalMarginValue: number;
  totalMarginPerc: number;
  totalTaxes: number;
  totalCommission: number;
  totalFreight: number;

  items: ProposalItem[];
  createdAt: string;
  updatedAt: string;

  priceTableId?: string | null;
  priceTableVersionId?: string | null;
  priceTableCode?: string | null;
  priceTableVersionNumber?: number | null;
  priceSource?: string | null;
}

export interface CreateProposalInput {
  title?: string;
  customerId: string;
  status: ProposalStatus;
  responsible?: string;
  companyIssuer?: string;
  validityDays: number;
  paymentTerms?: string;
  paymentMethod?: string;
  deliveryTimeDays?: number;
  freightCondition: string;
  deliveryLocation?: string;
  notes?: string;
  internalNotes?: string;
  
  totalItems: number;
  totalGrossValue: number;
  totalDiscount: number;
  totalNetValue: number;
  totalCost: number;
  totalMarginValue: number;
  totalMarginPerc: number;
  totalTaxes: number;
  totalCommission: number;
  totalFreight: number;

  priceTableId?: string | null;
  priceTableVersionId?: string | null;
  priceTableCode?: string | null;
  priceTableVersionNumber?: number | null;
  priceSource?: string | null;

  items: Omit<ProposalItem, "id" | "proposalId" | "Product">[];
}
