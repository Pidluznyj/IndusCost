/**
 * Regras puras — listagem paginada de Ordens de Produção (OP-16).
 */
import type { Prisma } from "@prisma/client";
import {
  buildProductionOrdersAppliedFilters,
  PRODUCTION_ORDERS_LIST_PERIOD_FIELD,
  type ProductionOrdersAppliedFilter,
  type ProductionOrdersListQuery,
} from "@/src/lib/productionOrdersListQuery.js";

export type ProductionOrderCurrentSalesOrderSummary = {
  externalSalesOrderId: number;
  salesOrderId: string | null;
  orderCode: string | null;
  customerName: string | null;
};

export type ProductionOrderGridRow = {
  id: string;
  externalId: number;
  name: string | null;
  status: string | null;
  tipo: string | null;
  priority: string | null;
  companyName: string | null;
  productCode: string | null;
  productDescription: string | null;
  quantity: string | null;
  unit: string | null;
  stockSector: string | null;
  openedAt: string | null;
  releasedAt: string | null;
  plannedAt: string | null;
  deliveryAt: string | null;
  closedAt: string | null;
  nomusUpdatedAt: string | null;
  syncedAt: string | null;
  currentLinkCount: number;
  currentSalesOrders: ProductionOrderCurrentSalesOrderSummary[];
  hasPendingLink: boolean;
};

export type ProductionOrdersListResponse = {
  rows: ProductionOrderGridRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  statusCounts: Record<string, number>;
  appliedFilters: ProductionOrdersAppliedFilter[];
  periodField: typeof PRODUCTION_ORDERS_LIST_PERIOD_FIELD;
};

export const PRODUCTION_ORDERS_GRID_SELECT = {
  id: true,
  externalId: true,
  name: true,
  status: true,
  tipo: true,
  priority: true,
  companyName: true,
  productCode: true,
  productDescription: true,
  quantity: true,
  unit: true,
  stockSector: true,
  openedAt: true,
  releasedAt: true,
  plannedAt: true,
  deliveryAt: true,
  closedAt: true,
  nomusUpdatedAt: true,
  syncedAt: true,
} as const satisfies Prisma.NomusProductionOrderSelect;

export type ProductionOrderGridDbRow = Prisma.NomusProductionOrderGetPayload<{
  select: typeof PRODUCTION_ORDERS_GRID_SELECT;
}>;

export function buildProductionOrdersListWhere(
  query: ProductionOrdersListQuery
): Prisma.NomusProductionOrderWhereInput {
  const where: Prisma.NomusProductionOrderWhereInput = {};
  const and: Prisma.NomusProductionOrderWhereInput[] = [];

  if (query.status) {
    and.push({ status: query.status });
  }
  if (query.tipo) {
    and.push({ tipo: query.tipo });
  }
  if (query.company) {
    and.push({
      companyName: { contains: query.company, mode: "insensitive" },
    });
  }

  if (query.openedFrom || query.openedTo) {
    const openedAt: Prisma.DateTimeNullableFilter = {};
    if (query.openedFrom) openedAt.gte = query.openedFrom;
    if (query.openedTo) openedAt.lte = query.openedTo;
    and.push({ openedAt });
  }

  if (query.search) {
    and.push({
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { productCode: { contains: query.search, mode: "insensitive" } },
        { productDescription: { contains: query.search, mode: "insensitive" } },
        {
          salesLinks: {
            some: {
              isCurrent: true,
              customerName: { contains: query.search, mode: "insensitive" },
            },
          },
        },
        {
          salesLinks: {
            some: {
              isCurrent: true,
              SalesOrder: {
                orderCode: { contains: query.search, mode: "insensitive" },
              },
            },
          },
        },
      ],
    });
  }

  if (and.length > 0) {
    where.AND = and;
  }

  return where;
}

export function productionOrdersListOrderBy(): Prisma.NomusProductionOrderOrderByWithRelationInput[] {
  return [{ openedAt: { sort: "desc", nulls: "last" } }, { externalId: "desc" }];
}

export function serializeProductionOrderDecimal(
  value: Prisma.Decimal | null | undefined
): string | null {
  if (value == null) return null;
  return value.toString();
}

export function serializeProductionOrderDate(value: Date | null | undefined): string | null {
  if (value == null) return null;
  return value.toISOString();
}

export function statusCountKey(status: string | null): string {
  return status ?? "";
}

export function buildProductionOrdersStatusCounts(
  groups: Array<{ status: string | null; _count: { _all: number } }>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const group of groups) {
    counts[statusCountKey(group.status)] = group._count._all;
  }
  return counts;
}

export type ProductionOrderLinkAggregateInput = {
  productionOrderId: string;
  isCurrent: boolean;
  externalSalesOrderId: number;
  customerName: string | null;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  orderCode: string | null;
};

export function buildProductionOrderLinkAggregates(
  links: ProductionOrderLinkAggregateInput[]
): Map<
  string,
  {
    currentLinkCount: number;
    currentSalesOrders: ProductionOrderCurrentSalesOrderSummary[];
    hasPendingLink: boolean;
  }
> {
  const byOp = new Map<
    string,
    {
      currentLinkCount: number;
      currentSalesOrders: ProductionOrderCurrentSalesOrderSummary[];
      hasPendingLink: boolean;
      seenOrders: Set<number>;
    }
  >();

  for (const link of links) {
    const bucket =
      byOp.get(link.productionOrderId) ??
      {
        currentLinkCount: 0,
        currentSalesOrders: [],
        hasPendingLink: false,
        seenOrders: new Set<number>(),
      };

    if (link.isCurrent) {
      bucket.currentLinkCount += 1;
      const pending = link.salesOrderId == null || link.salesOrderItemId == null;
      if (pending) bucket.hasPendingLink = true;

      if (!bucket.seenOrders.has(link.externalSalesOrderId)) {
        bucket.seenOrders.add(link.externalSalesOrderId);
        bucket.currentSalesOrders.push({
          externalSalesOrderId: link.externalSalesOrderId,
          salesOrderId: link.salesOrderId,
          orderCode: link.orderCode,
          customerName: link.customerName,
        });
      }
    }

    byOp.set(link.productionOrderId, bucket);
  }

  const result = new Map<
    string,
    {
      currentLinkCount: number;
      currentSalesOrders: ProductionOrderCurrentSalesOrderSummary[];
      hasPendingLink: boolean;
    }
  >();

  for (const [productionOrderId, bucket] of byOp) {
    result.set(productionOrderId, {
      currentLinkCount: bucket.currentLinkCount,
      currentSalesOrders: bucket.currentSalesOrders,
      hasPendingLink: bucket.hasPendingLink,
    });
  }

  return result;
}

export function serializeProductionOrderGridRow(
  row: ProductionOrderGridDbRow,
  linkAgg?: {
    currentLinkCount: number;
    currentSalesOrders: ProductionOrderCurrentSalesOrderSummary[];
    hasPendingLink: boolean;
  }
): ProductionOrderGridRow {
  return {
    id: row.id,
    externalId: row.externalId,
    name: row.name,
    status: row.status,
    tipo: row.tipo,
    priority: row.priority,
    companyName: row.companyName,
    productCode: row.productCode,
    productDescription: row.productDescription,
    quantity: serializeProductionOrderDecimal(row.quantity),
    unit: row.unit,
    stockSector: row.stockSector,
    openedAt: serializeProductionOrderDate(row.openedAt),
    releasedAt: serializeProductionOrderDate(row.releasedAt),
    plannedAt: serializeProductionOrderDate(row.plannedAt),
    deliveryAt: serializeProductionOrderDate(row.deliveryAt),
    closedAt: serializeProductionOrderDate(row.closedAt),
    nomusUpdatedAt: serializeProductionOrderDate(row.nomusUpdatedAt),
    syncedAt: serializeProductionOrderDate(row.syncedAt),
    currentLinkCount: linkAgg?.currentLinkCount ?? 0,
    currentSalesOrders: linkAgg?.currentSalesOrders ?? [],
    hasPendingLink: linkAgg?.hasPendingLink ?? false,
  };
}

export function buildProductionOrdersListResponse(args: {
  rows: ProductionOrderGridRow[];
  query: ProductionOrdersListQuery;
  total: number;
  statusCounts: Record<string, number>;
}): ProductionOrdersListResponse {
  const totalPages = Math.max(1, Math.ceil(args.total / args.query.pageSize));
  return {
    rows: args.rows,
    page: args.query.page,
    pageSize: args.query.pageSize,
    total: args.total,
    totalPages,
    statusCounts: args.statusCounts,
    appliedFilters: buildProductionOrdersAppliedFilters(args.query),
    periodField: PRODUCTION_ORDERS_LIST_PERIOD_FIELD,
  };
}
