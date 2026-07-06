import type { PrismaClient } from "@prisma/client";
import {
  aggregateMaterializationRunSummary,
  buildMaterializationOrderResult,
  mergeAffectedSalesOrderRefs,
  type AffectedSalesOrderRef,
  type AffectedSalesOrderSource,
  type CommissionMaterializationOrderResult,
  type CommissionMaterializationRunSummary,
} from "./commissionMaterializationOrchestrator.js";
import {
  materializeCommissionForSalesOrder,
  SalesOrderNotFoundError,
} from "./commissionOrderMaterializer.server.js";
import {
  OrderSnapshotNotFoundError,
  rebuildCommissionReceivableSchedule,
} from "./commissionReceivableScheduler.server.js";

export type RebuildCommissionMaterializationInput = {
  since?: Date | null;
  year?: number | null;
  month?: number | null;
  seller?: string | null;
  customer?: string | null;
  limit?: number | null;
  salesOrderIds?: string[];
  nfeIds?: number[];
  receivableIds?: number[];
  preview?: boolean;
  apply?: boolean;
};

export type MaterializationOrchestratorDeps = {
  materialize: typeof materializeCommissionForSalesOrder;
  rebuildSchedule: typeof rebuildCommissionReceivableSchedule;
};

const defaultDeps: MaterializationOrchestratorDeps = {
  materialize: materializeCommissionForSalesOrder,
  rebuildSchedule: rebuildCommissionReceivableSchedule,
};

export async function resolveSalesOrderIdsFromNfeExternalIds(
  db: Pick<PrismaClient, "salesOrderNfeLink">,
  nfeIds: number[]
): Promise<AffectedSalesOrderRef[]> {
  const unique = [...new Set(nfeIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return [];

  const links = await db.salesOrderNfeLink.findMany({
    where: { nfeExternalId: { in: unique } },
    select: { salesOrderId: true, nfeExternalId: true },
  });

  return mergeAffectedSalesOrderRefs(
    links.map((link) => ({
      salesOrderId: link.salesOrderId,
      sources: ["NFE"] as AffectedSalesOrderSource[],
    }))
  );
}

export async function resolveSalesOrderIdsFromReceivableExternalIds(
  db: Pick<PrismaClient, "nomusAccountsReceivable" | "salesOrderNfeLink">,
  receivableIds: number[]
): Promise<AffectedSalesOrderRef[]> {
  const unique = [...new Set(receivableIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return [];

  const receivables = await db.nomusAccountsReceivable.findMany({
    where: { externalId: { in: unique } },
    select: { externalId: true, sourceInvoiceId: true },
  });

  const nfeIds = [
    ...new Set(
      receivables
        .map((row) => row.sourceInvoiceId)
        .filter((id): id is number => id != null && Number.isFinite(id) && id > 0)
    ),
  ];
  if (nfeIds.length === 0) return [];

  const links = await db.salesOrderNfeLink.findMany({
    where: { nfeExternalId: { in: nfeIds } },
    select: { salesOrderId: true },
  });

  return mergeAffectedSalesOrderRefs(
    links.map((link) => ({
      salesOrderId: link.salesOrderId,
      sources: ["RECEIVABLE"] as AffectedSalesOrderSource[],
    }))
  );
}

export async function discoverAffectedSalesOrderRefsSince(
  db: PrismaClient,
  since: Date
): Promise<AffectedSalesOrderRef[]> {
  const bucket: AffectedSalesOrderRef[] = [];

  const [orders, items, nfeLinks, syncedNfes, syncedReceivables, customers, sellers, aliases, rulesChanged, exclusionsChanged] =
    await Promise.all([
      db.salesOrder.findMany({
        where: { updatedAt: { gte: since } },
        select: { id: true },
      }),
      db.salesOrderItem.findMany({
        where: { updatedAt: { gte: since } },
        select: { salesOrderId: true },
        distinct: ["salesOrderId"],
      }),
      db.salesOrderNfeLink.findMany({
        where: { updatedAt: { gte: since } },
        select: { salesOrderId: true },
      }),
      db.nomusNfe.findMany({
        where: { syncedAt: { gte: since } },
        select: { externalId: true },
      }),
      db.nomusAccountsReceivable.findMany({
        where: { syncedAt: { gte: since } },
        select: { sourceInvoiceId: true },
      }),
      db.customer.findMany({
        where: { updatedAt: { gte: since } },
        select: { id: true },
      }),
      db.commissionPerson.findMany({
        where: { updatedAt: { gte: since }, type: "SELLER" },
        select: { nomusPersonId: true },
      }),
      db.commissionPersonAlias.findMany({
        where: { updatedAt: { gte: since } },
        select: { rawSellerId: true },
      }),
      db.commissionRule.findFirst({
        where: { updatedAt: { gte: since } },
        select: { id: true },
      }),
      db.commissionCustomerExclusionRule.findFirst({
        where: { updatedAt: { gte: since } },
        select: { id: true },
      }),
    ]);

  bucket.push(
    ...orders.map((row) => ({ salesOrderId: row.id, sources: ["SALES_ORDER"] as const })),
    ...items.map((row) => ({ salesOrderId: row.salesOrderId, sources: ["SALES_ORDER"] as const })),
    ...nfeLinks.map((row) => ({ salesOrderId: row.salesOrderId, sources: ["NFE"] as const }))
  );

  if (syncedNfes.length > 0) {
    const fromNfe = await resolveSalesOrderIdsFromNfeExternalIds(
      db,
      syncedNfes.map((row) => row.externalId)
    );
    bucket.push(...fromNfe);
  }

  const nfeIdsFromReceivables = [
    ...new Set(
      syncedReceivables
        .map((row) => row.sourceInvoiceId)
        .filter((id): id is number => id != null && Number.isFinite(id) && id > 0)
    ),
  ];
  if (nfeIdsFromReceivables.length > 0) {
    const fromReceivableNfe = await resolveSalesOrderIdsFromNfeExternalIds(db, nfeIdsFromReceivables);
    bucket.push(
      ...fromReceivableNfe.map((ref) => ({
        salesOrderId: ref.salesOrderId,
        sources: ["RECEIVABLE"] as AffectedSalesOrderSource[],
      }))
    );
  }

  if (customers.length > 0) {
    const customerOrders = await db.salesOrder.findMany({
      where: { customerId: { in: customers.map((row) => row.id) } },
      select: { id: true },
    });
    bucket.push(
      ...customerOrders.map((row) => ({
        salesOrderId: row.id,
        sources: ["CUSTOMER"] as const,
      }))
    );
  }

  const sellerNomusIds = [
    ...new Set(
      [
        ...sellers.map((row) => row.nomusPersonId),
        ...aliases.map((row) => row.rawSellerId),
      ].filter((id): id is number => id != null && Number.isFinite(id) && id > 0)
    ),
  ];
  if (sellerNomusIds.length > 0) {
    const sellerOrders = await db.salesOrder.findMany({
      where: { externalSellerId: { in: sellerNomusIds } },
      select: { id: true },
    });
    bucket.push(
      ...sellerOrders.map((row) => ({
        salesOrderId: row.id,
        sources: ["SELLER"] as const,
      }))
    );
  }

  if (rulesChanged) {
    const [ruleOrders, snapshotOrders] = await Promise.all([
      db.salesOrder.findMany({
        where: { issueDate: { gte: since } },
        select: { id: true },
      }),
      db.commissionOrderSnapshot.findMany({
        where: { status: "ACTIVE", saleDate: { gte: since } },
        select: { salesOrderId: true },
        distinct: ["salesOrderId"],
      }),
    ]);
    bucket.push(
      ...ruleOrders.map((row) => ({
        salesOrderId: row.id,
        sources: ["COMMISSION_RULE"] as const,
      })),
      ...snapshotOrders.map((row) => ({
        salesOrderId: row.salesOrderId,
        sources: ["COMMISSION_RULE"] as const,
      }))
    );
  }

  if (exclusionsChanged) {
    const changedRules = await db.commissionCustomerExclusionRule.findMany({
      where: { updatedAt: { gte: since } },
      select: { customerId: true, customerExternalId: true },
    });
    const customerIds = changedRules
      .map((row) => row.customerId)
      .filter((id): id is string => id != null);
    const externalCustomerIds = changedRules
      .map((row) => row.customerExternalId)
      .filter((id): id is number => id != null && Number.isFinite(id));

    const exclusionOrders = await db.salesOrder.findMany({
      where: {
        OR: [
          customerIds.length > 0 ? { customerId: { in: customerIds } } : undefined,
          externalCustomerIds.length > 0
            ? { externalCustomerId: { in: externalCustomerIds } }
            : undefined,
          { issueDate: { gte: since } },
        ].filter(Boolean) as never,
      },
      select: { id: true },
    });
    bucket.push(
      ...exclusionOrders.map((row) => ({
        salesOrderId: row.id,
        sources: ["CUSTOMER_EXCLUSION"] as const,
      }))
    );
  }

  return mergeAffectedSalesOrderRefs(bucket);
}

export async function discoverSalesOrderRefsForReceiptMonth(
  db: Pick<PrismaClient, "nomusAccountsReceivable" | "salesOrderNfeLink">,
  year: number,
  month: number
): Promise<AffectedSalesOrderRef[]> {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59, 999);

  const receivables = await db.nomusAccountsReceivable.findMany({
    where: {
      settlementDate: { gte: from, lte: to },
      amountReceived: { gt: 0 },
    },
    select: { sourceInvoiceId: true },
  });

  const nfeIds = [
    ...new Set(
      receivables
        .map((row) => row.sourceInvoiceId)
        .filter((id): id is number => id != null && Number.isFinite(id) && id > 0)
    ),
  ];
  if (nfeIds.length === 0) return [];

  const refs = await resolveSalesOrderIdsFromNfeExternalIds(db, nfeIds);
  return refs.map((ref) => ({
    salesOrderId: ref.salesOrderId,
    sources: [...new Set<AffectedSalesOrderSource>([...ref.sources, "RECEIVABLE"])],
  }));
}

export async function filterAffectedSalesOrderRefs(
  db: Pick<PrismaClient, "salesOrder">,
  refs: AffectedSalesOrderRef[],
  filters: { seller?: string | null; customer?: string | null }
): Promise<AffectedSalesOrderRef[]> {
  const sellerNeedle = filters.seller?.trim().toLowerCase();
  const customerNeedle = filters.customer?.trim().toLowerCase();
  if (!sellerNeedle && !customerNeedle) return refs;

  const orderIds = refs.map((ref) => ref.salesOrderId);
  if (orderIds.length === 0) return [];

  const orders = await db.salesOrder.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      externalSellerId: true,
      responsible: true,
      customerId: true,
      Customer: { select: { name: true } },
    },
  });

  const allowed = new Set(
    orders
      .filter((order) => {
        if (sellerNeedle) {
          const haystacks = [String(order.externalSellerId ?? ""), order.responsible ?? ""]
            .map((value) => value.toLowerCase())
            .filter(Boolean);
          if (
            !haystacks.some(
              (value) => value.includes(sellerNeedle) || sellerNeedle.includes(value)
            )
          ) {
            return false;
          }
        }
        if (customerNeedle) {
          const name = (order.Customer?.name ?? "").toLowerCase();
          const customerId = (order.customerId ?? "").toLowerCase();
          if (
            !name.includes(customerNeedle) &&
            !customerNeedle.includes(name) &&
            !customerId.includes(customerNeedle)
          ) {
            return false;
          }
        }
        return true;
      })
      .map((order) => order.id)
  );

  return refs.filter((ref) => allowed.has(ref.salesOrderId));
}

async function loadMaterializationArtifactCounts(
  db: Pick<PrismaClient, "commissionOrderSnapshot" | "commissionReceivableSchedule">,
  salesOrderIds: string[]
): Promise<{ activeSnapshots: number; activeSchedules: number }> {
  if (salesOrderIds.length === 0) {
    return { activeSnapshots: 0, activeSchedules: 0 };
  }
  const [activeSnapshots, activeSchedules] = await Promise.all([
    db.commissionOrderSnapshot.count({
      where: { salesOrderId: { in: salesOrderIds }, status: "ACTIVE" },
    }),
    db.commissionReceivableSchedule.count({
      where: { salesOrderId: { in: salesOrderIds }, status: "ACTIVE" },
    }),
  ]);
  return { activeSnapshots, activeSchedules };
}

async function loadClosedReceiptClosings(
  db: Pick<PrismaClient, "commissionMonthlyClosing">,
  year?: number | null,
  month?: number | null
): Promise<Array<{ closingId: string; year: number; month: number }>> {
  const rows = await db.commissionMonthlyClosing.findMany({
    where: {
      status: "CLOSED",
      ...(year != null ? { year } : {}),
      ...(month != null ? { month } : {}),
    },
    select: { id: true, year: true, month: true },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });
  return rows.map((row) => ({
    closingId: row.id,
    year: row.year,
    month: row.month,
  }));
}

async function resolveAffectedSalesOrderRefs(
  db: PrismaClient,
  input: RebuildCommissionMaterializationInput
): Promise<AffectedSalesOrderRef[]> {
  const bucket: AffectedSalesOrderRef[] = [];

  if (input.salesOrderIds?.length) {
    bucket.push(
      ...input.salesOrderIds.map((salesOrderId) => ({
        salesOrderId,
        sources: ["SALES_ORDER"] as AffectedSalesOrderSource[],
      }))
    );
  }

  if (input.nfeIds?.length) {
    bucket.push(...(await resolveSalesOrderIdsFromNfeExternalIds(db, input.nfeIds)));
  }

  if (input.receivableIds?.length) {
    bucket.push(
      ...(await resolveSalesOrderIdsFromReceivableExternalIds(db, input.receivableIds))
    );
  }

  if (input.since) {
    bucket.push(...(await discoverAffectedSalesOrderRefsSince(db, input.since)));
  }

  if (input.year != null && input.month != null) {
    bucket.push(...(await discoverSalesOrderRefsForReceiptMonth(db, input.year, input.month)));
  }

  let merged = mergeAffectedSalesOrderRefs(bucket);
  merged = await filterAffectedSalesOrderRefs(db, merged, {
    seller: input.seller,
    customer: input.customer,
  });

  if (input.limit != null && input.limit > 0) {
    merged = merged.slice(0, input.limit);
  }

  return merged;
}

async function processSalesOrderMaterialization(
  db: PrismaClient,
  ref: AffectedSalesOrderRef,
  dryRun: boolean,
  deps: MaterializationOrchestratorDeps
): Promise<CommissionMaterializationOrderResult> {
  try {
    const snapshot = await deps.materialize(db, {
      salesOrderId: ref.salesOrderId,
      dryRun,
    });

    let schedule = null;
    try {
      schedule = await deps.rebuildSchedule(db, {
        salesOrderId: ref.salesOrderId,
        dryRun,
      });
    } catch (error) {
      if (error instanceof OrderSnapshotNotFoundError) {
        schedule = null;
      } else {
        throw error;
      }
    }

    return buildMaterializationOrderResult({
      salesOrderId: ref.salesOrderId,
      sources: ref.sources,
      snapshot: {
        action: snapshot.action,
        snapshotId: snapshot.snapshotId,
        preview: snapshot.preview,
      },
      schedule,
    });
  } catch (error) {
    const message =
      error instanceof SalesOrderNotFoundError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    return buildMaterializationOrderResult({
      salesOrderId: ref.salesOrderId,
      sources: ref.sources,
      snapshot: null,
      schedule: null,
      error: message,
    });
  }
}

/**
 * Identifica pedidos afetados e, para cada um, materializa snapshot + schedule de CR.
 * Idempotente via sourceHash dos artefatos filhos. Não altera fechamentos CLOSED.
 */
export async function rebuildCommissionMaterializationForAffectedSales(
  db: PrismaClient,
  input: RebuildCommissionMaterializationInput,
  deps: MaterializationOrchestratorDeps = defaultDeps
): Promise<CommissionMaterializationRunSummary> {
  const dryRun = input.apply !== true;
  const affected = await resolveAffectedSalesOrderRefs(db, input);
  const salesOrderIds = affected.map((ref) => ref.salesOrderId);
  const baseline = await loadMaterializationArtifactCounts(db, salesOrderIds);
  const closedClosingsPreserved = await loadClosedReceiptClosings(
    db,
    input.year,
    input.month
  );

  const orders: CommissionMaterializationOrderResult[] = [];
  for (const ref of affected) {
    orders.push(await processSalesOrderMaterialization(db, ref, dryRun, deps));
  }

  const after = await loadMaterializationArtifactCounts(db, salesOrderIds);

  return aggregateMaterializationRunSummary({
    dryRun,
    since: input.since ?? null,
    year: input.year ?? null,
    month: input.month ?? null,
    sellerFilter: input.seller ?? null,
    customerFilter: input.customer ?? null,
    limit: input.limit ?? null,
    closedClosingsPreserved,
    baseline,
    after,
    orders,
  });
}
