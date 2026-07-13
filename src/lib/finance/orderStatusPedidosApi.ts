/**
 * API pura — Status Pedidos (Conciliação de Carteira).
 * Consolida OrderToCashAuditFact por Pedido de Venda (não por linha de evidência).
 * Sem Prisma; backend calcula; frontend só exibe.
 */

import {
  mapOrderToCashAuditFactToListRow,
  type OrderToCashAuditFactRecord,
  type OrderToCashAuditListFilters,
  type OrderToCashAuditListRow,
  type OrderToCashAuditRunMeta,
} from "./orderToCashAuditApi.js";

export const ORDER_STATUS_PEDIDOS_DEFAULT_PAGE_SIZE = 50;
export const ORDER_STATUS_PEDIDOS_MAX_PAGE_SIZE = 200;
export const ORDER_STATUS_PEDIDOS_DEFAULT_SORT_BY = "orderIssueDate" as const;
export const ORDER_STATUS_PEDIDOS_DEFAULT_SORT_DIRECTION = "desc" as const;

export const ORDER_STATUS_PEDIDOS_SORT_WHITELIST = [
  "orderCode",
  "orderIssueDate",
  "customerName",
  "sellerName",
  "orderNetValue",
  "allocatedValue",
  "receivableTotalValue",
  "receivableOpenValue",
  "receivableReceivedValue",
  "orderStatus",
] as const;

export type OrderStatusPedidosSortBy =
  (typeof ORDER_STATUS_PEDIDOS_SORT_WHITELIST)[number];

export type OrderStatusPedidosSortDirection = "asc" | "desc";

/** Status executivo consolidado do pedido (não da linha de fato). */
export type OrderStatusPedidosStatus =
  | "RECEBIDO"
  | "CR_ABERTO"
  | "PARCIAL"
  | "SEM_ATENDIMENTO"
  | "DIVERGENCIA"
  | "BLOQUEADO";

export const ORDER_STATUS_PEDIDOS_STATUS_LABEL: Record<
  OrderStatusPedidosStatus,
  string
> = {
  RECEBIDO: "Completo / recebido",
  CR_ABERTO: "CR aberto",
  PARCIAL: "Parcial / atenção",
  SEM_ATENDIMENTO: "Sem atendimento",
  DIVERGENCIA: "Divergência",
  BLOQUEADO: "Bloqueado / revisão",
};

export const ORDER_STATUS_PEDIDOS_STATUS_HINT: Record<
  OrderStatusPedidosStatus,
  string
> = {
  RECEBIDO: "Pedido atendido com recebimento evidenciado (sem pendência de item).",
  CR_ABERTO: "Pedido atendido/faturado com Contas a Receber em aberto.",
  PARCIAL: "Há item pendente ou atendimento parcial — não tratar como 100% faturado.",
  SEM_ATENDIMENTO: "Ainda sem documento/alocação de saída para o pedido.",
  DIVERGENCIA: "Há excedente, produto fora do pedido, preço ou NF divergente.",
  BLOQUEADO: "Pedido bloqueado para revisão (ex.: antigo sem evolução).",
};

export type OrderStatusPedidosOrderRow = {
  orderKey: string;
  salesOrderId: string | null;
  orderCode: string | null;
  orderIssueDate: string | null;
  customerName: string | null;
  customerExternalId: number | null;
  sellerName: string | null;
  orderNetValue: number;
  allocatedValue: number;
  /** CR do título — agregado 1× por pedido (max), nunca soma por linha. */
  receivableTotalValue: number;
  receivableOpenValue: number;
  receivableReceivedValue: number;
  orderStatus: OrderStatusPedidosStatus;
  orderToCashStage: string | null;
  temperature: string | null;
  confidenceLabel: string | null;
  factCount: number;
  pendingItemCount: number;
  allocatedItemCount: number;
  hasPendingItems: boolean;
  hasOpenCr: boolean;
  hasDivergences: boolean;
  hasAlerts: boolean;
  nfeNumbers: string[];
  alerts: string[];
};

export type OrderStatusPedidosSummary = {
  /** Pedidos distintos — nunca totalFacts. */
  totalOrders: number;
  totalOrderValue: number;
  totalAllocatedValue: number;
  totalReceivableValue: number;
  totalReceivedValue: number;
  totalOpenValue: number;
  statusCounts: Record<OrderStatusPedidosStatus, number>;
  withPendingItems: number;
  withOpenCr: number;
  withDivergences: number;
  withAlerts: number;
  summarySource: "aggregated_orders";
};

export type OrderStatusPedidosListPayload = {
  ok: true;
  filters: OrderToCashAuditListFilters;
  run: OrderToCashAuditRunMeta | null;
  rows: OrderStatusPedidosOrderRow[];
  summary: OrderStatusPedidosSummary;
  totalOrders: number;
  page: number;
  pageSize: number;
  totalPages: number;
  message: string | null;
};

export type OrderStatusPedidosDetailPayload = {
  ok: true;
  run: OrderToCashAuditRunMeta | null;
  order: OrderStatusPedidosOrderRow | null;
  /** Evidências/itens — grain de fato; não confundir com status do pedido. */
  items: OrderToCashAuditListRow[];
  message: string | null;
};

export class OrderStatusPedidosApiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderStatusPedidosApiParseError";
  }
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseAlerts(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    try {
      return parseAlerts(JSON.parse(value));
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  return [];
}

function round6(n: number): number {
  return Number(n.toFixed(6));
}

function orderKeyOf(fact: OrderToCashAuditFactRecord): string {
  if (fact.salesOrderId) return fact.salesOrderId;
  if (fact.orderCode) return `code:${fact.orderCode}`;
  return `fact:${fact.id}`;
}

function isPendingLine(fact: OrderToCashAuditFactRecord): boolean {
  return (fact.lineType ?? "").toUpperCase() === "ORDER_ITEM_PENDING";
}

function factHasDivergence(fact: OrderToCashAuditFactRecord): boolean {
  return (
    fact.hasExcessQuantity ||
    fact.hasProductOutsideOrder ||
    fact.hasPriceMismatch ||
    fact.hasNfeHeaderGreaterThanOrder ||
    fact.hasDocumentWithoutReceivable
  );
}

function isBlockedFact(fact: OrderToCashAuditFactRecord): boolean {
  if ((fact.orderToCashStage ?? "").toUpperCase() === "BLOQUEADO_REVISAO") return true;
  return parseAlerts(fact.blockingReasonsJson).length > 0;
}

/**
 * Classifica o pedido (não a linha).
 * Prioridade: BLOQUEADO → DIVERGENCIA → PARCIAL → SEM_ATENDIMENTO → RECEBIDO → CR_ABERTO
 */
export function classifyOrderStatusPedidos(input: {
  hasBlocked: boolean;
  hasDivergences: boolean;
  hasPendingItems: boolean;
  hasPartialFulfillment: boolean;
  hasAnyAllocation: boolean;
  receivableOpenValue: number;
  receivableReceivedValue: number;
  dominantStage: string | null;
}): OrderStatusPedidosStatus {
  if (input.hasBlocked) return "BLOQUEADO";
  if (input.hasDivergences && !input.hasPendingItems && input.hasAnyAllocation) {
    return "DIVERGENCIA";
  }
  if (input.hasPendingItems || input.hasPartialFulfillment) return "PARCIAL";
  if (!input.hasAnyAllocation) return "SEM_ATENDIMENTO";
  const stage = (input.dominantStage ?? "").toUpperCase();
  if (stage === "RECEBIDO" || (input.receivableReceivedValue > 0 && input.receivableOpenValue <= 0.009)) {
    return "RECEBIDO";
  }
  if (input.receivableOpenValue > 0.009 || stage === "CR_ABERTO") return "CR_ABERTO";
  if (input.hasDivergences) return "DIVERGENCIA";
  return "CR_ABERTO";
}

type Acc = {
  orderKey: string;
  salesOrderId: string | null;
  orderCode: string | null;
  orderIssueDate: Date | string | null;
  customerName: string | null;
  customerExternalId: number | null;
  sellerName: string | null;
  orderNetValue: number | null;
  allocatedValue: number;
  receivableTotal: number;
  receivableOpen: number;
  receivableReceived: number;
  factCount: number;
  pendingItemCount: number;
  allocatedItemCount: number;
  hasPartialFulfillment: boolean;
  hasBlocked: boolean;
  hasDivergences: boolean;
  hasAlerts: boolean;
  nfeNumbers: Set<string>;
  alerts: Set<string>;
  stageScores: Map<string, number>;
  temperature: string | null;
  confidenceLabel: string | null;
};

function pickDominantStage(scores: Map<string, number>): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const [stage, score] of scores) {
    if (score > bestScore) {
      best = stage;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Agrega facts → uma linha por pedido distinto.
 * - orderNetValue: 1× por pedido
 * - CR: Math.max por pedido (ignora PENDING para não herdar título como item)
 * - allocated: soma só linhas com alocação
 * - não usa nfeHeaderValue / receivableTotal como valor de produto
 */
export function aggregateFactsToOrderStatusRows(
  facts: readonly OrderToCashAuditFactRecord[]
): OrderStatusPedidosOrderRow[] {
  const byOrder = new Map<string, Acc>();

  for (const fact of facts) {
    const key = orderKeyOf(fact);
    let acc = byOrder.get(key);
    if (!acc) {
      acc = {
        orderKey: key,
        salesOrderId: fact.salesOrderId,
        orderCode: fact.orderCode,
        orderIssueDate: fact.orderIssueDate,
        customerName: fact.customerName,
        customerExternalId: fact.externalCustomerId,
        sellerName: fact.sellerName,
        orderNetValue: fact.orderNetValue,
        allocatedValue: 0,
        receivableTotal: 0,
        receivableOpen: 0,
        receivableReceived: 0,
        factCount: 0,
        pendingItemCount: 0,
        allocatedItemCount: 0,
        hasPartialFulfillment: false,
        hasBlocked: false,
        hasDivergences: false,
        hasAlerts: false,
        nfeNumbers: new Set(),
        alerts: new Set(),
        stageScores: new Map(),
        temperature: fact.temperature,
        confidenceLabel: fact.confidenceLabel,
      };
      byOrder.set(key, acc);
    }

    acc.factCount += 1;
    if (!acc.salesOrderId && fact.salesOrderId) acc.salesOrderId = fact.salesOrderId;
    if (!acc.orderCode && fact.orderCode) acc.orderCode = fact.orderCode;
    if (!acc.customerName && fact.customerName) acc.customerName = fact.customerName;
    if (acc.customerExternalId == null && fact.externalCustomerId != null) {
      acc.customerExternalId = fact.externalCustomerId;
    }
    if (!acc.sellerName && fact.sellerName) acc.sellerName = fact.sellerName;
    if (acc.orderNetValue == null && fact.orderNetValue != null) {
      acc.orderNetValue = fact.orderNetValue;
    }
    if (!acc.orderIssueDate && fact.orderIssueDate) acc.orderIssueDate = fact.orderIssueDate;
    if (!acc.temperature && fact.temperature) acc.temperature = fact.temperature;
    if (!acc.confidenceLabel && fact.confidenceLabel) {
      acc.confidenceLabel = fact.confidenceLabel;
    }

    const pending = isPendingLine(fact);
    if (pending) {
      acc.pendingItemCount += 1;
    } else {
      const allocatedQty = fact.quantityUsedForOrder ?? 0;
      if (allocatedQty > 0 || (fact.allocatedValueByOrderPrice ?? 0) > 0) {
        acc.allocatedItemCount += 1;
        acc.allocatedValue += fact.allocatedValueByOrderPrice ?? 0;
      }
      // CR do título — só de linhas com evidência de item (não PENDING)
      acc.receivableTotal = Math.max(acc.receivableTotal, fact.receivableTotalValue ?? 0);
      acc.receivableOpen = Math.max(acc.receivableOpen, fact.receivableOpenValue ?? 0);
      acc.receivableReceived = Math.max(
        acc.receivableReceived,
        fact.receivableReceivedValue ?? 0
      );
      if (fact.nfeNumber?.trim()) acc.nfeNumbers.add(fact.nfeNumber.trim());
    }

    if (fact.hasPartialFulfillment) acc.hasPartialFulfillment = true;
    if (isBlockedFact(fact)) acc.hasBlocked = true;
    if (factHasDivergence(fact)) acc.hasDivergences = true;

    const alerts = parseAlerts(fact.alertsJson);
    for (const a of alerts) {
      acc.alerts.add(a);
      acc.hasAlerts = true;
    }
    if (
      fact.hasDeliveryDelay ||
      fact.hasMissingStockDocument ||
      fact.hasOverdueReceivable
    ) {
      acc.hasAlerts = true;
    }

    const stage = fact.orderToCashStage?.trim();
    if (stage) {
      acc.stageScores.set(stage, (acc.stageScores.get(stage) ?? 0) + 1);
    }
  }

  const rows: OrderStatusPedidosOrderRow[] = [];
  for (const acc of byOrder.values()) {
    const hasPendingItems = acc.pendingItemCount > 0;
    const hasAnyAllocation = acc.allocatedItemCount > 0 || acc.allocatedValue > 0;
    // Divergência + pendência → PARCIAL (caso PD 02534)
    const hasDivergences = acc.hasDivergences;
    const dominantStage = pickDominantStage(acc.stageScores);
    const orderStatus = classifyOrderStatusPedidos({
      hasBlocked: acc.hasBlocked,
      hasDivergences,
      hasPendingItems,
      hasPartialFulfillment: acc.hasPartialFulfillment || hasPendingItems,
      hasAnyAllocation,
      receivableOpenValue: acc.receivableOpen,
      receivableReceivedValue: acc.receivableReceived,
      dominantStage,
    });

    rows.push({
      orderKey: acc.orderKey,
      salesOrderId: acc.salesOrderId,
      orderCode: acc.orderCode,
      orderIssueDate: toIso(acc.orderIssueDate),
      customerName: acc.customerName,
      customerExternalId: acc.customerExternalId,
      sellerName: acc.sellerName,
      orderNetValue: round6(acc.orderNetValue ?? 0),
      allocatedValue: round6(acc.allocatedValue),
      receivableTotalValue: round6(acc.receivableTotal),
      receivableOpenValue: round6(acc.receivableOpen),
      receivableReceivedValue: round6(acc.receivableReceived),
      orderStatus,
      orderToCashStage: dominantStage,
      temperature: acc.temperature,
      confidenceLabel: acc.confidenceLabel,
      factCount: acc.factCount,
      pendingItemCount: acc.pendingItemCount,
      allocatedItemCount: acc.allocatedItemCount,
      hasPendingItems,
      hasOpenCr: acc.receivableOpen > 0.009,
      hasDivergences,
      hasAlerts: acc.hasAlerts,
      nfeNumbers: [...acc.nfeNumbers].sort(),
      alerts: [...acc.alerts].sort(),
    });
  }

  return rows;
}

export function buildOrderStatusPedidosSummary(
  rows: readonly OrderStatusPedidosOrderRow[]
): OrderStatusPedidosSummary {
  const statusCounts: Record<OrderStatusPedidosStatus, number> = {
    RECEBIDO: 0,
    CR_ABERTO: 0,
    PARCIAL: 0,
    SEM_ATENDIMENTO: 0,
    DIVERGENCIA: 0,
    BLOQUEADO: 0,
  };
  let totalOrderValue = 0;
  let totalAllocatedValue = 0;
  let totalReceivableValue = 0;
  let totalReceivedValue = 0;
  let totalOpenValue = 0;
  let withPendingItems = 0;
  let withOpenCr = 0;
  let withDivergences = 0;
  let withAlerts = 0;

  for (const row of rows) {
    statusCounts[row.orderStatus] += 1;
    totalOrderValue += row.orderNetValue;
    totalAllocatedValue += row.allocatedValue;
    totalReceivableValue += row.receivableTotalValue;
    totalReceivedValue += row.receivableReceivedValue;
    totalOpenValue += row.receivableOpenValue;
    if (row.hasPendingItems) withPendingItems += 1;
    if (row.hasOpenCr) withOpenCr += 1;
    if (row.hasDivergences) withDivergences += 1;
    if (row.hasAlerts) withAlerts += 1;
  }

  return {
    totalOrders: rows.length,
    totalOrderValue: round6(totalOrderValue),
    totalAllocatedValue: round6(totalAllocatedValue),
    totalReceivableValue: round6(totalReceivableValue),
    totalReceivedValue: round6(totalReceivedValue),
    totalOpenValue: round6(totalOpenValue),
    statusCounts,
    withPendingItems,
    withOpenCr,
    withDivergences,
    withAlerts,
    summarySource: "aggregated_orders",
  };
}

export function resolveOrderStatusPedidosSort(
  sortByRaw: unknown,
  sortDirectionRaw: unknown
): { sortBy: OrderStatusPedidosSortBy; sortDirection: OrderStatusPedidosSortDirection } {
  const sortBy = String(sortByRaw ?? ORDER_STATUS_PEDIDOS_DEFAULT_SORT_BY).trim();
  const allowed = ORDER_STATUS_PEDIDOS_SORT_WHITELIST as readonly string[];
  if (!allowed.includes(sortBy)) {
    throw new OrderStatusPedidosApiParseError(`sortBy inválido: ${sortBy}`);
  }
  const dir = String(sortDirectionRaw ?? ORDER_STATUS_PEDIDOS_DEFAULT_SORT_DIRECTION)
    .trim()
    .toLowerCase();
  if (dir !== "asc" && dir !== "desc") {
    throw new OrderStatusPedidosApiParseError("sortDirection inválido.");
  }
  return {
    sortBy: sortBy as OrderStatusPedidosSortBy,
    sortDirection: dir,
  };
}

function compareNullableString(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "", "pt-BR");
}

function compareNullableNumber(a: number, b: number): number {
  return a - b;
}

export function sortOrderStatusPedidosRows(
  rows: readonly OrderStatusPedidosOrderRow[],
  sortBy: OrderStatusPedidosSortBy,
  sortDirection: OrderStatusPedidosSortDirection
): OrderStatusPedidosOrderRow[] {
  const mul = sortDirection === "asc" ? 1 : -1;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "orderCode":
        cmp = compareNullableString(a.orderCode, b.orderCode);
        break;
      case "orderIssueDate":
        cmp = compareNullableString(a.orderIssueDate, b.orderIssueDate);
        break;
      case "customerName":
        cmp = compareNullableString(a.customerName, b.customerName);
        break;
      case "sellerName":
        cmp = compareNullableString(a.sellerName, b.sellerName);
        break;
      case "orderNetValue":
        cmp = compareNullableNumber(a.orderNetValue, b.orderNetValue);
        break;
      case "allocatedValue":
        cmp = compareNullableNumber(a.allocatedValue, b.allocatedValue);
        break;
      case "receivableTotalValue":
        cmp = compareNullableNumber(a.receivableTotalValue, b.receivableTotalValue);
        break;
      case "receivableOpenValue":
        cmp = compareNullableNumber(a.receivableOpenValue, b.receivableOpenValue);
        break;
      case "receivableReceivedValue":
        cmp = compareNullableNumber(a.receivableReceivedValue, b.receivableReceivedValue);
        break;
      case "orderStatus":
        cmp = compareNullableString(a.orderStatus, b.orderStatus);
        break;
      default:
        cmp = 0;
    }
    if (cmp !== 0) return cmp * mul;
    return compareNullableString(a.orderCode, b.orderCode);
  });
  return sorted;
}

export function filterOrderStatusPedidosRows(
  rows: readonly OrderStatusPedidosOrderRow[],
  filters: {
    orderStatus?: string | null;
    onlyWithPendingItems?: boolean;
    onlyWithOpenCr?: boolean;
    onlyWithDivergences?: boolean;
    onlyWithAlerts?: boolean;
  }
): OrderStatusPedidosOrderRow[] {
  return rows.filter((row) => {
    if (filters.orderStatus && row.orderStatus !== filters.orderStatus) return false;
    if (filters.onlyWithPendingItems && !row.hasPendingItems) return false;
    if (filters.onlyWithOpenCr && !row.hasOpenCr) return false;
    if (filters.onlyWithDivergences && !row.hasDivergences) return false;
    if (filters.onlyWithAlerts && !row.hasAlerts) return false;
    return true;
  });
}

export function paginateOrderStatusPedidosRows(
  rows: readonly OrderStatusPedidosOrderRow[],
  page: number,
  pageSize: number
): { pageRows: OrderStatusPedidosOrderRow[]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    pageRows: rows.slice(start, start + pageSize),
    totalPages,
  };
}

export function buildOrderStatusPedidosListPayload(args: {
  filters: OrderToCashAuditListFilters;
  run: OrderToCashAuditRunMeta | null;
  allOrderRows: OrderStatusPedidosOrderRow[];
  pageRows: OrderStatusPedidosOrderRow[];
  totalOrders: number;
  totalPages: number;
  message?: string | null;
}): OrderStatusPedidosListPayload {
  return {
    ok: true,
    filters: args.filters,
    run: args.run,
    rows: args.pageRows,
    summary: buildOrderStatusPedidosSummary(args.allOrderRows),
    totalOrders: args.totalOrders,
    page: args.filters.page,
    pageSize: args.filters.pageSize,
    totalPages: args.totalPages,
    message: args.message ?? null,
  };
}

export function buildOrderStatusPedidosDetailPayload(args: {
  run: OrderToCashAuditRunMeta | null;
  orderFacts: OrderToCashAuditFactRecord[];
  message?: string | null;
}): OrderStatusPedidosDetailPayload {
  const orderRows = aggregateFactsToOrderStatusRows(args.orderFacts);
  const order = orderRows[0] ?? null;
  const items = args.orderFacts.map((f) => mapOrderToCashAuditFactToListRow(f));
  // Enrich title CR/NF for drawer (PENDING não herda NF/CR de item)
  const titleReceivable = order?.receivableTotalValue ?? null;
  const titleOpen = order?.receivableOpenValue ?? null;
  const titleNfe = order?.nfeNumbers[0] ?? null;
  const enriched = items.map((row) => {
    if (row.lineType === "ORDER_ITEM_PENDING") {
      return {
        ...row,
        nfeNumber: null,
        nfeHeaderValue: null,
        receivableTotalValue: null,
        receivableOpenValue: null,
        receivableReceivedValue: null,
        titleReceivableTotalValue: titleReceivable,
        titleReceivableOpenValue: titleOpen,
        titleNfeNumber: titleNfe,
        evidenceLevel: "ORDER_TITLE" as const,
      };
    }
    return {
      ...row,
      titleReceivableTotalValue: titleReceivable,
      titleReceivableOpenValue: titleOpen,
      titleNfeNumber: titleNfe,
    };
  });

  return {
    ok: true,
    run: args.run,
    order,
    items: enriched,
    message: args.message ?? null,
  };
}
