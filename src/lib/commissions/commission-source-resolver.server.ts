import type { PrismaClient } from "@prisma/client";
import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";
import { resolveLinkedNfeValue } from "@/src/lib/salesOrderLinkedNfe.js";
import {
  assembleOrderSourceBundle,
  indexReceivablesByNfeId,
  mapLinkedNfeSource,
  mapOutputDocumentSource,
  mapReceivableSource,
  mapSalesOrderItemToSource,
} from "./commission-source-resolver.js";
import type { CommissionOrderSourceBundle, CommissionPeriodInput } from "./commission-types.js";
import {
  COMMISSION_IGNORED_CANCELED_ITEM,
  COMMISSION_IGNORED_STALE_ITEM,
  resolveCommissionIgnoreReasonForSalesOrderItem,
} from "../sales/nomusSalesOrderItemStatus.js";

const EXIT_MOVEMENT_TYPES = [
  "MANUAL_EXIT",
  "REQUISITION_EXIT",
  "PRODUCTION_EXIT",
  "LOSS",
  "SCRAP",
] as const;

const SALES_ORDER_SOURCE_SELECT = {
  id: true,
  externalSalesOrderId: true,
  orderCode: true,
  issueDate: true,
  status: true,
  paymentTerms: true,
  paymentMethod: true,
  externalCompanyId: true,
  externalCustomerId: true,
  externalSellerId: true,
  nomusSellerName: true,
  responsible: true,
  totalNetValue: true,
  nomusRawResponse: true,
  Customer: { select: { companyName: true, tradeName: true } },
  items: {
    select: {
      id: true,
      productId: true,
      externalProductId: true,
      skuSnapshot: true,
      productNameSnapshot: true,
      quantity: true,
      negotiatedPrice: true,
      totalNetValue: true,
      notes: true,
      nomusIsCanceled: true,
      nomusIsStale: true,
      nomusItemStatusNormalized: true,
    },
  },
  nfeLinks: {
    select: {
      nfeExternalId: true,
      nfeNumber: true,
      nfeStatus: true,
      tipoOperacao: true,
      dataProcessamento: true,
      nomusNfeId: true,
      rawPayload: true,
    },
  },
} as const;

type SalesOrderSourceRow = {
  id: string;
  externalSalesOrderId: number | null;
  orderCode: string;
  issueDate: Date;
  status: string;
  paymentTerms: string | null;
  paymentMethod: string | null;
  externalCompanyId: number | null;
  externalCustomerId: number | null;
  externalSellerId: number | null;
  nomusSellerName: string | null;
  responsible: string | null;
  totalNetValue: import("@prisma/client").Prisma.Decimal;
  nomusRawResponse: unknown;
  Customer: { companyName: string; tradeName: string | null };
  items: Array<{
    id: string;
    productId: string;
    externalProductId: number | null;
    skuSnapshot: string;
    productNameSnapshot: string;
    quantity: import("@prisma/client").Prisma.Decimal;
    negotiatedPrice: import("@prisma/client").Prisma.Decimal;
    totalNetValue: import("@prisma/client").Prisma.Decimal;
    notes: string | null;
    nomusIsCanceled?: boolean | null;
    nomusIsStale?: boolean | null;
    nomusItemStatusNormalized?: string | null;
  }>;
  nfeLinks: Array<{
    nfeExternalId: number;
    nfeNumber: string | null;
    nfeStatus: number | null;
    tipoOperacao: number | null;
    dataProcessamento: Date | null;
    nomusNfeId: string | null;
    rawPayload: unknown;
  }>;
};

export function resolveCommissionPeriod(input: CommissionPeriodInput): { from: Date; to: Date } {
  if (input.from && input.to) {
    return { from: input.from, to: input.to };
  }
  const year = input.year ?? new Date().getFullYear();
  if (input.month != null && input.month >= 1 && input.month <= 12) {
    return {
      from: new Date(year, input.month - 1, 1),
      to: new Date(year, input.month, 0, 23, 59, 59, 999),
    };
  }
  return {
    from: new Date(year, 0, 1),
    to: new Date(year, 11, 31, 23, 59, 59, 999),
  };
}

async function buildCommissionOrderSourceBundlesFromOrders(
  db: Pick<
    PrismaClient,
    "nomusNfe" | "nomusAccountsReceivable" | "inventoryMovement"
  >,
  orders: SalesOrderSourceRow[]
): Promise<CommissionOrderSourceBundle[]> {
  const allNfeExternalIds = [...new Set(orders.flatMap((o) => o.nfeLinks.map((l) => l.nfeExternalId)))];

  const nomusNfes =
    allNfeExternalIds.length > 0
      ? await db.nomusNfe.findMany({
          where: { externalId: { in: allNfeExternalIds } },
          select: {
            id: true,
            externalId: true,
            numero: true,
            status: true,
            tipoOperacao: true,
            dataProcessamento: true,
            valorLiquido: true,
            xmlVNF: true,
          },
        })
      : [];

  const nfeByExternalId = new Map(nomusNfes.map((n) => [n.externalId, n]));
  const nfeUuidByExternalId = new Map(nomusNfes.map((n) => [n.externalId, n.id]));
  const nfeNumeroByExternalId = new Map(
    nomusNfes.map((n) => [n.externalId, n.numero?.trim() || null])
  );

  const arRows =
    allNfeExternalIds.length > 0
      ? await db.nomusAccountsReceivable.findMany({
          where: { sourceInvoiceId: { in: allNfeExternalIds } },
          select: {
            externalId: true,
            sourceInvoiceId: true,
            dueDate: true,
            amountReceivable: true,
            amountReceived: true,
            balanceReceivable: true,
            settlementDate: true,
          },
        })
      : [];

  const arByNfeId = indexReceivablesByNfeId(arRows.map(mapReceivableSource));

  const inventoryExits =
    allNfeExternalIds.length > 0
      ? await db.inventoryMovement.findMany({
          where: {
            movementType: { in: [...EXIT_MOVEMENT_TYPES] },
            OR: [
              { nfeNumber: { in: nomusNfes.map((n) => n.numero).filter(Boolean) as string[] } },
              { nfeId: { in: nomusNfes.map((n) => n.id) } },
              { nfeId: { in: allNfeExternalIds.map(String) } },
            ],
          },
          select: {
            id: true,
            documentNumber: true,
            nfeId: true,
            nfeNumber: true,
            salesOrderId: true,
            movementDate: true,
            movementType: true,
          },
        })
      : [];

  const outputDocsByNfeId = new Map<number, ReturnType<typeof mapOutputDocumentSource>[]>();
  for (const extId of allNfeExternalIds) {
    const uuid = nfeUuidByExternalId.get(extId);
    const numero = nfeNumeroByExternalId.get(extId);
    const docs = inventoryExits
      .filter(
        (m) =>
          m.nfeId === uuid ||
          m.nfeId === String(extId) ||
          (numero != null && m.nfeNumber === numero)
      )
      .map((m) => mapOutputDocumentSource(m, extId))
      .filter((d): d is NonNullable<typeof d> => d != null);
    if (docs.length > 0) outputDocsByNfeId.set(extId, docs);
  }

  const rawItemsByOrderId = new Map<string, Map<number, Record<string, unknown>>>();
  const rawItemsByProductId = new Map<string, Map<number, Record<string, unknown>[]>>();
  for (const order of orders) {
    const raw = order.nomusRawResponse;
    if (!raw || typeof raw !== "object") continue;
    const itens = (raw as Record<string, unknown>).itensPedido;
    if (!Array.isArray(itens)) continue;
    const map = new Map<number, Record<string, unknown>>();
    const byProduct = new Map<number, Record<string, unknown>[]>();
    for (const item of itens) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const lineId = Number(row.id ?? row.idItemPedido ?? row.idItem);
      if (Number.isFinite(lineId)) map.set(lineId, row);
      const prodId = Number(row.idProduto);
      if (Number.isFinite(prodId)) {
        const list = byProduct.get(prodId) ?? [];
        list.push(row);
        byProduct.set(prodId, list);
      }
    }
    rawItemsByOrderId.set(order.id, map);
    rawItemsByProductId.set(order.id, byProduct);
  }

  return orders.map((order) => {
    const linkedNfes = order.nfeLinks.map((link) => {
      const nomus = nfeByExternalId.get(link.nfeExternalId);
      const value = nomus
        ? decimalToNumber(nomus.valorLiquido) || decimalToNumber(nomus.xmlVNF)
        : resolveLinkedNfeValue({ rawPayload: link.rawPayload }, null);
      return mapLinkedNfeSource({
        nfeExternalId: link.nfeExternalId,
        nfeNumber: link.nfeNumber ?? nomus?.numero ?? null,
        nfeStatus: nomus?.status ?? link.nfeStatus,
        tipoOperacao: nomus?.tipoOperacao ?? link.tipoOperacao,
        dataProcessamento: nomus?.dataProcessamento ?? link.dataProcessamento,
        nfeValue: value,
        nomusNfeLocalId: nomus?.id ?? link.nomusNfeId,
      });
    });

    const rawLineMap = rawItemsByOrderId.get(order.id);
    const rawByProduct = rawItemsByProductId.get(order.id);
    const ignoredItems: Array<{
      salesOrderItemId: string;
      reason: typeof COMMISSION_IGNORED_CANCELED_ITEM | typeof COMMISSION_IGNORED_STALE_ITEM;
    }> = [];
    const items = order.items
      .filter((item) => {
        const reason = resolveCommissionIgnoreReasonForSalesOrderItem({
          nomusIsCanceled: item.nomusIsCanceled,
          nomusIsStale: item.nomusIsStale,
          nomusItemStatusNormalized: item.nomusItemStatusNormalized,
          quantity: decimalToNumber(item.quantity),
          totalNetValue: decimalToNumber(item.totalNetValue),
        });
        if (reason) {
          ignoredItems.push({ salesOrderItemId: item.id, reason });
          return false;
        }
        return true;
      })
      .map((item) => {
        let nomusRawLine: Record<string, unknown> | null = null;
        if (item.notes) {
          const m = item.notes.match(/\[nomus-line:(\d+)\]/);
          if (m && rawLineMap) {
            nomusRawLine = rawLineMap.get(Number.parseInt(m[1], 10)) ?? null;
          }
        }
        if (
          !nomusRawLine &&
          item.externalProductId != null &&
          rawByProduct
        ) {
          const list = rawByProduct.get(item.externalProductId) ?? [];
          nomusRawLine = list[0] ?? null;
        }
        if (nomusRawLine) {
          const st = nomusRawLine.status;
          if (st === 6 || st === "6") {
            ignoredItems.push({
              salesOrderItemId: item.id,
              reason: COMMISSION_IGNORED_CANCELED_ITEM,
            });
            return null;
          }
        }
        return mapSalesOrderItemToSource({ ...item, nomusRawLine });
      })
      .filter((row): row is NonNullable<typeof row> => row != null);

    // Auditoria: itens ignorados (cancelado/stale) não entram no cálculo nem em NO_MARGIN.
    void ignoredItems;

    const orderReceivables = new Map<number, ReturnType<typeof mapReceivableSource>[]>();
    for (const nfe of linkedNfes) {
      const list = arByNfeId.get(nfe.nfeExternalId);
      if (list) orderReceivables.set(nfe.nfeExternalId, list);
    }

    const activeNet = items.reduce((s, i) => s + (i.itemNetAmount || 0), 0);

    return assembleOrderSourceBundle({
      localOrderId: order.id,
      nomusOrderId: order.externalSalesOrderId,
      orderCode: order.orderCode,
      issueDate: order.issueDate,
      status: order.status,
      paymentTerms: order.paymentTerms,
      paymentMethod: order.paymentMethod,
      companyExternalId: order.externalCompanyId,
      externalCustomerId: order.externalCustomerId,
      customerName: order.Customer.tradeName ?? order.Customer.companyName,
      externalSellerId: order.externalSellerId,
      nomusSellerName: order.nomusSellerName,
      totalNetValue: activeNet > 0 ? activeNet : decimalToNumber(order.totalNetValue),
      nomusRawResponse: order.nomusRawResponse,
      items,
      linkedNfes,
      outputDocumentsByNfeId: outputDocsByNfeId,
      receivablesByNfeId: orderReceivables,
    });
  });
}

export async function loadCommissionOrderSources(
  db: Pick<
    PrismaClient,
    "salesOrder" | "nomusNfe" | "nomusAccountsReceivable" | "inventoryMovement"
  >,
  period: CommissionPeriodInput
): Promise<CommissionOrderSourceBundle[]> {
  const { from, to } = resolveCommissionPeriod(period);
  const orders = await db.salesOrder.findMany({
    where: { issueDate: { gte: from, lte: to } },
    select: SALES_ORDER_SOURCE_SELECT,
    orderBy: { issueDate: "asc" },
  });
  return buildCommissionOrderSourceBundlesFromOrders(db, orders);
}

export async function loadCommissionOrderSourcesByNfeExternalIds(
  db: Pick<
    PrismaClient,
    "salesOrder" | "nomusNfe" | "nomusAccountsReceivable" | "inventoryMovement"
  >,
  nfeExternalIds: number[]
): Promise<CommissionOrderSourceBundle[]> {
  const unique = [...new Set(nfeExternalIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return [];
  const orders = await db.salesOrder.findMany({
    where: { nfeLinks: { some: { nfeExternalId: { in: unique } } } },
    select: SALES_ORDER_SOURCE_SELECT,
    orderBy: { issueDate: "asc" },
  });
  return buildCommissionOrderSourceBundlesFromOrders(db, orders);
}

export async function loadCommissionOrderSourceBySalesOrderId(
  db: Pick<
    PrismaClient,
    "salesOrder" | "nomusNfe" | "nomusAccountsReceivable" | "inventoryMovement"
  >,
  salesOrderId: string
): Promise<{ bundle: CommissionOrderSourceBundle; customerId: string } | null> {
  const order = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: {
      ...SALES_ORDER_SOURCE_SELECT,
      customerId: true,
    },
  });
  if (!order) return null;

  const { customerId, ...orderRow } = order;
  const [bundle] = await buildCommissionOrderSourceBundlesFromOrders(
    db,
    [orderRow as SalesOrderSourceRow]
  );
  if (!bundle) return null;

  return { bundle, customerId };
}
