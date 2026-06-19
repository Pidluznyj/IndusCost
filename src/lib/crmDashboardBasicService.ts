/**
 * GET /api/crm/dashboard/basic — contagens com escopo por vendedor quando aplicável.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import type { CrmCommercialAccessScope } from "@/src/lib/crmCommercialAccessScope";
import { buildCrmSellerCustomerExistsSql } from "@/src/lib/crmCommercialAccessScope";

export async function buildCrmDashboardBasicResponse(
  scope: CrmCommercialAccessScope,
  now = new Date()
) {
  const since30 = new Date(now);
  since30.setUTCDate(since30.getUTCDate() - 30);
  const in7 = new Date(now);
  in7.setUTCDate(in7.getUTCDate() + 7);

  const sellerFilterSql =
    scope.dataScope === "own"
      ? buildCrmSellerCustomerExistsSql("c", scope.externalSellerId, scope.responsible)
      : Prisma.sql`TRUE`;

  const activityCustomerInScopeSql =
    scope.dataScope === "own"
      ? Prisma.sql`
          EXISTS (
            SELECT 1 FROM "Customer" c
            WHERE c."id" = a."customerId"
              AND ${buildCrmSellerCustomerExistsSql("c", scope.externalSellerId, scope.responsible)}
          )
        `
      : Prisma.sql`TRUE`;

  const [totalCustomersRow] = await prisma.$queryRaw<{ c: bigint }[]>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS c
      FROM "Customer" c
      WHERE ${sellerFilterSql}
    `
  );
  const totalCustomers = Number(totalCustomersRow?.c ?? 0n);

  const [withContactRow] = await prisma.$queryRaw<{ c: bigint }[]>(
    Prisma.sql`
      SELECT COUNT(DISTINCT a."customerId")::bigint AS c
      FROM "CommercialActivity" a
      WHERE COALESCE(a."contactDate", a."createdAt") >= ${since30}
        AND ${activityCustomerInScopeSql}
    `
  );
  const customersWithContactLast30Days = Number(withContactRow?.c ?? 0n);

  const [withoutContactRow] = await prisma.$queryRaw<{ c: bigint }[]>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS c
      FROM "Customer" c
      WHERE ${sellerFilterSql}
        AND NOT EXISTS (
          SELECT 1
          FROM "CommercialActivity" a
          WHERE a."customerId" = c."id"
            AND COALESCE(a."contactDate", a."createdAt") >= ${since30}
        )
    `
  );
  const customersWithoutContactLast30Days = Number(withoutContactRow?.c ?? 0n);

  const [overdueRow] = await prisma.$queryRaw<{ c: bigint }[]>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS c
      FROM "CommercialActivity" a
      WHERE a."nextActionAt" IS NOT NULL
        AND a."nextActionAt" < ${now}
        AND (
          a."status" IS NULL
          OR LOWER(TRIM(a."status")) NOT IN ('done', 'closed', 'cancelled', 'canceled')
        )
        AND ${activityCustomerInScopeSql}
    `
  );
  const overdueFollowUps = Number(overdueRow?.c ?? 0n);

  const [upcomingRow] = await prisma.$queryRaw<{ c: bigint }[]>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS c
      FROM "CommercialActivity" a
      WHERE a."nextActionAt" IS NOT NULL
        AND a."nextActionAt" >= ${now}
        AND a."nextActionAt" < ${in7}
        AND (
          a."status" IS NULL
          OR LOWER(TRIM(a."status")) NOT IN ('done', 'closed', 'cancelled', 'canceled')
        )
        AND ${activityCustomerInScopeSql}
    `
  );
  const upcomingFollowUpsNext7Days = Number(upcomingRow?.c ?? 0n);

  return {
    totalCustomers,
    customersWithContactLast30Days,
    customersWithoutContactLast30Days,
    overdueFollowUps,
    upcomingFollowUpsNext7Days,
  };
}
