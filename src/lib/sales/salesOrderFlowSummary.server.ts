/**
 * OP-59 — Loader Prisma do resumo do Kanban (somente snapshots + overlay).
 * Não recalcula o motor na requisição.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildSalesOrderNomusSellerWhereFromSellerKey,
  buildSalesOrderNomusSellerWhereFilter,
} from "@/src/lib/salesOrderNomusSellerDisplay.js";
import { loadCommissionSellerIdentityContext } from "@/src/lib/commissions/commissionSellerIdentity.server.js";
import {
  buildSalesOrderFlowSummaryPayload,
  buildSalesOrderFlowSummarySnapshotWhere,
  parseSalesOrderFlowSummaryQuery,
  type SalesOrderFlowSummaryFilters,
  type SalesOrderFlowSummaryPayload,
  type SalesOrderFlowSummaryStageAggregate,
  type SalesOrderFlowSummaryTotals,
} from "./salesOrderFlowSummary.js";

export type SalesOrderFlowSummaryDb = Pick<
  PrismaClient,
  "salesOrderFlowSnapshot"
> & {
  // Usado apenas para resolver filtro textual de vendedor.
  salesOrder?: PrismaClient["salesOrder"];
};

export type LoadSalesOrderFlowSummaryOptions = {
  prisma: SalesOrderFlowSummaryDb;
  scopeCustomerIds?: string[] | null;
  canViewValues?: boolean;
  resolveSellerWhere?: (
    filters: SalesOrderFlowSummaryFilters
  ) => Promise<Prisma.SalesOrderWhereInput | null>;
  now?: () => Date;
};

function andWhere(
  base: Prisma.SalesOrderFlowSnapshotWhereInput,
  extra: Prisma.SalesOrderFlowSnapshotWhereInput
): Prisma.SalesOrderFlowSnapshotWhereInput {
  if (!base || Object.keys(base).length === 0) return extra;
  return { AND: [base, extra] };
}

async function defaultResolveSellerWhere(
  prisma: SalesOrderFlowSummaryDb,
  filters: SalesOrderFlowSummaryFilters
): Promise<Prisma.SalesOrderWhereInput | null> {
  if (filters.sellerKey) {
    const byKey = buildSalesOrderNomusSellerWhereFromSellerKey(filters.sellerKey);
    if (byKey) return byKey;
  }
  if (!filters.seller) return null;
  if (!prisma.salesOrder) {
    const asNum = Number(filters.seller);
    if (Number.isInteger(asNum) && asNum > 0) {
      return { externalSellerId: asNum };
    }
    return {
      nomusSellerName: { contains: filters.seller, mode: "insensitive" },
    };
  }
  const ctx = await loadCommissionSellerIdentityContext(prisma as PrismaClient);
  return buildSalesOrderNomusSellerWhereFilter(filters.seller, ctx);
}

export async function loadSalesOrderFlowSummary(
  query: Record<string, unknown>,
  options: LoadSalesOrderFlowSummaryOptions
): Promise<SalesOrderFlowSummaryPayload> {
  const filters = parseSalesOrderFlowSummaryQuery(query);
  const canViewValues = options.canViewValues !== false;
  const sellerWhere = options.resolveSellerWhere
    ? await options.resolveSellerWhere(filters)
    : await defaultResolveSellerWhere(options.prisma, filters);

  const where = buildSalesOrderFlowSummarySnapshotWhere({
    filters,
    sellerWhere,
    scopeCustomerIds: options.scopeCustomerIds ?? null,
  });

  const db = options.prisma.salesOrderFlowSnapshot;

  const [
    groups,
    overdueCount,
    blockedCount,
    inconsistentCount,
    partiallyShippedCount,
    completedWithCutCount,
    canceledCount,
    lastAggregate,
  ] = await Promise.all([
    db.groupBy({
      by: ["currentStage"],
      where,
      _count: { _all: true },
      _sum: {
        orderValue: true,
        activeResidualValue: true,
      },
    }),
    db.count({ where: andWhere(where, { isOverdue: true }) }),
    db.count({
      where: andWhere(where, {
        salesOrder: { flowManagement: { is: { isBlocked: true } } },
      }),
    }),
    db.count({
      where: andWhere(where, { inconsistentItems: { gt: 0 } }),
    }),
    db.count({
      where: andWhere(where, {
        badgesJson: { array_contains: ["PARTIAL"] },
      }),
    }),
    db.count({
      where: andWhere(where, {
        currentStage: "SHIPPED_COMPLETED",
        cutValue: { gt: 0 },
      }),
    }),
    db.count({
      where: andWhere(where, { currentStage: "CANCELED" }),
    }),
    db.aggregate({
      where,
      _max: { computedAt: true },
    }),
  ]);

  const aggregates: SalesOrderFlowSummaryStageAggregate[] = groups.map(
    (row) => ({
      stage: row.currentStage,
      orderCount: row._count._all,
      orderValue: Number(row._sum.orderValue ?? 0),
      activeResidualValue: Number(row._sum.activeResidualValue ?? 0),
    })
  );

  const totals: SalesOrderFlowSummaryTotals = {
    overdueCount,
    blockedCount,
    inconsistentCount,
    partiallyShippedCount,
    completedWithCutCount,
    canceledCount,
  };

  return buildSalesOrderFlowSummaryPayload({
    filters,
    aggregates,
    totals,
    lastUpdatedAt: lastAggregate._max.computedAt,
    canViewValues,
    generatedAt: options.now?.() ?? new Date(),
  });
}
