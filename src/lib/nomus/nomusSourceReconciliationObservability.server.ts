/**
 * SYNC-09 — Loaders de observabilidade (Prisma).
 * Não confirma ausências. Não retorna rawPayload.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { NOMUS_SALES_ORDER_SOURCE } from "../salesOrderNomusSync.server.js";
import {
  buildNomusSourceReconciliationObservabilityPayload,
  buildPresenceDrilldownRow,
  paginateDrilldownRows,
  parseNomusSourceDrilldownQuery,
  sanitizeObservabilitySummaryJson,
  type NomusSourceObservabilityEntityType,
  type NomusSourcePresenceDrilldownRow,
  type NomusSourceSyncRunObservabilityRow,
} from "./nomusSourceReconciliationObservability.js";

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function loadNomusSourceSyncRunsForObservability(
  prisma: PrismaClient,
  options?: { takePerEntity?: number }
): Promise<NomusSourceSyncRunObservabilityRow[]> {
  const take = Math.max(2, Math.min(50, options?.takePerEntity ?? 5));
  const entities: NomusSourceObservabilityEntityType[] = [
    "SALES_ORDER",
    "ACCOUNTS_RECEIVABLE",
    "ACCOUNTS_PAYABLE",
  ];
  const rows: NomusSourceSyncRunObservabilityRow[] = [];
  for (const entityType of entities) {
    const found = await prisma.nomusSourceSyncRun.findMany({
      where: { entityType },
      orderBy: { startedAt: "desc" },
      take,
      select: {
        id: true,
        entityType: true,
        strategy: true,
        scope: true,
        startedAt: true,
        finishedAt: true,
        status: true,
        payloadComplete: true,
        pagesRead: true,
        rowsRead: true,
        createdCount: true,
        updatedCount: true,
        unchangedCount: true,
        missingCandidateCount: true,
        missingConfirmedCount: true,
        reactivatedCount: true,
        http429Count: true,
        errors: true,
        coveredFrom: true,
        coveredTo: true,
        errorMessage: true,
        summaryJson: true,
      },
    });
    for (const r of found) {
      rows.push({
        ...r,
        summaryJson: sanitizeObservabilitySummaryJson(r.summaryJson),
      });
    }
  }
  return rows;
}

export async function buildNomusSourceReconciliationObservabilityStatus(
  prisma: PrismaClient
) {
  const runs = await loadNomusSourceSyncRunsForObservability(prisma);
  return buildNomusSourceReconciliationObservabilityPayload({ runs });
}

async function loadSalesOrderDrilldown(
  prisma: PrismaClient,
  query: ReturnType<typeof parseNomusSourceDrilldownQuery>
): Promise<NomusSourcePresenceDrilldownRow[]> {
  const where: Prisma.SalesOrderWhereInput = {
    sourceSystem: NOMUS_SALES_ORDER_SOURCE,
  };
  if (query.externalId) {
    const n = Number(query.externalId);
    if (Number.isFinite(n)) where.externalSalesOrderId = n;
  }
  if (query.code) {
    where.OR = [
      { orderCode: { contains: query.code, mode: "insensitive" } },
      { externalSalesOrderCode: { contains: query.code, mode: "insensitive" } },
    ];
  }
  if (query.presenceStatus) {
    where.sourcePresenceStatus = query.presenceStatus as never;
  }

  const rows = await prisma.salesOrder.findMany({
    where,
    select: {
      id: true,
      externalSalesOrderId: true,
      orderCode: true,
      sourcePresenceStatus: true,
      firstSeenAt: true,
      lastSeenAt: true,
      missingSince: true,
      sourceRemovedAt: true,
      lastSyncRunId: true,
      totalNetValue: true,
    },
    orderBy: [{ lastSeenAt: "desc" }],
    take: 500,
  });

  return rows.map((r) =>
    buildPresenceDrilldownRow({
      entityType: "SALES_ORDER",
      localId: r.id,
      externalId: r.externalSalesOrderId ?? r.orderCode,
      code: r.orderCode,
      sourcePresenceStatus: r.sourcePresenceStatus,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
      missingSince: r.missingSince,
      sourceRemovedAt: r.sourceRemovedAt,
      lastSyncRunId: r.lastSyncRunId,
      openBalance: decimalToNumber(r.totalNetValue),
      reasons: [],
    })
  );
}

async function loadArDrilldown(
  prisma: PrismaClient,
  query: ReturnType<typeof parseNomusSourceDrilldownQuery>
): Promise<NomusSourcePresenceDrilldownRow[]> {
  const where: Prisma.NomusAccountsReceivableWhereInput = {};
  if (query.externalId) {
    const n = Number(query.externalId);
    if (Number.isFinite(n)) where.externalId = n;
  }
  if (query.code) {
    where.OR = [
      { sourceInvoiceNumber: { contains: query.code, mode: "insensitive" } },
      { description: { contains: query.code, mode: "insensitive" } },
    ];
  }
  if (query.presenceStatus) {
    where.sourcePresenceStatus = query.presenceStatus as never;
  }

  const rows = await prisma.nomusAccountsReceivable.findMany({
    where,
    select: {
      id: true,
      externalId: true,
      sourceInvoiceNumber: true,
      sourcePresenceStatus: true,
      firstSeenAt: true,
      lastSeenAt: true,
      missingSince: true,
      sourceRemovedAt: true,
      lastSyncRunId: true,
      balanceReceivable: true,
    },
    orderBy: [{ lastSeenAt: "desc" }],
    take: 500,
  });

  return rows.map((r) =>
    buildPresenceDrilldownRow({
      entityType: "ACCOUNTS_RECEIVABLE",
      localId: r.id,
      externalId: r.externalId,
      code: r.sourceInvoiceNumber,
      sourcePresenceStatus: r.sourcePresenceStatus,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
      missingSince: r.missingSince,
      sourceRemovedAt: r.sourceRemovedAt,
      lastSyncRunId: r.lastSyncRunId,
      openBalance: decimalToNumber(r.balanceReceivable),
    })
  );
}

async function loadApDrilldown(
  prisma: PrismaClient,
  query: ReturnType<typeof parseNomusSourceDrilldownQuery>
): Promise<NomusSourcePresenceDrilldownRow[]> {
  const where: Prisma.NomusAccountsPayableWhereInput = {};
  if (query.externalId) {
    const n = Number(query.externalId);
    if (Number.isFinite(n)) where.externalId = n;
  }
  if (query.code) {
    where.OR = [
      { documentNumber: { contains: query.code, mode: "insensitive" } },
      { description: { contains: query.code, mode: "insensitive" } },
    ];
  }
  if (query.presenceStatus) {
    where.sourcePresenceStatus = query.presenceStatus as never;
  }

  const rows = await prisma.nomusAccountsPayable.findMany({
    where,
    select: {
      id: true,
      externalId: true,
      documentNumber: true,
      sourcePresenceStatus: true,
      firstSeenAt: true,
      lastSeenAt: true,
      missingSince: true,
      sourceRemovedAt: true,
      lastSyncRunId: true,
      balancePayable: true,
    },
    orderBy: [{ lastSeenAt: "desc" }],
    take: 500,
  });

  return rows.map((r) =>
    buildPresenceDrilldownRow({
      entityType: "ACCOUNTS_PAYABLE",
      localId: r.id,
      externalId: r.externalId,
      code: r.documentNumber,
      sourcePresenceStatus: r.sourcePresenceStatus,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
      missingSince: r.missingSince,
      sourceRemovedAt: r.sourceRemovedAt,
      lastSyncRunId: r.lastSyncRunId,
      openBalance: decimalToNumber(r.balancePayable),
    })
  );
}

export async function loadNomusSourcePresenceDrilldown(
  prisma: PrismaClient,
  rawQuery: Record<string, unknown>
) {
  const query = parseNomusSourceDrilldownQuery(rawQuery);
  const buckets: NomusSourcePresenceDrilldownRow[] = [];

  if (query.entityType === "ALL" || query.entityType === "SALES_ORDER") {
    buckets.push(...(await loadSalesOrderDrilldown(prisma, query)));
  }
  if (query.entityType === "ALL" || query.entityType === "ACCOUNTS_RECEIVABLE") {
    buckets.push(...(await loadArDrilldown(prisma, query)));
  }
  if (query.entityType === "ALL" || query.entityType === "ACCOUNTS_PAYABLE") {
    buckets.push(...(await loadApDrilldown(prisma, query)));
  }

  const page = paginateDrilldownRows(buckets, query.page, query.pageSize);
  return {
    ...page,
    filters: query,
    sensitiveFieldsExcluded: true as const,
    // Drilldown administrativo — sem rawPayload
    fields: [
      "entityType",
      "externalId",
      "code",
      "sourcePresenceStatus",
      "firstSeenAt",
      "lastSeenAt",
      "missingSince",
      "sourceRemovedAt",
      "lastSyncRunId",
      "operationalImpact",
    ],
  };
}
