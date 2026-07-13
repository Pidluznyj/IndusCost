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
    const key = sellerIdentityKey.trim();
    if (key.startsWith("__ID_ONLY__:")) {
      const id = Number.parseInt(key.slice("__ID_ONLY__:".length), 10);
      if (Number.isFinite(id)) {
        return { ...statusFilter, externalSellerId: id };
      }
    }
    // Vendedor do pedido = Nomus oficial, com fallback legado (responsible).
    return {
      ...statusFilter,
      OR: [
        { nomusSellerName: { equals: key, mode: "insensitive" } },
        { responsible: { equals: key, mode: "insensitive" } },
      ],
    };
  }
  if (externalSellerId !== null) {
    return { ...statusFilter, externalSellerId };
  }
  if (responsible) {
    return {
      ...statusFilter,
      OR: [
        { nomusSellerName: { equals: responsible.trim(), mode: "insensitive" } },
        { responsible: { equals: responsible.trim(), mode: "insensitive" } },
      ],
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
  order: {
    externalSellerId: number | null;
    responsible: string | null;
    nomusSellerName?: string | null;
  },
  scope: CrmCommercialAccessScope
): boolean {
  if (scope.dataScope !== "own") return true;
  const orderName = normalizeSellerIdentityName(
    (order.nomusSellerName ?? order.responsible ?? "").trim()
  );
  if (scope.sellerIdentityKey) {
    if (scope.sellerIdentityKey.startsWith("__ID_ONLY__:")) {
      const id = Number.parseInt(scope.sellerIdentityKey.slice("__ID_ONLY__:".length), 10);
      return Number.isFinite(id) && order.externalSellerId === id;
    }
    return orderName === scope.sellerIdentityKey;
  }
  if (scope.externalSellerId !== null) {
    return order.externalSellerId === scope.externalSellerId;
  }
  if (scope.responsible) {
    return orderName === normalizeSellerIdentityName(scope.responsible);
  }
  return false;
}
