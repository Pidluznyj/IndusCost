import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { salesOrderHasInvoicing } from "@/src/lib/customerCommercialSalesOrderView.js";
import { toPgDateYmd } from "@/src/lib/salesOrderInvoicingSql.js";
import {
  buildSoldProductsAppliedFiltersLabel,
  matchesSoldProductsCustomerScope,
  matchesSoldProductsIssuerCompany,
  normalizeSoldProductsUiFilters,
  orderMatchesSoldProductsStatus,
  parseSalesProductRankingFilters,
  salesOrderStatusLabelPt,
  formatSellerKey,
} from "@/src/lib/salesProductRankingFilters.js";
import type {
  SoldProductsCustomerMixRow,
  SoldProductsDashboardFilters,
  SoldProductsDashboardPayload,
  SoldProductsDetailRow,
  SoldProductsFilterOptionsPayload,
  SoldProductsMonthlyEvolutionRow,
  SoldProductsNcmProductRow,
  SoldProductsNcmSummary,
  SoldProductsRankingRow,
  SoldProductsSortBy,
  SoldProductsSummary,
  SoldProductsTopProductRef,
  SoldProductsUiFilters,
} from "@/src/lib/salesProductRankingTypes.js";

const MAX_LINE_ITEMS = 50_000;

export type SoldProductsLineContext = {
  lineId: string;
  productId: string;
  productCode: string | null;
  productName: string;
  /** NCM cadastral atual do Product (fonte: sync Nomus /produtos) — null vira "Sem NCM" na aba. */
  productNcm: string | null;
  quantity: number;
  unitPrice: number;
  lineAmount: number;
  orderId: string;
  orderCode: string;
  orderDate: Date;
  orderStatus: string;
  sellerName: string | null;
  companyLabel: string | null;
  customerId: string;
  customerName: string;
  customerTaxId: string | null;
};

export function safeSoldProductsNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function resolveSoldProductsLineAmount(
  quantity: unknown,
  unitPrice: unknown,
  totalNetValue: unknown
): number {
  const total = safeSoldProductsNumber(totalNetValue);
  if (total > 0) return total;
  const qty = safeSoldProductsNumber(quantity);
  const price = safeSoldProductsNumber(unitPrice);
  const computed = qty * price;
  return Number.isFinite(computed) ? computed : 0;
}

export function computeSoldProductsAverageUnitPrice(
  quantity: number,
  amount: number
): number | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const avg = amount / quantity;
  return Number.isFinite(avg) ? avg : null;
}

export function computeSoldProductsSharePercent(part: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const pct = (part / total) * 100;
  return Number.isFinite(pct) ? Math.round(pct * 100) / 100 : 0;
}

function resolveOrderDateForBasis(
  order: {
    issueDate: Date;
    expectedDeliveryDate: Date | null;
    nomusRawResponse?: unknown;
  },
  dateBasis: SoldProductsDashboardFilters["dateBasis"]
): Date | null {
  if (dateBasis === "issueDate") return order.issueDate;
  if (dateBasis === "expectedDeliveryDate") return order.expectedDeliveryDate;
  return resolveLatestInvoiceDate(order.nomusRawResponse);
}

function resolveLatestInvoiceDate(nomusRawResponse: unknown): Date | null {
  if (!nomusRawResponse || typeof nomusRawResponse !== "object") return null;
  const nfes = (nomusRawResponse as { nfes?: unknown }).nfes;
  if (!Array.isArray(nfes)) return null;
  let latest: Date | null = null;
  for (const nfe of nfes) {
    if (!nfe || typeof nfe !== "object") continue;
    const raw = String((nfe as { dataProcessamento?: string }).dataProcessamento ?? "").trim();
    const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) continue;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (Number.isNaN(d.getTime())) continue;
    if (!latest || d > latest) latest = d;
  }
  return latest;
}

function dateInRange(date: Date | null, start: Date, end: Date): boolean {
  if (!date) return false;
  const t = date.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function resolveCompanyLabel(order: {
  companyIssuer?: string | null;
  externalCompanyId?: number | null;
  nomusRawResponse?: unknown;
}): string | null {
  const raw = order.nomusRawResponse as Record<string, unknown> | null | undefined;
  const nome = String(raw?.nomeEmpresa ?? "").trim();
  if (nome) return nome;
  if (order.externalCompanyId != null) return `Empresa ${order.externalCompanyId}`;
  if (order.companyIssuer?.trim()) return order.companyIssuer.trim();
  return null;
}

function resolveSellerName(
  responsible: string | null | undefined,
  externalSellerId: number | null | undefined
): string | null {
  if (responsible?.trim()) return responsible.trim();
  if (externalSellerId != null) return `Vendedor ID ${externalSellerId}`;
  return null;
}

export function filterSoldProductsLines(
  lines: SoldProductsLineContext[],
  filters: SoldProductsDashboardFilters
): SoldProductsLineContext[] {
  return lines.filter((line) => {
    if (!orderMatchesSoldProductsStatus(line.orderStatus, filters.orderStatus)) return false;
    if (
      !matchesSoldProductsCustomerScope(
        {
          taxId: line.customerTaxId,
          companyName: line.customerName,
        },
        filters.customerScope
      )
    ) {
      return false;
    }
    if (!dateInRange(line.orderDate, filters.startDate, filters.endDate)) return false;
    return true;
  });
}

type ProductAgg = {
  productId: string;
  productCode: string | null;
  productName: string;
  ncm: string | null;
  quantitySold: number;
  amountSold: number;
  orderIds: Set<string>;
  customerIds: Set<string>;
  lastSaleDate: Date | null;
};

export function aggregateSoldProductsRanking(
  lines: SoldProductsLineContext[],
  sortBy: SoldProductsSortBy,
  topN: number | null
): SoldProductsRankingRow[] {
  const byProduct = new Map<string, ProductAgg>();
  let totalQuantity = 0;
  let totalAmount = 0;

  for (const line of lines) {
    totalQuantity += line.quantity;
    totalAmount += line.lineAmount;
    let agg = byProduct.get(line.productId);
    if (!agg) {
      agg = {
        productId: line.productId,
        productCode: line.productCode,
        productName: line.productName,
        ncm: line.productNcm,
        quantitySold: 0,
        amountSold: 0,
        orderIds: new Set(),
        customerIds: new Set(),
        lastSaleDate: null,
      };
      byProduct.set(line.productId, agg);
    }
    agg.quantitySold += line.quantity;
    agg.amountSold += line.lineAmount;
    agg.orderIds.add(line.orderId);
    agg.customerIds.add(line.customerId);
    if (!agg.lastSaleDate || line.orderDate > agg.lastSaleDate) {
      agg.lastSaleDate = line.orderDate;
    }
  }

  const rows = [...byProduct.values()].map((agg) => ({
    rank: 0,
    productId: agg.productId,
    productCode: agg.productCode,
    productName: agg.productName,
    ncm: agg.ncm,
    quantitySold: agg.quantitySold,
    amountSold: agg.amountSold,
    averageUnitPrice: computeSoldProductsAverageUnitPrice(agg.quantitySold, agg.amountSold),
    ordersCount: agg.orderIds.size,
    customersCount: agg.customerIds.size,
    lastSaleDate: agg.lastSaleDate ? agg.lastSaleDate.toISOString().slice(0, 10) : null,
    quantitySharePercent: computeSoldProductsSharePercent(agg.quantitySold, totalQuantity),
    amountSharePercent: computeSoldProductsSharePercent(agg.amountSold, totalAmount),
  }));

  const sortKey: Record<SoldProductsSortBy, (r: SoldProductsRankingRow) => number> = {
    quantity: (r) => r.quantitySold,
    amount: (r) => r.amountSold,
    orders: (r) => r.ordersCount,
    customers: (r) => r.customersCount,
  };
  rows.sort((a, b) => sortKey[sortBy](b) - sortKey[sortBy](a) || b.amountSold - a.amountSold);

  const limited = topN != null ? rows.slice(0, topN) : rows;
  return limited.map((row, idx) => ({ ...row, rank: idx + 1 }));
}

export function buildSoldProductsSummary(
  lines: SoldProductsLineContext[],
  ranking: SoldProductsRankingRow[]
): SoldProductsSummary {
  const orderIds = new Set<string>();
  const customerIds = new Set<string>();
  const productIds = new Set<string>();
  let totalQuantity = 0;
  let totalAmount = 0;

  for (const line of lines) {
    totalQuantity += line.quantity;
    totalAmount += line.lineAmount;
    orderIds.add(line.orderId);
    customerIds.add(line.customerId);
    productIds.add(line.productId);
  }

  const toRef = (row: SoldProductsRankingRow | undefined): SoldProductsTopProductRef | null => {
    if (!row) return null;
    return {
      productId: row.productId,
      productCode: row.productCode,
      productName: row.productName,
      quantitySold: row.quantitySold,
      amountSold: row.amountSold,
    };
  };

  const byQty = [...ranking].sort((a, b) => b.quantitySold - a.quantitySold);
  const byAmt = [...ranking].sort((a, b) => b.amountSold - a.amountSold);

  return {
    totalQuantity,
    totalAmount,
    productsCount: productIds.size,
    customersCount: customerIds.size,
    ordersCount: orderIds.size,
    averageUnitPrice: computeSoldProductsAverageUnitPrice(totalQuantity, totalAmount),
    topProductByQuantity: toRef(byQty[0]),
    topProductByAmount: toRef(byAmt[0]),
  };
}

export function buildSoldProductsCustomerMix(
  lines: SoldProductsLineContext[],
  ranking: SoldProductsRankingRow[]
): SoldProductsCustomerMixRow[] {
  const topProductIds = new Set(ranking.map((r) => r.productId));
  const totalsByProduct = new Map<string, number>();
  const key = (productId: string, customerId: string) => `${productId}::${customerId}`;
  const rows = new Map<
    string,
    SoldProductsCustomerMixRow & { _qty: number; _amt: number }
  >();

  for (const line of lines) {
    if (!topProductIds.has(line.productId)) continue;
    totalsByProduct.set(
      line.productId,
      (totalsByProduct.get(line.productId) ?? 0) + line.quantity
    );
    const k = key(line.productId, line.customerId);
    let row = rows.get(k);
    if (!row) {
      row = {
        productId: line.productId,
        productCode: line.productCode,
        productName: line.productName,
        customerId: line.customerId,
        customerName: line.customerName,
        customerTaxId: line.customerTaxId,
        quantitySold: 0,
        amountSold: 0,
        customerSharePercent: 0,
        _qty: 0,
        _amt: 0,
      };
      rows.set(k, row);
    }
    row._qty += line.quantity;
    row._amt += line.lineAmount;
    row.quantitySold = row._qty;
    row.amountSold = row._amt;
  }

  return [...rows.values()]
    .map(({ _qty, _amt, ...row }) => ({
      ...row,
      customerSharePercent: computeSoldProductsSharePercent(
        _qty,
        totalsByProduct.get(row.productId) ?? 0
      ),
    }))
    .sort(
      (a, b) =>
        a.productName.localeCompare(b.productName, "pt-BR") ||
        b.quantitySold - a.quantitySold
    );
}

/**
 * Aba NCM x Produto — agrega as MESMAS linhas do relatório (população canônica,
 * reconciliação garantida por construção) em uma linha por PRODUTO, com o NCM
 * cadastral atual do Product. Produto sem NCM (null) permanece com ncm=null —
 * a UI apresenta "Sem NCM" e os números continuam nos totais.
 * Ordenação: NCM ASC (null/Sem NCM por último), depois SKU ASC.
 */
export function aggregateSoldProductsNcmByProduct(
  lines: SoldProductsLineContext[]
): SoldProductsNcmProductRow[] {
  const byProduct = new Map<string, SoldProductsNcmProductRow>();
  for (const line of lines) {
    let row = byProduct.get(line.productId);
    if (!row) {
      row = {
        ncm: line.productNcm,
        productId: line.productId,
        sku: line.productCode ?? "—",
        productName: line.productName,
        quantitySold: 0,
        soldValue: 0,
      };
      byProduct.set(line.productId, row);
    }
    row.quantitySold += line.quantity;
    row.soldValue += line.lineAmount;
  }
  return [...byProduct.values()].sort((a, b) => {
    if (a.ncm == null && b.ncm != null) return 1;
    if (a.ncm != null && b.ncm == null) return -1;
    const ncmCmp = (a.ncm ?? "").localeCompare(b.ncm ?? "", "pt-BR");
    if (ncmCmp !== 0) return ncmCmp;
    return a.sku.localeCompare(b.sku, "pt-BR", { sensitivity: "base" });
  });
}

export function buildSoldProductsNcmSummary(
  rows: SoldProductsNcmProductRow[]
): SoldProductsNcmSummary {
  let totalQuantity = 0;
  let totalSoldValue = 0;
  let productsWithoutNcmCount = 0;
  for (const row of rows) {
    totalQuantity += row.quantitySold;
    totalSoldValue += row.soldValue;
    if (row.ncm == null) productsWithoutNcmCount += 1;
  }
  return {
    totalQuantity,
    totalSoldValue,
    productsCount: rows.length,
    productsWithoutNcmCount,
  };
}

export function buildSoldProductsMonthlyEvolution(
  lines: SoldProductsLineContext[]
): SoldProductsMonthlyEvolutionRow[] {
  const map = new Map<string, SoldProductsMonthlyEvolutionRow>();
  for (const line of lines) {
    const y = line.orderDate.getFullYear();
    const m = line.orderDate.getMonth() + 1;
    const k = `${line.productId}::${y}::${m}`;
    let row = map.get(k);
    if (!row) {
      row = {
        productId: line.productId,
        productCode: line.productCode,
        productName: line.productName,
        year: y,
        month: m,
        quantitySold: 0,
        amountSold: 0,
      };
      map.set(k, row);
    }
    row.quantitySold += line.quantity;
    row.amountSold += line.lineAmount;
  }
  return [...map.values()].sort(
    (a, b) =>
      a.year - b.year || a.month - b.month || a.productName.localeCompare(b.productName, "pt-BR")
  );
}

export function buildSoldProductsDetailRows(lines: SoldProductsLineContext[]): SoldProductsDetailRow[] {
  return lines
    .map((line) => ({
      orderDate: line.orderDate.toISOString().slice(0, 10),
      orderCode: line.orderCode,
      orderId: line.orderId,
      customerName: line.customerName,
      customerTaxId: line.customerTaxId,
      sellerName: line.sellerName,
      companyLabel: line.companyLabel,
      productCode: line.productCode,
      productName: line.productName,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineAmount: line.lineAmount,
      orderStatus: line.orderStatus,
      orderStatusLabel: salesOrderStatusLabelPt(line.orderStatus),
    }))
    .sort(
      (a, b) =>
        b.orderDate.localeCompare(a.orderDate) || a.orderCode.localeCompare(b.orderCode)
    );
}

function buildPrismaWhere(
  filters: SoldProductsDashboardFilters,
  sellerScope?: { externalSellerId: number | null; responsible: string | null }
): Prisma.SalesOrderWhereInput {
  const and: Prisma.SalesOrderWhereInput[] = [];

  if (filters.orderStatus === "cancelled") {
    and.push({ status: "CANCELLED" });
  } else if (filters.orderStatus === "valid") {
    and.push({ status: { notIn: ["CANCELLED", "ERROR"] } });
  }

  if (filters.customerId) and.push({ customerId: filters.customerId });

  if (filters.customerName) {
    and.push({
      Customer: {
        OR: [
          { companyName: { contains: filters.customerName, mode: "insensitive" } },
          { tradeName: { contains: filters.customerName, mode: "insensitive" } },
        ],
      },
    });
  }

  if (filters.customerTaxId) {
    const digits = filters.customerTaxId.replace(/\D/g, "");
    and.push({
      Customer: {
        taxId: { contains: digits || filters.customerTaxId, mode: "insensitive" },
      },
    });
  }

  if (filters.sellerExternalId != null) {
    and.push({ externalSellerId: filters.sellerExternalId });
  } else if (filters.sellerResponsible) {
    and.push({
      responsible: { equals: filters.sellerResponsible, mode: "insensitive" },
    });
  }

  if (sellerScope) {
    if (sellerScope.externalSellerId != null) {
      and.push({ externalSellerId: sellerScope.externalSellerId });
    } else if (sellerScope.responsible?.trim()) {
      and.push({
        responsible: { equals: sellerScope.responsible.trim(), mode: "insensitive" },
      });
    }
  }

  if (filters.dateBasis !== "invoiceDate") {
    const field = filters.dateBasis === "expectedDeliveryDate" ? "expectedDeliveryDate" : "issueDate";
    and.push({
      [field]: {
        gte: filters.startDate,
        lte: filters.endDate,
      },
    } as Prisma.SalesOrderWhereInput);
  }

  const itemWhere: Prisma.SalesOrderItemWhereInput = {};
  if (filters.productId) {
    itemWhere.productId = filters.productId;
  }
  if (filters.productCode) {
    itemWhere.OR = [
      { skuSnapshot: { contains: filters.productCode, mode: "insensitive" } },
      { Product: { sku: { contains: filters.productCode, mode: "insensitive" } } },
    ];
  }
  if (filters.productName) {
    itemWhere.OR = [
      ...(itemWhere.OR ?? []),
      { productNameSnapshot: { contains: filters.productName, mode: "insensitive" } },
      { Product: { name: { contains: filters.productName, mode: "insensitive" } } },
    ];
  }
  if (Object.keys(itemWhere).length > 0) {
    and.push({ items: { some: itemWhere } });
  }

  return and.length > 0 ? { AND: and } : {};
}

async function loadInvoiceFilteredOrderIds(
  filters: SoldProductsDashboardFilters
): Promise<string[] | null> {
  if (filters.dateBasis !== "invoiceDate") return null;
  const fromYmd = toPgDateYmd(filters.startDate);
  const toYmd = toPgDateYmd(filters.endDate);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT so.id
    FROM "SalesOrder" so
    WHERE EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(so."nomusRawResponse"->'nfes') = 'array'
          THEN so."nomusRawResponse"->'nfes'
          ELSE '[]'::jsonb
        END
      ) AS nfe
      WHERE NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'dataProcessamento', '')), '') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
        AND to_date(TRIM(nfe->>'dataProcessamento'), 'DD/MM/YYYY') >= ${fromYmd}::date
        AND to_date(TRIM(nfe->>'dataProcessamento'), 'DD/MM/YYYY') <= ${toYmd}::date
    )
  `);
  return rows.map((r) => r.id);
}

export async function loadSoldProductsLineContexts(
  filters: SoldProductsDashboardFilters,
  sellerScope?: { externalSellerId: number | null; responsible: string | null }
): Promise<SoldProductsLineContext[]> {
  const where = buildPrismaWhere(filters, sellerScope);
  const invoiceOrderIds = await loadInvoiceFilteredOrderIds(filters);
  if (invoiceOrderIds && invoiceOrderIds.length === 0) return [];

  const itemFilters: Prisma.SalesOrderItemWhereInput[] = [];
  if (filters.productId) {
    itemFilters.push({ productId: filters.productId });
  }
  if (filters.productCode) {
    itemFilters.push({
      OR: [
        { skuSnapshot: { contains: filters.productCode, mode: "insensitive" } },
        { Product: { sku: { contains: filters.productCode, mode: "insensitive" } } },
      ],
    });
  }
  if (filters.productName) {
    itemFilters.push({
      OR: [
        { productNameSnapshot: { contains: filters.productName, mode: "insensitive" } },
        { Product: { name: { contains: filters.productName, mode: "insensitive" } } },
      ],
    });
  }

  const items = await prisma.salesOrderItem.findMany({
    where: {
      nomusIsCanceled: false,
      nomusIsStale: false,
      ...(itemFilters.length > 0 ? { AND: itemFilters } : {}),
      SalesOrder: {
        ...where,
        ...(invoiceOrderIds ? { id: { in: invoiceOrderIds } } : {}),
      },
    },
    select: {
      id: true,
      productId: true,
      skuSnapshot: true,
      productNameSnapshot: true,
      quantity: true,
      negotiatedPrice: true,
      totalNetValue: true,
      Product: { select: { sku: true, name: true, ncm: true } },
      SalesOrder: {
        select: {
          id: true,
          orderCode: true,
          issueDate: true,
          expectedDeliveryDate: true,
          status: true,
          responsible: true,
          externalSellerId: true,
          companyIssuer: true,
          externalCompanyId: true,
          nomusRawResponse: true,
          Customer: {
            select: {
              id: true,
              companyName: true,
              tradeName: true,
              taxId: true,
            },
          },
        },
      },
    },
    take: MAX_LINE_ITEMS,
    orderBy: { SalesOrder: { issueDate: "desc" } },
  });

  const lines: SoldProductsLineContext[] = [];
  for (const item of items) {
    const order = item.SalesOrder;
    if (!order) continue;
    if (!matchesSoldProductsIssuerCompany(order, filters.company)) continue;
    if (!salesOrderHasInvoicing(order.nomusRawResponse) && filters.dateBasis === "invoiceDate") {
      continue;
    }

    const orderDate = resolveOrderDateForBasis(order, filters.dateBasis);
    if (!orderDate) continue;

    const customer = order.Customer;
    const customerName =
      customer?.tradeName?.trim() || customer?.companyName?.trim() || "—";
    const quantity = safeSoldProductsNumber(item.quantity);
    const unitPrice = safeSoldProductsNumber(item.negotiatedPrice);
    const lineAmount = resolveSoldProductsLineAmount(
      item.quantity,
      item.negotiatedPrice,
      item.totalNetValue
    );

    lines.push({
      lineId: item.id,
      productId: item.productId,
      productCode: item.Product?.sku ?? item.skuSnapshot ?? null,
      productName: item.Product?.name ?? item.productNameSnapshot ?? "—",
      productNcm: item.Product?.ncm ?? null,
      quantity,
      unitPrice,
      lineAmount,
      orderId: order.id,
      orderCode: order.orderCode,
      orderDate,
      orderStatus: order.status,
      sellerName: resolveSellerName(order.responsible, order.externalSellerId),
      companyLabel: resolveCompanyLabel(order),
      customerId: customer?.id ?? "",
      customerName,
      customerTaxId: customer?.taxId ?? null,
    });
  }

  return filterSoldProductsLines(lines, filters);
}

export async function buildSalesProductRanking(
  query: Record<string, unknown>,
  options?: {
    referenceDate?: Date;
    sellerScope?: { externalSellerId: number | null; responsible: string | null };
    uiOverrides?: Partial<SoldProductsUiFilters>;
  }
): Promise<SoldProductsDashboardPayload> {
  const referenceDate = options?.referenceDate ?? new Date();
  const filters = parseSalesProductRankingFilters(query, referenceDate);
  const ui = normalizeSoldProductsUiFilters({
    ...{
      startDate: typeof query.startDate === "string" ? query.startDate : "",
      endDate: typeof query.endDate === "string" ? query.endDate : "",
      year: typeof query.year === "string" ? query.year : String(referenceDate.getFullYear()),
      month: typeof query.month === "string" ? query.month : "",
      dateBasis: filters.dateBasis,
      customerName: filters.customerName ?? "",
      customerTaxId: filters.customerTaxId ?? "",
      customerId: filters.customerId ?? "",
      productCode: filters.productCode ?? "",
      productName: filters.productName ?? "",
      sellerKey: typeof query.sellerKey === "string" ? query.sellerKey : "",
      company: filters.company,
      orderStatus: filters.orderStatus,
      customerScope: filters.customerScope,
      sortBy: filters.sortBy,
      topN: filters.topN == null ? "all" : (String(filters.topN) as SoldProductsUiFilters["topN"]),
    },
    ...(options?.uiOverrides ?? {}),
  });

  const lines = await loadSoldProductsLineContexts(filters, options?.sellerScope);
  const ranking = aggregateSoldProductsRanking(lines, filters.sortBy, filters.topN);
  const summary = buildSoldProductsSummary(lines, ranking);
  const customerMix = buildSoldProductsCustomerMix(lines, ranking);
  const monthlyEvolution = buildSoldProductsMonthlyEvolution(lines);
  const ncmByProduct = aggregateSoldProductsNcmByProduct(lines);
  const ncmSummary = buildSoldProductsNcmSummary(ncmByProduct);
  const allDetails = buildSoldProductsDetailRows(lines);
  const total = allDetails.length;
  const includeAll =
    query.includeAllDetailRows === "true" || query.includeAllDetailRows === "1";
  const start = (filters.detailPage - 1) * filters.detailLimit;
  const detailRows = includeAll
    ? allDetails
    : allDetails.slice(start, start + filters.detailLimit);

  return {
    generatedAt: referenceDate.toISOString(),
    filters: buildSoldProductsAppliedFiltersLabel(ui, referenceDate),
    summary,
    ranking,
    customerMix,
    monthlyEvolution,
    ncmByProduct,
    ncmSummary,
    detailRows,
    detailPagination: {
      page: filters.detailPage,
      limit: filters.detailLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.detailLimit)),
    },
  };
}

export async function buildSoldProductsFilterOptions(): Promise<SoldProductsFilterOptionsPayload> {
  const [customers, products, sellerRows] = await Promise.all([
    prisma.customer.findMany({
      where: { salesOrders: { some: {} } },
      select: {
        id: true,
        companyName: true,
        tradeName: true,
        taxId: true,
      },
      orderBy: { companyName: "asc" },
    }),
    prisma.product.findMany({
      where: { SalesOrderItem: { some: {} } },
      select: { id: true, sku: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.salesOrder.findMany({
      where: {
        status: { notIn: ["CANCELLED", "ERROR"] },
        OR: [{ responsible: { not: null } }, { externalSellerId: { not: null } }],
      },
      select: { responsible: true, externalSellerId: true },
      distinct: ["responsible", "externalSellerId"],
    }),
  ]);

  const sellerMap = new Map<string, string>();
  for (const row of sellerRows) {
    const key = formatSellerKey(row.externalSellerId, row.responsible);
    if (!key || sellerMap.has(key)) continue;
    const label =
      row.responsible?.trim() ||
      (row.externalSellerId != null ? `Vendedor ID ${row.externalSellerId}` : key);
    sellerMap.set(key, label);
  }

  return {
    customers: customers.map((c) => ({
      id: c.id,
      companyName: (c.companyName || c.tradeName || "Cliente").trim(),
      taxId: c.taxId?.trim() || null,
    })),
    products: products.map((p) => ({
      id: p.id,
      sku: p.sku?.trim() || null,
      name: p.name,
    })),
    sellers: [...sellerMap.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
  };
}

export { parseSalesProductRankingFilters, buildPrismaWhere };
