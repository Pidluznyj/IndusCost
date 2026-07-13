/**
 * Normalizador de status de item do Pedido de Venda (Nomus itensPedido[].status).
 *
 * Códigos confirmados em produção (PD 02207):
 * - 4 → FULFILLED (Atendido totalmente)
 * - 6 → CANCELED (Cancelado)
 *
 * Preserva status bruto e marca UNKNOWN quando o código/texto não é mapeado.
 */

import {
  isSalesOrderItemCancelledByRawQuantity,
  normalizeSalesOrderItemNomusStatus,
  type NomusRawItem,
} from "../salesOrderNomusRaw.js";
import type { SalesOrderItemNomusStatus } from "../salesOrderLifecycleTypes.js";

export type NomusSalesOrderItemStatusNormalized =
  | "FULFILLED"
  | "CANCELED"
  | "PARTIAL"
  | "PENDING"
  | "UNKNOWN";

/** Mapa inicial pedido pelo contrato Status Pedidos / sync. */
export const NOMUS_SALES_ORDER_ITEM_STATUS_CODE_MAP: Readonly<
  Record<number, NomusSalesOrderItemStatusNormalized>
> = {
  1: "PENDING",
  2: "PENDING",
  3: "PARTIAL",
  4: "FULFILLED",
  5: "PARTIAL",
  6: "CANCELED",
};

export type ParsedNomusSalesOrderItemStatus = {
  statusRaw: string | null;
  statusNormalized: NomusSalesOrderItemStatusNormalized;
  isCanceled: boolean;
  quantityOrdered: number | null;
  quantityFulfilled: number | null;
  quantityCanceled: number | null;
  quantityPending: number | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStatusRaw(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return null;
}

function parseStatusCode(status: unknown): number | null {
  if (typeof status === "number" && Number.isFinite(status)) return Math.trunc(status);
  if (typeof status === "string") {
    const t = status.trim();
    if (/^\d+$/.test(t)) return Number.parseInt(t, 10);
  }
  return null;
}

export function mapLifecycleStatusToNormalized(
  status: SalesOrderItemNomusStatus
): NomusSalesOrderItemStatusNormalized {
  switch (status) {
    case "fully_fulfilled":
    case "delivered":
    case "shipped":
      return "FULFILLED";
    case "cancelled":
      return "CANCELED";
    case "partially_fulfilled":
    case "fulfilled_with_cut":
    case "partially_returned":
      return "PARTIAL";
    case "awaiting_release":
    case "released":
      return "PENDING";
    case "fully_returned":
      return "CANCELED";
    default:
      return "UNKNOWN";
  }
}

/**
 * Normaliza código/texto Nomus → FULFILLED | CANCELED | PARTIAL | PENDING | UNKNOWN.
 */
export function normalizeNomusSalesOrderItemStatus(
  status: unknown
): NomusSalesOrderItemStatusNormalized {
  const code = parseStatusCode(status);
  if (code != null && NOMUS_SALES_ORDER_ITEM_STATUS_CODE_MAP[code]) {
    return NOMUS_SALES_ORDER_ITEM_STATUS_CODE_MAP[code]!;
  }
  const lifecycle = normalizeSalesOrderItemNomusStatus(status);
  return mapLifecycleStatusToNormalized(lifecycle);
}

export function isNomusSalesOrderItemCanceledStatus(
  status: unknown
): boolean {
  return normalizeNomusSalesOrderItemStatus(status) === "CANCELED";
}

/** Status usado em OrderToCash / Status Pedidos (CANCELADO, ATENDIDO, …). */
export function toOrderItemFulfillmentStorageStatus(
  normalized: NomusSalesOrderItemStatusNormalized
): string {
  switch (normalized) {
    case "CANCELED":
      return "CANCELADO";
    case "FULFILLED":
      return "ATENDIDO";
    case "PARTIAL":
      return "PARCIAL";
    case "PENDING":
      return "PENDENTE";
    default:
      return "DESCONHECIDO";
  }
}

/**
 * Extrai status + quantidades de um item bruto Nomus (itensPedido[]).
 */
export function parseNomusSalesOrderItemStatus(
  rawItem: unknown
): ParsedNomusSalesOrderItemStatus {
  const obj = asObject(rawItem);
  if (!obj) {
    return {
      statusRaw: null,
      statusNormalized: "UNKNOWN",
      isCanceled: false,
      quantityOrdered: null,
      quantityFulfilled: null,
      quantityCanceled: null,
      quantityPending: null,
    };
  }

  const statusRaw =
    asStatusRaw(obj.status) ??
    asStatusRaw(obj.situacao) ??
    asStatusRaw(obj.situacaoItem) ??
    asStatusRaw(obj.statusItem) ??
    asStatusRaw(obj.descricaoStatus);

  let statusNormalized = normalizeNomusSalesOrderItemStatus(statusRaw ?? obj.status);
  const canceledByQty = isSalesOrderItemCancelledByRawQuantity(obj);
  if (canceledByQty) statusNormalized = "CANCELED";

  const quantityOrdered =
    asNumber(obj.quantidade) ?? asNumber(obj.qtd) ?? asNumber(obj.quantity);
  const quantityFulfilled =
    asNumber(obj.quantidadeAtendida) ??
    asNumber(obj.qtdAtendida) ??
    asNumber(obj.quantidadeFaturada);
  const quantityCanceled =
    asNumber(obj.quantidadeCancelada) ?? asNumber(obj.qtdCancelada);
  let quantityPending: number | null = null;
  if (quantityOrdered != null) {
    const fulfilled = quantityFulfilled ?? 0;
    const canceled = quantityCanceled ?? (statusNormalized === "CANCELED" ? quantityOrdered : 0);
    quantityPending = Math.max(0, quantityOrdered - fulfilled - canceled);
    if (statusNormalized === "CANCELED") quantityPending = 0;
    if (statusNormalized === "FULFILLED") quantityPending = 0;
  }

  return {
    statusRaw,
    statusNormalized,
    isCanceled: statusNormalized === "CANCELED" || canceledByQty,
    quantityOrdered,
    quantityFulfilled,
    quantityCanceled,
    quantityPending,
  };
}

export function parseNomusSalesOrderItemStatusFromRawItem(
  raw: NomusRawItem | null | undefined
): ParsedNomusSalesOrderItemStatus {
  if (!raw) {
    return {
      statusRaw: null,
      statusNormalized: "UNKNOWN",
      isCanceled: false,
      quantityOrdered: null,
      quantityFulfilled: null,
      quantityCanceled: null,
      quantityPending: null,
    };
  }
  return parseNomusSalesOrderItemStatus(raw.raw ?? raw);
}

/** Item inativo para carteira/comissão: cancelado ou stale. */
export function isInactiveSalesOrderItemNomusFlags(flags: {
  nomusIsCanceled?: boolean | null;
  nomusIsStale?: boolean | null;
  nomusItemStatusNormalized?: string | null;
  itemStatus?: string | null;
  isCanceled?: boolean | null;
  isStale?: boolean | null;
}): boolean {
  if (flags.nomusIsCanceled === true || flags.isCanceled === true) return true;
  if (flags.nomusIsStale === true || flags.isStale === true) return true;
  const norm = (flags.nomusItemStatusNormalized ?? "").trim().toUpperCase();
  if (norm === "CANCELED" || norm === "CANCELLED" || norm === "CANCELADO") {
    return true;
  }
  const itemStatus = (flags.itemStatus ?? "").trim().toUpperCase();
  return (
    itemStatus === "CANCELED" ||
    itemStatus === "CANCELLED" ||
    itemStatus === "CANCELADO"
  );
}

/** Alias do contrato oficial — status bruto Nomus cancelado. */
export function isNomusSalesOrderItemCanceled(rawStatus: unknown): boolean {
  return isNomusSalesOrderItemCanceledStatus(rawStatus);
}

export type SalesOrderItemActivityFlags = {
  nomusIsCanceled?: boolean | null;
  nomusIsStale?: boolean | null;
  nomusItemStatusNormalized?: string | null;
  itemStatus?: string | null;
  isCanceled?: boolean | null;
  isStale?: boolean | null;
  quantity?: number | null;
  totalNetValue?: number | null;
};

function isZeroedItem(item: SalesOrderItemActivityFlags): boolean {
  const qty = item.quantity;
  const net = item.totalNetValue;
  if (qty != null && Number.isFinite(qty) && qty <= 0) return true;
  if (net != null && Number.isFinite(net) && Math.abs(net) < 1e-9) return true;
  return false;
}

/** Gate canônico: CANCELED / STALE / zerado → não é valor comercial ativo. */
export function isSalesOrderItemActiveForCommercialValue(
  item: SalesOrderItemActivityFlags
): boolean {
  if (isInactiveSalesOrderItemNomusFlags(item)) return false;
  if (isZeroedItem(item)) return false;
  return true;
}

export function isSalesOrderItemActiveForReceivableForecast(
  item: SalesOrderItemActivityFlags
): boolean {
  return isSalesOrderItemActiveForCommercialValue(item);
}

export function isSalesOrderItemActiveForCommission(
  item: SalesOrderItemActivityFlags
): boolean {
  return isSalesOrderItemActiveForCommercialValue(item);
}

export function isSalesOrderItemActiveForMargin(
  item: SalesOrderItemActivityFlags
): boolean {
  return isSalesOrderItemActiveForCommercialValue(item);
}

export const COMMISSION_IGNORED_CANCELED_ITEM = "IGNORED_CANCELED_ITEM";
export const COMMISSION_IGNORED_STALE_ITEM = "IGNORED_STALE_ITEM";

export function resolveCommissionIgnoreReasonForSalesOrderItem(
  item: SalesOrderItemActivityFlags
): typeof COMMISSION_IGNORED_CANCELED_ITEM | typeof COMMISSION_IGNORED_STALE_ITEM | null {
  if (item.nomusIsStale === true || item.isStale === true) {
    return COMMISSION_IGNORED_STALE_ITEM;
  }
  if (isInactiveSalesOrderItemNomusFlags(item) || isZeroedItem(item)) {
    return COMMISSION_IGNORED_CANCELED_ITEM;
  }
  return null;
}
