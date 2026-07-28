/**
 * Normalizador de status de item do Pedido de Venda (Nomus itensPedido[].status).
 *
 * Códigos confirmados em produção (PD 02207):
 * - 4 → FULFILLED (Atendido totalmente)
 * - 6 → CANCELED (Cancelado)
 *
 * Preserva status bruto e marca UNKNOWN quando o código/texto não é mapeado.
 */

import { parseNomusPtBrNumber } from "@/scripts/nomusNumberParser.js";
import {
  isSalesOrderItemCancelledByRawQuantity,
  normalizeSalesOrderItemNomusStatus,
  type NomusRawItem,
} from "../salesOrderNomusRaw.js";
import type { SalesOrderItemNomusStatus } from "../salesOrderLifecycleTypes.js";

export type NomusSalesOrderItemStatusNormalized =
  | "FULFILLED"
  | "FULFILLED_WITH_CUT"
  | "RELEASED"
  | "CANCELED"
  | "PARTIAL"
  | "PENDING"
  | "STALE"
  | "UNKNOWN";

/** Mapa inicial pedido pelo contrato Status Pedidos / sync.
 *  1=aguardando liberação → PENDING
 *  2=liberado → RELEASED
 *  3=parcial → PARTIAL
 *  4=atendido totalmente → FULFILLED
 *  5=atendido com corte → FULFILLED_WITH_CUT
 *  6=cancelado → CANCELED
 */
export const NOMUS_SALES_ORDER_ITEM_STATUS_CODE_MAP: Readonly<
  Record<number, NomusSalesOrderItemStatusNormalized>
> = {
  1: "PENDING",
  2: "RELEASED",
  3: "PARTIAL",
  4: "FULFILLED",
  5: "FULFILLED_WITH_CUT",
  6: "CANCELED",
};

export type ParsedNomusSalesOrderItemStatus = {
  statusRaw: string | null;
  statusNormalized: NomusSalesOrderItemStatusNormalized;
  isCanceled: boolean;
  isCut: boolean;
  isReleased: boolean;
  quantityOrdered: number | null;
  quantityFulfilled: number | null;
  quantityCanceled: number | null;
  quantityCut: number | null;
  quantityPending: number | null;
  /**
   * true quando status FULFILLED veio com atendida < pedida e a qty foi
   * promovida para a pedida (inconsistência de sync / parse).
   */
  fulfilledQuantityCoercedDueToStatusMismatch: boolean;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Quantidades Nomus (aceita milhar pt-BR: "1.000" → 1000). */
function asQuantityNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = parseNomusPtBrNumber(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Valores monetários / genéricos (vírgula decimal). */
function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = parseNomusPtBrNumber(value);
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
    case "fulfilled_with_cut":
      return "FULFILLED_WITH_CUT";
    case "cancelled":
      return "CANCELED";
    case "partially_fulfilled":
    case "partially_returned":
      return "PARTIAL";
    case "awaiting_release":
      return "PENDING";
    case "released":
      return "RELEASED";
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
    case "FULFILLED_WITH_CUT":
      return "ATENDIDO_COM_CORTE";
    case "PARTIAL":
      return "PARCIAL";
    case "RELEASED":
      return "LIBERADO";
    case "PENDING":
      return "PENDENTE";
    case "STALE":
      return "STALE";
    default:
      return "DESCONHECIDO";
  }
}

const EMPTY_PARSED: ParsedNomusSalesOrderItemStatus = {
  statusRaw: null,
  statusNormalized: "UNKNOWN",
  isCanceled: false,
  isCut: false,
  isReleased: false,
  quantityOrdered: null,
  quantityFulfilled: null,
  quantityCanceled: null,
  quantityCut: null,
  quantityPending: null,
  fulfilledQuantityCoercedDueToStatusMismatch: false,
};

/**
 * Extrai status + quantidades de um item bruto Nomus (itensPedido[]).
 */
export function parseNomusSalesOrderItemStatus(
  rawItem: unknown
): ParsedNomusSalesOrderItemStatus {
  const obj = asObject(rawItem);
  if (!obj) return { ...EMPTY_PARSED };

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
    asQuantityNumber(obj.quantidade) ??
    asQuantityNumber(obj.qtd) ??
    asQuantityNumber(obj.quantity);
  // Nomus frequentemente envia quantidadeAtendida=0 mesmo com status 4
  // ("Atendido totalmente") e preenche só quantidadeFaturada / UI de produção.
  // `??` não cai no próximo campo quando o valor é 0 — tratar 0 como ausente.
  const rawAtendida =
    asQuantityNumber(obj.quantidadeAtendida) ??
    asQuantityNumber(obj.qtdAtendida) ??
    asQuantityNumber(obj.quantidadeAtendimento) ??
    asQuantityNumber(obj.quantidadeAtendidaProducao) ??
    asQuantityNumber(obj.qtdeAtendidaProducao);
  const rawFaturada =
    asQuantityNumber(obj.quantidadeFaturada) ??
    asQuantityNumber(obj.qtdFaturada) ??
    asQuantityNumber(obj.quantidadeNF);
  let quantityFulfilled: number | null =
    rawAtendida != null && rawAtendida > 0
      ? rawAtendida
      : rawFaturada != null && rawFaturada > 0
        ? rawFaturada
        : rawAtendida;
  let fulfilledQuantityCoercedDueToStatusMismatch = false;
  // Status 4 sem qty positiva: obrigação atendida = pedida (não inventa corte).
  if (
    (quantityFulfilled == null || quantityFulfilled <= 0) &&
    statusNormalized === "FULFILLED" &&
    quantityOrdered != null &&
    quantityOrdered > 0
  ) {
    quantityFulfilled = quantityOrdered;
  }
  // Status 4 com atendida parcial inconsistente (ex.: "1.000" parseado como 1) → pedida.
  if (
    statusNormalized === "FULFILLED" &&
    quantityOrdered != null &&
    quantityOrdered > 0 &&
    quantityFulfilled != null &&
    quantityFulfilled > 0 &&
    quantityFulfilled + 1e-9 < quantityOrdered
  ) {
    fulfilledQuantityCoercedDueToStatusMismatch = true;
    quantityFulfilled = quantityOrdered;
  }
  const quantityCanceled =
    asQuantityNumber(obj.quantidadeCancelada) ??
    asQuantityNumber(obj.qtdCancelada);

  let quantityCut: number | null = null;
  if (statusNormalized === "FULFILLED_WITH_CUT" && quantityOrdered != null) {
    const fulfilled = quantityFulfilled != null && quantityFulfilled > 0
      ? quantityFulfilled
      : 0;
    quantityCut = Math.max(0, quantityOrdered - fulfilled);
  }

  let quantityPending: number | null = null;
  if (quantityOrdered != null) {
    const fulfilled = quantityFulfilled ?? 0;
    const canceled = quantityCanceled ?? (statusNormalized === "CANCELED" ? quantityOrdered : 0);
    const cut = quantityCut ?? 0;
    quantityPending = Math.max(0, quantityOrdered - fulfilled - canceled - cut);
    if (statusNormalized === "CANCELED") quantityPending = 0;
    if (statusNormalized === "FULFILLED") quantityPending = 0;
    if (statusNormalized === "FULFILLED_WITH_CUT") quantityPending = 0;
  }

  return {
    statusRaw,
    statusNormalized,
    isCanceled: statusNormalized === "CANCELED" || canceledByQty,
    isCut: statusNormalized === "FULFILLED_WITH_CUT",
    isReleased: statusNormalized === "RELEASED",
    quantityOrdered,
    quantityFulfilled,
    quantityCanceled,
    quantityCut,
    quantityPending,
    fulfilledQuantityCoercedDueToStatusMismatch,
  };
}

export function parseNomusSalesOrderItemStatusFromRawItem(
  raw: NomusRawItem | null | undefined
): ParsedNomusSalesOrderItemStatus {
  if (!raw) return { ...EMPTY_PARSED };
  return parseNomusSalesOrderItemStatus(raw.raw ?? raw);
}

/** Item inativo para carteira/comissão: cancelado ou stale (não inclui corte). */
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
  if (norm === "CANCELED" || norm === "CANCELLED" || norm === "CANCELADO" || norm === "STALE") {
    return true;
  }
  const itemStatus = (flags.itemStatus ?? "").trim().toUpperCase();
  return (
    itemStatus === "CANCELED" ||
    itemStatus === "CANCELLED" ||
    itemStatus === "CANCELADO"
  );
}

/** Item atendido com corte — não é cancelado; encerra saldo cortado. */
export function isFulfilledWithCutSalesOrderItem(flags: {
  nomusIsCut?: boolean | null;
  isCut?: boolean | null;
  nomusItemStatusNormalized?: string | null;
  itemStatus?: string | null;
}): boolean {
  if (flags.nomusIsCut === true || flags.isCut === true) return true;
  const norm = (flags.nomusItemStatusNormalized ?? "").trim().toUpperCase();
  if (norm === "FULFILLED_WITH_CUT") return true;
  const itemStatus = (flags.itemStatus ?? "").trim().toUpperCase();
  return itemStatus === "ATENDIDO_COM_CORTE" || itemStatus === "FULFILLED_WITH_CUT";
}

/** Alias do contrato oficial — status bruto Nomus cancelado. */
export function isNomusSalesOrderItemCanceled(rawStatus: unknown): boolean {
  return isNomusSalesOrderItemCanceledStatus(rawStatus);
}

export type SalesOrderItemActivityFlags = {
  nomusIsCanceled?: boolean | null;
  nomusIsStale?: boolean | null;
  nomusIsCut?: boolean | null;
  nomusItemStatusNormalized?: string | null;
  itemStatus?: string | null;
  isCanceled?: boolean | null;
  isStale?: boolean | null;
  isCut?: boolean | null;
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

/** Gate canônico: CANCELED / STALE / zerado / CUT → não é valor comercial ativo/aberto. */
export function isSalesOrderItemActiveForCommercialValue(
  item: SalesOrderItemActivityFlags
): boolean {
  if (isInactiveSalesOrderItemNomusFlags(item)) return false;
  if (isFulfilledWithCutSalesOrderItem(item)) return false;
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
export const COMMISSION_IGNORED_CUT_ITEM = "IGNORED_CUT_ITEM";

export function resolveCommissionIgnoreReasonForSalesOrderItem(
  item: SalesOrderItemActivityFlags
):
  | typeof COMMISSION_IGNORED_CANCELED_ITEM
  | typeof COMMISSION_IGNORED_STALE_ITEM
  | typeof COMMISSION_IGNORED_CUT_ITEM
  | null {
  if (item.nomusIsStale === true || item.isStale === true) {
    return COMMISSION_IGNORED_STALE_ITEM;
  }
  if (isInactiveSalesOrderItemNomusFlags(item)) {
    return COMMISSION_IGNORED_CANCELED_ITEM;
  }
  if (isFulfilledWithCutSalesOrderItem(item)) {
    return COMMISSION_IGNORED_CUT_ITEM;
  }
  if (isZeroedItem(item)) {
    return COMMISSION_IGNORED_CANCELED_ITEM;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Casamento item local × item bruto Nomus por LINHA (não por SKU)
// ---------------------------------------------------------------------------

export type NomusRawItemMatchConfidence =
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "AMBIGUOUS"
  | "NONE";

export type NomusRawItemMatchResult = {
  rawItem: NomusRawItem | null;
  matchConfidence: NomusRawItemMatchConfidence;
  matchReason: string;
};

export type SalesOrderItemLineMatchInput = {
  id: string;
  externalProductId?: number | null;
  skuSnapshot?: string | null;
  productNameSnapshot?: string | null;
  quantity?: number | null;
  negotiatedPrice?: number | null;
  notes?: string | null;
  nomusItemExternalId?: number | null;
  nomusItemSequence?: string | null;
};

function toIntOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const t = value.trim();
    if (/^\d+$/.test(t)) return Number.parseInt(t, 10);
  }
  return null;
}

function extractRawItemExternalId(raw: NomusRawItem): number | null {
  const obj = asObject(raw.raw) ?? {};
  const candidates: unknown[] = [
    obj.id,
    obj.idItemPedido,
    obj.idPedidoItem,
    obj.idItem,
  ];
  for (const c of candidates) {
    const n = toIntOrNull(c);
    if (n != null && n > 0) return n;
  }
  return null;
}

function extractRawItemSequence(raw: NomusRawItem): string | null {
  if (raw.item != null) return String(raw.item);
  const obj = asObject(raw.raw) ?? {};
  const cand = obj.item ?? obj.sequencia ?? obj.numero ?? obj.numeroItem;
  if (cand == null) return null;
  return String(cand);
}

function parseLineIdFromNotes(notes: string | null | undefined): number | null {
  if (!notes) return null;
  const m = notes.match(/\[nomus-line:(\d+)\]/);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function rawItemUnitPrice(raw: NomusRawItem): number | null {
  const obj = asObject(raw.raw) ?? {};
  return (
    asNumber(obj.valorUnitario) ??
    asNumber(obj.valor_unitario) ??
    asNumber(obj.precoUnitario) ??
    asNumber(obj.preco)
  );
}

function nearlyEqual(a: number | null | undefined, b: number | null | undefined, eps = 0.005): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= eps;
}

/**
 * Resolve, PARA CADA local item, o rawItem correspondente com confidência.
 * Regras (na ordem):
 *   1. `nomusItemExternalId` ou `[nomus-line:N]` → id do item Nomus → HIGH.
 *   2. `nomusItemSequence` → HIGH (se sequência única).
 *   3. Produto único no pedido (uma linha local, uma linha raw) → HIGH.
 *   4. Múltiplas linhas do mesmo produto: match por (quantidade + valorUnitario) único → HIGH.
 *   5. Múltiplas linhas do mesmo produto, mesma quantidade unit price → LOW; se não
 *      resolver 1:1 → AMBIGUOUS.
 *
 * NUNCA aplica status por SKU quando há repetição de produto sem evidência de linha.
 */
export function resolveNomusRawItemMatchesForOrder(
  localItems: readonly SalesOrderItemLineMatchInput[],
  rawItems: readonly NomusRawItem[]
): Map<string, NomusRawItemMatchResult> {
  const result = new Map<string, NomusRawItemMatchResult>();
  if (rawItems.length === 0) {
    for (const item of localItems) {
      result.set(item.id, {
        rawItem: null,
        matchConfidence: "NONE",
        matchReason: "sem itensPedido no payload",
      });
    }
    return result;
  }

  const rawByExternalId = new Map<number, NomusRawItem>();
  const rawBySequence = new Map<string, NomusRawItem>();
  for (const raw of rawItems) {
    const extId = extractRawItemExternalId(raw);
    if (extId != null) rawByExternalId.set(extId, raw);
    const seq = extractRawItemSequence(raw);
    if (seq) {
      // apenas se sequência ainda não repetida
      if (rawBySequence.has(seq)) {
        rawBySequence.delete(seq);
      } else {
        rawBySequence.set(seq, raw);
      }
    }
  }

  const consumedRaw = new Set<NomusRawItem>();

  // Pass 1: id direto (nomusItemExternalId ou [nomus-line:N])
  for (const item of localItems) {
    const explicitId =
      (item.nomusItemExternalId != null && item.nomusItemExternalId > 0
        ? item.nomusItemExternalId
        : null) ?? parseLineIdFromNotes(item.notes);
    if (explicitId == null) continue;
    const raw = rawByExternalId.get(explicitId);
    if (raw && !consumedRaw.has(raw)) {
      result.set(item.id, {
        rawItem: raw,
        matchConfidence: "HIGH",
        matchReason: `nomus-line id ${explicitId}`,
      });
      consumedRaw.add(raw);
    }
  }

  // Pass 2: sequência única
  for (const item of localItems) {
    if (result.has(item.id)) continue;
    const seq = item.nomusItemSequence?.trim();
    if (!seq) continue;
    const raw = rawBySequence.get(seq);
    if (raw && !consumedRaw.has(raw)) {
      result.set(item.id, {
        rawItem: raw,
        matchConfidence: "HIGH",
        matchReason: `nomus item sequence ${seq}`,
      });
      consumedRaw.add(raw);
    }
  }

  // Bucket por produto (externalProductId + fallback SKU)
  const rawByProduct = new Map<string, NomusRawItem[]>();
  for (const raw of rawItems) {
    if (consumedRaw.has(raw)) continue;
    const productKey =
      raw.idProduto != null
        ? `id:${raw.idProduto}`
        : raw.codigoProduto
          ? `sku:${raw.codigoProduto.trim().toUpperCase()}`
          : null;
    if (!productKey) continue;
    const list = rawByProduct.get(productKey) ?? [];
    list.push(raw);
    rawByProduct.set(productKey, list);
  }

  const localByProduct = new Map<string, SalesOrderItemLineMatchInput[]>();
  for (const item of localItems) {
    if (result.has(item.id)) continue;
    const productKey =
      item.externalProductId != null
        ? `id:${item.externalProductId}`
        : item.skuSnapshot
          ? `sku:${item.skuSnapshot.trim().toUpperCase()}`
          : null;
    if (!productKey) {
      result.set(item.id, {
        rawItem: null,
        matchConfidence: "NONE",
        matchReason: "item local sem product key",
      });
      continue;
    }
    const list = localByProduct.get(productKey) ?? [];
    list.push(item);
    localByProduct.set(productKey, list);
  }

  for (const [productKey, locals] of localByProduct) {
    const raws = (rawByProduct.get(productKey) ?? []).filter((r) => !consumedRaw.has(r));

    if (raws.length === 0) {
      for (const l of locals) {
        result.set(l.id, {
          rawItem: null,
          matchConfidence: "NONE",
          matchReason: `sem rawItem para produto ${productKey}`,
        });
      }
      continue;
    }

    // Produto único em ambos os lados: HIGH.
    if (locals.length === 1 && raws.length === 1) {
      result.set(locals[0]!.id, {
        rawItem: raws[0]!,
        matchConfidence: "HIGH",
        matchReason: "produto único no pedido",
      });
      consumedRaw.add(raws[0]!);
      continue;
    }

    // Múltiplas linhas do mesmo produto: exigir evidência de linha, nunca fallback por SKU.
    // Tentar casar por (quantidade + valorUnitario) exato — se a tupla for única.
    const remainingLocals = [...locals];
    const remainingRaws = [...raws];

    for (const local of [...remainingLocals]) {
      const qty = local.quantity;
      const unit = local.negotiatedPrice;
      if (qty == null || unit == null) continue;
      const candidates = remainingRaws.filter(
        (r) => nearlyEqual(r.quantidade ?? null, qty) && nearlyEqual(rawItemUnitPrice(r), unit)
      );
      if (candidates.length === 1) {
        const chosen = candidates[0]!;
        result.set(local.id, {
          rawItem: chosen,
          matchConfidence: "HIGH",
          matchReason: `qty+unitPrice únicos (qty=${qty}, unit=${unit})`,
        });
        consumedRaw.add(chosen);
        const idxRaw = remainingRaws.indexOf(chosen);
        if (idxRaw >= 0) remainingRaws.splice(idxRaw, 1);
        const idxLocal = remainingLocals.indexOf(local);
        if (idxLocal >= 0) remainingLocals.splice(idxLocal, 1);
      }
    }

    // Se o que sobrou é 1:1 e mesma cardinalidade, atribuição estável (por posição) LOW.
    if (
      remainingLocals.length === remainingRaws.length &&
      remainingLocals.length > 0
    ) {
      // Ordem estável: sequence então posição de entrada
      remainingLocals.sort((a, b) => {
        const sa = a.nomusItemSequence ?? "";
        const sb = b.nomusItemSequence ?? "";
        return sa.localeCompare(sb);
      });
      remainingRaws.sort((a, b) => {
        const sa = extractRawItemSequence(a) ?? "";
        const sb = extractRawItemSequence(b) ?? "";
        return sa.localeCompare(sb);
      });
      for (let i = 0; i < remainingLocals.length; i += 1) {
        const local = remainingLocals[i]!;
        const raw = remainingRaws[i]!;
        result.set(local.id, {
          rawItem: raw,
          matchConfidence: "LOW",
          matchReason: `mesmo produto ${productKey} — pareamento posicional (${i + 1})`,
        });
        consumedRaw.add(raw);
      }
      continue;
    }

    // Restantes: AMBIGUOUS — não aplicar status por SKU.
    for (const local of remainingLocals) {
      result.set(local.id, {
        rawItem: null,
        matchConfidence: "AMBIGUOUS",
        matchReason: `SKU ${productKey} repete no pedido; sem evidência de linha (id/sequência/qty+preço)`,
      });
    }
  }

  // Garantia: todo local item tem entrada.
  for (const item of localItems) {
    if (!result.has(item.id)) {
      result.set(item.id, {
        rawItem: null,
        matchConfidence: "NONE",
        matchReason: "não resolvido",
      });
    }
  }

  return result;
}

/** Conveniência quando o caller já tem os itens e o payload. */
export function resolveNomusRawItemForSalesOrderItem(input: {
  salesOrderItem: SalesOrderItemLineMatchInput;
  rawItems: readonly NomusRawItem[];
  allLocalItems: readonly SalesOrderItemLineMatchInput[];
}): NomusRawItemMatchResult {
  const map = resolveNomusRawItemMatchesForOrder(input.allLocalItems, input.rawItems);
  return (
    map.get(input.salesOrderItem.id) ?? {
      rawItem: null,
      matchConfidence: "NONE",
      matchReason: "não resolvido",
    }
  );
}
