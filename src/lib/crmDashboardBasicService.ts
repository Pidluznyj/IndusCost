/**
 * GET /api/crm/dashboard/basic — contagens escopadas pela carteira do usuário.
 *
 * Eixo de escopo: Responsável Comercial do cliente (`CrmCustomerCommercialOwner`),
 * o mesmo de `/api/crm/customers` e do seller dashboard. NÃO usa o vendedor Nomus
 * do pedido — esse eixo é auditoria/comissão e nunca define acesso
 * (docs/commercial/crm-commercial-owner-and-order-seller-rules.md).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import type { CrmCommercialAccessScope } from "@/src/lib/crmCommercialAccessScope";
import { fetchCrmManualOwnerCustomerIds } from "@/src/lib/crmCustomersList";

/**
 * Predicado SQL do universo de clientes visíveis (puro, testável sem banco).
 *
 * - `global`: sem restrição.
 * - `own` com carteira: restringe aos clientes cujo Responsável Comercial ativo
 *   é o usuário.
 * - `own` sem carteira: `FALSE` — fail-closed. Nunca degradar para `TRUE`, que
 *   entregaria o universo inteiro a um usuário de escopo próprio.
 */
export function buildCrmDashboardBasicCustomerScopeSql(
  dataScope: CrmCommercialAccessScope["dataScope"],
  ownerCustomerIds: readonly string[],
  customerAlias = "c"
): Prisma.Sql {
  if (dataScope !== "own") return Prisma.sql`TRUE`;
  if (ownerCustomerIds.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${Prisma.raw(`${customerAlias}."id"`)} IN (${Prisma.join(
    ownerCustomerIds.map((id) => Prisma.sql`${id}::uuid`)
  )})`;
}

export async function buildCrmDashboardBasicResponse(
  scope: CrmCommercialAccessScope,
  now = new Date()
) {
  const since30 = new Date(now);
  since30.setUTCDate(since30.getUTCDate() - 30);
  const in7 = new Date(now);
  in7.setUTCDate(in7.getUTCDate() + 7);

  // A carteira é resolvida uma vez e reaproveitada por todas as contagens.
  const ownerCustomerIds =
    scope.dataScope === "own" ? await fetchCrmManualOwnerCustomerIds(prisma, scope) : [];

  const sellerFilterSql = buildCrmDashboardBasicCustomerScopeSql(
    scope.dataScope,
    ownerCustomerIds
  );

  const activityCustomerInScopeSql =
    scope.dataScope === "own"
      ? Prisma.sql`
          EXISTS (
            SELECT 1 FROM "Customer" c
            WHERE c."id" = a."customerId"
              AND ${buildCrmDashboardBasicCustomerScopeSql(scope.dataScope, ownerCustomerIds)}
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
