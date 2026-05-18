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

/** Converte Decimal/numeric/string do PostgreSQL (queryRaw) para number sem perder decimais. */
export function toMoneyNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const n = Number(trimmed.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  if (value instanceof Prisma.Decimal) {
    const n = value.toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "object") {
    const decimalLike = value as { toNumber?: () => number; toString?: () => string };
    if (typeof decimalLike.toNumber === "function") {
      const n = decimalLike.toNumber();
      if (Number.isFinite(n)) return n;
    }
    if (typeof decimalLike.toString === "function") {
      const n = Number(decimalLike.toString());
      if (Number.isFinite(n)) return n;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rowToSellerOption(row: {
  external_seller_id: number | null;
  responsible: string | null;
  orders_count: number;
  orders_value: unknown;
  proposals_count: number;
  proposals_value: unknown;
}): AdminSellerOption | null {
  const externalSellerId = row.external_seller_id;
  const responsible = row.responsible?.trim() || null;
  if (externalSellerId == null && !responsible) return null;

  const displayName = formatSellerDisplayName(responsible, externalSellerId);
  if (!displayName) return null;

  const normalizedName = normalizeSellerNameForGrouping(displayName);
  if (!normalizedName) return null;

  return {
    externalSellerId,
    responsible,
    displayName,
    normalizedName,
    ordersCount: row.orders_count ?? 0,
    ordersValue: toMoneyNumber(row.orders_value),
    proposalsCount: row.proposals_count ?? 0,
    proposalsValue: toMoneyNumber(row.proposals_value),
    source: "sales_orders_and_proposals",
    confidence: externalSellerId != null ? "HIGH" : "MEDIUM",
  };
}

/**
 * Mescla opção MEDIUM (sem ID) na HIGH quando o normalizedName coincide.
 * Não mescla nomes diferentes nem MEDIUM órfãs sem HIGH correspondente.
 */
export function mergeSellerOptionsByNormalizedName(sellers: AdminSellerOption[]): AdminSellerOption[] {
  const byName = new Map<string, AdminSellerOption[]>();
  for (const seller of sellers) {
    const bucket = byName.get(seller.normalizedName) ?? [];
    bucket.push(seller);
    byName.set(seller.normalizedName, bucket);
  }

  const merged: AdminSellerOption[] = [];

  for (const group of byName.values()) {
    const high = group.find((s) => s.externalSellerId != null && s.confidence === "HIGH");
    const mediums = group.filter((s) => s.externalSellerId == null && s.confidence === "MEDIUM");

    if (high && mediums.length > 0) {
      let mergedFallbackRowsCount = 0;
      for (const medium of mediums) {
        if (medium.normalizedName !== high.normalizedName) continue;
        mergedFallbackRowsCount += 1;
        high.ordersCount += medium.ordersCount;
        high.ordersValue += medium.ordersValue;
        high.proposalsCount += medium.proposalsCount;
        high.proposalsValue += medium.proposalsValue;
      }
      if (mergedFallbackRowsCount > 0) {
        high.hasMergedNameFallback = true;
        high.mergedFallbackRowsCount = mergedFallbackRowsCount;
      }
      merged.push(high);
      const remaining = group.filter(
        (s) => s !== high && !(s.externalSellerId == null && s.normalizedName === high.normalizedName)
      );
      merged.push(...remaining);
      continue;
    }

    merged.push(...group);
  }

  return merged;
}

export function sortAdminSellerOptions(sellers: AdminSellerOption[]): AdminSellerOption[] {
  return [...sellers].sort((a, b) => {
    const totalA = a.ordersCount + a.proposalsCount;
    const totalB = b.ordersCount + b.proposalsCount;
    if (totalB !== totalA) return totalB - totalA;
    return a.displayName.localeCompare(b.displayName, "pt-BR", { sensitivity: "base" });
  });
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
        so."totalNetValue"::double precision AS line_value
      FROM "SalesOrder" so
      WHERE so."externalSellerId" IS NOT NULL
         OR (so."responsible" IS NOT NULL AND TRIM(so."responsible") <> '')
      UNION ALL
      SELECT
        'proposal'::text AS src,
        p."externalSellerId" AS external_seller_id,
        NULLIF(TRIM(p."responsible"), '') AS responsible,
        p."totalNetValue"::double precision AS line_value
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
      COALESCE(SUM(line_value) FILTER (WHERE src = 'order'), 0)::double precision AS orders_value,
      COUNT(*) FILTER (WHERE src = 'proposal')::int AS proposals_count,
      COALESCE(SUM(line_value) FILTER (WHERE src = 'proposal'), 0)::double precision AS proposals_value
    FROM filtered
    GROUP BY seller_key
  `);

  const rawSellers: AdminSellerOption[] = [];
  for (const row of rows) {
    const option = rowToSellerOption(row);
    if (option) rawSellers.push(option);
  }

  return sortAdminSellerOptions(mergeSellerOptionsByNormalizedName(rawSellers));
}
