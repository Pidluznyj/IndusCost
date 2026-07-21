/**
 * Gate operacional da Conciliação de Carteira / O2C.
 * Mesma regra do motor de Pedidos e Contas a Receber:
 * CANCELLED/ERROR fora; MISSING_CONFIRMED fora quando a flag está on.
 */
import { shouldIncludeSalesOrderInOperationalReceivables } from "@/src/lib/financeArCancelledSalesOrderExclusion.js";

export type PortfolioOperationalOrderPresence = {
  id: string;
  status?: string | null;
  sourcePresenceStatus?: string | null;
};

/** IDs de SalesOrder elegíveis para listas operacionais da Conciliação. */
export function selectOperationalPortfolioSalesOrderIds(
  orders: readonly PortfolioOperationalOrderPresence[],
  env?: Record<string, string | undefined>
): Set<string> {
  const allowed = new Set<string>();
  for (const order of orders) {
    if (
      shouldIncludeSalesOrderInOperationalReceivables({
        status: order.status,
        sourcePresenceStatus: order.sourcePresenceStatus,
        env,
      })
    ) {
      allowed.add(order.id);
    }
  }
  return allowed;
}

/** Fact/linha com salesOrderId: mantém se elegível (ou sem vínculo). */
export function isPortfolioFactOperationallyVisible(
  fact: { salesOrderId?: string | null },
  allowedSalesOrderIds: ReadonlySet<string>
): boolean {
  const id = fact.salesOrderId?.trim() || null;
  if (!id) return true;
  return allowedSalesOrderIds.has(id);
}

export function filterPortfolioFactsByOperationalOrders<
  T extends { salesOrderId?: string | null },
>(facts: readonly T[], allowedSalesOrderIds: ReadonlySet<string>): T[] {
  return facts.filter((fact) =>
    isPortfolioFactOperationallyVisible(fact, allowedSalesOrderIds)
  );
}

export function filterPortfolioOrderRowsByOperationalOrders<
  T extends { salesOrderId?: string | null },
>(rows: readonly T[], allowedSalesOrderIds: ReadonlySet<string>): T[] {
  return rows.filter((row) =>
    isPortfolioFactOperationallyVisible(row, allowedSalesOrderIds)
  );
}
