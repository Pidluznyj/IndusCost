import type { Prisma } from "@prisma/client";
import { isNomusPurchaseOrderOpenStage, isNomusPurchaseOrderOverdue } from "./nomusPurchaseOrderClassifier.js";
import type { NomusPurchaseOrderStage } from "./nomusPurchaseOrderTypes.js";

export type NomusPurchaseOrderListFilters = {
  q?: string | null;
  orderNumber?: string | null;
  supplier?: string | null;
  status?: string | null;
  stage?: string | null;
  product?: string | null;
  issuedFrom?: Date | null;
  issuedTo?: Date | null;
  expectedFrom?: Date | null;
  expectedTo?: Date | null;
  openOnly?: boolean;
  overdueOnly?: boolean;
  canceledOnly?: boolean;
  page?: number;
  pageSize?: number;
};

export function parseOptionalDate(value: unknown): Date | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseNomusPurchaseOrderListFilters(
  query: Record<string, unknown>
): NomusPurchaseOrderListFilters {
  const flag = (key: string) => {
    const raw = String(query[key] ?? "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "sim";
  };
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize ?? "25"), 10) || 25));
  return {
    q: String(query.q ?? query.search ?? "").trim() || null,
    orderNumber: String(query.orderNumber ?? query.pedido ?? "").trim() || null,
    supplier: String(query.supplier ?? query.fornecedor ?? "").trim() || null,
    status: String(query.status ?? "").trim() || null,
    stage: String(query.stage ?? query.fase ?? "").trim() || null,
    product: String(query.product ?? query.produto ?? "").trim() || null,
    issuedFrom: parseOptionalDate(query.issuedFrom ?? query.emissaoDe),
    issuedTo: parseOptionalDate(query.issuedTo ?? query.emissaoAte),
    expectedFrom: parseOptionalDate(query.expectedFrom ?? query.previsaoDe),
    expectedTo: parseOptionalDate(query.expectedTo ?? query.previsaoAte),
    openOnly: flag("openOnly") || flag("somenteAbertos"),
    overdueOnly: flag("overdueOnly") || flag("somenteAtrasados"),
    canceledOnly: flag("canceledOnly") || flag("somenteCancelados"),
    page,
    pageSize,
  };
}

export function buildNomusPurchaseOrderWhere(
  filters: NomusPurchaseOrderListFilters,
  now: Date = new Date()
): Prisma.NomusPurchaseOrderWhereInput {
  const AND: Prisma.NomusPurchaseOrderWhereInput[] = [];

  if (filters.q) {
    AND.push({
      OR: [
        { orderNumber: { contains: filters.q, mode: "insensitive" } },
        { supplierName: { contains: filters.q, mode: "insensitive" } },
        { supplierTaxId: { contains: filters.q, mode: "insensitive" } },
        { statusRaw: { contains: filters.q, mode: "insensitive" } },
        { items: { some: { OR: [
          { productCode: { contains: filters.q, mode: "insensitive" } },
          { description: { contains: filters.q, mode: "insensitive" } },
        ] } } },
      ],
    });
  }
  if (filters.orderNumber) {
    AND.push({ orderNumber: { contains: filters.orderNumber, mode: "insensitive" } });
  }
  if (filters.supplier) {
    AND.push({
      OR: [
        { supplierName: { contains: filters.supplier, mode: "insensitive" } },
        { supplierTaxId: { contains: filters.supplier, mode: "insensitive" } },
      ],
    });
  }
  if (filters.status) {
    AND.push({ statusRaw: { contains: filters.status, mode: "insensitive" } });
  }
  if (filters.stage) {
    AND.push({ stage: filters.stage });
  }
  if (filters.product) {
    AND.push({
      items: {
        some: {
          OR: [
            { productCode: { contains: filters.product, mode: "insensitive" } },
            { description: { contains: filters.product, mode: "insensitive" } },
          ],
        },
      },
    });
  }
  if (filters.issuedFrom) AND.push({ issuedAt: { gte: filters.issuedFrom } });
  if (filters.issuedTo) AND.push({ issuedAt: { lte: filters.issuedTo } });
  if (filters.expectedFrom) AND.push({ expectedAt: { gte: filters.expectedFrom } });
  if (filters.expectedTo) AND.push({ expectedAt: { lte: filters.expectedTo } });
  if (filters.canceledOnly) {
    AND.push({ OR: [{ canceled: true }, { stage: "CANCELED" }] });
  }
  if (filters.openOnly) {
    AND.push({ stage: { in: ["OPEN", "APPROVED", "PARTIALLY_RECEIVED"] } });
  }
  if (filters.overdueOnly) {
    AND.push({
      expectedAt: { lt: now },
      stage: { in: ["OPEN", "APPROVED", "PARTIALLY_RECEIVED"] },
    });
  }

  return AND.length > 0 ? { AND } : {};
}

export function serializeNomusPurchaseOrderListRow(row: {
  id: string;
  externalId: number;
  orderNumber: string | null;
  supplierExternalId: number | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  statusRaw: string | null;
  canceled: boolean | null;
  stage: string;
  issuedAt: Date | null;
  expectedAt: Date | null;
  totalAmount: { toString(): string } | null;
  itemCount: number;
  orderedQuantity: { toString(): string } | null;
  receivedQuantity: { toString(): string } | null;
  remainingQuantity: { toString(): string } | null;
  syncedAt: Date;
  lastSeenAt: Date;
}, now: Date = new Date()) {
  const stage = row.stage as NomusPurchaseOrderStage;
  return {
    id: row.id,
    externalId: row.externalId,
    orderNumber: row.orderNumber,
    supplierExternalId: row.supplierExternalId,
    supplierName: row.supplierName,
    supplierTaxId: row.supplierTaxId,
    statusRaw: row.statusRaw,
    canceled: row.canceled,
    stage,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    expectedAt: row.expectedAt?.toISOString() ?? null,
    totalAmount: row.totalAmount ? Number(row.totalAmount.toString()) : null,
    itemCount: row.itemCount,
    orderedQuantity: row.orderedQuantity ? Number(row.orderedQuantity.toString()) : null,
    receivedQuantity: row.receivedQuantity ? Number(row.receivedQuantity.toString()) : null,
    remainingQuantity: row.remainingQuantity ? Number(row.remainingQuantity.toString()) : null,
    overdue: isNomusPurchaseOrderOverdue({ stage, expectedAt: row.expectedAt, now }),
    open: isNomusPurchaseOrderOpenStage(stage),
    syncedAt: row.syncedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

export function buildNomusPurchaseOrderKpis(
  rows: Array<{
    stage: string;
    expectedAt: Date | null;
    totalAmount: { toString(): string } | null;
  }>,
  now: Date = new Date()
) {
  const inDays = (days: number) => {
    const limit = new Date(now);
    limit.setDate(limit.getDate() + days);
    return limit;
  };
  const horizon7 = inDays(7);
  const horizon30 = inDays(30);

  let openCount = 0;
  let openAmount = 0;
  let overdueCount = 0;
  let partialCount = 0;
  let expected7 = 0;
  let expected30 = 0;

  for (const row of rows) {
    const stage = row.stage as NomusPurchaseOrderStage;
    const amount = row.totalAmount ? Number(row.totalAmount.toString()) : 0;
    if (isNomusPurchaseOrderOpenStage(stage)) {
      openCount += 1;
      openAmount += Number.isFinite(amount) ? amount : 0;
    }
    if (isNomusPurchaseOrderOverdue({ stage, expectedAt: row.expectedAt, now })) overdueCount += 1;
    if (stage === "PARTIALLY_RECEIVED") partialCount += 1;
    if (isNomusPurchaseOrderOpenStage(stage) && row.expectedAt) {
      if (row.expectedAt >= now && row.expectedAt <= horizon7) expected7 += 1;
      if (row.expectedAt >= now && row.expectedAt <= horizon30) expected30 += 1;
    }
  }

  return {
    openCount,
    openAmount,
    overdueCount,
    partialCount,
    expectedNext7Days: expected7,
    expectedNext30Days: expected30,
  };
}
