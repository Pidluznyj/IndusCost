/**
 * DTO HTTP da listagem GET /api/sales-orders — PERFORMANCE 04.
 * Select Prisma + projeção mínima alinhada ao consumo da UI
 * (`SalesOrderListRowSnapshot` + células de margem/faturamento).
 * Mantém IDs e campos de ação; omite raw/JSON/sync não usados na grade.
 */

import type { SalesOrderBillingStatus } from "@/src/lib/sales/salesOrderListBillingStatus";
import type {
  SalesOrderItemMarginPayload,
  SalesOrderMarginSummaryPayload,
} from "@/src/lib/salesOrderMarginTypes";

/**
 * Select da página da listagem.
 * Sem `nomusRawResponse`: JSON Nomus é pesado e travava o GET da grade.
 * Billing da lista usa só SalesOrderNfeLink + NomusNfe.
 */
export const SALES_ORDER_LIST_PAGE_PRISMA_SELECT = {
  id: true,
  customerId: true,
  orderCode: true,
  status: true,
  issueDate: true,
  expectedDeliveryDate: true,
  totalItems: true,
  totalNetValue: true,
  externalSellerId: true,
  proposalId: true,
  Customer: {
    select: {
      companyName: true,
      tradeName: true,
    },
  },
  Proposal: {
    select: {
      id: true,
      number: true,
      externalProposalCode: true,
      title: true,
    },
  },
} as const;

/** Select só para agregação de totais da listagem (evita SALES_ORDER_RULES_PRISMA_SELECT). */
export const SALES_ORDER_LIST_SUMMARY_PRISMA_SELECT = {
  totalNetValue: true,
  totalItems: true,
} as const;

export type SalesOrderListSellerDto = {
  externalSellerId: number | null;
  name: string | null;
  resolutionStatus: string;
};

export type SalesOrderListHttpRow = {
  id: string;
  customerId: string | null;
  orderCode: string;
  status: string;
  issueDate: Date | string;
  expectedDeliveryDate: Date | string | null;
  totalItems: number;
  totalNetValue: unknown;
  externalSellerId: number | null;
  proposalId: string | null;
  Customer: { companyName: string | null; tradeName: string | null } | null;
  Proposal: {
    id: string;
    number: number;
    externalProposalCode: string | null;
    title: string | null;
  } | null;
  seller: SalesOrderListSellerDto;
  responsible: string | null;
  hasInvoice: boolean;
  billingStatus: SalesOrderBillingStatus;
  invoiceCount: number;
  lastInvoiceNumber: string | null;
  lastInvoiceDate: string | null;
  marginSummary?: SalesOrderMarginSummaryPayload;
  marginItems?: SalesOrderItemMarginPayload[];
};

type ListPageOrder = {
  id: string;
  customerId: string | null;
  orderCode: string;
  status: string;
  issueDate: Date | string;
  expectedDeliveryDate: Date | string | null;
  totalItems: number;
  totalNetValue: unknown;
  externalSellerId: number | null;
  proposalId: string | null;
  Customer?: { companyName: string | null; tradeName: string | null } | null;
  Proposal?: {
    id: string;
    number: number;
    externalProposalCode: string | null;
    title: string | null;
  } | null;
  marginSummary?: SalesOrderMarginSummaryPayload;
  marginItems?: SalesOrderItemMarginPayload[];
};

/**
 * Projeta a linha HTTP da listagem — sem nomusRawResponse nem scalars de sync/detalhe.
 */
export function toSalesOrderListHttpRow(
  order: ListPageOrder,
  extras: {
    seller: SalesOrderListSellerDto;
    hasInvoice: boolean;
    billingStatus: SalesOrderBillingStatus;
    invoiceCount: number;
    lastInvoiceNumber: string | null;
    lastInvoiceDate: string | null;
    responsible: string | null;
  }
): SalesOrderListHttpRow {
  return {
    id: order.id,
    customerId: order.customerId,
    orderCode: order.orderCode,
    status: order.status,
    issueDate: order.issueDate,
    expectedDeliveryDate: order.expectedDeliveryDate,
    totalItems: order.totalItems,
    totalNetValue: order.totalNetValue,
    externalSellerId: order.externalSellerId,
    proposalId: order.proposalId,
    Customer: order.Customer
      ? {
          companyName: order.Customer.companyName ?? null,
          tradeName: order.Customer.tradeName ?? null,
        }
      : null,
    Proposal: order.Proposal
      ? {
          id: order.Proposal.id,
          number: order.Proposal.number,
          externalProposalCode: order.Proposal.externalProposalCode ?? null,
          title: order.Proposal.title ?? null,
        }
      : null,
    seller: extras.seller,
    responsible: extras.responsible,
    hasInvoice: extras.hasInvoice,
    billingStatus: extras.billingStatus,
    invoiceCount: extras.invoiceCount,
    lastInvoiceNumber: extras.lastInvoiceNumber,
    lastInvoiceDate: extras.lastInvoiceDate,
    marginSummary: order.marginSummary,
    marginItems: order.marginItems,
  };
}

/** Campos que NÃO devem aparecer no JSON da listagem (regressão). */
export const SALES_ORDER_LIST_HTTP_FORBIDDEN_KEYS = [
  "nomusRawResponse",
  "payloadHash",
  "sourcePresenceStatus",
  "presentInLastPayload",
  "firstSeenAt",
  "lastSeenAt",
  "missingSince",
  "missingConsecutiveRuns",
  "sourceRemovedAt",
  "lastSyncRunId",
  "notes",
  "internalNotes",
  "paymentTerms",
  "paymentMethod",
  "freightCondition",
  "deliveryLocation",
  "totalGrossValue",
  "totalDiscount",
  "totalCost",
  "totalTaxes",
  "totalFreight",
  "sentToNomusAt",
] as const;
