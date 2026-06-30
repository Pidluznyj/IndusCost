/**
 * Helpers idempotentes para sync de Pedidos de Venda Nomus → IndusCost.
 * Sem I/O — testável e reutilizado pelo script de sync e auditorias.
 */
import {
  buildNomusSyncLineMatchKey,
  computeNomusSyncLineTotalCost,
  formatNomusSyncUnitCostDecimal,
  parseNomusSyncStoredUnitCost,
  type UnitCostSnapshotResult,
} from "./salesOrderNomusSyncCost.server.js";

export const NOMUS_SALES_ORDER_SOURCE = "NOMUS";

const STALE_LINE_NOTE = "[nomus-sync] linha removida ou substituída no Nomus";

export type NomusSyncExistingSalesOrder = {
  id: string;
  orderCode: string;
  externalSalesOrderId: number | null;
  externalSalesOrderCode: string | null;
  sourceSystem: string | null;
  totalNetValue: unknown;
  totalItems: number;
  totalCost: unknown;
  totalMarginValue: unknown;
  totalMarginPerc: unknown;
  updatedAt?: Date | string | null;
};

export type NomusSyncExistingItem = {
  id: string;
  productId: string;
  externalProductId: number | null;
  proposalItemId: string | null;
  skuSnapshot: string;
  productNameSnapshot: string;
  unit: string | null;
  unitCost: unknown;
  totalCost: unknown;
  marginValue: unknown;
  marginPerc: unknown;
  quantity: unknown;
  negotiatedPrice: unknown;
  totalNetValue: unknown;
  notes: string | null;
};

export type NomusSyncPlannedLine = {
  externalLineId: number | null;
  productId: string;
  externalProductId: number;
  proposalItemId: string | null;
  skuSnapshot: string;
  productNameSnapshot: string;
  unit: string | null;
  quantity: number;
  negotiatedPrice: number;
  totalNetValue: number;
  notes: string | null;
};

export type NomusSyncLineMatchInput = {
  externalLineId: number | null;
  productId: string;
  externalProductId: number;
  proposalItemId: string | null;
};

export type NomusSyncItemWriteRow = {
  id?: string;
  salesOrderId: string;
  proposalItemId: string | null;
  productId: string;
  externalProductId: number;
  skuSnapshot: string;
  productNameSnapshot: string;
  quantity: string;
  unit: string | null;
  unitCost: string;
  negotiatedPrice: string;
  totalNetValue: string;
  totalCost: string;
  marginValue: string;
  marginPerc: string;
  notes: string | null;
  stale?: boolean;
};

export type NomusSyncUpdatePreview = {
  externalSalesOrderId: number;
  codigoPedido: string;
  id: string;
  orderCodeBefore: string;
  totalNetValueBefore: number;
  totalNetValueAfter: number;
  itemCountBefore: number;
  itemCountAfter: number;
  changedHeaderTotals: boolean;
  changedItems: boolean;
};

function parseMoney(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function decimalString(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "0.000000";
}

/** Chave canônica para casar PD 02339, PD02339, PD-02339, 02339. */
export function expandNomusOrderCodeLookupVariants(codigoPedido: string): string[] {
  const variants = new Set<string>();
  const trimmed = codigoPedido.trim().replace(/\s+/g, " ");
  if (!trimmed) return [];
  variants.add(trimmed);
  const key = canonicalNomusOrderCodeKey(trimmed);
  if (key?.startsWith("PD:")) {
    const n = Number(key.slice(3));
    variants.add(`PD ${String(n).padStart(5, "0")}`);
    variants.add(`PD${String(n).padStart(5, "0")}`);
    variants.add(`PD-${String(n).padStart(5, "0")}`);
    variants.add(`PD ${n}`);
    variants.add(`PD${n}`);
    variants.add(String(n).padStart(5, "0"));
  }
  return [...variants];
}

/** Chave canônica para casar PD 02339, PD02339, PD-02339, 02339. */
export function canonicalNomusOrderCodeKey(code: string | null | undefined): string | null {
  if (!code?.trim()) return null;
  const normalized = code.trim().replace(/\s+/g, " ").toUpperCase();
  const pdMatch = normalized.match(/^PD[-\s]?(\d+)$/);
  if (pdMatch) {
    const n = Number.parseInt(pdMatch[1], 10);
    return Number.isFinite(n) ? `PD:${n}` : null;
  }
  const digitsOnly = normalized.match(/^(\d+)$/);
  if (digitsOnly) {
    const n = Number.parseInt(digitsOnly[1], 10);
    return Number.isFinite(n) ? `PD:${n}` : null;
  }
  return normalized.replace(/[\s-]+/g, "");
}

/** Formato estável de armazenamento alinhado à UI (PD 02339). */
export function normalizeNomusOrderCodeForStorage(codigoPedido: string): string {
  const key = canonicalNomusOrderCodeKey(codigoPedido);
  if (key?.startsWith("PD:")) {
    const n = Number(key.slice(3));
    return `PD ${String(n).padStart(5, "0")}`;
  }
  return codigoPedido.trim().replace(/\s+/g, " ");
}

export function extractNomusLineExternalId(item: Record<string, unknown>): number | null {
  const candidates = [item.id, item.idItemPedido, item.idItem, item.idLinha, item.idPedidoItem];
  for (const raw of candidates) {
    if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
    if (typeof raw === "string") {
      const parsed = Number.parseInt(raw.replace(/[^\d-]/g, ""), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function buildNomusSyncLineReconcileKey(line: NomusSyncLineMatchInput): string {
  if (line.externalLineId != null && line.externalLineId > 0) {
    return `line:${line.externalLineId}`;
  }
  return buildNomusSyncLineMatchKey({
    productId: line.productId,
    externalProductId: line.externalProductId,
    proposalItemId: line.proposalItemId,
  });
}

export function indexExistingSalesOrdersByNomusKey(
  rows: NomusSyncExistingSalesOrder[]
): {
  byExternalId: Map<number, NomusSyncExistingSalesOrder>;
  byOrderCodeKey: Map<string, NomusSyncExistingSalesOrder>;
} {
  const byExternalId = new Map<number, NomusSyncExistingSalesOrder>();
  const byOrderCodeKey = new Map<string, NomusSyncExistingSalesOrder>();

  for (const row of rows) {
    if (row.externalSalesOrderId != null) {
      const prev = byExternalId.get(row.externalSalesOrderId);
      if (!prev || row.sourceSystem === NOMUS_SALES_ORDER_SOURCE) {
        byExternalId.set(row.externalSalesOrderId, row);
      }
    }
    for (const code of [row.orderCode, row.externalSalesOrderCode]) {
      const key = canonicalNomusOrderCodeKey(code);
      if (!key) continue;
      const prev = byOrderCodeKey.get(key);
      if (!prev || row.sourceSystem === NOMUS_SALES_ORDER_SOURCE) {
        byOrderCodeKey.set(key, row);
      }
    }
  }

  return { byExternalId, byOrderCodeKey };
}

export function findExistingSalesOrderForNomusSync(
  indexes: {
    byExternalId: Map<number, NomusSyncExistingSalesOrder>;
    byOrderCodeKey: Map<string, NomusSyncExistingSalesOrder>;
  },
  plan: { externalSalesOrderId: number; codigoPedido: string }
): NomusSyncExistingSalesOrder | null {
  const byExt = indexes.byExternalId.get(plan.externalSalesOrderId);
  if (byExt) return byExt;

  const codeKey = canonicalNomusOrderCodeKey(plan.codigoPedido);
  if (codeKey) {
    const byCode = indexes.byOrderCodeKey.get(codeKey);
    if (byCode) return byCode;
  }

  return null;
}

/** Mescla campos comerciais do Nomus preservando totais de margem/custo do cabeçalho. */
export function mergeNomusSyncHeaderPreservingHistoricalCosts<T extends Record<string, unknown>>(
  nomusHeader: T,
  existing: Pick<NomusSyncExistingSalesOrder, "totalCost" | "totalMarginValue" | "totalMarginPerc">,
  isUpdate: boolean
): T {
  if (!isUpdate) return nomusHeader;
  return {
    ...nomusHeader,
    totalCost: existing.totalCost,
    totalMarginValue: existing.totalMarginValue,
    totalMarginPerc: existing.totalMarginPerc,
  };
}

function computeLineEconomics(
  quantity: number,
  totalNetValue: number,
  unitCost: number | null
): { totalCost: number; marginValue: number; marginPerc: number } {
  const resolvedUnitCost = unitCost != null && unitCost > 0 ? unitCost : null;
  if (resolvedUnitCost != null) {
    const totalCost = computeNomusSyncLineTotalCost(quantity, resolvedUnitCost);
    const marginValue = totalNetValue - totalCost;
    const marginPerc = totalNetValue > 0 ? (marginValue / totalNetValue) * 100 : 0;
    return { totalCost, marginValue, marginPerc };
  }

  return {
    totalCost: 0,
    marginValue: totalNetValue,
    marginPerc: totalNetValue > 0 ? 100 : 0,
  };
}

function appendStaleNote(notes: string | null): string {
  if (!notes?.trim()) return STALE_LINE_NOTE;
  if (notes.includes(STALE_LINE_NOTE)) return notes;
  return `${notes.trim()} | ${STALE_LINE_NOTE}`;
}

function takeExistingItem(
  pool: Map<string, NomusSyncExistingItem[]>,
  key: string
): NomusSyncExistingItem | null {
  const list = pool.get(key);
  if (!list?.length) return null;
  return list.shift() ?? null;
}

function pushExistingItem(
  pool: Map<string, NomusSyncExistingItem[]>,
  key: string,
  item: NomusSyncExistingItem
): void {
  const list = pool.get(key) ?? [];
  list.push(item);
  pool.set(key, list);
}

function buildExistingItemPool(items: NomusSyncExistingItem[]): Map<string, NomusSyncExistingItem[]> {
  const pool = new Map<string, NomusSyncExistingItem[]>();
  for (const item of items) {
    if (item.externalProductId == null) continue;
    const key = buildNomusSyncLineReconcileKey({
      externalLineId: null,
      productId: item.productId,
      externalProductId: item.externalProductId,
      proposalItemId: item.proposalItemId,
    });
    pushExistingItem(pool, key, item);
  }
  return pool;
}

export function buildNomusSyncItemWritePlan(input: {
  salesOrderId: string;
  plannedLines: NomusSyncPlannedLine[];
  existingItems: NomusSyncExistingItem[];
  resolveUnitCost: (line: NomusSyncPlannedLine) => UnitCostSnapshotResult;
}): {
  upserts: NomusSyncItemWriteRow[];
  creates: NomusSyncItemWriteRow[];
  staleUpdates: NomusSyncItemWriteRow[];
} {
  const pool = buildExistingItemPool(input.existingItems);
  const upserts: NomusSyncItemWriteRow[] = [];
  const creates: NomusSyncItemWriteRow[] = [];

  for (const line of input.plannedLines) {
    const reconcileKey = buildNomusSyncLineReconcileKey(line);
    let matched = takeExistingItem(pool, reconcileKey);

    if (!matched) {
      const productKey = buildNomusSyncLineMatchKey({
        productId: line.productId,
        externalProductId: line.externalProductId,
        proposalItemId: line.proposalItemId,
      });
      matched = takeExistingItem(pool, productKey);
    }

    if (!matched && line.proposalItemId) {
      const altKey = buildNomusSyncLineMatchKey({
        productId: line.productId,
        externalProductId: line.externalProductId,
        proposalItemId: null,
      });
      matched = takeExistingItem(pool, altKey);
    }

    const snapshot = input.resolveUnitCost(line);
    const unitCost = snapshot.unitCost;
    const economics = computeLineEconomics(line.quantity, line.totalNetValue, unitCost);

    const row: NomusSyncItemWriteRow = {
      id: matched?.id,
      salesOrderId: input.salesOrderId,
      proposalItemId: line.proposalItemId,
      productId: line.productId,
      externalProductId: line.externalProductId,
      skuSnapshot: line.skuSnapshot,
      productNameSnapshot: line.productNameSnapshot,
      quantity: decimalString(line.quantity),
      unit: line.unit,
      unitCost: formatNomusSyncUnitCostDecimal(unitCost),
      negotiatedPrice: decimalString(line.negotiatedPrice),
      totalNetValue: decimalString(line.totalNetValue),
      totalCost: decimalString(economics.totalCost),
      marginValue: decimalString(economics.marginValue),
      marginPerc: decimalString(economics.marginPerc),
      notes: line.notes,
    };

    if (matched) upserts.push(row);
    else creates.push(row);
  }

  const staleUpdates: NomusSyncItemWriteRow[] = [];
  for (const leftovers of pool.values()) {
    for (const item of leftovers) {
      if (item.externalProductId == null) continue;
      const unitCost = parseNomusSyncStoredUnitCost(item.unitCost);
      staleUpdates.push({
        id: item.id,
        salesOrderId: input.salesOrderId,
        proposalItemId: item.proposalItemId,
        productId: item.productId,
        externalProductId: item.externalProductId,
        skuSnapshot: item.skuSnapshot,
        productNameSnapshot: item.productNameSnapshot,
        quantity: decimalString(0),
        unit: item.unit,
        unitCost: formatNomusSyncUnitCostDecimal(unitCost),
        negotiatedPrice: decimalString(0),
        totalNetValue: decimalString(0),
        totalCost: decimalString(0),
        marginValue: decimalString(0),
        marginPerc: decimalString(0),
        notes: appendStaleNote(item.notes),
        stale: true,
      });
    }
  }

  return { upserts, creates, staleUpdates };
}

export function buildNomusSyncUpdatePreview(
  existing: NomusSyncExistingSalesOrder,
  plan: { externalSalesOrderId: number; codigoPedido: string; totalNetValue: number; lineCount: number }
): NomusSyncUpdatePreview {
  const totalNetValueBefore = parseMoney(existing.totalNetValue);
  const totalNetValueAfter = plan.totalNetValue;
  const itemCountBefore = existing.totalItems;
  const itemCountAfter = plan.lineCount;

  return {
    externalSalesOrderId: plan.externalSalesOrderId,
    codigoPedido: plan.codigoPedido,
    id: existing.id,
    orderCodeBefore: existing.orderCode,
    totalNetValueBefore,
    totalNetValueAfter,
    itemCountBefore,
    itemCountAfter,
    changedHeaderTotals:
      Math.abs(totalNetValueBefore - totalNetValueAfter) > 0.000001 ||
      itemCountBefore !== itemCountAfter,
    changedItems: itemCountBefore !== itemCountAfter,
  };
}

export function sumSalesOrderItemsNetValue(items: Array<{ totalNetValue: unknown }>): number {
  return items.reduce((sum, item) => sum + parseMoney(item.totalNetValue), 0);
}

export function detectSalesOrderHeaderItemDrift(
  headerTotalNetValue: unknown,
  items: Array<{ totalNetValue: unknown }>,
  tolerance = 0.01
): { itemsSum: number; headerTotal: number; drift: number; hasDrift: boolean } {
  const itemsSum = sumSalesOrderItemsNetValue(items);
  const headerTotal = parseMoney(headerTotalNetValue);
  const drift = headerTotal - itemsSum;
  return {
    itemsSum,
    headerTotal,
    drift,
    hasDrift: Math.abs(drift) > tolerance,
  };
}
