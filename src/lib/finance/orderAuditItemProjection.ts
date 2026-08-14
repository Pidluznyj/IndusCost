/**
 * FASE 2C — mapper-base PURO de `SalesOrderItem` → `OrderFullAuditItem`.
 *
 * Era o `order.items.map(...)` inline de `loadOrderFullAuditUncached`. Foi
 * extraído para que o auditor 360º e o loader leve do Fluxo de Caixa produzam
 * os itens pela MESMA regra — quantidades ativas/canceladas/cortadas, valores
 * e leitura do `nomusRawItem` — sem duas cópias que possam divergir.
 *
 * O QUE ESTE MAPPER **NÃO** FAZ: enriquecer os vínculos O2C
 * (`linkedStockDocumentExternalIds`, `linkedNfeExternalIds`,
 * `linkedReceivableExternalIds`) nem os `alerts`. Eles saem vazios aqui, como
 * sempre saíram — quem os preenche é o audit, depois, a partir de
 * `OrderToCashAuditFact`. O loader leve deliberadamente não os preenche:
 * cashFlowLightProjectionFeasibility.test.ts prova que eles não movem o número
 * consumido pelo Fluxo de Caixa.
 *
 * Sem Prisma. Sem I/O.
 */

import type { OrderFullAuditItem } from "@/src/lib/finance/orderFullAuditClient.js";

export function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && "toNumber" in (value as object)) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function readNomusRawString(
  raw: unknown,
  keys: readonly string[]
): string | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

export function readNomusRawNumber(
  raw: unknown,
  keys: readonly string[]
): number | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Campos de `SalesOrderItem` realmente lidos pelo mapper. */
export type OrderAuditItemSource = {
  id: string;
  nomusItemExternalId?: number | null;
  nomusItemSequence?: string | null;
  skuSnapshot: string | null;
  productNameSnapshot: string | null;
  externalProductId?: number | null;
  unit?: string | null;
  quantity: unknown;
  negotiatedPrice: unknown;
  totalNetValue: unknown;
  nomusQuantityFulfilled: unknown;
  nomusQuantityPending: unknown;
  nomusIsCanceled?: boolean | null;
  nomusIsCut?: boolean | null;
  nomusIsStale?: boolean | null;
  nomusItemStatusRaw?: string | null;
  nomusItemStatusNormalized?: string | null;
  nomusMatchConfidence?: string | null;
  proposalItemId?: string | null;
  nomusRawItem?: unknown;
};

export type ProjectOrderAuditItemsInput = {
  items: ReadonlyArray<OrderAuditItemSource>;
  /** `SalesOrder.expectedDeliveryDate` — prazo do pedido, replicado na linha. */
  expectedDeliveryDate: Date | string | null | undefined;
};

/** Projeta os itens do pedido exatamente como o audit 360º sempre projetou. */
export function projectOrderAuditItems(
  input: ProjectOrderAuditItemsInput
): OrderFullAuditItem[] {
  return input.items.map((item, index) => {
    const qty = decimalToNumber(item.quantity);
    const unitPrice = decimalToNumber(item.negotiatedPrice);
    const totalNet = decimalToNumber(item.totalNetValue);
    const fulfilled = decimalToNumber(item.nomusQuantityFulfilled);
    const pending = decimalToNumber(item.nomusQuantityPending);
    const isCanceled = item.nomusIsCanceled === true;
    const isCut = item.nomusIsCut === true;
    const isStale = item.nomusIsStale === true;
    const canceledQty = isCanceled || isStale ? (qty ?? 0) : 0;
    const cutQty =
      isCut && qty != null && fulfilled != null
        ? Math.max(0, qty - fulfilled)
        : 0;
    const activeQty =
      qty != null ? Math.max(0, qty - canceledQty - cutQty) : null;
    const activePending =
      isCanceled || isStale
        ? 0
        : isCut
          ? 0
          : pending != null
            ? Math.max(0, pending)
            : activeQty != null && fulfilled != null
              ? Math.max(0, activeQty - fulfilled)
              : activeQty;
    const canceledValue =
      qty && unitPrice != null && canceledQty > 0
        ? round2(canceledQty * unitPrice)
        : 0;
    const cutValue =
      qty && unitPrice != null && cutQty > 0 ? round2(cutQty * unitPrice) : 0;
    const activeValue = round2(
      Math.max(0, (totalNet ?? 0) - canceledValue - cutValue)
    );

    const rawItem = item.nomusRawItem;
    const productionQuantity = readNomusRawNumber(rawItem, [
      "qtdeProduzida",
      "quantidadeProduzida",
      "producedQuantity",
    ]);
    const invoicedQuantity = readNomusRawNumber(rawItem, [
      "qtdeFaturada",
      "quantidadeFaturada",
      "invoicedQuantity",
    ]);
    const saldoAFaturar = readNomusRawNumber(rawItem, [
      "saldoFaturar",
      "saldoAFaturar",
      "remainingToInvoice",
    ]);
    const saldoPronto = readNomusRawNumber(rawItem, [
      "saldoPronto",
      "saldoDisponivel",
      "readyBalance",
    ]);
    const movementType = readNomusRawString(rawItem, [
      "tipoMovimentacao",
      "movementType",
      "descricaoMovimentacao",
    ]);
    const cfop = readNomusRawString(rawItem, ["cfop", "codigoCfop", "cfopCode"]);

    return {
      salesOrderItemId: item.id,
      externalSalesOrderItemId: item.nomusItemExternalId ?? null,
      itemSequence: item.nomusItemSequence ?? String(index + 1),
      productCode: item.skuSnapshot,
      sku: item.skuSnapshot,
      productName: item.productNameSnapshot,
      productExternalId: item.externalProductId ?? null,
      unit: item.unit ?? null,
      quantity: qty,
      unitPrice,
      totalNetValue: totalNet,
      nomusItemStatusRaw: item.nomusItemStatusRaw ?? null,
      nomusItemStatusNormalized: item.nomusItemStatusNormalized ?? null,
      itemStatus: item.nomusItemStatusNormalized ?? null,
      nomusIsCanceled: isCanceled,
      nomusIsCut: isCut,
      nomusIsStale: isStale,
      nomusQuantityFulfilled: fulfilled,
      nomusQuantityPending: pending,
      matchConfidence: item.nomusMatchConfidence ?? null,
      proposalItemId: item.proposalItemId ?? null,
      activeQuantity: activeQty,
      canceledQuantity: canceledQty > 0 ? canceledQty : 0,
      cutQuantity: cutQty > 0 ? cutQty : 0,
      activePendingQuantity: activePending,
      activeValue,
      canceledValue,
      cutValue,
      expectedDeliveryDate: toIso(input.expectedDeliveryDate),
      productionQuantity,
      invoicedQuantity,
      saldoAFaturar,
      saldoPronto,
      movementType,
      cfop,
      // Preenchidos depois pelo audit, a partir de OrderToCashAuditFact.
      linkedStockDocumentExternalIds: [],
      linkedNfeExternalIds: [],
      linkedReceivableExternalIds: [],
      alerts: [],
    } as unknown as OrderFullAuditItem;
  });
}
