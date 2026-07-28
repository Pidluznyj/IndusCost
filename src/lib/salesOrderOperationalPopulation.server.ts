/**
 * OP-02 — População operacional canônica de Pedidos de Venda (server-only).
 *
 * Fonte única de `where` para listagem, cards, PDF, Excel, Resultado Industrial
 * e demais consumidores OPERATIONAL. Presença Nomus é aplicada no builder.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildSalesOrderListWhere,
  type SalesOrderListFilters,
} from "./salesOrdersListSummary.js";
import {
  buildSalesOrderListWhereForQuery,
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
  resolveSalesOrderListWhereExcludingSeller,
  type SalesOrderListQuery,
} from "./salesOrderListQuery.server.js";
import { buildSalesOrderManagementWhere } from "./salesOrderManagement.js";
import {
  mergeSalesOrderOperationalPresenceWhere,
  type SalesOrderOperationalContext,
} from "./salesOrderOperationalPopulationShared.js";

export type {
  SalesOrderListFilters,
  SalesOrderListQuery,
};

export type ResolveOperationalPopulationInput = {
  context?: SalesOrderOperationalContext;
  env?: Record<string, string | undefined>;
  /** Filtros tipados da listagem Comercial. */
  listQuery?: SalesOrderListQuery;
  /** Filtros ad-hoc (year/month/status/…) — sempre passam pelo builder canônico. */
  listFilters?: SalesOrderListFilters;
  sellerWhere?: Prisma.SalesOrderWhereInput | null;
};

function presenceOptions(input: ResolveOperationalPopulationInput) {
  return {
    env: input.env,
    includeConfirmedMissing: input.context === "HISTORICAL_AUDIT",
    // Pedidos de Venda (listagem/cards/export): não exclui grupo econômico.
    // Exclusão intercompany permanece opt-in em motores oficiais (DRE/executivo/AR/AP).
    excludeEconomicGroupCustomers: false,
  };
}

/**
 * Resolve o `where` oficial da população operacional.
 * HISTORICAL_AUDIT: não exclui MISSING_CONFIRMED.
 * OPERATIONAL (default): aplica flag NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENABLED.
 */
export async function resolveSalesOrderOperationalPopulationWhere(
  prisma: PrismaClient,
  input: ResolveOperationalPopulationInput = {}
): Promise<Prisma.SalesOrderWhereInput> {
  const opts = presenceOptions(input);
  if (input.listQuery) {
    return resolveSalesOrderListWhere(
      prisma,
      input.listQuery,
      input.sellerWhere ?? null,
      opts
    );
  }
  if (input.listFilters) {
    return buildSalesOrderListWhere(input.listFilters, opts);
  }
  return mergeSalesOrderOperationalPresenceWhere({}, opts) as Prisma.SalesOrderWhereInput;
}

/** Where a partir da query string da listagem (mesmo parse dos cards/PDF/Excel). */
export async function resolveSalesOrderOperationalPopulationFromQuery(
  prisma: PrismaClient,
  query: Record<string, unknown>,
  options?: {
    context?: SalesOrderOperationalContext;
    env?: Record<string, string | undefined>;
  }
): Promise<{
  listQuery: SalesOrderListQuery;
  sellerWhere: Prisma.SalesOrderWhereInput | null;
  where: Prisma.SalesOrderWhereInput;
}> {
  const listQuery = parseSalesOrderListQuery(query);
  const sellerWhere = await resolveSalesOrderListSellerWhere(prisma, {
    sellerKeyRaw: listQuery.sellerKeyRaw,
    sellerText: listQuery.sellerText,
  });
  const where = await resolveSalesOrderOperationalPopulationWhere(prisma, {
    listQuery,
    sellerWhere,
    context: options?.context ?? "OPERATIONAL",
    env: options?.env,
  });
  return { listQuery, sellerWhere, where };
}

/** IDs únicos da população — base de paridade entre consumidores. */
export async function loadSalesOrderOperationalPopulationIds(
  prisma: PrismaClient,
  where: Prisma.SalesOrderWhereInput
): Promise<string[]> {
  const rows = await prisma.salesOrder.findMany({
    where,
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => r.id);
}

export {
  buildSalesOrderListWhere,
  buildSalesOrderListWhereForQuery,
  buildSalesOrderManagementWhere,
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
  resolveSalesOrderListWhereExcludingSeller,
  mergeSalesOrderOperationalPresenceWhere,
};
