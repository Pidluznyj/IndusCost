import { Prisma } from "@prisma/client";
import { billingMarketCustomerFilterSql } from "@/src/lib/billingMarketCustomerSql.js";
import { formatCnpj } from "@/src/lib/companyCnpjFormat.js";
import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";
import { addLocalDays, startOfLocalDay } from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  isFinanceHorizonDrilldownBucketKey,
  resolveFinanceAgingBucketMeta,
  rowMatchesFinanceHorizonDrilldownBucket,
} from "@/src/lib/financeDashboardAgingBuckets.js";
import { roundHorizonMoney } from "@/src/lib/financeHorizonBuckets.js";
import type {
  FinanceBillingHorizonBucketTotals,
  FinanceBillingHorizonDrilldownPayload,
  FinanceBillingHorizonOrderRow,
} from "@/src/lib/financeBillingHorizonDrilldownTypes.js";
import { SALES_ORDER_STATUS_LABELS } from "@/src/lib/materialDemandFilters.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  nomusNfesElementsSql,
  orderNotInvoicedSql,
  toPgDateYmd,
} from "@/src/lib/salesOrderInvoicingSql.js";

const NOT_CANCELLED = Prisma.sql`so.status != 'CANCELLED'`;
const MARKET_CUSTOMER = billingMarketCustomerFilterSql("c");

export type {
  FinanceBillingHorizonBucketTotals,
  FinanceBillingHorizonDrilldownPayload,
  FinanceBillingHorizonOrderRow,
} from "@/src/lib/financeBillingHorizonDrilldownTypes.js";

type RawHorizonDrilldownOrder = {
  id: string;
  order_code: string;
  customer_name: string;
  customer_tax_id: string | null;
  expected_delivery_date: Date | null;
  total_net_value: unknown;
  status: string;
  notes: string | null;
  delivery_location: string | null;
  nfe_number: string | null;
  nfe_serie: string | null;
  nfe_nature: string | null;
};

function normalizeCnpjQuery(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits : null;
}

function normalizeDocumentNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parsePage(value: unknown): number {
  const n = Number.parseInt(String(value ?? "1"), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parseLimit(value: unknown): number {
  const n = Number.parseInt(String(value ?? "25"), 10);
  if (!Number.isFinite(n)) return 25;
  return Math.min(Math.max(n, 1), 100);
}

export function resolveBillingHorizonOperationNature(input: {
  nfeNature: string | null;
  notes: string | null;
  deliveryLocation: string | null;
}): string | null {
  const candidates = [input.nfeNature, input.notes, input.deliveryLocation];
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function mapRawHorizonOrder(row: RawHorizonDrilldownOrder): FinanceBillingHorizonOrderRow {
  const taxId = row.customer_tax_id?.trim() || null;
  return {
    orderId: row.id,
    orderCode: row.order_code,
    customerName: row.customer_name,
    customerDocument: taxId ? formatCnpj(taxId) : null,
    nfeNumber: row.nfe_number?.trim() || null,
    nfeSerie: row.nfe_serie?.trim() || null,
    expectedDeliveryDate: row.expected_delivery_date?.toISOString() ?? null,
    totalNetValue: decimalToNumber(row.total_net_value) ?? 0,
    status: row.status,
    statusLabel: SALES_ORDER_STATUS_LABELS[row.status] ?? row.status,
    operationNature: resolveBillingHorizonOperationNature({
      nfeNature: row.nfe_nature,
      notes: row.notes,
      deliveryLocation: row.delivery_location,
    }),
  };
}

export async function queryBillingHorizonDrilldownOrders(
  referenceDate: Date,
  filters: { customerCnpj: string | null; documentNumber: string | null }
): Promise<RawHorizonDrilldownOrder[]> {
  const today = startOfLocalDay(referenceDate);
  const horizonEnd = addLocalDays(today, 60);
  const fromYmd = toPgDateYmd(today);
  const toYmd = toPgDateYmd(horizonEnd);

  const customerFilter = filters.customerCnpj
    ? Prisma.sql`AND regexp_replace(COALESCE(c."taxId", ''), '[^0-9]', '', 'g') LIKE ${`%${filters.customerCnpj}%`}`
    : Prisma.empty;

  const documentFilter = filters.documentNumber
    ? Prisma.sql`AND (
        so."orderCode" ILIKE ${`%${filters.documentNumber}%`}
        OR COALESCE(so."externalSalesOrderCode", '') ILIKE ${`%${filters.documentNumber}%`}
      )`
    : Prisma.empty;

  return prisma.$queryRaw<RawHorizonDrilldownOrder[]>(
    Prisma.sql`
      SELECT
        so.id,
        so."orderCode" AS order_code,
        COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName") AS customer_name,
        c."taxId" AS customer_tax_id,
        so."expectedDeliveryDate" AS expected_delivery_date,
        so."totalNetValue" AS total_net_value,
        so.status,
        so.notes,
        so."deliveryLocation" AS delivery_location,
        nfe_info.nfe_number,
        nfe_info.nfe_serie,
        nfe_info.nfe_nature
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      LEFT JOIN LATERAL (
        SELECT
          NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'numero', '')), '') AS nfe_number,
          NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'serie', '')), '') AS nfe_serie,
          NULLIF(TRIM(BOTH FROM COALESCE(
            nfe->>'naturezaOperacao',
            nfe->>'descricaoOperacao',
            nfe->>'natOp',
            ''
          )), '') AS nfe_nature
        FROM ${nomusNfesElementsSql("so")}
        LIMIT 1
      ) nfe_info ON TRUE
      WHERE ${NOT_CANCELLED}
        AND ${MARKET_CUSTOMER}
        AND ${orderNotInvoicedSql("so")}
        AND so."expectedDeliveryDate" IS NOT NULL
        AND so."expectedDeliveryDate" >= ${fromYmd}::date
        AND so."expectedDeliveryDate" <= ${toYmd}::date
        ${customerFilter}
        ${documentFilter}
      ORDER BY so."expectedDeliveryDate" ASC, so."issueDate" DESC
      LIMIT 2000
    `
  );
}

export function filterBillingHorizonOrdersByBucket(
  rows: FinanceBillingHorizonOrderRow[],
  bucketKey: string,
  referenceDate: Date = new Date()
): FinanceBillingHorizonOrderRow[] {
  if (!isFinanceHorizonDrilldownBucketKey(bucketKey)) return [];
  return rows.filter((row) => {
    if (!row.expectedDeliveryDate) return false;
    const date = new Date(row.expectedDeliveryDate);
    if (Number.isNaN(date.getTime())) return false;
    return rowMatchesFinanceHorizonDrilldownBucket(date, bucketKey, referenceDate);
  });
}

export function computeBillingHorizonBucketTotals(
  rows: FinanceBillingHorizonOrderRow[]
): FinanceBillingHorizonBucketTotals {
  let amount = 0;
  for (const row of rows) {
    amount += row.totalNetValue;
  }
  return {
    amount: roundHorizonMoney(amount),
    ordersCount: rows.length,
  };
}

export async function buildFinanceBillingHorizonDrilldown(
  query: Record<string, unknown>,
  referenceDate: Date = new Date()
): Promise<FinanceBillingHorizonDrilldownPayload> {
  const horizonBucket = typeof query.horizonBucket === "string" ? query.horizonBucket.trim() : "";
  if (!isFinanceHorizonDrilldownBucketKey(horizonBucket)) {
    throw new Error("Faixa de horizonte inválida.");
  }

  const page = parsePage(query.page);
  const limit = parseLimit(query.limit);
  const filters = {
    customerCnpj: normalizeCnpjQuery(query.customerCnpj),
    documentNumber: normalizeDocumentNumber(query.documentNumber),
  };

  const rawRows = await queryBillingHorizonDrilldownOrders(referenceDate, filters);
  const mapped = rawRows.map(mapRawHorizonOrder);
  const bucketRows = filterBillingHorizonOrdersByBucket(mapped, horizonBucket, referenceDate);
  const bucketTotals = computeBillingHorizonBucketTotals(bucketRows);
  const total = bucketRows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  const items = bucketRows.slice(start, start + limit);
  const meta = resolveFinanceAgingBucketMeta(horizonBucket);

  return {
    generatedAt: referenceDate.toISOString(),
    horizonBucket,
    selectedBucket: {
      key: meta.key,
      label: meta.label,
    },
    bucketTotals,
    dateField: "expectedDeliveryDate",
    page: safePage,
    limit,
    total,
    totalPages,
    items,
    filters: {
      customerCnpj: filters.customerCnpj,
      documentNumber: filters.documentNumber,
    },
  };
}
