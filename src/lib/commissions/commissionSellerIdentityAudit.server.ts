import { prisma } from "@/src/lib/prisma.js";
import { decimalToNumber } from "./commission-money.js";
import { listCommissionVisualAuditPage } from "./commissionVisualAudit.server.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { parseCommissionVisualAuditQuery } from "./commissionQuery.js";
import { normalizeCommissionPersonName } from "./commissionPersonIdentity.js";
import { loadCommissionSellerIdentityContext } from "./commissionSellerIdentity.server.js";
import {
  resolveCommissionSellerIdentity,
  sellerNameMatchesFilter,
} from "./commissionSellerIdentity.js";
import {
  buildSellerFocusAudit,
  buildSellerIdentityGroups,
  type SellerIdentityAuditSummary,
  type SellerSourceObservation,
} from "./commissionSellerIdentityAudit.js";
import { activeCommissionRecordWhere } from "./commission-record-status.js";

const GLOBAL_SCOPE: CommissionAccessScope = {
  dataScope: "global",
  sellerLocked: false,
  nomusSellerId: null,
  sellerResponsibleName: null,
  blockedReason: null,
  blockedMessage: null,
};

export type SellerIdentityAuditQuery = {
  year: number;
  month: number;
  seller?: string | null;
};

async function loadVisualRows(year: number, month: number, mode: "PAYABLE" | "GENERATED" | "FORECAST") {
  const payload = await listCommissionVisualAuditPage(
    parseCommissionVisualAuditQuery({
      year,
      month,
      appraisalMode: mode.toLowerCase(),
      page: 1,
      pageSize: 500000,
    }),
    GLOBAL_SCOPE
  );
  return payload.rows;
}

function observationFromResolution(
  partial: Omit<SellerSourceObservation, "canonicalSellerId" | "canonicalSellerName" | "status" | "warning">,
  resolution: ReturnType<typeof resolveCommissionSellerIdentity>
): SellerSourceObservation {
  return {
    ...partial,
    canonicalSellerId: resolution.canonicalSellerId,
    canonicalSellerName: resolution.canonicalSellerName,
    status: resolution.resolutionStatus,
    warning: resolution.warnings.length > 0 ? resolution.warnings.join("; ") : null,
  };
}

export async function runCommissionSellerIdentityAudit(
  query: SellerIdentityAuditQuery
): Promise<{ summary: SellerIdentityAuditSummary; details: SellerSourceObservation[] }> {
  const periodFrom = new Date(query.year, query.month - 1, 1);
  const periodTo = new Date(query.year, query.month, 0, 23, 59, 59, 999);

  const [identityCtx, salesOrders, commissionRecords, payableRows, generatedRows, forecastRows] =
    await Promise.all([
      loadCommissionSellerIdentityContext(prisma),
      prisma.salesOrder.findMany({
        where: {
          OR: [
            { issueDate: { gte: periodFrom, lte: periodTo } },
            { createdAt: { gte: periodFrom, lte: periodTo } },
          ],
        },
        select: {
          id: true,
          orderCode: true,
          externalSellerId: true,
          responsible: true,
          issueDate: true,
          Customer: { select: { name: true } },
        },
      }),
      prisma.commissionRecord.findMany({
        where: activeCommissionRecordWhere({ from: periodFrom, to: periodTo }),
        select: {
          id: true,
          commissionPersonId: true,
          nomusSellerId: true,
          commissionPerson: { select: { name: true } },
          customerName: true,
          orderCode: true,
          nfeNumber: true,
          confirmedAt: true,
          commissionAmount: true,
          releasedAmount: true,
          itemBaseAmount: true,
        },
      }),
      loadVisualRows(query.year, query.month, "PAYABLE"),
      loadVisualRows(query.year, query.month, "GENERATED"),
      loadVisualRows(query.year, query.month, "FORECAST"),
    ]);

  const observations: SellerSourceObservation[] = [];

  for (const order of salesOrders) {
    const normalized = normalizeCommissionPersonName(order.responsible);
    if (query.seller && !sellerNameMatchesFilter(normalized, query.seller)) continue;

    const resolution = resolveCommissionSellerIdentity(
      {
        rawSellerId: order.externalSellerId,
        rawSellerName: order.responsible,
        source: "NOMUS_ORDER",
      },
      identityCtx
    );

    observations.push(
      observationFromResolution(
        {
          sourceTable: "SalesOrder",
          sourceId: order.id,
          rawSellerId: order.externalSellerId,
          rawSellerName: order.responsible,
          normalizedSellerName: normalized || "SEM_NOME",
          issueDate: order.issueDate?.toISOString() ?? null,
          settlementDate: null,
          customer: order.Customer?.name ?? null,
          order: order.orderCode,
          nfe: null,
          receivable: null,
          base: 0,
          expectedCommission: 0,
          releasedCommission: 0,
        },
        resolution
      )
    );
  }

  for (const record of commissionRecords) {
    const normalized = normalizeCommissionPersonName(record.commissionPerson?.name);
    if (query.seller && !sellerNameMatchesFilter(normalized, query.seller)) continue;

    const resolution = resolveCommissionSellerIdentity(
      {
        rawSellerId: record.nomusSellerId,
        rawSellerName: record.commissionPerson?.name ?? null,
        source: "COMMISSION_RECORD",
      },
      identityCtx
    );

    observations.push(
      observationFromResolution(
        {
          sourceTable: "CommissionRecord",
          sourceId: record.id,
          rawSellerId: record.nomusSellerId,
          rawSellerName: record.commissionPerson?.name ?? null,
          normalizedSellerName: normalized || "SEM_NOME",
          issueDate: record.confirmedAt?.toISOString() ?? null,
          settlementDate: null,
          customer: record.customerName,
          order: record.orderCode,
          nfe: record.nfeNumber,
          receivable: null,
          base: decimalToNumber(record.itemBaseAmount),
          expectedCommission: decimalToNumber(record.commissionAmount),
          releasedCommission: decimalToNumber(record.releasedAmount),
        },
        resolution
      )
    );
  }

  for (const row of payableRows) {
    const normalized = normalizeCommissionPersonName(row.commissionPersonName);
    if (query.seller && !sellerNameMatchesFilter(normalized, query.seller)) continue;

    const resolution = resolveCommissionSellerIdentity(
      {
        rawSellerName: row.commissionPersonName,
        source: "COMMISSION_RECORD",
      },
      identityCtx
    );

    observations.push(
      observationFromResolution(
        {
          sourceTable: "CommissionPaymentSchedule",
          sourceId: row.scheduleId ?? row.lineId,
          rawSellerId: null,
          rawSellerName: row.commissionPersonName,
          normalizedSellerName: normalized || "SEM_NOME",
          issueDate: row.confirmedAt,
          settlementDate: row.settlementDate,
          customer: row.customerName,
          order: row.orderCode,
          nfe: row.nfeNumber,
          receivable: row.nomusReceivableId,
          base: row.allocatedBaseAmount,
          expectedCommission: row.commissionExpected,
          releasedCommission: row.commissionReleased,
        },
        {
          ...resolution,
          canonicalSellerId: row.commissionPersonId,
          canonicalSellerName: row.commissionPersonName,
          resolutionStatus:
            resolution.resolutionStatus === "UNRESOLVED"
              ? "OK_CANONICAL"
              : resolution.resolutionStatus,
        }
      )
    );
  }

  for (const person of identityCtx.persons) {
    const normalized = normalizeCommissionPersonName(person.name);
    if (query.seller && !sellerNameMatchesFilter(normalized, query.seller)) continue;

    observations.push({
      sourceTable: "CommissionPerson",
      sourceId: person.id,
      rawSellerId: person.nomusPersonId,
      rawSellerName: person.name,
      normalizedSellerName: normalized,
      canonicalSellerId: person.id,
      canonicalSellerName: person.name,
      issueDate: null,
      settlementDate: null,
      customer: null,
      order: null,
      nfe: null,
      receivable: null,
      base: 0,
      expectedCommission: 0,
      releasedCommission: 0,
      status: person.active ? "OK_CANONICAL" : "INACTIVE",
      warning: null,
    });
  }

  const groups = buildSellerIdentityGroups({ observations, identityCtx });
  const filteredGroups = query.seller
    ? groups.filter((g) => sellerNameMatchesFilter(g.normalizedSellerName, query.seller))
    : groups;

  const sellerFocusAudit = query.seller
    ? buildSellerFocusAudit({
        sellerFilter: query.seller,
        groups: filteredGroups,
        payableRows,
        generatedRows,
        forecastRows,
        identityCtx,
      })
    : null;

  return {
    summary: {
      year: query.year,
      month: query.month,
      sellerFilter: query.seller ?? null,
      groups: filteredGroups,
      sellerFocusAudit,
    },
    details: observations,
  };
}
