/**
 * Serviço do GET /api/crm/management-dashboard — base principal: SalesOrder.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import {
  buildManagementRiskReasons,
  buildManagementSuggestedAction,
  mgmtDaysSince,
  mgmtDisplayName,
  mgmtIso,
  mgmtToNumber,
} from "@/src/lib/crmManagementDashboard";
import {
  CRM_ACTIVITY_NOT_CLOSED_SQL,
  CRM_VALID_PURCHASE_STATUS_SQL,
  crmOpenPortfolioOrderSql,
  crmOrderWithoutFollowUpNotExistsSql,
} from "@/src/lib/crmOrderPortfolioSql";

const LIST_LIMIT = 10;

function bigintCount(rows: { c: bigint }[] | undefined): number {
  return Number(rows?.[0]?.c ?? 0n);
}

export async function buildCrmManagementDashboardResponse(now = new Date()) {
  const nowMs = now.getTime();
  const since7 = new Date(now);
  since7.setUTCDate(since7.getUTCDate() - 7);
  const since30 = new Date(now);
  since30.setUTCDate(since30.getUTCDate() - 30);
  const since60 = new Date(now);
  since60.setUTCDate(since60.getUTCDate() - 60);
  const since90 = new Date(now);
  since90.setUTCDate(since90.getUTCDate() - 90);
  const since180 = new Date(now);
  since180.setUTCDate(since180.getUTCDate() - 180);
  const in7 = new Date(now);
  in7.setUTCDate(in7.getUTCDate() + 7);
  const in30 = new Date(now);
  in30.setUTCDate(in30.getUTCDate() + 30);
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setUTCDate(twelveMonthsAgo.getUTCDate() - 365);

  const openPortfolioSql = crmOpenPortfolioOrderSql("so");
  const orderNoFollowUpSql = crmOrderWithoutFollowUpNotExistsSql("so");

  const [
    totalCustomersRow,
    withContact30Row,
    withoutContact30Row,
    withoutContact60Row,
    withoutContact90Row,
    withoutValidPurchaseRow,
    withoutPurchase90Row,
    withoutPurchase180Row,
    contacts7Row,
    contacts30Row,
    overdueFollowUpsRow,
    upcoming7Row,
    upcoming30Row,
    openOrdersRow,
    ordersNoFollowUpRow,
    customersHighRiskRow,
    riskCustomersRows,
    opportunityTier1Rows,
    opportunityTier2Rows,
    opportunityTier3Rows,
    overdueFollowUpListRows,
    upcomingFollowUpListRows,
    ordersWithoutFollowUpRows,
    topCustomers12mRows,
    breakdownChannelRows,
    breakdownReasonRows,
    breakdownResponsibleRows,
  ] = await Promise.all([
    prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS c FROM "Customer"`),
    prisma.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(DISTINCT a."customerId")::bigint AS c
        FROM "CommercialActivity" a
        WHERE COALESCE(a."contactDate", a."createdAt") >= ${since30}
      `
    ),
    prisma.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS c FROM "Customer" c
        WHERE NOT EXISTS (
          SELECT 1 FROM "CommercialActivity" a
          WHERE a."customerId" = c."id"
            AND COALESCE(a."contactDate", a."createdAt") >= ${since30}
        )
      `
    ),
    prisma.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS c FROM "Customer" c
        WHERE NOT EXISTS (
          SELECT 1 FROM "CommercialActivity" a
          WHERE a."customerId" = c."id"
            AND COALESCE(a."contactDate", a."createdAt") >= ${since60}
        )
      `
    ),
    prisma.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS c FROM "Customer" c
        WHERE NOT EXISTS (
          SELECT 1 FROM "CommercialActivity" a
          WHERE a."customerId" = c."id"
            AND COALESCE(a."contactDate", a."createdAt") >= ${since90}
        )
      `
    ),
    prisma.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS c FROM "Customer" c
        WHERE NOT EXISTS (
          SELECT 1 FROM "SalesOrder" so
          WHERE so."customerId" = c."id" AND ${CRM_VALID_PURCHASE_STATUS_SQL}
        )
      `
    ),
    prisma.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS c FROM "Customer" c
        WHERE NOT EXISTS (
          SELECT 1 FROM "SalesOrder" so
          WHERE so."customerId" = c."id"
            AND ${CRM_VALID_PURCHASE_STATUS_SQL}
            AND so."issueDate" >= ${since90}
        )
      `
    ),
    prisma.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS c FROM "Customer" c
        WHERE NOT EXISTS (
          SELECT 1 FROM "SalesOrder" so
          WHERE so."customerId" = c."id"
            AND ${CRM_VALID_PURCHASE_STATUS_SQL}
            AND so."issueDate" >= ${since180}
        )
      `
    ),
    prisma.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS c FROM "CommercialActivity" a
        WHERE COALESCE(a."contactDate", a."createdAt") >= ${since7}
      `
    ),
    prisma.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS c FROM "CommercialActivity" a
        WHERE COALESCE(a."contactDate", a."createdAt") >= ${since30}
      `
    ),
    prisma.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS c FROM "CommercialActivity" a
        WHERE a."nextActionAt" IS NOT NULL AND a."nextActionAt" < ${now}
          AND ${CRM_ACTIVITY_NOT_CLOSED_SQL}
      `
    ),
    prisma.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS c FROM "CommercialActivity" a
        WHERE a."nextActionAt" IS NOT NULL
          AND a."nextActionAt" >= ${now} AND a."nextActionAt" < ${in7}
          AND ${CRM_ACTIVITY_NOT_CLOSED_SQL}
      `
    ),
    prisma.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS c FROM "CommercialActivity" a
        WHERE a."nextActionAt" IS NOT NULL
          AND a."nextActionAt" >= ${now} AND a."nextActionAt" < ${in30}
          AND ${CRM_ACTIVITY_NOT_CLOSED_SQL}
      `
    ),
    prisma.$queryRaw<{ cnt: bigint; val: unknown }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS cnt, COALESCE(SUM(so."totalNetValue"), 0) AS val
        FROM "SalesOrder" so
        WHERE ${openPortfolioSql}
      `
    ),
    prisma.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(*)::bigint AS c
        FROM "SalesOrder" so
        WHERE ${openPortfolioSql}
          AND ${orderNoFollowUpSql}
      `
    ),
    prisma.$queryRaw<{ c: bigint }[]>(
      Prisma.sql`
        SELECT COUNT(DISTINCT c."id")::bigint AS c
        FROM "Customer" c
        WHERE EXISTS (
          SELECT 1 FROM "SalesOrder" so
          WHERE so."customerId" = c."id"
            AND ${openPortfolioSql}
            AND ${orderNoFollowUpSql}
        )
        OR EXISTS (
          SELECT 1 FROM "SalesOrder" so
          WHERE so."customerId" = c."id"
            AND ${CRM_VALID_PURCHASE_STATUS_SQL}
          GROUP BY so."customerId"
          HAVING MAX(so."issueDate") < ${since90}
        )
      `
    ),
    prisma.$queryRaw<
      {
        customer_id: string;
        company_name: string;
        trade_name: string | null;
        tax_id: string;
        city: string | null;
        state: string | null;
        last_purchase_at: Date | null;
        last_contact_at: Date | null;
        open_orders_count: number;
        open_orders_value: unknown;
        has_order_no_fu: boolean;
        next_followup_at: Date | null;
        relationship_level: string | null;
        commercial_temperature: string | null;
        risk_level: string;
      }[]
    >(
      Prisma.sql`
        WITH last_purchase AS (
          SELECT so."customerId", MAX(so."issueDate") AS last_at
          FROM "SalesOrder" so
          WHERE ${CRM_VALID_PURCHASE_STATUS_SQL}
          GROUP BY so."customerId"
        ),
        last_contact AS (
          SELECT a."customerId", MAX(COALESCE(a."contactDate", a."createdAt")) AS last_at
          FROM "CommercialActivity" a
          GROUP BY a."customerId"
        ),
        open_order_stats AS (
          SELECT so."customerId",
            COUNT(*)::int AS cnt,
            COALESCE(SUM(so."totalNetValue"), 0) AS val
          FROM "SalesOrder" so
          WHERE ${openPortfolioSql}
          GROUP BY so."customerId"
        ),
        customer_no_followup AS (
          SELECT DISTINCT so."customerId"
          FROM "SalesOrder" so
          WHERE ${openPortfolioSql}
            AND ${orderNoFollowUpSql}
        ),
        next_followup AS (
          SELECT a."customerId", MIN(a."nextActionAt") AS next_at
          FROM "CommercialActivity" a
          WHERE a."nextActionAt" IS NOT NULL AND a."nextActionAt" > ${now}
            AND ${CRM_ACTIVITY_NOT_CLOSED_SQL}
          GROUP BY a."customerId"
        ),
        scored AS (
          SELECT
            c."id" AS customer_id,
            c."companyName" AS company_name,
            c."tradeName" AS trade_name,
            c."taxId" AS tax_id,
            c."city" AS city,
            c."state" AS state,
            lp.last_at AS last_purchase_at,
            lc.last_at AS last_contact_at,
            COALESCE(oos.cnt, 0) AS open_orders_count,
            COALESCE(oos.val, 0) AS open_orders_value,
            (cnf."customerId" IS NOT NULL) AS has_order_no_fu,
            nf.next_at AS next_followup_at,
            prof."relationshipLevel" AS relationship_level,
            prof."commercialTemperature" AS commercial_temperature,
            CASE
              WHEN cnf."customerId" IS NOT NULL
                OR (lp.last_at IS NOT NULL AND lp.last_at < ${since90})
              THEN 'HIGH'
              WHEN lp.last_at IS NULL OR COALESCE(oos.cnt, 0) > 0
              THEN 'MEDIUM'
              ELSE 'LOW'
            END AS risk_level
          FROM "Customer" c
          LEFT JOIN last_purchase lp ON lp."customerId" = c."id"
          LEFT JOIN last_contact lc ON lc."customerId" = c."id"
          LEFT JOIN open_order_stats oos ON oos."customerId" = c."id"
          LEFT JOIN customer_no_followup cnf ON cnf."customerId" = c."id"
          LEFT JOIN next_followup nf ON nf."customerId" = c."id"
          LEFT JOIN "CrmCustomerProfile" prof ON prof."customerId" = c."id"
        )
        SELECT * FROM scored
        WHERE risk_level IN ('HIGH', 'MEDIUM')
        ORDER BY
          CASE risk_level WHEN 'HIGH' THEN 0 ELSE 1 END,
          has_order_no_fu DESC,
          CASE WHEN last_purchase_at IS NULL THEN 999999
            ELSE EXTRACT(EPOCH FROM (${now}::timestamptz - last_purchase_at)) / 86400 END DESC,
          CASE WHEN last_contact_at IS NULL THEN 999999
            ELSE EXTRACT(EPOCH FROM (${now}::timestamptz - last_contact_at)) / 86400 END DESC
        LIMIT ${LIST_LIMIT}
      `
    ),
    prisma.$queryRaw<
      {
        customer_id: string;
        company_name: string;
        trade_name: string | null;
        tax_id: string;
        last_purchase_at: Date;
        last_contact_at: Date | null;
        total_12m: unknown;
        open_orders_count: number;
      }[]
    >(
      Prisma.sql`
        WITH last_purchase AS (
          SELECT so."customerId", MAX(so."issueDate") AS last_at
          FROM "SalesOrder" so WHERE ${CRM_VALID_PURCHASE_STATUS_SQL}
          GROUP BY so."customerId"
        ),
        last_contact AS (
          SELECT a."customerId", MAX(COALESCE(a."contactDate", a."createdAt")) AS last_at
          FROM "CommercialActivity" a GROUP BY a."customerId"
        ),
        purchase_12m AS (
          SELECT so."customerId", COALESCE(SUM(so."totalNetValue"), 0) AS total_12m
          FROM "SalesOrder" so
          WHERE ${CRM_VALID_PURCHASE_STATUS_SQL} AND so."issueDate" >= ${twelveMonthsAgo}
          GROUP BY so."customerId"
        ),
        open_order_stats AS (
          SELECT so."customerId", COUNT(*)::int AS cnt
          FROM "SalesOrder" so WHERE ${openPortfolioSql}
          GROUP BY so."customerId"
        )
        SELECT c."id" AS customer_id, c."companyName" AS company_name, c."tradeName" AS trade_name,
          c."taxId" AS tax_id, lp.last_at AS last_purchase_at, lc.last_at AS last_contact_at,
          COALESCE(p12.total_12m, 0) AS total_12m, COALESCE(oos.cnt, 0) AS open_orders_count
        FROM "Customer" c
        INNER JOIN last_purchase lp ON lp."customerId" = c."id"
        LEFT JOIN last_contact lc ON lc."customerId" = c."id"
        LEFT JOIN purchase_12m p12 ON p12."customerId" = c."id"
        LEFT JOIN open_order_stats oos ON oos."customerId" = c."id"
        WHERE lp.last_at >= ${since30}
        ORDER BY lp.last_at DESC
        LIMIT ${LIST_LIMIT}
      `
    ),
    prisma.$queryRaw<
      {
        customer_id: string;
        company_name: string;
        trade_name: string | null;
        tax_id: string;
        last_purchase_at: Date | null;
        last_contact_at: Date | null;
        total_12m: unknown;
        open_orders_count: number;
      }[]
    >(
      Prisma.sql`
        WITH last_purchase AS (
          SELECT so."customerId", MAX(so."issueDate") AS last_at
          FROM "SalesOrder" so WHERE ${CRM_VALID_PURCHASE_STATUS_SQL}
          GROUP BY so."customerId"
        ),
        last_contact AS (
          SELECT a."customerId", MAX(COALESCE(a."contactDate", a."createdAt")) AS last_at
          FROM "CommercialActivity" a GROUP BY a."customerId"
        ),
        purchase_12m AS (
          SELECT so."customerId", COALESCE(SUM(so."totalNetValue"), 0) AS total_12m
          FROM "SalesOrder" so
          WHERE ${CRM_VALID_PURCHASE_STATUS_SQL} AND so."issueDate" >= ${twelveMonthsAgo}
          GROUP BY so."customerId"
        ),
        open_order_stats AS (
          SELECT so."customerId", COUNT(*)::int AS cnt
          FROM "SalesOrder" so WHERE ${openPortfolioSql}
          GROUP BY so."customerId"
        )
        SELECT c."id" AS customer_id, c."companyName" AS company_name, c."tradeName" AS trade_name,
          c."taxId" AS tax_id, lp.last_at AS last_purchase_at, lc.last_at AS last_contact_at,
          COALESCE(p12.total_12m, 0) AS total_12m, COALESCE(oos.cnt, 0) AS open_orders_count
        FROM "Customer" c
        INNER JOIN open_order_stats oos ON oos."customerId" = c."id"
        LEFT JOIN last_purchase lp ON lp."customerId" = c."id"
        LEFT JOIN last_contact lc ON lc."customerId" = c."id"
        LEFT JOIN purchase_12m p12 ON p12."customerId" = c."id"
        WHERE oos.cnt > 0
        ORDER BY COALESCE(p12.total_12m, 0) DESC, oos.cnt DESC
        LIMIT ${LIST_LIMIT}
      `
    ),
    prisma.$queryRaw<
      {
        customer_id: string;
        company_name: string;
        trade_name: string | null;
        tax_id: string;
        last_purchase_at: Date | null;
        last_contact_at: Date | null;
        total_12m: unknown;
        open_orders_count: number;
      }[]
    >(
      Prisma.sql`
        WITH last_contact AS (
          SELECT a."customerId", MAX(COALESCE(a."contactDate", a."createdAt")) AS last_at
          FROM "CommercialActivity" a GROUP BY a."customerId"
        ),
        purchase_12m AS (
          SELECT so."customerId", COALESCE(SUM(so."totalNetValue"), 0) AS total_12m
          FROM "SalesOrder" so
          WHERE ${CRM_VALID_PURCHASE_STATUS_SQL} AND so."issueDate" >= ${twelveMonthsAgo}
          GROUP BY so."customerId"
        ),
        last_purchase AS (
          SELECT so."customerId", MAX(so."issueDate") AS last_at
          FROM "SalesOrder" so WHERE ${CRM_VALID_PURCHASE_STATUS_SQL}
          GROUP BY so."customerId"
        ),
        open_order_stats AS (
          SELECT so."customerId", COUNT(*)::int AS cnt
          FROM "SalesOrder" so WHERE ${openPortfolioSql}
          GROUP BY so."customerId"
        )
        SELECT c."id" AS customer_id, c."companyName" AS company_name, c."tradeName" AS trade_name,
          c."taxId" AS tax_id, lp.last_at AS last_purchase_at, lc.last_at AS last_contact_at,
          p12.total_12m AS total_12m, COALESCE(ops.cnt, 0) AS open_orders_count
        FROM "Customer" c
        INNER JOIN purchase_12m p12 ON p12."customerId" = c."id"
        LEFT JOIN last_contact lc ON lc."customerId" = c."id"
        LEFT JOIN last_purchase lp ON lp."customerId" = c."id"
        LEFT JOIN open_order_stats ops ON ops."customerId" = c."id"
        WHERE p12.total_12m > 0
          AND (lc.last_at IS NULL OR lc.last_at < ${since30})
        ORDER BY p12.total_12m DESC
        LIMIT ${LIST_LIMIT}
      `
    ),
    prisma.$queryRaw<
      {
        activity_id: string;
        customer_id: string;
        company_name: string;
        trade_name: string | null;
        next_action_at: Date;
        next_action_description: string | null;
        assigned_to: string | null;
        created_by_name: string | null;
      }[]
    >(
      Prisma.sql`
        SELECT a.id AS activity_id, a."customerId" AS customer_id,
          c."companyName" AS company_name, c."tradeName" AS trade_name,
          a."nextActionAt" AS next_action_at, a."nextActionDescription" AS next_action_description,
          a."assignedTo" AS assigned_to, a."createdByName" AS created_by_name
        FROM "CommercialActivity" a
        INNER JOIN "Customer" c ON c.id = a."customerId"
        WHERE a."nextActionAt" IS NOT NULL AND a."nextActionAt" < ${now}
          AND ${CRM_ACTIVITY_NOT_CLOSED_SQL}
        ORDER BY a."nextActionAt" ASC
        LIMIT ${LIST_LIMIT}
      `
    ),
    prisma.$queryRaw<
      {
        activity_id: string;
        customer_id: string;
        company_name: string;
        trade_name: string | null;
        next_action_at: Date;
        next_action_description: string | null;
        assigned_to: string | null;
        created_by_name: string | null;
      }[]
    >(
      Prisma.sql`
        SELECT a.id AS activity_id, a."customerId" AS customer_id,
          c."companyName" AS company_name, c."tradeName" AS trade_name,
          a."nextActionAt" AS next_action_at, a."nextActionDescription" AS next_action_description,
          a."assignedTo" AS assigned_to, a."createdByName" AS created_by_name
        FROM "CommercialActivity" a
        INNER JOIN "Customer" c ON c.id = a."customerId"
        WHERE a."nextActionAt" IS NOT NULL
          AND a."nextActionAt" >= ${now} AND a."nextActionAt" < ${in7}
          AND ${CRM_ACTIVITY_NOT_CLOSED_SQL}
        ORDER BY a."nextActionAt" ASC
        LIMIT ${LIST_LIMIT}
      `
    ),
    prisma.$queryRaw<
      {
        sales_order_id: string;
        order_code: string;
        customer_id: string;
        company_name: string;
        trade_name: string | null;
        status: string;
        total_net_value: unknown;
        updated_at: Date;
        responsible: string | null;
      }[]
    >(
      Prisma.sql`
        SELECT so.id AS sales_order_id, so."orderCode" AS order_code,
          so."customerId" AS customer_id, c."companyName" AS company_name, c."tradeName" AS trade_name,
          so.status::text AS status, so."totalNetValue" AS total_net_value,
          COALESCE(so."updatedAt", so."issueDate") AS updated_at, so.responsible AS responsible
        FROM "SalesOrder" so
        INNER JOIN "Customer" c ON c.id = so."customerId"
        WHERE ${openPortfolioSql}
          AND ${orderNoFollowUpSql}
        ORDER BY COALESCE(so."updatedAt", so."issueDate") ASC
        LIMIT ${LIST_LIMIT}
      `
    ),
    prisma.$queryRaw<
      {
        customer_id: string;
        company_name: string;
        trade_name: string | null;
        tax_id: string;
        total_purchased: unknown;
        orders_count: bigint;
        last_purchase_at: Date;
        last_contact_at: Date | null;
      }[]
    >(
      Prisma.sql`
        WITH purchase_12m AS (
          SELECT so."customerId",
            COALESCE(SUM(so."totalNetValue"), 0) AS total_purchased,
            COUNT(*)::bigint AS orders_count,
            MAX(so."issueDate") AS last_purchase_at
          FROM "SalesOrder" so
          WHERE ${CRM_VALID_PURCHASE_STATUS_SQL} AND so."issueDate" >= ${twelveMonthsAgo}
          GROUP BY so."customerId"
        ),
        last_contact AS (
          SELECT a."customerId", MAX(COALESCE(a."contactDate", a."createdAt")) AS last_at
          FROM "CommercialActivity" a GROUP BY a."customerId"
        )
        SELECT c."id" AS customer_id, c."companyName" AS company_name, c."tradeName" AS trade_name,
          c."taxId" AS tax_id, p12.total_purchased, p12.orders_count, p12.last_purchase_at,
          lc.last_at AS last_contact_at
        FROM purchase_12m p12
        INNER JOIN "Customer" c ON c.id = p12."customerId"
        LEFT JOIN last_contact lc ON lc."customerId" = c."id"
        ORDER BY p12.total_purchased DESC
        LIMIT ${LIST_LIMIT}
      `
    ),
    prisma.$queryRaw<{ key: string | null; count: bigint }[]>(
      Prisma.sql`
        SELECT COALESCE(NULLIF(TRIM(a.channel), ''), 'Sem canal') AS key, COUNT(*)::bigint AS count
        FROM "CommercialActivity" a
        WHERE COALESCE(a."contactDate", a."createdAt") >= ${since30}
        GROUP BY 1 ORDER BY count DESC LIMIT 20
      `
    ),
    prisma.$queryRaw<{ key: string | null; count: bigint }[]>(
      Prisma.sql`
        SELECT COALESCE(NULLIF(TRIM(a.reason), ''), 'Sem motivo') AS key, COUNT(*)::bigint AS count
        FROM "CommercialActivity" a
        WHERE COALESCE(a."contactDate", a."createdAt") >= ${since30}
        GROUP BY 1 ORDER BY count DESC LIMIT 20
      `
    ),
    prisma.$queryRaw<{ key: string; count: bigint }[]>(
      Prisma.sql`
        SELECT COALESCE(NULLIF(TRIM(a."assignedTo"), ''), NULLIF(TRIM(a."createdByName"), ''), 'Sem responsável') AS key,
          COUNT(*)::bigint AS count
        FROM "CommercialActivity" a
        WHERE COALESCE(a."contactDate", a."createdAt") >= ${since30}
        GROUP BY 1 ORDER BY count DESC LIMIT 20
      `
    ),
  ]);

  const openOrdersAgg = openOrdersRow?.[0];

  const riskCustomers = riskCustomersRows.map((row) => {
    const riskLevel = row.risk_level === "HIGH" ? "HIGH" : "MEDIUM";
    return {
      customerId: row.customer_id,
      displayName: mgmtDisplayName(row.company_name, row.trade_name),
      taxId: row.tax_id,
      city: row.city ?? null,
      state: row.state ?? null,
      riskLevel,
      riskReasons: buildManagementRiskReasons({
        riskLevel,
        hasOrderNoFollowUp: row.has_order_no_fu,
        lastPurchaseAt: row.last_purchase_at,
        openOrdersCount: row.open_orders_count,
        since90,
      }),
      daysSinceLastPurchase: mgmtDaysSince(row.last_purchase_at, nowMs),
      daysSinceLastContact: mgmtDaysSince(row.last_contact_at, nowMs),
      openOrdersCount: row.open_orders_count,
      openOrdersValue: mgmtToNumber(row.open_orders_value),
      nextFollowUpAt: mgmtIso(row.next_followup_at),
      relationshipLevel: row.relationship_level ?? null,
      commercialTemperature: row.commercial_temperature ?? null,
    };
  });

  type OppRow = (typeof opportunityTier1Rows)[number];
  const opportunityMap = new Map<
    string,
    {
      customerId: string;
      displayName: string;
      taxId: string;
      daysSinceLastPurchase: number | null;
      daysSinceLastContact: number | null;
      totalPurchasedLast12Months: number;
      openOrdersCount: number;
      suggestedAction: string;
      tier: number;
    }
  >();

  const addOpportunityRows = (rows: OppRow[], tier: number) => {
    for (const row of rows) {
      if (opportunityMap.has(row.customer_id)) continue;
      opportunityMap.set(row.customer_id, {
        customerId: row.customer_id,
        displayName: mgmtDisplayName(row.company_name, row.trade_name),
        taxId: row.tax_id,
        daysSinceLastPurchase: mgmtDaysSince(row.last_purchase_at, nowMs),
        daysSinceLastContact: mgmtDaysSince(row.last_contact_at, nowMs),
        totalPurchasedLast12Months: mgmtToNumber(row.total_12m),
        openOrdersCount: row.open_orders_count,
        suggestedAction: buildManagementSuggestedAction({
          lastPurchaseAt: row.last_purchase_at,
          lastContactAt: row.last_contact_at,
          openOrdersCount: row.open_orders_count,
          tier,
          since30,
        }),
        tier,
      });
    }
  };

  addOpportunityRows(opportunityTier1Rows, 1);
  addOpportunityRows(opportunityTier2Rows, 2);
  addOpportunityRows(opportunityTier3Rows, 3);

  const opportunityCustomers = [...opportunityMap.values()]
    .sort((a, b) => a.tier - b.tier)
    .slice(0, LIST_LIMIT)
    .map(({ tier: _tier, ...rest }) => rest);

  const overdueFollowUps = overdueFollowUpListRows.map((row) => {
    const nextAt = row.next_action_at;
    return {
      activityId: row.activity_id,
      customerId: row.customer_id,
      displayName: mgmtDisplayName(row.company_name, row.trade_name),
      nextActionAt: mgmtIso(nextAt) ?? now.toISOString(),
      nextActionDescription: row.next_action_description ?? null,
      assignedTo: row.assigned_to ?? null,
      createdByName: row.created_by_name ?? null,
      daysOverdue: Math.max(0, Math.floor((nowMs - nextAt.getTime()) / 86400000)),
    };
  });

  const upcomingFollowUps = upcomingFollowUpListRows.map((row) => {
    const nextAt = row.next_action_at;
    return {
      activityId: row.activity_id,
      customerId: row.customer_id,
      displayName: mgmtDisplayName(row.company_name, row.trade_name),
      nextActionAt: mgmtIso(nextAt) ?? now.toISOString(),
      nextActionDescription: row.next_action_description ?? null,
      assignedTo: row.assigned_to ?? null,
      createdByName: row.created_by_name ?? null,
      daysUntil: Math.max(0, Math.ceil((nextAt.getTime() - nowMs) / 86400000)),
    };
  });

  const ordersWithoutFollowUp = ordersWithoutFollowUpRows.map((row) => {
    const updatedAt = row.updated_at;
    return {
      salesOrderId: row.sales_order_id,
      orderCode: row.order_code,
      customerId: row.customer_id,
      displayName: mgmtDisplayName(row.company_name, row.trade_name),
      status: row.status,
      totalNetValue: mgmtToNumber(row.total_net_value),
      updatedAt: mgmtIso(updatedAt) ?? now.toISOString(),
      daysWithoutFollowUp: Math.max(0, Math.floor((nowMs - updatedAt.getTime()) / 86400000)),
      responsible: row.responsible ?? null,
    };
  });

  const topCustomersLast12Months = topCustomers12mRows.map((row) => ({
    customerId: row.customer_id,
    displayName: mgmtDisplayName(row.company_name, row.trade_name),
    taxId: row.tax_id,
    totalPurchasedLast12Months: mgmtToNumber(row.total_purchased),
    ordersCount: Number(row.orders_count ?? 0n),
    lastPurchaseAt: mgmtIso(row.last_purchase_at),
    daysSinceLastContact: mgmtDaysSince(row.last_contact_at, nowMs),
  }));

  const mapBreakdown = (rows: { key: string | null; count: bigint }[]) =>
    rows.map((r) => ({ key: r.key ?? "—", count: Number(r.count ?? 0n) }));

  const openOrdersCount = Number(openOrdersAgg?.cnt ?? 0n);
  const openOrdersValue = mgmtToNumber(openOrdersAgg?.val);

  return {
    generatedAt: now.toISOString(),
    summary: {
      totalCustomers: bigintCount(totalCustomersRow),
      customersWithContactLast30Days: bigintCount(withContact30Row),
      customersWithoutContactLast30Days: bigintCount(withoutContact30Row),
      customersWithoutContactLast60Days: bigintCount(withoutContact60Row),
      customersWithoutContactLast90Days: bigintCount(withoutContact90Row),
      customersWithoutValidPurchase: bigintCount(withoutValidPurchaseRow),
      customersWithoutPurchase90Days: bigintCount(withoutPurchase90Row),
      customersWithoutPurchase180Days: bigintCount(withoutPurchase180Row),
      contactsLast7Days: bigintCount(contacts7Row),
      contactsLast30Days: bigintCount(contacts30Row),
      overdueFollowUps: bigintCount(overdueFollowUpsRow),
      upcomingFollowUpsNext7Days: bigintCount(upcoming7Row),
      upcomingFollowUpsNext30Days: bigintCount(upcoming30Row),
      openOrdersCount,
      openOrdersValue,
      ordersWithoutFollowUpCount: bigintCount(ordersNoFollowUpRow),
      customersAtHighRisk: bigintCount(customersHighRiskRow),
    },
    riskCustomers,
    opportunityCustomers,
    overdueFollowUps,
    upcomingFollowUps,
    ordersWithoutFollowUp,
    topCustomersLast12Months,
    activityBreakdown: {
      periodDays: 30,
      byChannel: mapBreakdown(breakdownChannelRows),
      byReason: mapBreakdown(breakdownReasonRows),
      byResponsible: mapBreakdown(breakdownResponsibleRows),
    },
  };
}
