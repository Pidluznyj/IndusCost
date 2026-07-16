/**
 * Regras puras — detalhe de Ordem de Produção (OP-17).
 */
import { isSensitiveLogKey } from "@/src/lib/nomusRestClient.js";
import {
  serializeProductionOrderDate,
  serializeProductionOrderDecimal,
} from "@/src/lib/productionOrdersList.js";

export type ProductionOrderLinkState =
  | "current_resolved"
  | "current_pending"
  | "removed";

export type ProductionOrderDetailLocalItem = {
  id: string;
  skuSnapshot: string | null;
  productNameSnapshot: string | null;
  quantity: string | null;
  unit: string | null;
  nomusItemExternalId: number | null;
  nomusItemSequence: string | null;
};

export type ProductionOrderDetailSalesLink = {
  id: string;
  linkState: ProductionOrderLinkState;
  isCurrent: boolean;
  externalSalesOrderId: number;
  externalSalesOrderItemId: number;
  itemNumber: string | null;
  customerName: string | null;
  linkedQuantity: string | null;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  orderCode: string | null;
  localItem: ProductionOrderDetailLocalItem | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  removedAt: string | null;
  rawJson: unknown | null;
};

export type ProductionOrderDetailAuditSummary = {
  currentLinkCount: number;
  removedLinkCount: number;
  resolvedLinkCount: number;
  pendingLinkCount: number;
};

export type ProductionOrderDetailResponse = {
  identification: {
    id: string;
    externalId: number;
    name: string | null;
    status: string | null;
    tipo: string | null;
    priority: string | null;
  };
  product: {
    externalProductId: number | null;
    productCode: string | null;
    productDescription: string | null;
    productAdditionalInfo: string | null;
    productConfigId: number | null;
    productConfigCode: string | null;
    quantity: string | null;
    unit: string | null;
    stockSector: string | null;
  };
  company: {
    externalCompanyId: number | null;
    companyName: string | null;
  };
  dates: {
    openedAt: string | null;
    releasedAt: string | null;
    plannedAt: string | null;
    deliveryAt: string | null;
    closedAt: string | null;
    nomusUpdatedAt: string | null;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    lastChangedAt: string | null;
    syncedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  };
  salesLinks: ProductionOrderDetailSalesLink[];
  auditSummary: ProductionOrderDetailAuditSummary;
  payloadHash: string;
  rawJson: unknown;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isProductionOrderDetailId(value: string): boolean {
  return UUID_RE.test(value);
}

export function classifyProductionOrderLinkState(args: {
  isCurrent: boolean;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
}): ProductionOrderLinkState {
  if (!args.isCurrent) return "removed";
  if (args.salesOrderId == null || args.salesOrderItemId == null) {
    return "current_pending";
  }
  return "current_resolved";
}

export function buildProductionOrderDetailAuditSummary(
  links: Array<{
    isCurrent: boolean;
    salesOrderId: string | null;
    salesOrderItemId: string | null;
  }>
): ProductionOrderDetailAuditSummary {
  let currentLinkCount = 0;
  let removedLinkCount = 0;
  let resolvedLinkCount = 0;
  let pendingLinkCount = 0;

  for (const link of links) {
    if (link.isCurrent) {
      currentLinkCount += 1;
      if (link.salesOrderId == null || link.salesOrderItemId == null) {
        pendingLinkCount += 1;
      }
    } else {
      removedLinkCount += 1;
    }

    if (link.salesOrderId != null && link.salesOrderItemId != null) {
      resolvedLinkCount += 1;
    }
  }

  return {
    currentLinkCount,
    removedLinkCount,
    resolvedLinkCount,
    pendingLinkCount,
  };
}

export function sanitizeProductionOrderRawJson(value: unknown): unknown {
  return sanitizeProductionOrderRawJsonValue(value, new WeakSet<object>());
}

function sanitizeProductionOrderRawJsonValue(
  value: unknown,
  seen: WeakSet<object>
): unknown {
  if (value == null || typeof value !== "object") {
    if (typeof value === "string") {
      return value
        .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [redigido]")
        .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [redigido]");
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProductionOrderRawJsonValue(item, seen));
  }

  const obj = value as Record<string, unknown>;
  if (seen.has(obj)) return "[Circular]";
  seen.add(obj);

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(obj)) {
    if (isSensitiveLogKey(key)) {
      out[key] = "[redigido]";
      continue;
    }
    out[key] = sanitizeProductionOrderRawJsonValue(nested, seen);
  }
  return out;
}

export type ProductionOrderDetailDbLink = {
  id: string;
  isCurrent: boolean;
  externalSalesOrderId: number;
  externalSalesOrderItemId: number;
  itemNumber: string | null;
  customerName: string | null;
  linkedQuantity: import("@prisma/client").Prisma.Decimal | null;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  removedAt: Date | null;
  rawJson: unknown;
  SalesOrder: { orderCode: string } | null;
  SalesOrderItem: {
    id: string;
    skuSnapshot: string;
    productNameSnapshot: string;
    quantity: import("@prisma/client").Prisma.Decimal;
    unit: string | null;
    nomusItemExternalId: number | null;
    nomusItemSequence: string | null;
  } | null;
};

export type ProductionOrderDetailDbRow = {
  id: string;
  externalId: number;
  name: string | null;
  status: string | null;
  tipo: string | null;
  priority: string | null;
  externalProductId: number | null;
  productCode: string | null;
  productDescription: string | null;
  productAdditionalInfo: string | null;
  productConfigId: number | null;
  productConfigCode: string | null;
  quantity: import("@prisma/client").Prisma.Decimal | null;
  unit: string | null;
  stockSector: string | null;
  externalCompanyId: number | null;
  companyName: string | null;
  openedAt: Date | null;
  releasedAt: Date | null;
  plannedAt: Date | null;
  deliveryAt: Date | null;
  closedAt: Date | null;
  nomusUpdatedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastChangedAt: Date;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  payloadHash: string;
  rawJson: unknown;
  salesLinks: ProductionOrderDetailDbLink[];
};

export function serializeProductionOrderDetailSalesLink(
  link: ProductionOrderDetailDbLink
): ProductionOrderDetailSalesLink {
  const linkState = classifyProductionOrderLinkState({
    isCurrent: link.isCurrent,
    salesOrderId: link.salesOrderId,
    salesOrderItemId: link.salesOrderItemId,
  });

  const localItem =
    link.SalesOrderItem == null
      ? null
      : {
          id: link.SalesOrderItem.id,
          skuSnapshot: link.SalesOrderItem.skuSnapshot,
          productNameSnapshot: link.SalesOrderItem.productNameSnapshot,
          quantity: serializeProductionOrderDecimal(link.SalesOrderItem.quantity),
          unit: link.SalesOrderItem.unit,
          nomusItemExternalId: link.SalesOrderItem.nomusItemExternalId,
          nomusItemSequence: link.SalesOrderItem.nomusItemSequence,
        };

  return {
    id: link.id,
    linkState,
    isCurrent: link.isCurrent,
    externalSalesOrderId: link.externalSalesOrderId,
    externalSalesOrderItemId: link.externalSalesOrderItemId,
    itemNumber: link.itemNumber,
    customerName: link.customerName,
    linkedQuantity: serializeProductionOrderDecimal(link.linkedQuantity),
    salesOrderId: link.salesOrderId,
    salesOrderItemId: link.salesOrderItemId,
    orderCode: link.SalesOrder?.orderCode ?? null,
    localItem,
    firstSeenAt: serializeProductionOrderDate(link.firstSeenAt),
    lastSeenAt: serializeProductionOrderDate(link.lastSeenAt),
    removedAt: serializeProductionOrderDate(link.removedAt),
    rawJson:
      link.rawJson == null ? null : sanitizeProductionOrderRawJson(link.rawJson),
  };
}

export function serializeProductionOrderDetail(
  row: ProductionOrderDetailDbRow
): ProductionOrderDetailResponse {
  const salesLinks = row.salesLinks.map(serializeProductionOrderDetailSalesLink);

  return {
    identification: {
      id: row.id,
      externalId: row.externalId,
      name: row.name,
      status: row.status,
      tipo: row.tipo,
      priority: row.priority,
    },
    product: {
      externalProductId: row.externalProductId,
      productCode: row.productCode,
      productDescription: row.productDescription,
      productAdditionalInfo: row.productAdditionalInfo,
      productConfigId: row.productConfigId,
      productConfigCode: row.productConfigCode,
      quantity: serializeProductionOrderDecimal(row.quantity),
      unit: row.unit,
      stockSector: row.stockSector,
    },
    company: {
      externalCompanyId: row.externalCompanyId,
      companyName: row.companyName,
    },
    dates: {
      openedAt: serializeProductionOrderDate(row.openedAt),
      releasedAt: serializeProductionOrderDate(row.releasedAt),
      plannedAt: serializeProductionOrderDate(row.plannedAt),
      deliveryAt: serializeProductionOrderDate(row.deliveryAt),
      closedAt: serializeProductionOrderDate(row.closedAt),
      nomusUpdatedAt: serializeProductionOrderDate(row.nomusUpdatedAt),
      firstSeenAt: serializeProductionOrderDate(row.firstSeenAt),
      lastSeenAt: serializeProductionOrderDate(row.lastSeenAt),
      lastChangedAt: serializeProductionOrderDate(row.lastChangedAt),
      syncedAt: serializeProductionOrderDate(row.syncedAt),
      createdAt: serializeProductionOrderDate(row.createdAt),
      updatedAt: serializeProductionOrderDate(row.updatedAt),
    },
    salesLinks,
    auditSummary: buildProductionOrderDetailAuditSummary(row.salesLinks),
    payloadHash: row.payloadHash,
    rawJson: sanitizeProductionOrderRawJson(row.rawJson),
  };
}
