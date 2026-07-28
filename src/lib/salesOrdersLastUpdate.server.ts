import type { PrismaClient } from "@prisma/client";
import { resolveSalesOrdersLastUpdatedAt } from "@/src/lib/salesOrdersLastUpdate.js";

type SalesOrdersLastUpdateDb = Pick<
  PrismaClient,
  "salesOrder" | "nomusSourceSyncRun"
>;

export async function loadSalesOrdersLastUpdatedAt(
  db: SalesOrdersLastUpdateDb,
): Promise<string | null> {
  const [orderAgg, syncRun] = await Promise.all([
    db.salesOrder.aggregate({
      _max: {
        lastSeenAt: true,
        updatedAt: true,
      },
    }),
    db.nomusSourceSyncRun.findFirst({
      where: {
        entityType: "SALES_ORDER",
        status: "SUCCESS",
        finishedAt: { not: null },
      },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);

  return resolveSalesOrdersLastUpdatedAt([
    orderAgg._max.lastSeenAt,
    orderAgg._max.updatedAt,
    syncRun?.finishedAt ?? null,
  ]);
}
