/**
 * PURCH-MIRROR-01 — Serviço de leitura (read model) do mirror de Pedido de
 * Compra Nomus, para a futura tela (inspirado no read model de Pedidos de
 * Venda). Só leitura — nenhuma escrita, nenhum recomputo de agregados fora
 * daqui (consumidores devem usar estas funções, não reimplementar).
 */

import type { PrismaClient, Prisma } from "@prisma/client";

export type NomusPurchaseOrderListQuery = {
  page: number;
  pageSize: number;
  dateFrom: Date | null;
  dateTo: Date | null;
  externalCompanyId: number | null;
  externalSupplierId: number | null;
  externalBuyerId: number | null;
  derivedStage: string | null;
  nomusStatusCode: string | null;
  code: string | null;
  externalProductId: number | null;
  sortBy: "issueDate" | "totalValue" | "code" | "syncedAt";
  sortDir: "asc" | "desc";
};

const ALLOWED_SORT_BY = new Set(["issueDate", "totalValue", "code", "syncedAt"]);

function toInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toDateOrNull(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toStringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/** Parse puro da query string — nunca lança, sempre devolve defaults seguros. */
export function parseNomusPurchaseOrderListQuery(
  query: Record<string, unknown>
): NomusPurchaseOrderListQuery {
  const page = Math.max(1, toInt(query.page) ?? 1);
  const pageSize = Math.min(200, Math.max(1, toInt(query.pageSize) ?? 25));
  const sortByRaw = toStringOrNull(query.sortBy) ?? "issueDate";
  const sortBy = (ALLOWED_SORT_BY.has(sortByRaw) ? sortByRaw : "issueDate") as
    NomusPurchaseOrderListQuery["sortBy"];
  const sortDir = toStringOrNull(query.sortDir) === "asc" ? "asc" : "desc";

  return {
    page,
    pageSize,
    dateFrom: toDateOrNull(query.dateFrom),
    dateTo: toDateOrNull(query.dateTo),
    externalCompanyId: toInt(query.companyId ?? query.externalCompanyId),
    externalSupplierId: toInt(query.supplierId ?? query.externalSupplierId),
    externalBuyerId: toInt(query.buyerId ?? query.externalBuyerId),
    derivedStage: toStringOrNull(query.stage ?? query.derivedStage),
    nomusStatusCode: toStringOrNull(query.status ?? query.nomusStatusCode),
    code: toStringOrNull(query.code),
    externalProductId: toInt(query.productId ?? query.externalProductId),
    sortBy,
    sortDir,
  };
}

/** Monta o `where` do Prisma a partir da query já parseada (função pura). */
export function buildNomusPurchaseOrderListWhere(
  parsed: NomusPurchaseOrderListQuery
): Prisma.NomusPurchaseOrderWhereInput {
  const where: Prisma.NomusPurchaseOrderWhereInput = {};
  if (parsed.dateFrom || parsed.dateTo) {
    where.issueDate = {
      ...(parsed.dateFrom ? { gte: parsed.dateFrom } : {}),
      ...(parsed.dateTo ? { lte: parsed.dateTo } : {}),
    };
  }
  if (parsed.externalCompanyId != null) where.externalCompanyId = parsed.externalCompanyId;
  if (parsed.externalSupplierId != null) where.externalSupplierId = parsed.externalSupplierId;
  if (parsed.externalBuyerId != null) where.externalBuyerId = parsed.externalBuyerId;
  if (parsed.derivedStage) where.derivedStage = parsed.derivedStage as never;
  if (parsed.nomusStatusCode) where.nomusStatusCode = parsed.nomusStatusCode;
  if (parsed.code) where.code = { contains: parsed.code, mode: "insensitive" };
  if (parsed.externalProductId != null) {
    where.items = { some: { externalProductId: parsed.externalProductId } };
  }
  return where;
}

export type NomusPurchaseOrderListRow = {
  id: string;
  externalId: number;
  code: string | null;
  companyName: string | null;
  supplierNameSnapshot: string | null;
  supplierMatchStatus: string;
  buyerNameSnapshot: string | null;
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  totalValue: string | null;
  itemCount: number;
  derivedStage: string;
  nomusStatusCode: string | null;
  syncedAt: string;
  sourcePresenceStatus: string;
};

function mapRow(row: {
  id: string;
  externalId: number;
  code: string | null;
  companyName: string | null;
  supplierNameSnapshot: string | null;
  supplierMatchStatus: string;
  buyerNameSnapshot: string | null;
  issueDate: Date | null;
  expectedDeliveryDate: Date | null;
  totalValue: Prisma.Decimal | null;
  derivedStage: string;
  nomusStatusCode: string | null;
  syncedAt: Date;
  sourcePresenceStatus: string;
  _count?: { items: number };
}): NomusPurchaseOrderListRow {
  return {
    id: row.id,
    externalId: row.externalId,
    code: row.code,
    companyName: row.companyName,
    supplierNameSnapshot: row.supplierNameSnapshot,
    supplierMatchStatus: row.supplierMatchStatus,
    buyerNameSnapshot: row.buyerNameSnapshot,
    issueDate: row.issueDate ? row.issueDate.toISOString() : null,
    expectedDeliveryDate: row.expectedDeliveryDate
      ? row.expectedDeliveryDate.toISOString()
      : null,
    totalValue: row.totalValue != null ? row.totalValue.toString() : null,
    itemCount: row._count?.items ?? 0,
    derivedStage: row.derivedStage,
    nomusStatusCode: row.nomusStatusCode,
    syncedAt: row.syncedAt.toISOString(),
    sourcePresenceStatus: row.sourcePresenceStatus,
  };
}

export type NomusPurchaseOrderListResult = {
  data: NomusPurchaseOrderListRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export async function listNomusPurchaseOrders(
  prisma: PrismaClient,
  rawQuery: Record<string, unknown>
): Promise<NomusPurchaseOrderListResult> {
  const parsed = parseNomusPurchaseOrderListQuery(rawQuery);
  const where = buildNomusPurchaseOrderListWhere(parsed);
  const skip = (parsed.page - 1) * parsed.pageSize;

  const [rows, total] = await Promise.all([
    prisma.nomusPurchaseOrder.findMany({
      where,
      orderBy: { [parsed.sortBy]: parsed.sortDir },
      skip,
      take: parsed.pageSize,
      include: { _count: { select: { items: true } } },
    }),
    prisma.nomusPurchaseOrder.count({ where }),
  ]);

  return {
    data: rows.map(mapRow),
    page: parsed.page,
    pageSize: parsed.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / parsed.pageSize)),
  };
}

export type NomusPurchaseOrderDetail = {
  id: string;
  externalId: number;
  code: string | null;
  company: { externalCompanyId: number | null; code: string | null; name: string | null };
  supplier: {
    externalSupplierId: number | null;
    nameSnapshot: string | null;
    documentSnapshot: string | null;
    financialSupplierId: string | null;
    matchStatus: string;
  };
  buyer: { externalBuyerId: number | null; nameSnapshot: string | null };
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  payment: {
    conditionId: number | null;
    conditionText: string | null;
    methodId: number | null;
    methodText: string | null;
  };
  values: {
    freight: string | null;
    insurance: string | null;
    otherExpenses: string | null;
    discount: string | null;
    subtotal: string | null;
    total: string | null;
  };
  nomusStatusCode: string | null;
  derivedStage: string;
  sourcePresenceStatus: string;
  syncedAt: string;
  items: Array<{
    id: string;
    lineNumber: number;
    externalItemId: number | null;
    externalProductId: number | null;
    productCodeSnapshot: string | null;
    productDescriptionSnapshot: string | null;
    unitSnapshot: string | null;
    quantityOrdered: string | null;
    quantityAttended: string | null;
    quantityPending: string | null;
    unitPrice: string | null;
    lineTotal: string | null;
    nomusStatusCode: string | null;
    nomusStatusName: string | null;
    productMatchStatus: string;
    materialId: string | null;
    inventoryItemId: string | null;
  }>;
};

export async function getNomusPurchaseOrderDetail(
  prisma: PrismaClient,
  id: string
): Promise<NomusPurchaseOrderDetail | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id
  );
  const externalId = Number.parseInt(id, 10);
  const row = await prisma.nomusPurchaseOrder.findFirst({
    where: isUuid
      ? { id }
      : Number.isFinite(externalId)
        ? { externalId }
        : { id: "00000000-0000-0000-0000-000000000000" },
    include: { items: { orderBy: { lineNumber: "asc" } } },
  });
  if (!row) return null;

  return {
    id: row.id,
    externalId: row.externalId,
    code: row.code,
    company: {
      externalCompanyId: row.externalCompanyId,
      code: row.companyCode,
      name: row.companyName,
    },
    supplier: {
      externalSupplierId: row.externalSupplierId,
      nameSnapshot: row.supplierNameSnapshot,
      documentSnapshot: row.supplierDocumentSnapshot,
      financialSupplierId: row.financialSupplierId,
      matchStatus: row.supplierMatchStatus,
    },
    buyer: { externalBuyerId: row.externalBuyerId, nameSnapshot: row.buyerNameSnapshot },
    issueDate: row.issueDate ? row.issueDate.toISOString() : null,
    expectedDeliveryDate: row.expectedDeliveryDate
      ? row.expectedDeliveryDate.toISOString()
      : null,
    payment: {
      conditionId: row.paymentConditionId,
      conditionText: row.paymentConditionText,
      methodId: row.paymentMethodId,
      methodText: row.paymentMethodText,
    },
    values: {
      freight: row.freightValue?.toString() ?? null,
      insurance: row.insuranceValue?.toString() ?? null,
      otherExpenses: row.otherExpensesValue?.toString() ?? null,
      discount: row.discountValue?.toString() ?? null,
      subtotal: row.subtotalValue?.toString() ?? null,
      total: row.totalValue?.toString() ?? null,
    },
    nomusStatusCode: row.nomusStatusCode,
    derivedStage: row.derivedStage,
    sourcePresenceStatus: row.sourcePresenceStatus,
    syncedAt: row.syncedAt.toISOString(),
    items: row.items.map((item) => ({
      id: item.id,
      lineNumber: item.lineNumber,
      externalItemId: item.externalItemId,
      externalProductId: item.externalProductId,
      productCodeSnapshot: item.productCodeSnapshot,
      productDescriptionSnapshot: item.productDescriptionSnapshot,
      unitSnapshot: item.unitSnapshot,
      quantityOrdered: item.quantityOrdered?.toString() ?? null,
      quantityAttended: item.quantityAttended?.toString() ?? null,
      quantityPending: item.quantityPending?.toString() ?? null,
      unitPrice: item.unitPrice?.toString() ?? null,
      lineTotal: item.lineTotal?.toString() ?? null,
      nomusStatusCode: item.nomusStatusCode,
      nomusStatusName: item.nomusStatusName,
      productMatchStatus: item.productMatchStatus,
      materialId: item.materialId,
      inventoryItemId: item.inventoryItemId,
    })),
  };
}
