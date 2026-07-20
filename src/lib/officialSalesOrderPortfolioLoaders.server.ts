import type { PrismaClient } from "@prisma/client";
import {
  buildOfficialCustomerRevenueByCustomer,
  mapPrismaOrderToSalesOrderRulesInput,
  SALES_ORDER_RULES_PRISMA_SELECT,
} from "@/src/lib/salesOrderRulesAdapter.js";
import { mergeSalesOrderOperationalPresenceWhere } from "@/src/lib/nomus/nomusSourcePresencePolicy.server.js";

/** ABC portfólio — receita por cliente via motor oficial (sem groupBy Prisma). */
export async function loadOfficialPortfolioAbcRevenueRows(
  db: Pick<PrismaClient, "salesOrder">
): Promise<Array<{ customerId: string; revenue: number }>> {
  const orders = await db.salesOrder.findMany({
    where: mergeSalesOrderOperationalPresenceWhere({
      status: { notIn: ["CANCELLED", "ERROR"] },
    }),
    select: SALES_ORDER_RULES_PRISMA_SELECT,
  });
  return buildOfficialCustomerRevenueByCustomer(
    orders.map(mapPrismaOrderToSalesOrderRulesInput),
    { abcEligibleOnly: true }
  ).map((row) => ({ customerId: row.customerId, revenue: row.revenue }));
}
