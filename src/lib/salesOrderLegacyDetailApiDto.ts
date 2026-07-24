/**
 * DTO HTTP do detalhe legado GET /api/sales-orders/:id — PERFORMANCE 04.
 * Consumidores: impressão (`SalesOrderClientDocument`) e drawer de margem.
 * O detalhe oficial completo permanece em GET /api/sales-orders/:id/detail.
 */

import type {
  SalesOrderItemMarginPayload,
  SalesOrderMarginSummaryPayload,
} from "@/src/lib/salesOrderMarginTypes";

/** Select Prisma do detalhe legado (sem Product/Proposal/ProposalItem integrais). */
export const SALES_ORDER_LEGACY_DETAIL_PRISMA_SELECT = {
  id: true,
  orderCode: true,
  status: true,
  issueDate: true,
  expectedDeliveryDate: true,
  responsible: true,
  paymentTerms: true,
  paymentMethod: true,
  freightCondition: true,
  deliveryLocation: true,
  notes: true,
  totalGrossValue: true,
  totalDiscount: true,
  totalNetValue: true,
  totalFreight: true,
  proposalId: true,
  /** Margem server-side; removido do JSON. */
  nomusRawResponse: true,
  Customer: {
    select: {
      companyName: true,
      tradeName: true,
      taxId: true,
      address: true,
      city: true,
      state: true,
      zipCode: true,
      phone: true,
    },
  },
  items: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      salesOrderId: true,
      productId: true,
      proposalItemId: true,
      externalProductId: true,
      skuSnapshot: true,
      productNameSnapshot: true,
      quantity: true,
      unit: true,
      negotiatedPrice: true,
      totalNetValue: true,
      unitCost: true,
      nomusIsCanceled: true,
      nomusIsStale: true,
      nomusIsCut: true,
      nomusItemStatusNormalized: true,
      nomusItemStatusRaw: true,
    },
  },
} as const;

export type SalesOrderLegacyDetailHttpItem = {
  id: string;
  skuSnapshot: string | null;
  productNameSnapshot: string | null;
  quantity: unknown;
  unit: string | null;
  negotiatedPrice: unknown;
  totalNetValue: unknown;
  margin?: SalesOrderItemMarginPayload;
};

export type SalesOrderLegacyDetailHttpRow = {
  id: string;
  orderCode: string;
  status: string;
  issueDate: Date | string;
  expectedDeliveryDate: Date | string | null;
  responsible: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  freightCondition: string | null;
  deliveryLocation: string | null;
  notes: string | null;
  totalGrossValue: unknown;
  totalDiscount: unknown;
  totalNetValue: unknown;
  totalFreight: unknown;
  Customer: {
    companyName: string | null;
    tradeName: string | null;
    taxId: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    phone: string | null;
  } | null;
  items: SalesOrderLegacyDetailHttpItem[];
  marginSummary?: SalesOrderMarginSummaryPayload;
};

type EnrichedLegacyOrder = {
  id: string;
  orderCode: string;
  status: string;
  issueDate: Date | string;
  expectedDeliveryDate: Date | string | null;
  responsible: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  freightCondition: string | null;
  deliveryLocation: string | null;
  notes: string | null;
  totalGrossValue: unknown;
  totalDiscount: unknown;
  totalNetValue: unknown;
  totalFreight: unknown;
  Customer?: SalesOrderLegacyDetailHttpRow["Customer"];
  items: Array<{
    id: string;
    skuSnapshot?: string | null;
    productNameSnapshot?: string | null;
    quantity: unknown;
    unit?: string | null;
    negotiatedPrice?: unknown;
    totalNetValue?: unknown;
    margin?: SalesOrderItemMarginPayload;
  }>;
  marginSummary?: SalesOrderMarginSummaryPayload;
};

export function toSalesOrderLegacyDetailHttpRow(
  order: EnrichedLegacyOrder
): SalesOrderLegacyDetailHttpRow {
  return {
    id: order.id,
    orderCode: order.orderCode,
    status: order.status,
    issueDate: order.issueDate,
    expectedDeliveryDate: order.expectedDeliveryDate,
    responsible: order.responsible,
    paymentTerms: order.paymentTerms,
    paymentMethod: order.paymentMethod,
    freightCondition: order.freightCondition,
    deliveryLocation: order.deliveryLocation,
    notes: order.notes,
    totalGrossValue: order.totalGrossValue,
    totalDiscount: order.totalDiscount,
    totalNetValue: order.totalNetValue,
    totalFreight: order.totalFreight,
    Customer: order.Customer
      ? {
          companyName: order.Customer.companyName ?? null,
          tradeName: order.Customer.tradeName ?? null,
          taxId: order.Customer.taxId ?? null,
          address: order.Customer.address ?? null,
          city: order.Customer.city ?? null,
          state: order.Customer.state ?? null,
          zipCode: order.Customer.zipCode ?? null,
          phone: order.Customer.phone ?? null,
        }
      : null,
    items: order.items.map((item) => ({
      id: item.id,
      skuSnapshot: item.skuSnapshot ?? null,
      productNameSnapshot: item.productNameSnapshot ?? null,
      quantity: item.quantity,
      unit: item.unit ?? null,
      negotiatedPrice: item.negotiatedPrice,
      totalNetValue: item.totalNetValue,
      margin: item.margin,
    })),
    marginSummary: order.marginSummary,
  };
}

export const SALES_ORDER_LEGACY_DETAIL_HTTP_FORBIDDEN_KEYS = [
  "nomusRawResponse",
  "Product",
  "Proposal",
  "ProposalItem",
  "payloadHash",
  "sourcePresenceStatus",
  "rawPayload",
  "xmlRaw",
] as const;
