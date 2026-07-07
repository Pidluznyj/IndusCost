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
import { isCommissionInternalGroupReceivable } from "./commissionInternalGroupExclusion.js";
import type { CommissionReceivableScheduleRebuildResult } from "./commissionReceivableScheduler.js";
import {
  materializeCommissionForSalesOrder,
  SalesOrderCustomerMissingError,
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
      nfeIds: [link.nfeExternalId],
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
    select: { salesOrderId: true, nfeExternalId: true },
  });

  return mergeAffectedSalesOrderRefs(
    links.map((link) => ({
      salesOrderId: link.salesOrderId,
      sources: ["RECEIVABLE"] as AffectedSalesOrderSource[],
      nfeIds: [link.nfeExternalId],
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
    select: { sourceInvoiceId: true, personName: true, personCnpj: true },
  });

  const commercialReceivables = receivables.filter(
    (row) =>
      !isCommissionInternalGroupReceivable({
        customerName: row.personName,
        customerCnpj: row.personCnpj,
      })
  );

  const nfeIds = [
    ...new Set(
      commercialReceivables
        .map((row) => row.sourceInvoiceId)
        .filter((id): id is number => id != null && Number.isFinite(id) && id > 0)
    ),
  ];
  if (nfeIds.length === 0) return [];

  const links = await db.salesOrderNfeLink.findMany({
    where: { nfeExternalId: { in: nfeIds } },
    select: { salesOrderId: true, nfeExternalId: true },
  });

  return mergeAffectedSalesOrderRefs(
    links.map((link) => ({
      salesOrderId: link.salesOrderId,
      sources: ["RECEIVABLE"] as AffectedSalesOrderSource[],
      nfeIds: [link.nfeExternalId],
    }))
  );
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

async function resolveTargetNfeIdsForMaterialization(
  db: Pick<PrismaClient, "salesOrderNfeLink">,
  ref: AffectedSalesOrderRef
): Promise<Array<number | null>> {
  if (ref.nfeIds?.length) {
    return [...new Set(ref.nfeIds)];
  }
  const links = await db.salesOrderNfeLink.findMany({
    where: { salesOrderId: ref.salesOrderId },
    select: { nfeExternalId: true },
  });
  if (links.length === 0) return [null];
  return [...new Set(links.map((link) => link.nfeExternalId))];
}

function mergeScheduleRebuildResults(
  left: CommissionReceivableScheduleRebuildResult,
  right: CommissionReceivableScheduleRebuildResult
): CommissionReceivableScheduleRebuildResult {
  const schedulesCreated = left.schedulesCreated + right.schedulesCreated;
  const schedulesSuperseded = left.schedulesSuperseded + right.schedulesSuperseded;
  const schedulesStaled = left.schedulesStaled + right.schedulesStaled;
  const schedulesUnchanged = left.schedulesUnchanged + right.schedulesUnchanged;

  let action: CommissionReceivableScheduleRebuildResult["action"] = "unchanged";
  if (schedulesCreated > 0 && schedulesSuperseded === 0 && schedulesStaled === 0) {
    action = schedulesUnchanged > 0 ? "mixed" : "created";
  } else if (schedulesSuperseded > 0 || schedulesStaled > 0) {
    action = schedulesCreated > 0 || schedulesStaled > 0 ? "updated" : "unchanged";
  }
  if (schedulesCreated === 0 && schedulesSuperseded === 0 && schedulesStaled === 0) {
    action = "unchanged";
  } else if (
    schedulesCreated > 0 &&
    (schedulesSuperseded > 0 || schedulesStaled > 0 || schedulesUnchanged > 0)
  ) {
    action = "mixed";
  }
  if (left.action !== right.action && left.action !== "unchanged" && right.action !== "unchanged") {
    action = "mixed";
  } else if (left.action !== "unchanged") {
    action = left.action;
  } else if (right.action !== "unchanged") {
    action = right.action;
  }

  return {
    action,
    orderSnapshotId: right.orderSnapshotId || left.orderSnapshotId,
    schedulesCreated,
    schedulesSuperseded,
    schedulesStaled,
    schedulesUnchanged,
    dryRun: left.dryRun,
    preview: [...left.preview, ...right.preview],
  };
}

async function rebuildScheduleAfterMaterialize(
  db: PrismaClient,
  deps: MaterializationOrchestratorDeps,
  input: {
    salesOrderId: string;
    requestedNfeId: number | null;
    materializedNfeId: number | null;
    dryRun: boolean;
  }
): Promise<CommissionReceivableScheduleRebuildResult | null> {
  const candidates = [
    input.materializedNfeId,
    input.requestedNfeId,
    null,
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  for (const nfeId of candidates) {
    try {
      return await deps.rebuildSchedule(db, {
        salesOrderId: input.salesOrderId,
        ...(nfeId != null ? { nfeId } : {}),
        dryRun: input.dryRun,
      });
    } catch (error) {
      if (error instanceof OrderSnapshotNotFoundError) continue;
      throw error;
    }
  }
  return null;
}

type ReceiptMonthReceivableRef = {
  receivableId: number;
  sourceInvoiceId: number | null;
};

export async function loadCommercialReceiptMonthReceivableRefs(
  db: Pick<PrismaClient, "nomusAccountsReceivable">,
  year: number,
  month: number
): Promise<ReceiptMonthReceivableRef[]> {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59, 999);

  const receivables = await db.nomusAccountsReceivable.findMany({
    where: {
      settlementDate: { gte: from, lte: to },
      amountReceived: { gt: 0 },
    },
    select: {
      externalId: true,
      sourceInvoiceId: true,
      personName: true,
      personCnpj: true,
    },
  });

  return receivables
    .filter(
      (row) =>
        !isCommissionInternalGroupReceivable({
          customerName: row.personName,
          customerCnpj: row.personCnpj,
        })
    )
    .map((row) => ({
      receivableId: row.externalId,
      sourceInvoiceId: row.sourceInvoiceId,
    }));
}

async function ensureReceiptMonthReceivableSchedules(
  db: PrismaClient,
  input: {
    year: number;
    month: number;
    dryRun: boolean;
    processedPairs: Set<string>;
    deps: MaterializationOrchestratorDeps;
  }
): Promise<{
  receivablesChecked: number;
  receivablesMissingBefore: number;
  schedulesEnsured: number;
  unlinkedReceivables: number;
  errors: Array<{ receivableId: number; message: string }>;
}> {
  const receivables = await loadCommercialReceiptMonthReceivableRefs(
    db,
    input.year,
    input.month
  );
  if (receivables.length === 0) {
    return {
      receivablesChecked: 0,
      receivablesMissingBefore: 0,
      schedulesEnsured: 0,
      unlinkedReceivables: 0,
      errors: [],
    };
  }

  const receivableIds = receivables.map((row) => row.receivableId);
  const activeSchedules = await db.commissionReceivableSchedule.findMany({
    where: { receivableId: { in: receivableIds }, status: "ACTIVE" },
    select: { receivableId: true },
  });
  const scheduled = new Set(activeSchedules.map((row) => row.receivableId));
  const missing = receivables.filter((row) => !scheduled.has(row.receivableId));

  let schedulesEnsured = 0;
  let unlinkedReceivables = 0;
  const errors: Array<{ receivableId: number; message: string }> = [];

  for (const receivable of missing) {
    if (receivable.sourceInvoiceId == null) {
      unlinkedReceivables += 1;
      continue;
    }

    const link = await db.salesOrderNfeLink.findFirst({
      where: { nfeExternalId: receivable.sourceInvoiceId },
      select: { salesOrderId: true, nfeExternalId: true },
    });
    if (!link) {
      unlinkedReceivables += 1;
      continue;
    }

    const pairKey = `${link.salesOrderId}|${link.nfeExternalId}`;
    input.processedPairs.add(pairKey);

    try {
      const snapshot = await input.deps.materialize(db, {
        salesOrderId: link.salesOrderId,
        nfeId: link.nfeExternalId,
        dryRun: input.dryRun,
      });
      const schedule = await rebuildScheduleAfterMaterialize(db, input.deps, {
        salesOrderId: link.salesOrderId,
        requestedNfeId: link.nfeExternalId,
        materializedNfeId: snapshot.preview.nfeId,
        dryRun: input.dryRun,
      });
      if (schedule && schedule.schedulesCreated > 0) {
        schedulesEnsured += 1;
        continue;
      }

      const after = await db.commissionReceivableSchedule.findFirst({
        where: { receivableId: receivable.receivableId, status: "ACTIVE" },
        select: { id: true },
      });
      if (after) schedulesEnsured += 1;
    } catch (error) {
      const message =
        error instanceof SalesOrderNotFoundError ||
        error instanceof SalesOrderCustomerMissingError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      errors.push({ receivableId: receivable.receivableId, message });
    }
  }

  return {
    receivablesChecked: receivables.length,
    receivablesMissingBefore: missing.length,
    schedulesEnsured,
    unlinkedReceivables,
    errors,
  };
}

async function processSalesOrderMaterialization(
  db: PrismaClient,
  ref: AffectedSalesOrderRef,
  dryRun: boolean,
  deps: MaterializationOrchestratorDeps
): Promise<CommissionMaterializationOrderResult> {
  try {
    const targetNfeIds = await resolveTargetNfeIdsForMaterialization(db, ref);
    let lastSnapshot: Awaited<ReturnType<MaterializationOrchestratorDeps["materialize"]>> | null =
      null;
    let mergedSchedule: CommissionReceivableScheduleRebuildResult | null = null;

    for (const nfeId of targetNfeIds) {
      const snapshot = await deps.materialize(db, {
        salesOrderId: ref.salesOrderId,
        ...(nfeId != null ? { nfeId } : {}),
        dryRun,
      });
      lastSnapshot = snapshot;

      const schedule = await rebuildScheduleAfterMaterialize(db, deps, {
        salesOrderId: ref.salesOrderId,
        requestedNfeId: nfeId,
        materializedNfeId: snapshot.preview.nfeId,
        dryRun,
      });
      if (schedule) {
        mergedSchedule = mergedSchedule
          ? mergeScheduleRebuildResults(mergedSchedule, schedule)
          : schedule;
      }
    }

    return buildMaterializationOrderResult({
      salesOrderId: ref.salesOrderId,
      sources: ref.sources,
      snapshot: lastSnapshot
        ? {
            action: lastSnapshot.action,
            snapshotId: lastSnapshot.snapshotId,
            preview: lastSnapshot.preview,
          }
        : null,
      schedule: mergedSchedule,
    });
  } catch (error) {
    const message =
      error instanceof SalesOrderNotFoundError
        ? error.message
        : error instanceof SalesOrderCustomerMissingError
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
  const processedPairs = new Set<string>();
  for (const ref of affected) {
    for (const nfeId of ref.nfeIds ?? []) {
      processedPairs.add(`${ref.salesOrderId}|${nfeId}`);
    }
    orders.push(await processSalesOrderMaterialization(db, ref, dryRun, deps));
  }

  let receiptMonthPass: Awaited<ReturnType<typeof ensureReceiptMonthReceivableSchedules>> | null =
    null;
  if (input.year != null && input.month != null) {
    receiptMonthPass = await ensureReceiptMonthReceivableSchedules(db, {
      year: input.year,
      month: input.month,
      dryRun,
      processedPairs,
      deps,
    });
  }

  const expandedOrderIds = [
    ...new Set([
      ...salesOrderIds,
      ...[...processedPairs].map((pair) => pair.split("|")[0]!).filter(Boolean),
    ]),
  ];
  const after = await loadMaterializationArtifactCounts(db, expandedOrderIds);

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
    extraErrors:
      receiptMonthPass?.errors.map((error) => ({
        salesOrderId: `receivable:${error.receivableId}`,
        message: error.message,
      })) ?? [],
    receiptMonthReceivablesChecked: receiptMonthPass?.receivablesChecked,
    receiptMonthReceivablesMissingBefore: receiptMonthPass?.receivablesMissingBefore,
    receiptMonthSchedulesEnsured: receiptMonthPass?.schedulesEnsured,
    receiptMonthUnlinkedReceivables: receiptMonthPass?.unlinkedReceivables,
  });
}
