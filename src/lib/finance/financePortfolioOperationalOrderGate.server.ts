/**
 * Resolve IDs de pedidos elegíveis para Conciliação / O2C (server).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  filterPortfolioFactsByOperationalOrders,
  selectOperationalPortfolioSalesOrderIds,
} from "@/src/lib/finance/financePortfolioOperationalOrderGate.js";
import { buildSalesOrderExcludedFromOperationalArWhere } from "@/src/lib/financeArCancelledSalesOrderExclusion.js";

type SalesOrderClient = Pick<PrismaClient, "salesOrder">;
type FactClient = Pick<PrismaClient, "orderToCashAuditFact">;

export async function loadOperationalPortfolioSalesOrderIdSet(
  prisma: SalesOrderClient,
  salesOrderIds: readonly (string | null | undefined)[],
  env?: Record<string, string | undefined>
): Promise<Set<string>> {
  const unique = [
    ...new Set(
      salesOrderIds
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => id.length > 0)
    ),
  ];
  if (unique.length === 0) return new Set();

  const rows = await prisma.salesOrder.findMany({
    where: { id: { in: unique } },
    select: { id: true, status: true, sourcePresenceStatus: true },
  });

  return selectOperationalPortfolioSalesOrderIds(rows, env);
}

/**
 * Restringe where de OrderToCashAuditFact aos pedidos do universo operacional.
 * Usa distinct salesOrderId do escopo atual (não varre a base inteira).
 */
export async function gateOrderToCashAuditFactWhere(
  prisma: SalesOrderClient & FactClient,
  where: Prisma.OrderToCashAuditFactWhereInput,
  env?: Record<string, string | undefined>
): Promise<Prisma.OrderToCashAuditFactWhereInput> {
  const scoped = await prisma.orderToCashAuditFact.findMany({
    where,
    select: { salesOrderId: true },
    distinct: ["salesOrderId"],
  });

  const linkedIds = scoped
    .map((row) => row.salesOrderId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (linkedIds.length === 0) return where;

  const allowed = await loadOperationalPortfolioSalesOrderIdSet(
    prisma,
    linkedIds,
    env
  );
  const allowedList = [...allowed];

  const salesOrderClause: Prisma.OrderToCashAuditFactWhereInput =
    allowedList.length > 0
      ? {
          OR: [{ salesOrderId: null }, { salesOrderId: { in: allowedList } }],
        }
      : { salesOrderId: null };

  return { AND: [where, salesOrderClause] };
}

/** Aplica gate em facts já materializados (agregação Status Pedidos). */
export async function filterFactsByOperationalPortfolioOrders<
  T extends { salesOrderId?: string | null },
>(
  prisma: SalesOrderClient,
  facts: readonly T[],
  env?: Record<string, string | undefined>
): Promise<T[]> {
  const allowed = await loadOperationalPortfolioSalesOrderIdSet(
    prisma,
    facts.map((f) => f.salesOrderId),
    env
  );
  return filterPortfolioFactsByOperationalOrders(facts, allowed);
}

/** Where de SalesOrder para rebuild O2C / Portfolio Reconciliation. */
export function mergeSalesOrderWhereWithPortfolioOperationalGate(
  where: Prisma.SalesOrderWhereInput,
  env?: Record<string, string | undefined>
): Prisma.SalesOrderWhereInput {
  const gate = buildSalesOrderExcludedFromOperationalArWhere({
    env,
  }) as Prisma.SalesOrderWhereInput;
  if (!where || Object.keys(where).length === 0) return gate;
  return { AND: [where, gate] };
}

/**
 * Pedido pode aparecer / abrir Auditoria 360° na Conciliação de Carteira?
 * false → fora do universo operacional (ex.: PD 02739 MISSING_CONFIRMED).
 */
export async function isSalesOrderVisibleInPortfolioReconciliation(
  prisma: SalesOrderClient,
  salesOrderId: string,
  env?: Record<string, string | undefined>
): Promise<boolean> {
  const id = salesOrderId.trim();
  if (!id) return false;
  const allowed = await loadOperationalPortfolioSalesOrderIdSet(
    prisma,
    [id],
    env
  );
  return allowed.has(id);
}
