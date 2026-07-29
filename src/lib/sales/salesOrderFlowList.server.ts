/**
 * OP-60 — Loader Prisma da lista paginada do Kanban.
 * Índice leve por coluna → ordenação determinística → cards só da página.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildSalesOrderNomusSellerWhereFromSellerKey,
  buildSalesOrderNomusSellerWhereFilter,
} from "@/src/lib/salesOrderNomusSellerDisplay.js";
import { loadCommissionSellerIdentityContext } from "@/src/lib/commissions/commissionSellerIdentity.server.js";
import {
  buildSalesOrderFlowSummarySnapshotWhere,
  type SalesOrderFlowSummaryFilters,
} from "./salesOrderFlowSummary.js";
import {
  buildSalesOrderFlowListColumnTotals,
  hasCriticalSalesOrderFlowInconsistency,
  mapSalesOrderFlowListCard,
  paginateSalesOrderFlowSortRows,
  parseSalesOrderFlowBadges,
  parseSalesOrderFlowInconsistencies,
  parseSalesOrderFlowListQuery,
  SALES_ORDER_FLOW_LIST_SORT_INDEX_CAP,
  type SalesOrderFlowCardSource,
  type SalesOrderFlowListColumn,
  type SalesOrderFlowListPayload,
  type SalesOrderFlowSortRow,
} from "./salesOrderFlowList.js";
import type { SalesOrderFlowStage } from "./salesOrderFlowCatalog.js";
import { serializeSalesOrderFlowSummaryFilters } from "./salesOrderFlowSummary.js";

export type SalesOrderFlowListDb = Pick<
  PrismaClient,
  "salesOrderFlowSnapshot" | "salesOrderItemFlowSnapshot"
> & {
  salesOrder?: PrismaClient["salesOrder"];
};

export type LoadSalesOrderFlowListOptions = {
  prisma: SalesOrderFlowListDb;
  scopeCustomerIds?: string[] | null;
  canViewValues?: boolean;
  canViewProduction?: boolean;
  canViewInconsistencies?: boolean;
  resolveSellerWhere?: (
    filters: SalesOrderFlowSummaryFilters
  ) => Promise<Prisma.SalesOrderWhereInput | null>;
  now?: () => Date;
};

async function defaultResolveSellerWhere(
  prisma: SalesOrderFlowListDb,
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

function andWhere(
  base: Prisma.SalesOrderFlowSnapshotWhereInput,
  extra: Prisma.SalesOrderFlowSnapshotWhereInput
): Prisma.SalesOrderFlowSnapshotWhereInput {
  if (!base || Object.keys(base).length === 0) return extra;
  return { AND: [base, extra] };
}

type LightRow = {
  salesOrderId: string;
  isOverdue: boolean;
  promisedDeliveryAt: Date | null;
  inconsistenciesJson: unknown;
  badgesJson: unknown;
  inconsistentItems: number;
  cutValue: unknown;
  bottleneckSalesOrderItemId: string | null;
  salesOrder: {
    orderCode: string;
    issueDate: Date;
    flowManagement: {
      priority: string;
      isBlocked: boolean;
    } | null;
  };
};

async function loadStageEnteredAtByBottleneck(
  prisma: SalesOrderFlowListDb,
  bottleneckItemIds: string[]
): Promise<Map<string, Date | null>> {
  const unique = [...new Set(bottleneckItemIds.filter(Boolean))];
  const map = new Map<string, Date | null>();
  if (unique.length === 0) return map;
  const rows = await prisma.salesOrderItemFlowSnapshot.findMany({
    where: { salesOrderItemId: { in: unique } },
    select: { salesOrderItemId: true, stageEnteredAt: true },
  });
  for (const row of rows) {
    map.set(row.salesOrderItemId, row.stageEnteredAt);
  }
  return map;
}

function toSortRows(
  light: LightRow[],
  stageEnteredByItem: Map<string, Date | null>
): SalesOrderFlowSortRow[] {
  return light.map((row) => {
    const inconsistencies = parseSalesOrderFlowInconsistencies(
      row.inconsistenciesJson
    );
    const stageEnteredAt = row.bottleneckSalesOrderItemId
      ? stageEnteredByItem.get(row.bottleneckSalesOrderItemId) ?? null
      : null;
    return {
      salesOrderId: row.salesOrderId,
      orderCode: row.salesOrder.orderCode,
      issueDate: row.salesOrder.issueDate,
      promisedDeliveryAt: row.promisedDeliveryAt,
      isOverdue: row.isOverdue,
      priority: row.salesOrder.flowManagement?.priority ?? "NORMAL",
      stageEnteredAt,
      hasCriticalInconsistency:
        hasCriticalSalesOrderFlowInconsistency(inconsistencies),
    };
  });
}

async function loadStageColumn(
  prisma: SalesOrderFlowListDb,
  input: {
    stage: SalesOrderFlowStage;
    baseWhere: Prisma.SalesOrderFlowSnapshotWhereInput;
    cursor: string | null | undefined;
    limit: number;
    canViewValues: boolean;
    canViewProduction: boolean;
    canViewInconsistencies: boolean;
    now: Date;
  }
): Promise<SalesOrderFlowListColumn> {
  const where = andWhere(input.baseWhere, { currentStage: input.stage });

  const light = (await prisma.salesOrderFlowSnapshot.findMany({
    where,
    take: SALES_ORDER_FLOW_LIST_SORT_INDEX_CAP,
    select: {
      salesOrderId: true,
      isOverdue: true,
      promisedDeliveryAt: true,
      inconsistenciesJson: true,
      badgesJson: true,
      inconsistentItems: true,
      cutValue: true,
      bottleneckSalesOrderItemId: true,
      salesOrder: {
        select: {
          orderCode: true,
          issueDate: true,
          flowManagement: {
            select: { priority: true, isBlocked: true },
          },
        },
      },
    },
  })) as unknown as LightRow[];

  const sortIndexTruncated = light.length >= SALES_ORDER_FLOW_LIST_SORT_INDEX_CAP;
  const stageEnteredByItem = await loadStageEnteredAtByBottleneck(
    prisma,
    light
      .map((r) => r.bottleneckSalesOrderItemId)
      .filter((id): id is string => Boolean(id))
  );
  const sortRows = toSortRows(light, stageEnteredByItem);
  const page = paginateSalesOrderFlowSortRows({
    rows: sortRows,
    cursor: input.cursor,
    stage: input.stage,
    limit: input.limit,
  });

  const totals = buildSalesOrderFlowListColumnTotals(
    light.map((row) => ({
      isOverdue: row.isOverdue,
      isBlocked: row.salesOrder.flowManagement?.isBlocked === true,
      inconsistentItems: row.inconsistentItems,
      badges: parseSalesOrderFlowBadges(row.badgesJson),
      cutValue: Number(row.cutValue ?? 0),
    }))
  );

  const pageIds = page.page.map((r) => r.salesOrderId);
  if (pageIds.length === 0) {
    return {
      stage: input.stage,
      total: sortRows.length,
      cards: [],
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      totals,
      sortIndexTruncated,
    };
  }

  const fullRows = await prisma.salesOrderFlowSnapshot.findMany({
    where: { salesOrderId: { in: pageIds } },
    select: {
      salesOrderId: true,
      currentStage: true,
      bottleneckStage: true,
      nextAction: true,
      responsibleArea: true,
      bottleneckReason: true,
      totalItems: true,
      activeItems: true,
      completedItems: true,
      pendingItems: true,
      inconsistentItems: true,
      canceledItems: true,
      progressProductionOrder: true,
      progressProduced: true,
      progressDocumented: true,
      progressInvoiced: true,
      progressShipped: true,
      orderValue: true,
      fulfilledValue: true,
      activeResidualValue: true,
      cutValue: true,
      canceledValue: true,
      promisedDeliveryAt: true,
      isOverdue: true,
      inconsistenciesJson: true,
      badgesJson: true,
      bottleneckSalesOrderItemId: true,
      salesOrder: {
        select: {
          orderCode: true,
          issueDate: true,
          nomusSellerName: true,
          responsible: true,
          companyIssuer: true,
          Customer: {
            select: { companyName: true, tradeName: true },
          },
          flowManagement: {
            select: {
              priority: true,
              isBlocked: true,
              blockReason: true,
            },
          },
        },
      },
    },
  });

  const byId = new Map(
    fullRows.map((row) => {
      const stageEnteredAt = row.bottleneckSalesOrderItemId
        ? stageEnteredByItem.get(row.bottleneckSalesOrderItemId) ?? null
        : null;
      const source: SalesOrderFlowCardSource = {
        ...(row as Omit<SalesOrderFlowCardSource, "stageEnteredAt">),
        stageEnteredAt,
      };
      return [row.salesOrderId, source] as const;
    })
  );

  const cards = pageIds
    .map((id) => byId.get(id))
    .filter((row): row is SalesOrderFlowCardSource => row != null)
    .map((row) =>
      mapSalesOrderFlowListCard(row, {
        canViewValues: input.canViewValues,
        canViewProduction: input.canViewProduction,
        canViewInconsistencies: input.canViewInconsistencies,
        now: input.now,
      })
    );

  if (!input.canViewInconsistencies) {
    totals.inconsistentCount = null;
  }

  return {
    stage: input.stage,
    total: sortRows.length,
    cards,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    totals,
    sortIndexTruncated,
  };
}

export async function loadSalesOrderFlowList(
  query: Record<string, unknown>,
  options: LoadSalesOrderFlowListOptions
): Promise<SalesOrderFlowListPayload> {
  const parsed = parseSalesOrderFlowListQuery(query);
  const canViewValues = options.canViewValues !== false;
  const canViewProduction = options.canViewProduction !== false;
  const canViewInconsistencies = options.canViewInconsistencies !== false;
  const now = options.now?.() ?? new Date();
  const sellerWhere = options.resolveSellerWhere
    ? await options.resolveSellerWhere(parsed.filters)
    : await defaultResolveSellerWhere(options.prisma, parsed.filters);

  const baseWhere = buildSalesOrderFlowSummarySnapshotWhere({
    filters: parsed.filters,
    sellerWhere,
    scopeCustomerIds: options.scopeCustomerIds ?? null,
  });

  const columns = await Promise.all(
    parsed.stages.map((stage) =>
      loadStageColumn(options.prisma, {
        stage,
        baseWhere,
        cursor: parsed.cursors[stage] ?? null,
        limit: parsed.limit,
        canViewValues,
        canViewProduction,
        canViewInconsistencies,
        now,
      })
    )
  );

  return {
    filters: {
      ...serializeSalesOrderFlowSummaryFilters(parsed.filters),
      stages: parsed.stages,
      limit: parsed.limit,
    },
    columns,
    valuesVisible: canViewValues,
    productionVisible: canViewProduction,
    inconsistenciesVisible: canViewInconsistencies,
    generatedAt: now.toISOString(),
  };
}
