/**
 * Loader Prisma — provisão de comissão por pedido (CommissionOrderSnapshot ACTIVE).
 */
import type { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/src/lib/prisma.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { decimalToNumber } from "./commission-money.js";
import {
  assembleCommissionOrderProvisionPayload,
  assembleCommissionOrderProvisionReportPayload,
  buildCommissionOrderProvisionExportFilename,
  buildCommissionOrderProvisionExportWorkbook,
  parseCommissionOrderProvisionQuery,
  resolveCommissionOrderProvisionSaleDateFilter,
  type CommissionOrderProvisionPayload,
  type CommissionOrderProvisionQuery,
  type CommissionOrderProvisionReportPayload,
  type CommissionOrderProvisionSnapshotInput,
} from "./commissionOrderProvision.shared.js";

function applySellerScope(
  scope: CommissionAccessScope,
  query: {
    canonicalSellerId: string | null;
    rawSellerId: number | null;
  }
): Prisma.CommissionOrderSnapshotWhereInput {
  const and: Prisma.CommissionOrderSnapshotWhereInput[] = [];

  if (scope.dataScope === "own") {
    if (scope.nomusSellerId == null) {
      return { id: { in: [] } };
    }
    and.push({
      OR: [
        { rawSellerId: scope.nomusSellerId },
        {
          canonicalSeller: {
            nomusPersonId: scope.nomusSellerId,
            type: "SELLER",
          },
        },
      ],
    });
  } else {
    if (query.canonicalSellerId) {
      and.push({ canonicalSellerId: query.canonicalSellerId });
    }
    if (query.rawSellerId != null) {
      and.push({ rawSellerId: query.rawSellerId });
    }
  }

  if (and.length === 0) return {};
  if (and.length === 1) return and[0]!;
  return { AND: and };
}

function buildSaleDateWhere(
  query: ReturnType<typeof parseCommissionOrderProvisionQuery>
): Prisma.CommissionOrderSnapshotWhereInput | null {
  const filter = resolveCommissionOrderProvisionSaleDateFilter(query);
  if (filter.kind === "none") return null;
  if (filter.kind === "or_months") {
    return {
      OR: filter.ranges.map((range) => ({
        saleDate: { gte: range.gte, lte: range.lte },
      })),
    };
  }
  return { saleDate: { gte: filter.gte, lte: filter.lte } };
}

async function loadCommissionOrderProvisionSnapshots(
  queryInput: Record<string, unknown>,
  scope: CommissionAccessScope
): Promise<{
  query: CommissionOrderProvisionQuery;
  snapshots: CommissionOrderProvisionSnapshotInput[];
}> {
  const query = parseCommissionOrderProvisionQuery(queryInput);
  const saleDateWhere = buildSaleDateWhere(query);

  const and: Prisma.CommissionOrderSnapshotWhereInput[] = [
    { status: "ACTIVE" },
    applySellerScope(scope, query),
  ];
  if (saleDateWhere) and.push(saleDateWhere);

  if (query.customer) {
    and.push({
      customerNameSnapshot: {
        contains: query.customer,
        mode: "insensitive",
      },
    });
  }
  if (query.orderCode) {
    and.push({
      salesOrder: {
        orderCode: { contains: query.orderCode, mode: "insensitive" },
      },
    });
  }

  const where: Prisma.CommissionOrderSnapshotWhereInput = { AND: and };

  const rows = await prisma.commissionOrderSnapshot.findMany({
    where,
    select: {
      id: true,
      salesOrderId: true,
      nfeId: true,
      saleDate: true,
      customerNameSnapshot: true,
      canonicalSellerId: true,
      canonicalSellerName: true,
      rawSellerId: true,
      rawSellerName: true,
      totalSoldAmount: true,
      totalGrossCommissionAmount: true,
      totalFinalCommissionAmount: true,
      salesOrder: { select: { orderCode: true } },
      items: {
        select: { status: true },
        where: { status: "CUSTOMER_EXCLUDED" },
        take: 1,
      },
    },
    orderBy: [{ saleDate: "desc" }, { createdAt: "desc" }],
  });

  const snapshots: CommissionOrderProvisionSnapshotInput[] = rows.map((row) => ({
    id: row.id,
    salesOrderId: row.salesOrderId,
    orderCode: row.salesOrder?.orderCode ?? null,
    saleDate: row.saleDate,
    customerNameSnapshot: row.customerNameSnapshot,
    canonicalSellerId: row.canonicalSellerId,
    canonicalSellerName: row.canonicalSellerName,
    rawSellerId: row.rawSellerId,
    rawSellerName: row.rawSellerName,
    nfeId: row.nfeId,
    totalSoldAmount: decimalToNumber(row.totalSoldAmount) ?? 0,
    totalGrossCommissionAmount:
      decimalToNumber(row.totalGrossCommissionAmount) ?? 0,
    totalFinalCommissionAmount:
      decimalToNumber(row.totalFinalCommissionAmount) ?? 0,
    hasCustomerExcludedItems: row.items.length > 0,
  }));

  return { query, snapshots };
}

export async function getCommissionOrderProvisionPage(
  queryInput: Record<string, unknown>,
  scope: CommissionAccessScope
): Promise<CommissionOrderProvisionPayload> {
  const { query, snapshots } = await loadCommissionOrderProvisionSnapshots(queryInput, scope);
  return assembleCommissionOrderProvisionPayload({ query, snapshots });
}

/** Todas as linhas do filtro (sem paginação) — usado por print/PDF. */
export async function getCommissionOrderProvisionReport(
  queryInput: Record<string, unknown>,
  scope: CommissionAccessScope
): Promise<CommissionOrderProvisionReportPayload> {
  const { query, snapshots } = await loadCommissionOrderProvisionSnapshots(queryInput, scope);
  return assembleCommissionOrderProvisionReportPayload({ query, snapshots });
}

export async function exportCommissionOrderProvisionXlsx(
  queryInput: Record<string, unknown>,
  scope: CommissionAccessScope
): Promise<{ buffer: Buffer; filename: string }> {
  const { query, snapshots } = await loadCommissionOrderProvisionSnapshots(queryInput, scope);
  const payload = assembleCommissionOrderProvisionReportPayload({ query, snapshots });
  const wb = buildCommissionOrderProvisionExportWorkbook(payload);
  return {
    buffer: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer,
    filename: buildCommissionOrderProvisionExportFilename(query),
  };
}
