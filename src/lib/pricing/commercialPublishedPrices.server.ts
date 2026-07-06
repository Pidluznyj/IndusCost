/**
 * Snapshot read-only de preços comerciais publicados para o grid da Formação de Preço.
 * Lê PriceTableItem congelado — não recalcula preço nem chama motor de custo.
 */
import type { PrismaClient } from "@prisma/client";
import { normalizeSearchString } from "../utils.js";
import { resolvePublishedPriceTableVersionForDate } from "../priceTablePublication.server.js";

export const MAX_COMMERCIAL_PUBLISHED_TABLES = 4;

export type CommercialPublishedPriceGridSort =
  | "SKU_ASC"
  | "SKU_DESC"
  | "NAME_ASC"
  | "NAME_DESC"
  | "LAST_PUBLISHED_DESC";

export type CommercialPublishedPriceGridQuery = {
  search?: string | null;
  taxRuleId?: string | null;
  /** Filtra linhas com margem publicada (%) igual ao valor informado. */
  marginRuleId?: string | null;
  /** Filtra linhas com comissão publicada (%) igual ao valor informado. */
  commissionRuleId?: string | null;
  tableId?: string | null;
  referenceDate?: Date | null;
  page?: number;
  limit?: number;
  sort?: CommercialPublishedPriceGridSort;
};

export type CommercialPublishedPriceGridTable = {
  tableId: string;
  tableName: string;
  tableCode: string;
  versionId: string;
  versionNumber: number;
  publishedAt: string | null;
  effectiveFrom: string | null;
  taxRuleId: string | null;
  taxRuleName: string | null;
  status: string;
};

export type CommercialPublishedPriceCell = {
  tableId: string;
  tableName: string;
  versionId: string;
  priceItemId: string | null;
  salePrice: number | null;
  marginPercent: number | null;
  markup: number | null;
  commissionPercent: number | null;
  taxPercent: number | null;
  status: "PUBLISHED" | "NO_PRICE";
};

export type CommercialPublishedPriceGridRow = {
  productId: string;
  sku: string;
  productName: string;
  taxInfo: {
    fiscalRuleId: string | null;
    fiscalRuleName: string | null;
    taxPercent: number | null;
  } | null;
  prices: CommercialPublishedPriceCell[];
  lastPublishedAt: string | null;
  status: "OK" | "PARTIAL" | "NO_PRICE";
};

export type CommercialPublishedPriceGridSnapshot = {
  referenceDate: string;
  tables: CommercialPublishedPriceGridTable[];
  rows: CommercialPublishedPriceGridRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  totals: {
    tableCount: number;
    rowCount: number;
    pricedCellCount: number;
    emptyCellCount: number;
  };
};

type PublishedTableContext = CommercialPublishedPriceGridTable;

type PriceTableItemRow = {
  id: string;
  priceTableVersionId: string;
  productId: string;
  sku: string;
  productName: string;
  frozenTotalCost: unknown;
  marginPct: unknown;
  salePrice: unknown;
  commissionPerc: unknown;
  formulaSnapshotJson: unknown;
};

function dec(value: unknown): number | null {
  if (value == null) return null;
  const n =
    typeof value === "object" && value !== null && "toNumber" in value
      ? (value as { toNumber: () => number }).toNumber()
      : Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toIsoDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

export function readPublishedPriceItemMetrics(item: {
  salePrice: unknown;
  frozenTotalCost: unknown;
  marginPct: unknown;
  commissionPerc: unknown;
  formulaSnapshotJson: unknown;
}): {
  salePrice: number | null;
  marginPercent: number | null;
  commissionPercent: number | null;
  taxPercent: number | null;
  markup: number | null;
} {
  const salePriceRaw = dec(item.salePrice);
  const salePrice = salePriceRaw != null && salePriceRaw > 0 ? roundMoney(salePriceRaw) : null;
  const frozenTotalCost = dec(item.frozenTotalCost);
  const marginPercent = dec(item.marginPct);

  let commissionPercent = dec(item.commissionPerc);
  let taxPercent: number | null = null;

  const formula =
    item.formulaSnapshotJson != null && typeof item.formulaSnapshotJson === "object"
      ? (item.formulaSnapshotJson as Record<string, unknown>)
      : null;
  const rates =
    formula?.rates != null && typeof formula.rates === "object"
      ? (formula.rates as Record<string, unknown>)
      : undefined;

  const taxRate = Number(rates?.taxRate);
  if (Number.isFinite(taxRate) && taxRate >= 0) {
    taxPercent = roundPercent(taxRate * 100);
  }

  if (commissionPercent == null || commissionPercent <= 0) {
    const legacyCommissionRate = Number(rates?.commissionRate);
    if (Number.isFinite(legacyCommissionRate) && legacyCommissionRate > 0) {
      commissionPercent = roundPercent(legacyCommissionRate * 100);
    }
  }

  const markup =
    salePrice != null && frozenTotalCost != null && frozenTotalCost > 0
      ? roundPercent((salePrice / frozenTotalCost - 1) * 100)
      : null;

  return {
    salePrice,
    marginPercent: marginPercent != null ? roundPercent(marginPercent) : null,
    commissionPercent: commissionPercent != null ? roundPercent(commissionPercent) : null,
    taxPercent,
    markup,
  };
}

function parseOptionalPercentFilter(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(String(raw).trim().replace(",", "."));
  return Number.isFinite(n) ? roundPercent(n) : null;
}

function matchesSearch(sku: string, productName: string, search: string): boolean {
  if (!search) return true;
  const haystack = normalizeSearchString(`${sku} ${productName}`);
  const needle = normalizeSearchString(search);
  return haystack.includes(needle);
}

function matchesPercentFilter(
  values: Array<number | null | undefined>,
  target: number | null
): boolean {
  if (target == null) return true;
  return values.some((value) => value != null && Math.abs(value - target) < 0.011);
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
}

function sortRows(
  rows: CommercialPublishedPriceGridRow[],
  sort: CommercialPublishedPriceGridSort
): CommercialPublishedPriceGridRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (sort) {
      case "SKU_DESC":
        return compareStrings(b.sku, a.sku);
      case "NAME_ASC":
        return compareStrings(a.productName, b.productName);
      case "NAME_DESC":
        return compareStrings(b.productName, a.productName);
      case "LAST_PUBLISHED_DESC": {
        const aTime = a.lastPublishedAt ? Date.parse(a.lastPublishedAt) : 0;
        const bTime = b.lastPublishedAt ? Date.parse(b.lastPublishedAt) : 0;
        if (bTime !== aTime) return bTime - aTime;
        return compareStrings(a.sku, b.sku);
      }
      case "SKU_ASC":
      default:
        return compareStrings(a.sku, b.sku);
    }
  });
  return sorted;
}

function buildEmptyPriceCell(ctx: PublishedTableContext): CommercialPublishedPriceCell {
  return {
    tableId: ctx.tableId,
    tableName: ctx.tableName,
    versionId: ctx.versionId,
    priceItemId: null,
    salePrice: null,
    marginPercent: null,
    markup: null,
    commissionPercent: null,
    taxPercent: null,
    status: "NO_PRICE",
  };
}

function buildPriceCell(
  ctx: PublishedTableContext,
  item: PriceTableItemRow
): CommercialPublishedPriceCell {
  const metrics = readPublishedPriceItemMetrics(item);
  const hasPrice = metrics.salePrice != null;
  return {
    tableId: ctx.tableId,
    tableName: ctx.tableName,
    versionId: ctx.versionId,
    priceItemId: item.id,
    salePrice: metrics.salePrice,
    marginPercent: metrics.marginPercent,
    markup: metrics.markup,
    commissionPercent: metrics.commissionPercent,
    taxPercent: metrics.taxPercent,
    status: hasPrice ? "PUBLISHED" : "NO_PRICE",
  };
}

function resolveRowStatus(prices: CommercialPublishedPriceCell[]): CommercialPublishedPriceGridRow["status"] {
  const published = prices.filter((p) => p.status === "PUBLISHED").length;
  if (published === 0) return "NO_PRICE";
  if (published === prices.length) return "OK";
  return "PARTIAL";
}

export async function resolveCommercialPublishedTableContexts(
  db: Pick<PrismaClient, "priceTable" | "priceTableVersion" | "taxRule">,
  options?: {
    referenceDate?: Date;
    tableId?: string | null;
    taxRuleId?: string | null;
    maxTables?: number;
  }
): Promise<PublishedTableContext[]> {
  const referenceDate = options?.referenceDate ?? new Date();
  const maxTables = options?.maxTables ?? MAX_COMMERCIAL_PUBLISHED_TABLES;

  const catalog = await db.priceTable.findMany({
    where: {
      status: "ACTIVE",
      ...(options?.tableId?.trim() ? { id: options.tableId.trim() } : {}),
    },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });

  const contexts: PublishedTableContext[] = [];

  for (const table of catalog) {
    if (contexts.length >= maxTables) break;

    const version = await resolvePublishedPriceTableVersionForDate(db, table.id, referenceDate);
    if (!version) continue;

    if (options?.taxRuleId?.trim() && version.taxRuleId !== options.taxRuleId.trim()) {
      continue;
    }

    let taxRuleName: string | null = null;
    if (version.taxRuleId) {
      const taxRule = await db.taxRule.findUnique({
        where: { id: version.taxRuleId },
        select: { name: true },
      });
      taxRuleName = taxRule?.name ?? null;
    }

    contexts.push({
      tableId: table.id,
      tableName: table.name,
      tableCode: table.code,
      versionId: version.id,
      versionNumber: version.versionNumber,
      publishedAt: toIsoDate(version.publishedAt),
      effectiveFrom: toIsoDate(version.effectiveFrom),
      taxRuleId: version.taxRuleId,
      taxRuleName,
      status: version.status,
    });
  }

  return contexts;
}

export async function buildCommercialPublishedPriceGridSnapshot(
  db: Pick<PrismaClient, "priceTable" | "priceTableVersion" | "priceTableItem" | "taxRule">,
  rawQuery: CommercialPublishedPriceGridQuery = {}
): Promise<CommercialPublishedPriceGridSnapshot> {
  const referenceDate = rawQuery.referenceDate ?? new Date();
  const page = Math.max(1, rawQuery.page ?? 1);
  const limit = Math.min(200, Math.max(1, rawQuery.limit ?? 50));
  const sort = rawQuery.sort ?? "SKU_ASC";
  const search = rawQuery.search?.trim() ?? "";
  const marginFilter = parseOptionalPercentFilter(rawQuery.marginRuleId);
  const commissionFilter = parseOptionalPercentFilter(rawQuery.commissionRuleId);

  const tables = await resolveCommercialPublishedTableContexts(db, {
    referenceDate,
    tableId: rawQuery.tableId,
    taxRuleId: rawQuery.taxRuleId,
  });

  if (tables.length === 0) {
    return {
      referenceDate: referenceDate.toISOString().slice(0, 10),
      tables: [],
      rows: [],
      pagination: { page, limit, total: 0, totalPages: 1 },
      totals: { tableCount: 0, rowCount: 0, pricedCellCount: 0, emptyCellCount: 0 },
    };
  }

  const versionIds = tables.map((t) => t.versionId);
  const items = (await db.priceTableItem.findMany({
    where: { priceTableVersionId: { in: versionIds } },
    select: {
      id: true,
      priceTableVersionId: true,
      productId: true,
      sku: true,
      productName: true,
      frozenTotalCost: true,
      marginPct: true,
      salePrice: true,
      commissionPerc: true,
      formulaSnapshotJson: true,
    },
  })) as PriceTableItemRow[];

  const contextByVersionId = new Map(tables.map((t) => [t.versionId, t]));
  const itemsByProductId = new Map<
    string,
    { sku: string; productName: string; byTableId: Map<string, PriceTableItemRow> }
  >();

  for (const item of items) {
    const ctx = contextByVersionId.get(item.priceTableVersionId);
    if (!ctx) continue;

    const bucket =
      itemsByProductId.get(item.productId) ??
      {
        sku: item.sku,
        productName: item.productName,
        byTableId: new Map<string, PriceTableItemRow>(),
      };
    bucket.byTableId.set(ctx.tableId, item);
    itemsByProductId.set(item.productId, bucket);
  }

  let rows: CommercialPublishedPriceGridRow[] = [];

  for (const [productId, bucket] of itemsByProductId.entries()) {
    if (!matchesSearch(bucket.sku, bucket.productName, search)) continue;

    const prices = tables.map((ctx) => {
      const item = bucket.byTableId.get(ctx.tableId);
      return item ? buildPriceCell(ctx, item) : buildEmptyPriceCell(ctx);
    });

    if (!matchesPercentFilter(prices.map((p) => p.marginPercent), marginFilter)) continue;
    if (!matchesPercentFilter(prices.map((p) => p.commissionPercent), commissionFilter)) continue;

    const publishedContexts = tables.filter((ctx) => bucket.byTableId.has(ctx.tableId));
    const taxCtx = publishedContexts[0] ?? tables[0];
    const firstPublished = prices.find((p) => p.status === "PUBLISHED");

    rows.push({
      productId,
      sku: bucket.sku,
      productName: bucket.productName,
      taxInfo: taxCtx
        ? {
            fiscalRuleId: taxCtx.taxRuleId,
            fiscalRuleName: taxCtx.taxRuleName,
            taxPercent: firstPublished?.taxPercent ?? null,
          }
        : null,
      prices,
      lastPublishedAt: taxCtx?.publishedAt ?? null,
      status: resolveRowStatus(prices),
    });
  }

  rows = sortRows(rows, sort);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const pagedRows = rows.slice(start, start + limit);

  let pricedCellCount = 0;
  let emptyCellCount = 0;
  for (const row of pagedRows) {
    for (const price of row.prices) {
      if (price.status === "PUBLISHED") pricedCellCount += 1;
      else emptyCellCount += 1;
    }
  }

  return {
    referenceDate: referenceDate.toISOString().slice(0, 10),
    tables,
    rows: pagedRows,
    pagination: { page, limit, total, totalPages },
    totals: {
      tableCount: tables.length,
      rowCount: pagedRows.length,
      pricedCellCount,
      emptyCellCount,
    },
  };
}
