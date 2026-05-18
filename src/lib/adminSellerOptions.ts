import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import type { AdminSellerOption } from "@/src/lib/adminSellerOptionsTypes";

export type { AdminSellerOption, AdminSellerOptionConfidence } from "@/src/lib/adminSellerOptionsTypes";
export { buildAdminSellerOptionKey } from "@/src/lib/adminSellerOptionsTypes";

export function normalizeSellerNameForGrouping(value: string): string {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

export function formatSellerDisplayName(responsible: string | null, externalSellerId: number | null): string {
  if (responsible?.trim()) {
    return responsible.trim().replace(/\s+/g, " ");
  }
  if (externalSellerId != null) {
    return `Vendedor ID ${externalSellerId}`;
  }
  return "";
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function fetchAdminSellerOptionsFromDb(): Promise<AdminSellerOption[]> {
  const rows = await prisma.$queryRaw<
    {
      external_seller_id: number | null;
      responsible: string | null;
      orders_count: number;
      orders_value: unknown;
      proposals_count: number;
      proposals_value: unknown;
    }[]
  >(Prisma.sql`
    WITH raw_events AS (
      SELECT
        'order'::text AS src,
        so."externalSellerId" AS external_seller_id,
        NULLIF(TRIM(so."responsible"), '') AS responsible,
        so."totalNetValue" AS line_value
      FROM "SalesOrder" so
      WHERE so."externalSellerId" IS NOT NULL
         OR (so."responsible" IS NOT NULL AND TRIM(so."responsible") <> '')
      UNION ALL
      SELECT
        'proposal'::text AS src,
        p."externalSellerId" AS external_seller_id,
        NULLIF(TRIM(p."responsible"), '') AS responsible,
        p."totalNetValue" AS line_value
      FROM "Proposal" p
      WHERE p."externalSellerId" IS NOT NULL
         OR (p."responsible" IS NOT NULL AND TRIM(p."responsible") <> '')
    ),
    with_key AS (
      SELECT
        src,
        external_seller_id,
        responsible,
        line_value,
        CASE
          WHEN external_seller_id IS NOT NULL THEN 'id:' || external_seller_id::text
          WHEN responsible IS NOT NULL THEN 'r:' || UPPER(REGEXP_REPLACE(TRIM(responsible), '\\s+', ' ', 'g'))
          ELSE NULL
        END AS seller_key
      FROM raw_events
    ),
    filtered AS (
      SELECT * FROM with_key WHERE seller_key IS NOT NULL
    )
    SELECT
      MAX(external_seller_id) AS external_seller_id,
      MODE() WITHIN GROUP (ORDER BY responsible) AS responsible,
      COUNT(*) FILTER (WHERE src = 'order')::int AS orders_count,
      COALESCE(SUM(line_value) FILTER (WHERE src = 'order'), 0) AS orders_value,
      COUNT(*) FILTER (WHERE src = 'proposal')::int AS proposals_count,
      COALESCE(SUM(line_value) FILTER (WHERE src = 'proposal'), 0) AS proposals_value
    FROM filtered
    GROUP BY seller_key
    ORDER BY
      (COUNT(*) FILTER (WHERE src = 'order') + COUNT(*) FILTER (WHERE src = 'proposal')) DESC,
      MODE() WITHIN GROUP (ORDER BY responsible) ASC NULLS LAST
  `);

  const sellers: AdminSellerOption[] = [];

  for (const row of rows) {
    const externalSellerId = row.external_seller_id;
    const responsible = row.responsible?.trim() || null;
    if (externalSellerId == null && !responsible) continue;

    const displayName = formatSellerDisplayName(responsible, externalSellerId);
    if (!displayName) continue;

    const normalizedName = normalizeSellerNameForGrouping(displayName);
    if (!normalizedName) continue;

    sellers.push({
      externalSellerId,
      responsible,
      displayName,
      normalizedName,
      ordersCount: row.orders_count ?? 0,
      ordersValue: toNumber(row.orders_value),
      proposalsCount: row.proposals_count ?? 0,
      proposalsValue: toNumber(row.proposals_value),
      source: "sales_orders_and_proposals",
      confidence: externalSellerId != null ? "HIGH" : "MEDIUM",
    });
  }

  return sellers;
}
