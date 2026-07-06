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

  return mergeAffectedSalesOrderRefs(bucket);
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
      snapshot: { action: snapshot.action, snapshotId: snapshot.snapshotId },
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
  const orders: CommissionMaterializationOrderResult[] = [];

  for (const ref of affected) {
    orders.push(await processSalesOrderMaterialization(db, ref, dryRun, deps));
  }

  return aggregateMaterializationRunSummary({
    dryRun,
    since: input.since ?? null,
    orders,
  });
}
