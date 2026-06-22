import type { Prisma } from "@prisma/client";
import type { CrmCommercialAccessScope } from "@/src/lib/crmCommercialAccessScope";
import { normalizeSellerIdentityName } from "@/src/lib/crmSellerIdentityConsolidation.js";
import { buildManualCommercialOwnerPortfolioWhere } from "@/src/lib/crmCustomerCommercialOwner.js";

const VALID_ORDER_STATUSES = ["CANCELLED", "ERROR"] as const;

export function buildCrmSellerSalesOrderWhere(
  externalSellerId: number | null,
  responsible: string | null,
  sellerIdentityKey?: string | null
): Prisma.SalesOrderWhereInput {
  const statusFilter: Prisma.SalesOrderWhereInput = {
    status: { notIn: [...VALID_ORDER_STATUSES] },
  };

  if (sellerIdentityKey?.trim()) {
    return {
      ...statusFilter,
      responsible: { equals: sellerIdentityKey.trim(), mode: "insensitive" },
    };
  }
  if (externalSellerId !== null) {
    return { ...statusFilter, externalSellerId };
  }
  if (responsible) {
    return {
      ...statusFilter,
      responsible: { equals: responsible.trim(), mode: "insensitive" },
    };
  }
  return statusFilter;
}

export function buildCrmSellerCustomerPortfolioWhere(
  scope: CrmCommercialAccessScope
): Prisma.CustomerWhereInput | undefined {
  if (scope.dataScope !== "own") return undefined;

  const orderMatch: Prisma.CustomerWhereInput = {
    salesOrders: {
      some: buildCrmSellerSalesOrderWhere(
        scope.externalSellerId,
        scope.responsible,
        scope.sellerIdentityKey
      ),
    },
  };

  const manualWhere = buildManualCommercialOwnerPortfolioWhere(scope);
  const manualMatch: Prisma.CustomerWhereInput | undefined = manualWhere
    ? { CrmCustomerCommercialOwner: { is: manualWhere } }
    : undefined;

  if (manualMatch) {
    return { OR: [orderMatch, manualMatch] };
  }
  return orderMatch;
}

export function salesOrderMatchesCrmSellerScope(
  order: { externalSellerId: number | null; responsible: string | null },
  scope: CrmCommercialAccessScope
): boolean {
  if (scope.dataScope !== "own") return true;
  if (scope.sellerIdentityKey) {
    const rowKey = normalizeSellerIdentityName(order.responsible ?? "");
    return rowKey === scope.sellerIdentityKey;
  }
  if (scope.externalSellerId !== null) {
    return order.externalSellerId === scope.externalSellerId;
  }
  if (scope.responsible) {
    const rowName = (order.responsible ?? "").trim().toLowerCase();
    return rowName === scope.responsible.trim().toLowerCase();
  }
  return false;
}
