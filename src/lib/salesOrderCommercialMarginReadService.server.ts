/**
 * Fonte única de leitura da Margem comercial do Pedido.
 *
 * - Usa o motor oficial (`calculateCommercialMarginsForSalesOrders`) — sem nova fórmula.
 * - Anexa composição bruto/desconto/líquido (`resolveSalesOrderItemCommercialValues`).
 * - Batch por Pedido; formação histórica já é batch no motor.
 * - Não mistura margem gerencial.
 * - Não usa Proposta.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { calculateCommercialMarginsForSalesOrders } from "./salesOrderCommercialMargin.server.js";
import { resolveSalesOrderItemCommercialValues } from "./salesOrderItemCommercialValues.js";
import {
  SALES_ORDER_ITEM_MARGIN_SELECT,
  type SalesOrderItemForMargin,
} from "./salesOrderMarginService.server.js";
import {
  aggregateCommercialMarginSummaries,
  buildCommercialMarginItemDTO,
  buildCommercialMarginSummaryDTO,
  type SalesOrderCommercialMarginAggregateDTO,
  type SalesOrderCommercialMarginAggregateFiltersDTO,
  type SalesOrderCommercialMarginSummaryDTO,
} from "./salesOrderCommercialMarginReadModel.js";

const DEFAULT_AGGREGATE_TAKE = 5000;

type Decimalish = { toNumber?: () => number } | number | string | null | undefined;

function toNum(value: Decimalish): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && typeof value.toNumber === "function") {
    const n = value.toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const COMMERCIAL_MARGIN_ORDER_SELECT = {
  id: true,
  issueDate: true,
  customerId: true,
  items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
} as const;

type LoadedOrder = {
  id: string;
  issueDate: Date | null;
  customerId?: string | null;
  items: SalesOrderItemForMargin[];
};

function mapCompositionForItem(item: SalesOrderItemForMargin) {
  const orderedQty = toNum(item.quantity) ?? 0;
  const canceledQty =
    toNum(item.flowItemSnapshot?.canceledQuantity) ?? toNum(item.canceledQuantity) ?? 0;
  const isFullyCanceled =
    item.nomusIsCanceled === true ||
    item.nomusIsCut === true ||
    (item.nomusItemStatusNormalized ?? "").toUpperCase() === "CANCELED" ||
    (item.nomusItemStatusNormalized ?? "").toUpperCase() === "CANCELADO" ||
    (orderedQty > 0 && canceledQty >= orderedQty);

  return resolveSalesOrderItemCommercialValues({
    orderedQuantity: orderedQty,
    canceledQuantity: canceledQty,
    isFullyCanceled,
    grossUnitPrice: toNum(item.negotiatedPrice) ?? 0,
    netTotalValue: toNum(item.totalNetValue),
  });
}

async function loadOrdersByIds(
  prisma: PrismaClient,
  orderIds: string[]
): Promise<LoadedOrder[]> {
  if (orderIds.length === 0) return [];
  const unique = [...new Set(orderIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const rows = await prisma.salesOrder.findMany({
    where: { id: { in: unique } },
    select: COMMERCIAL_MARGIN_ORDER_SELECT,
  });

  const byId = new Map(rows.map((row) => [row.id, row]));
  // Preserva ordem pedida (consistência individual vs lote).
  return unique
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({
      id: row.id,
      issueDate: row.issueDate,
      customerId: row.customerId,
      items: row.items as SalesOrderItemForMargin[],
    }));
}

/**
 * Monta DTOs a partir de Pedidos já carregados — um único passe no motor oficial.
 * Sem Prisma em loop de item.
 */
export async function buildSalesOrderCommercialMarginReadModels(
  prisma: PrismaClient,
  orders: LoadedOrder[]
): Promise<Map<string, SalesOrderCommercialMarginSummaryDTO>> {
  const result = new Map<string, SalesOrderCommercialMarginSummaryDTO>();
  if (orders.length === 0) return result;

  const commercialByOrder = await calculateCommercialMarginsForSalesOrders(
    prisma,
    orders.map((order) => ({
      id: order.id,
      issueDate: order.issueDate,
      items: order.items,
    }))
  );

  for (const order of orders) {
    const commercial = commercialByOrder.get(order.id);
    if (!commercial) continue;

    const items = (order.items ?? []).map((item) => {
      const margin =
        commercial.byItemId.get(item.id) ??
        ({
          soldQuantity: 0,
          negotiatedUnitPrice: 0,
          soldValue: 0,
          costUnit: null,
          costValue: null,
          taxRate: null,
          taxValue: null,
          commissionRate: null,
          commissionValue: null,
          freightRate: null,
          freightRateValue: null,
          freightAbsoluteUnit: null,
          freightAbsoluteValue: null,
          otherVariablesRate: null,
          otherVariablesValue: null,
          commercialMarginRate: null,
          commercialMarginPercent: null,
          commercialMarginUnitValue: null,
          commercialMarginValue: null,
          lowerMarginBand: null,
          upperMarginBand: null,
          lowerBandPrice: null,
          upperBandPrice: null,
          calculationSource: "UNAVAILABLE" as const,
          historicalContextId: null,
          priceTableVersionId: null,
          referenceDate: null,
          isComplete: false,
          reasonCode: "INVALID_ACTIVE_QUANTITY" as const,
          warnings: [],
        });

      return buildCommercialMarginItemDTO({
        orderId: order.id,
        itemId: item.id,
        margin,
        composition: mapCompositionForItem(item),
      });
    });

    result.set(
      order.id,
      buildCommercialMarginSummaryDTO({
        orderId: order.id,
        commercialMargin: commercial.summary,
        items,
      })
    );
  }

  return result;
}

/** Margem comercial canônica de um Pedido. */
export async function getSalesOrderCommercialMargin(
  prisma: PrismaClient,
  orderId: string
): Promise<SalesOrderCommercialMarginSummaryDTO | null> {
  if (!orderId) return null;
  const orders = await loadOrdersByIds(prisma, [orderId]);
  if (orders.length === 0) return null;
  const map = await buildSalesOrderCommercialMarginReadModels(prisma, orders);
  return map.get(orderId) ?? null;
}

/** Margem comercial canônica em lote (batch). */
export async function getSalesOrdersCommercialMargins(
  prisma: PrismaClient,
  orderIds: string[]
): Promise<Map<string, SalesOrderCommercialMarginSummaryDTO>> {
  const orders = await loadOrdersByIds(prisma, orderIds);
  return buildSalesOrderCommercialMarginReadModels(prisma, orders);
}

function toDateBound(value: string | null | undefined, endOfDay: boolean): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  if (endOfDay) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

/**
 * Agregado ponderado por período / filtros.
 * Estratégia segura: (1) ids com select leve; (2) carga batch de itens; (3) um passe no motor.
 */
export async function getSalesOrderCommercialMarginAggregate(
  prisma: PrismaClient,
  filters: SalesOrderCommercialMarginAggregateFiltersDTO = {}
): Promise<SalesOrderCommercialMarginAggregateDTO> {
  const take = Math.min(
    Math.max(1, filters.take ?? DEFAULT_AGGREGATE_TAKE),
    DEFAULT_AGGREGATE_TAKE
  );

  const where: Prisma.SalesOrderWhereInput = {};
  if (filters.orderIds?.length) {
    where.id = { in: [...new Set(filters.orderIds.filter(Boolean))] };
  }
  if (filters.customerId) {
    where.customerId = filters.customerId;
  }
  const from = toDateBound(filters.issueDateFrom, false);
  const to = toDateBound(filters.issueDateTo, true);
  if (from || to) {
    where.issueDate = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  // Passo 1: só ids (sem itens) — evita payload pesado em filtros amplos.
  const idRows = await prisma.salesOrder.findMany({
    where,
    select: { id: true },
    orderBy: { issueDate: "asc" },
    take,
  });
  const orderIds = idRows.map((row) => row.id);

  // Passo 2–3: batch load + motor oficial único.
  const byOrder = await getSalesOrdersCommercialMargins(prisma, orderIds);
  const summaries = orderIds
    .map((id) => byOrder.get(id))
    .filter((row): row is SalesOrderCommercialMarginSummaryDTO => Boolean(row));

  return aggregateCommercialMarginSummaries(summaries, {
    ...filters,
    orderIds,
    take,
  });
}
