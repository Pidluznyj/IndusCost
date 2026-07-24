/**
 * Loader Prisma — provisão de comissão por pedido (CommissionOrderSnapshot ACTIVE).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { decimalToNumber } from "./commission-money.js";
import {
  assembleCommissionOrderProvisionPayload,
  parseCommissionOrderProvisionQuery,
  resolveCommissionOrderProvisionMonthRanges,
  resolveCommissionOrderProvisionSaleDateBounds,
  type CommissionOrderProvisionPayload,
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
  const monthRanges = resolveCommissionOrderProvisionMonthRanges(query);
  if (monthRanges) {
    return {
      OR: monthRanges.map((range) => ({
        saleDate: { gte: range.gte, lte: range.lte },
      })),
    };
  }
  const bounds = resolveCommissionOrderProvisionSaleDateBounds(query);
  if (!bounds) return null;
  return { saleDate: { gte: bounds.gte, lte: bounds.lte } };
}

export async function getCommissionOrderProvisionPage(
  queryInput: Record<string, unknown>,
  scope: CommissionAccessScope
): Promise<CommissionOrderProvisionPayload> {
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

  return assembleCommissionOrderProvisionPayload({ query, snapshots });
}
