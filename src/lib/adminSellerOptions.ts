import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import type { AdminSellerOption } from "@/src/lib/adminSellerOptionsTypes";
import {
  buildRawSellerKeyFromRow,
  consolidateSellerRowFragments,
  normalizeSellerIdentityName,
} from "@/src/lib/crmSellerIdentityConsolidation.js";

export type { AdminSellerOption, AdminSellerOptionConfidence } from "@/src/lib/adminSellerOptionsTypes";
export { buildAdminSellerOptionKey } from "@/src/lib/adminSellerOptionsTypes";

export function normalizeSellerNameForGrouping(value: string): string {
  return normalizeSellerIdentityName(value).toUpperCase();
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
  const options = consolidateAdminSellerMetricsRows([row]);
  return options[0] ?? null;
}

export type AdminSellerMetricsRow = {
  external_seller_id: number | null;
  responsible: string | null;
  orders_count: number;
  orders_value: unknown;
  proposals_count: number;
  proposals_value: unknown;
};

/** Consolida linhas SQL (uma por seller_key) em opções únicas para o cadastro de usuário. */
export function consolidateAdminSellerMetricsRows(
  rows: AdminSellerMetricsRow[]
): AdminSellerOption[] {
  const metricsBySourceKey = new Map<
    string,
    {
      ordersCount: number;
      ordersValue: number;
      proposalsCount: number;
      proposalsValue: number;
    }
  >();

  for (const row of rows) {
    const sourceSellerKey = buildRawSellerKeyFromRow(row.external_seller_id, row.responsible);
    const current = metricsBySourceKey.get(sourceSellerKey) ?? {
      ordersCount: 0,
      ordersValue: 0,
      proposalsCount: 0,
      proposalsValue: 0,
    };
    current.ordersCount += row.orders_count ?? 0;
    current.ordersValue += toMoneyNumber(row.orders_value);
    current.proposalsCount += row.proposals_count ?? 0;
    current.proposalsValue += toMoneyNumber(row.proposals_value);
    metricsBySourceKey.set(sourceSellerKey, current);
  }

  const consolidated = consolidateSellerRowFragments(
    rows.map((row) => ({
      external_seller_id: row.external_seller_id,
      responsible: row.responsible,
      orders_count: row.orders_count ?? 0,
    }))
  );

  const options: AdminSellerOption[] = [];
  for (const group of consolidated) {
    let ordersValue = 0;
    let proposalsCount = 0;
    let proposalsValue = 0;
    let mergedFallbackRowsCount = 0;

    for (const sourceKey of group.sourceSellerKeys) {
      const metrics = metricsBySourceKey.get(sourceKey);
      if (!metrics) continue;
      ordersValue += metrics.ordersValue;
      proposalsCount += metrics.proposalsCount;
      proposalsValue += metrics.proposalsValue;
      if (sourceKey.startsWith("r:") && group.externalSellerIds.length > 0) {
        mergedFallbackRowsCount += 1;
      }
    }

    const canonicalId =
      group.externalSellerIds.length > 0 ? group.externalSellerIds[0]! : null;
    const confidence =
      group.externalSellerIds.length > 0 || group.hasOrdersWithoutNomusId
        ? group.externalSellerIds.length > 0
          ? "HIGH"
          : "MEDIUM"
        : "MEDIUM";

    options.push({
      externalSellerId: canonicalId,
      externalSellerIds: group.externalSellerIds,
      sellerIdentityKey: group.sellerIdentityKey,
      responsible: group.responsible,
      displayName: group.displayName,
      normalizedName: group.normalizedName,
      ordersCount: group.ordersCount,
      ordersValue,
      proposalsCount,
      proposalsValue,
      source: "sales_orders",
      confidence: confidence as AdminSellerOption["confidence"],
      mergedFragmentCount: group.mergedFragmentCount,
      hasMergedNameFallback: group.hasOrdersWithoutNomusId && group.externalSellerIds.length > 0,
      mergedFallbackRowsCount:
        mergedFallbackRowsCount > 0 ? mergedFallbackRowsCount : undefined,
      needsReview: group.needsReview,
    });
  }

  return options;
}

export function formatAdminSellerOptionSublabel(option: AdminSellerOption): string {
  const idPart =
    option.externalSellerIds.length > 1
      ? `IDs Nomus ${option.externalSellerIds.join(", ")}`
      : option.externalSellerId != null
        ? `ID Nomus ${option.externalSellerId}`
        : "Sem ID — fallback por nome";
  const confidenceLabel =
    option.confidence === "HIGH" ? "Alta confiança" : "Média confiança (sem ID Nomus)";
  const counts = formatAdminSellerOptionCounts(option);
  const mergeNote =
    option.mergedFragmentCount > 1
      ? ` · Consolida ${option.mergedFragmentCount} registros Nomus`
      : "";
  return `${idPart} · ${confidenceLabel} · ${counts}${mergeNote}`;
}

export function formatAdminSellerOptionCounts(option: AdminSellerOption): string {
  const orderVal = formatCompactBrlAdmin(option.ordersValue);
  const base = orderVal
    ? `${option.ordersCount} ped. · ${orderVal}`
    : `${option.ordersCount} ped.`;
  const propPart =
    option.proposalsCount > 0 ? ` · ${option.proposalsCount} prop. negociação` : "";
  return `${base}${propPart}`;
}

function formatCompactBrlAdmin(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Mescla opção MEDIUM (sem ID) na HIGH quando o normalizedName coincide.
 * Soma apenas pedidos — propostas permanecem separadas.
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
    if (b.ordersCount !== a.ordersCount) return b.ordersCount - a.ordersCount;
    if (b.ordersValue !== a.ordersValue) return b.ordersValue - a.ordersValue;
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
    WITH orders_events AS (
      SELECT
        so."externalSellerId" AS external_seller_id,
        NULLIF(TRIM(so."responsible"), '') AS responsible,
        so."totalNetValue"::double precision AS line_value,
        CASE
          WHEN so."externalSellerId" IS NOT NULL THEN 'id:' || so."externalSellerId"::text
          WHEN NULLIF(TRIM(so."responsible"), '') IS NOT NULL
          THEN 'r:' || UPPER(REGEXP_REPLACE(TRIM(so."responsible"), '\\s+', ' ', 'g'))
          ELSE NULL
        END AS seller_key
      FROM "SalesOrder" so
      WHERE so.status::text NOT IN ('CANCELLED', 'ERROR')
        AND (
          so."externalSellerId" IS NOT NULL
          OR (so."responsible" IS NOT NULL AND TRIM(so."responsible") <> '')
        )
    ),
    proposals_events AS (
      SELECT
        p."externalSellerId" AS external_seller_id,
        NULLIF(TRIM(p."responsible"), '') AS responsible,
        p."totalNetValue"::double precision AS line_value,
        CASE
          WHEN p."externalSellerId" IS NOT NULL THEN 'id:' || p."externalSellerId"::text
          WHEN NULLIF(TRIM(p."responsible"), '') IS NOT NULL
          THEN 'r:' || UPPER(REGEXP_REPLACE(TRIM(p."responsible"), '\\s+', ' ', 'g'))
          ELSE NULL
        END AS seller_key
      FROM "Proposal" p
      WHERE p.status::text IN ('DRAFT', 'ANALYSIS', 'SENT')
        AND (
          p."externalSellerId" IS NOT NULL
          OR (p."responsible" IS NOT NULL AND TRIM(p."responsible") <> '')
        )
    ),
    orders_by_seller AS (
      SELECT
        seller_key,
        MAX(external_seller_id) AS external_seller_id,
        MODE() WITHIN GROUP (ORDER BY responsible) AS responsible,
        COUNT(*)::int AS orders_count,
        COALESCE(SUM(line_value), 0)::double precision AS orders_value
      FROM orders_events
      WHERE seller_key IS NOT NULL
      GROUP BY seller_key
    ),
    proposals_by_seller AS (
      SELECT
        seller_key,
        MAX(external_seller_id) AS external_seller_id,
        MODE() WITHIN GROUP (ORDER BY responsible) AS responsible,
        COUNT(*)::int AS proposals_count,
        COALESCE(SUM(line_value), 0)::double precision AS proposals_value
      FROM proposals_events
      WHERE seller_key IS NOT NULL
      GROUP BY seller_key
    ),
    all_keys AS (
      SELECT seller_key FROM orders_by_seller
      UNION
      SELECT seller_key FROM proposals_by_seller
    )
    SELECT
      COALESCE(o.external_seller_id, p.external_seller_id) AS external_seller_id,
      COALESCE(o.responsible, p.responsible) AS responsible,
      COALESCE(o.orders_count, 0) AS orders_count,
      COALESCE(o.orders_value, 0) AS orders_value,
      COALESCE(p.proposals_count, 0) AS proposals_count,
      COALESCE(p.proposals_value, 0) AS proposals_value
    FROM all_keys k
    LEFT JOIN orders_by_seller o ON o.seller_key = k.seller_key
    LEFT JOIN proposals_by_seller p ON p.seller_key = k.seller_key
  `);

  const rawSellers = consolidateAdminSellerMetricsRows(rows);
  return sortAdminSellerOptions(rawSellers);
}
