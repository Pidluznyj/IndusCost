/**
 * Resolve IDs de NF e códigos de Pedido excluídos do CR operacional
 * (CANCELLED / ERROR / MISSING_CONFIRMED com flag).
 */
import type { PrismaClient } from "@prisma/client";
import {
  buildSalesOrderExcludedFromOperationalArWhere,
  normalizeFinanceArOrderCodeKey,
  SALES_ORDER_STATUSES_EXCLUDED_FROM_OPERATIONAL_AR,
} from "./financeArCancelledSalesOrderExclusion.js";
import {
  isNomusOpsExcludeMissingSalesOrdersEnabled,
} from "./nomus/nomusSourcePresencePolicy.js";

export type FinanceArCancelledSalesOrderExclusionIndex = {
  invoiceIds: Set<number>;
  orderCodes: Set<string>;
};

export async function loadFinanceArCancelledSalesOrderExclusionIndex(
  prisma: Pick<PrismaClient, "salesOrder" | "salesOrderNfeLink">,
  options?: { env?: Record<string, string | undefined> }
): Promise<FinanceArCancelledSalesOrderExclusionIndex> {
  const env = options?.env;
  const or: Array<Record<string, unknown>> = [
    { status: { in: [...SALES_ORDER_STATUSES_EXCLUDED_FROM_OPERATIONAL_AR] } },
  ];
  if (isNomusOpsExcludeMissingSalesOrdersEnabled(env)) {
    or.push({ sourcePresenceStatus: "MISSING_CONFIRMED" });
  }

  const excludedOrders = await prisma.salesOrder.findMany({
    where: { OR: or } as never,
    select: { id: true, orderCode: true },
  });

  const orderCodes = new Set<string>();
  const orderIds: string[] = [];
  for (const order of excludedOrders) {
    orderIds.push(order.id);
    const key = normalizeFinanceArOrderCodeKey(order.orderCode);
    if (key) orderCodes.add(key);
  }

  const invoiceIds = new Set<number>();
  if (orderIds.length > 0) {
    const links = await prisma.salesOrderNfeLink.findMany({
      where: { salesOrderId: { in: orderIds } },
      select: { nfeExternalId: true },
    });
    for (const link of links) {
      if (link.nfeExternalId != null) invoiceIds.add(link.nfeExternalId);
    }
  }

  return { invoiceIds, orderCodes };
}

/** Where de pedidos elegíveis para previsão FIN-08 / agenda efetiva. */
export function buildFinanceArEffectiveSalesOrderWhere(
  commercialWhere: Record<string, unknown>,
  options?: { env?: Record<string, string | undefined> }
): Record<string, unknown> {
  const exclusion = buildSalesOrderExcludedFromOperationalArWhere({
    env: options?.env,
  });
  if (!commercialWhere || Object.keys(commercialWhere).length === 0) {
    return exclusion;
  }
  return { AND: [commercialWhere, exclusion] };
}
