/**
 * Auditoria read-only do grid de preços comerciais publicados.
 * Usa o mesmo service do endpoint (`buildCommercialPublishedPriceGridSnapshot`).
 */
import type { PrismaClient } from "@prisma/client";
import {
  buildCommercialPublishedPriceGridSnapshot,
  readPublishedPriceItemMetrics,
  resolveCommercialPublishedTableContexts,
} from "./commercialPublishedPrices.server.js";
import type {
  CommercialPublishedPriceGridRow,
  CommercialPublishedPriceGridSnapshot,
  CommercialPublishedPriceGridTable,
} from "./commercialPublishedPrices.types.js";

const GRID_PAGE_LIMIT = 200;

export type CommercialPriceGridAuditMismatch = {
  productId: string;
  sku: string;
  tableCode: string;
  tableName: string;
  field: "salePrice" | "priceItemId" | "versionId" | "missingPublishedItem";
  gridValue: string | number | null;
  publishedValue: string | number | null;
  priceItemId: string | null;
};

export type CommercialPriceGridPartialProduct = {
  productId: string;
  sku: string;
  productName: string;
  status: CommercialPublishedPriceGridRow["status"];
  missingTableCodes: string[];
};

export type CommercialPriceGridTopProduct = {
  productId: string;
  sku: string;
  productName: string;
  maxSalePrice: number;
  tableCode: string;
  tableName: string;
};

export type CommercialPriceGridAuditResult = {
  status: "PASS" | "FAIL";
  referenceDate: string;
  tables: CommercialPublishedPriceGridTable[];
  productCount: number;
  pricedCountByTable: Array<{
    tableId: string;
    tableCode: string;
    tableName: string;
    versionId: string;
    versionNumber: number;
    pricedProducts: number;
    totalProducts: number;
  }>;
  partialProducts: CommercialPriceGridPartialProduct[];
  mismatches: CommercialPriceGridAuditMismatch[];
  topProductsByPrice: CommercialPriceGridTopProduct[];
  gridSnapshot: CommercialPublishedPriceGridSnapshot;
};

export type CommercialPriceGridAuditQuery = {
  search?: string | null;
  sku?: string | null;
  productId?: string | null;
  referenceDate?: Date;
};

type PublishedItemRow = {
  id: string;
  priceTableVersionId: string;
  productId: string;
  sku: string;
  salePrice: unknown;
  frozenTotalCost: unknown;
  marginPct: unknown;
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

function normalizeSku(value: string): string {
  return value.trim().toLowerCase();
}

export function filterAuditRows(
  rows: CommercialPublishedPriceGridRow[],
  options?: { sku?: string | null; productId?: string | null }
): CommercialPublishedPriceGridRow[] {
  const sku = options?.sku?.trim();
  const productId = options?.productId?.trim();
  if (!sku && !productId) return rows;

  return rows.filter((row) => {
    if (productId && row.productId !== productId) return false;
    if (sku && normalizeSku(row.sku) !== normalizeSku(sku)) return false;
    return true;
  });
}

export function compareGridCellToPublishedItem(input: {
  row: CommercialPublishedPriceGridRow;
  table: CommercialPublishedPriceGridTable;
  cellIndex: number;
  publishedItem: PublishedItemRow | null | undefined;
}): CommercialPriceGridAuditMismatch[] {
  const { row, table, cellIndex, publishedItem } = input;
  const cell = row.prices[cellIndex];
  if (!cell) return [];

  const mismatches: CommercialPriceGridAuditMismatch[] = [];
  const base = {
    productId: row.productId,
    sku: row.sku,
    tableCode: table.tableCode,
    tableName: table.tableName,
    priceItemId: cell.priceItemId,
  };

  if (cell.status === "PUBLISHED") {
    if (!publishedItem) {
      mismatches.push({
        ...base,
        field: "missingPublishedItem",
        gridValue: cell.salePrice,
        publishedValue: null,
      });
      return mismatches;
    }

    const metrics = readPublishedPriceItemMetrics(publishedItem);
    if (cell.salePrice != null && metrics.salePrice != null && cell.salePrice !== metrics.salePrice) {
      mismatches.push({
        ...base,
        field: "salePrice",
        gridValue: cell.salePrice,
        publishedValue: metrics.salePrice,
      });
    }

    if (cell.priceItemId && cell.priceItemId !== publishedItem.id) {
      mismatches.push({
        ...base,
        field: "priceItemId",
        gridValue: cell.priceItemId,
        publishedValue: publishedItem.id,
      });
    }

    if (cell.versionId !== table.versionId) {
      mismatches.push({
        ...base,
        field: "versionId",
        gridValue: cell.versionId,
        publishedValue: table.versionId,
      });
    }
  }

  return mismatches;
}

export function buildCommercialPublishedPriceGridCsv(
  snapshot: Pick<CommercialPublishedPriceGridSnapshot, "tables" | "rows">
): string {
  const tableHeaders = snapshot.tables.map((_, index) => `Tabela ${index + 1} preço`);
  const header = [
    "SKU",
    "Produto",
    "Info tributária",
    ...tableHeaders,
    "Última publicação",
    "Status",
  ];

  const lines = [header.join(",")];

  for (const row of snapshot.rows) {
    const taxLabel = row.taxInfo
      ? [row.taxInfo.fiscalRuleName, row.taxInfo.taxPercent != null ? `${row.taxInfo.taxPercent}%` : null]
          .filter(Boolean)
          .join(" ")
      : "";

    const priceCols = snapshot.tables.map((table, index) => {
      const price = row.prices[index];
      if (!price || price.salePrice == null) return "";
      return String(price.salePrice);
    });

    while (priceCols.length < 4) priceCols.push("");

    lines.push(
      [
        row.sku,
        row.productName,
        taxLabel,
        priceCols[0] ?? "",
        priceCols[1] ?? "",
        priceCols[2] ?? "",
        priceCols[3] ?? "",
        row.lastPublishedAt ?? "",
        row.status,
      ]
        .map((value) => {
          const s = value == null ? "" : String(value);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    );
  }

  return lines.join("\n");
}

export function buildTopProductsByPrice(
  rows: CommercialPublishedPriceGridRow[],
  tables: CommercialPublishedPriceGridTable[],
  limit = 10
): CommercialPriceGridTopProduct[] {
  const ranked: CommercialPriceGridTopProduct[] = [];

  for (const row of rows) {
    let best: CommercialPriceGridTopProduct | null = null;
    row.prices.forEach((price, index) => {
      if (price.status !== "PUBLISHED" || price.salePrice == null) return;
      const table = tables[index];
      if (!table) return;
      if (!best || price.salePrice > best.maxSalePrice) {
        best = {
          productId: row.productId,
          sku: row.sku,
          productName: row.productName,
          maxSalePrice: price.salePrice,
          tableCode: table.tableCode,
          tableName: table.tableName,
        };
      }
    });
    if (best) ranked.push(best);
  }

  ranked.sort((a, b) => b.maxSalePrice - a.maxSalePrice || a.sku.localeCompare(b.sku, "pt-BR"));
  return ranked.slice(0, limit);
}

export function collectPartialProducts(
  rows: CommercialPublishedPriceGridRow[],
  tables: CommercialPublishedPriceGridTable[]
): CommercialPriceGridPartialProduct[] {
  return rows
    .filter((row) => row.status !== "OK")
    .map((row) => ({
      productId: row.productId,
      sku: row.sku,
      productName: row.productName,
      status: row.status,
      missingTableCodes: tables
        .map((table, index) => ({ table, price: row.prices[index] }))
        .filter((entry) => entry.price?.status !== "PUBLISHED")
        .map((entry) => entry.table.tableCode),
    }));
}

async function fetchAllGridRows(
  db: Pick<PrismaClient, "priceTable" | "priceTableVersion" | "priceTableItem" | "taxRule">,
  query: CommercialPriceGridAuditQuery
): Promise<CommercialPublishedPriceGridSnapshot> {
  const referenceDate = query.referenceDate ?? new Date();
  const search = query.search?.trim() || query.sku?.trim() || "";

  let page = 1;
  let totalPages = 1;
  let tables: CommercialPublishedPriceGridTable[] = [];
  const allRows: CommercialPublishedPriceGridRow[] = [];

  while (page <= totalPages) {
    const snapshot = await buildCommercialPublishedPriceGridSnapshot(db, {
      referenceDate,
      search,
      page,
      limit: GRID_PAGE_LIMIT,
      sort: "SKU_ASC",
    });

    if (page === 1) {
      tables = snapshot.tables;
      totalPages = snapshot.pagination.totalPages;
    }

    allRows.push(...snapshot.rows);
    page += 1;
  }

  const filteredRows = filterAuditRows(allRows, {
    sku: query.sku,
    productId: query.productId,
  });

  return {
    referenceDate: referenceDate.toISOString().slice(0, 10),
    tables,
    rows: filteredRows,
    pagination: {
      page: 1,
      limit: filteredRows.length || GRID_PAGE_LIMIT,
      total: filteredRows.length,
      totalPages: 1,
    },
    totals: {
      tableCount: tables.length,
      rowCount: filteredRows.length,
      pricedCellCount: filteredRows.reduce(
        (sum, row) => sum + row.prices.filter((p) => p.status === "PUBLISHED").length,
        0
      ),
      emptyCellCount: filteredRows.reduce(
        (sum, row) => sum + row.prices.filter((p) => p.status !== "PUBLISHED").length,
        0
      ),
    },
  };
}

export async function buildCommercialPublishedPriceGridAudit(
  db: Pick<PrismaClient, "priceTable" | "priceTableVersion" | "priceTableItem" | "taxRule">,
  query: CommercialPriceGridAuditQuery = {}
): Promise<CommercialPriceGridAuditResult> {
  const referenceDate = query.referenceDate ?? new Date();
  const tables = await resolveCommercialPublishedTableContexts(db, { referenceDate });
  const gridSnapshot = await fetchAllGridRows(db, query);

  const versionIds = tables.map((table) => table.versionId);
  const publishedItems =
    versionIds.length === 0
      ? []
      : await db.priceTableItem.findMany({
          where: { priceTableVersionId: { in: versionIds } },
          select: {
            id: true,
            priceTableVersionId: true,
            productId: true,
            sku: true,
            salePrice: true,
            frozenTotalCost: true,
            marginPct: true,
            commissionPerc: true,
            formulaSnapshotJson: true,
          },
        });

  const itemByProductTable = new Map<string, PublishedItemRow>();
  const tableIdByVersionId = new Map(tables.map((table) => [table.versionId, table.tableId]));

  for (const item of publishedItems) {
    const tableId = tableIdByVersionId.get(item.priceTableVersionId);
    if (!tableId) continue;
    itemByProductTable.set(`${item.productId}:${tableId}`, item);
  }

  const mismatches: CommercialPriceGridAuditMismatch[] = [];
  for (const row of gridSnapshot.rows) {
    tables.forEach((table, index) => {
      const publishedItem = itemByProductTable.get(`${row.productId}:${table.tableId}`);
      mismatches.push(
        ...compareGridCellToPublishedItem({
          row,
          table,
          cellIndex: index,
          publishedItem,
        })
      );
    });
  }

  const pricedCountByTable = tables.map((table) => {
    const pricedProducts = gridSnapshot.rows.filter(
      (row) => row.prices.find((price) => price.tableId === table.tableId)?.status === "PUBLISHED"
    ).length;
    return {
      tableId: table.tableId,
      tableCode: table.tableCode,
      tableName: table.tableName,
      versionId: table.versionId,
      versionNumber: table.versionNumber,
      pricedProducts,
      totalProducts: gridSnapshot.rows.length,
    };
  });

  const partialProducts = collectPartialProducts(gridSnapshot.rows, tables);
  const topProductsByPrice = buildTopProductsByPrice(gridSnapshot.rows, tables, 10);

  return {
    status: mismatches.length === 0 ? "PASS" : "FAIL",
    referenceDate: gridSnapshot.referenceDate,
    tables,
    productCount: gridSnapshot.rows.length,
    pricedCountByTable,
    partialProducts,
    mismatches,
    topProductsByPrice,
    gridSnapshot,
  };
}
