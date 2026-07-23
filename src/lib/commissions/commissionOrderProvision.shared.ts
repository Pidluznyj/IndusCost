/**
 * Provisão / acumulado de comissão por pedido (snapshot oficial).
 * Não usa settlementDate nem ledger de fechamento por título.
 *
 * Fórmula canônica (já materializada):
 * totalFinalCommissionAmount = Σ CommissionOrderItemSnapshot.finalCommissionAmount
 * Cliente excluído → final do item = 0 (reflete no total do pedido).
 */

export type CommissionOrderProvisionQuery = {
  year: number | null;
  month: number | null;
  from: string | null;
  to: string | null;
  canonicalSellerId: string | null;
  rawSellerId: number | null;
  customer: string | null;
  orderCode: string | null;
  includeZeroCommission: boolean;
  page: number;
  pageSize: number;
};

export type CommissionOrderProvisionRow = {
  salesOrderId: string;
  orderCode: string | null;
  saleDate: string;
  customerName: string;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  rawSellerName: string | null;
  nfeIds: number[];
  snapshotCount: number;
  totalSoldAmount: number;
  totalGrossCommissionAmount: number;
  totalFinalCommissionAmount: number;
  hasCustomerExcludedItems: boolean;
  snapshotIds: string[];
};

export type CommissionOrderProvisionSellerCard = {
  key: string;
  canonicalSellerId: string | null;
  sellerName: string;
  orderCount: number;
  totalFinalCommissionAmount: number;
};

export type CommissionOrderProvisionCards = {
  orderCount: number;
  snapshotCount: number;
  totalSoldAmount: number;
  totalGrossCommissionAmount: number;
  totalFinalCommissionAmount: number;
  zeroCommissionOrderCount: number;
  sellers: CommissionOrderProvisionSellerCard[];
};

export type CommissionOrderProvisionPayload = {
  source: "COMMISSION_ORDER_SNAPSHOT_ACTIVE";
  periodLabel: string;
  filters: CommissionOrderProvisionQuery;
  cards: CommissionOrderProvisionCards;
  rows: CommissionOrderProvisionRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  message: string | null;
};

function asTrimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function asInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

function asUuid(value: unknown): string | null {
  const t = asTrimmed(value);
  if (!t) return null;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      t
    )
  ) {
    return null;
  }
  return t;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const t = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "sim"].includes(t)) return true;
  if (["0", "false", "no", "nao", "não"].includes(t)) return false;
  return fallback;
}

function clampPage(value: number | null, fallback: number): number {
  if (value == null || value < 1) return fallback;
  return value;
}

function clampPageSize(value: number | null): number {
  if (value == null || value < 1) return 50;
  return Math.min(200, value);
}

export function parseCommissionOrderProvisionQuery(
  query: Record<string, unknown>
): CommissionOrderProvisionQuery {
  const now = new Date();
  const yearRaw = asInt(query.year);
  const monthRaw = asInt(query.month);
  const from = asTrimmed(query.from);
  const to = asTrimmed(query.to);
  const hasExplicitRange = Boolean(from || to || yearRaw != null || monthRaw != null);

  return {
    year: yearRaw ?? (hasExplicitRange ? null : now.getFullYear()),
    month:
      monthRaw != null && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : null,
    from,
    to,
    canonicalSellerId: asUuid(query.canonicalSellerId),
    rawSellerId: asInt(query.rawSellerId ?? query.sellerId),
    customer: asTrimmed(query.customer ?? query.customerName),
    orderCode: asTrimmed(query.orderCode ?? query.order),
    includeZeroCommission: asBool(query.includeZeroCommission, false),
    page: clampPage(asInt(query.page), 1),
    pageSize: clampPageSize(asInt(query.pageSize)),
  };
}

export function resolveCommissionOrderProvisionSaleDateBounds(
  query: CommissionOrderProvisionQuery
): { gte: Date; lte: Date } | null {
  if (query.from || query.to) {
    const gte = query.from
      ? new Date(`${query.from}T00:00:00.000`)
      : new Date(2000, 0, 1);
    const lte = query.to
      ? new Date(`${query.to}T23:59:59.999`)
      : new Date(2099, 11, 31, 23, 59, 59, 999);
    return { gte, lte };
  }
  if (query.year != null && query.month != null) {
    const gte = new Date(query.year, query.month - 1, 1, 0, 0, 0, 0);
    const lte = new Date(query.year, query.month, 0, 23, 59, 59, 999);
    return { gte, lte };
  }
  if (query.year != null) {
    return {
      gte: new Date(query.year, 0, 1, 0, 0, 0, 0),
      lte: new Date(query.year, 11, 31, 23, 59, 59, 999),
    };
  }
  return null;
}

export function formatCommissionOrderProvisionPeriodLabel(
  query: CommissionOrderProvisionQuery
): string {
  if (query.from || query.to) {
    return `${query.from ?? "…"} → ${query.to ?? "…"}`;
  }
  if (query.year != null && query.month != null) {
    return `${String(query.month).padStart(2, "0")}/${query.year}`;
  }
  if (query.year != null) return `Ano ${query.year}`;
  return "Todo o histórico materializado";
}

export type CommissionOrderProvisionSnapshotInput = {
  id: string;
  salesOrderId: string;
  orderCode: string | null;
  saleDate: Date | string;
  customerNameSnapshot: string;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  rawSellerName: string | null;
  nfeId: number | null;
  totalSoldAmount: number;
  totalGrossCommissionAmount: number;
  totalFinalCommissionAmount: number;
  hasCustomerExcludedItems: boolean;
};

function toIsoDate(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function money(value: number): number {
  return Number(value.toFixed(2));
}

/**
 * Agrega snapshots ACTIVE por pedido (soma das comissões finais = due do pedido).
 */
export function aggregateCommissionOrderProvisionRows(
  snapshots: ReadonlyArray<CommissionOrderProvisionSnapshotInput>
): CommissionOrderProvisionRow[] {
  const byOrder = new Map<string, CommissionOrderProvisionRow>();

  for (const snap of snapshots) {
    const existing = byOrder.get(snap.salesOrderId);
    if (!existing) {
      byOrder.set(snap.salesOrderId, {
        salesOrderId: snap.salesOrderId,
        orderCode: snap.orderCode,
        saleDate: toIsoDate(snap.saleDate),
        customerName: snap.customerNameSnapshot,
        canonicalSellerId: snap.canonicalSellerId,
        canonicalSellerName: snap.canonicalSellerName,
        rawSellerId: snap.rawSellerId,
        rawSellerName: snap.rawSellerName,
        nfeIds: snap.nfeId != null ? [snap.nfeId] : [],
        snapshotCount: 1,
        totalSoldAmount: money(snap.totalSoldAmount),
        totalGrossCommissionAmount: money(snap.totalGrossCommissionAmount),
        totalFinalCommissionAmount: money(snap.totalFinalCommissionAmount),
        hasCustomerExcludedItems: snap.hasCustomerExcludedItems,
        snapshotIds: [snap.id],
      });
      continue;
    }

    existing.snapshotCount += 1;
    existing.totalSoldAmount = money(
      existing.totalSoldAmount + snap.totalSoldAmount
    );
    existing.totalGrossCommissionAmount = money(
      existing.totalGrossCommissionAmount + snap.totalGrossCommissionAmount
    );
    existing.totalFinalCommissionAmount = money(
      existing.totalFinalCommissionAmount + snap.totalFinalCommissionAmount
    );
    existing.hasCustomerExcludedItems =
      existing.hasCustomerExcludedItems || snap.hasCustomerExcludedItems;
    existing.snapshotIds.push(snap.id);
    if (snap.nfeId != null && !existing.nfeIds.includes(snap.nfeId)) {
      existing.nfeIds.push(snap.nfeId);
    }
    const nextSale = toIsoDate(snap.saleDate);
    if (nextSale > existing.saleDate) existing.saleDate = nextSale;
    if (!existing.orderCode && snap.orderCode) existing.orderCode = snap.orderCode;
    if (!existing.canonicalSellerName && snap.canonicalSellerName) {
      existing.canonicalSellerId = snap.canonicalSellerId;
      existing.canonicalSellerName = snap.canonicalSellerName;
    }
  }

  return [...byOrder.values()].sort((a, b) => {
    if (a.saleDate !== b.saleDate) return a.saleDate < b.saleDate ? 1 : -1;
    return (a.orderCode ?? a.salesOrderId).localeCompare(
      b.orderCode ?? b.salesOrderId,
      "pt-BR"
    );
  });
}

export function buildCommissionOrderProvisionCards(
  rows: ReadonlyArray<CommissionOrderProvisionRow>
): CommissionOrderProvisionCards {
  const sellersMap = new Map<string, CommissionOrderProvisionSellerCard>();
  let totalSold = 0;
  let totalGross = 0;
  let totalFinal = 0;
  let zeroCount = 0;
  let snapshotCount = 0;

  for (const row of rows) {
    totalSold += row.totalSoldAmount;
    totalGross += row.totalGrossCommissionAmount;
    totalFinal += row.totalFinalCommissionAmount;
    snapshotCount += row.snapshotCount;
    if (row.totalFinalCommissionAmount <= 0.009) zeroCount += 1;

    const key =
      row.canonicalSellerId ??
      (row.rawSellerId != null ? `raw:${row.rawSellerId}` : "sem-vendedor");
    const name =
      row.canonicalSellerName?.trim() ||
      row.rawSellerName?.trim() ||
      "Sem vendedor";
    const prev = sellersMap.get(key);
    if (!prev) {
      sellersMap.set(key, {
        key,
        canonicalSellerId: row.canonicalSellerId,
        sellerName: name,
        orderCount: 1,
        totalFinalCommissionAmount: money(row.totalFinalCommissionAmount),
      });
    } else {
      prev.orderCount += 1;
      prev.totalFinalCommissionAmount = money(
        prev.totalFinalCommissionAmount + row.totalFinalCommissionAmount
      );
    }
  }

  const sellers = [...sellersMap.values()].sort(
    (a, b) => b.totalFinalCommissionAmount - a.totalFinalCommissionAmount
  );

  return {
    orderCount: rows.length,
    snapshotCount,
    totalSoldAmount: money(totalSold),
    totalGrossCommissionAmount: money(totalGross),
    totalFinalCommissionAmount: money(totalFinal),
    zeroCommissionOrderCount: zeroCount,
    sellers,
  };
}

export function paginateCommissionOrderProvisionRows(
  rows: ReadonlyArray<CommissionOrderProvisionRow>,
  page: number,
  pageSize: number
): {
  rows: CommissionOrderProvisionRow[];
  pagination: CommissionOrderProvisionPayload["pagination"];
} {
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    pagination: {
      page: safePage,
      pageSize,
      totalRows,
      totalPages,
    },
  };
}

export function assembleCommissionOrderProvisionPayload(input: {
  query: CommissionOrderProvisionQuery;
  snapshots: ReadonlyArray<CommissionOrderProvisionSnapshotInput>;
}): CommissionOrderProvisionPayload {
  let rows = aggregateCommissionOrderProvisionRows(input.snapshots);
  if (!input.query.includeZeroCommission) {
    rows = rows.filter((r) => r.totalFinalCommissionAmount > 0.009);
  }
  const cards = buildCommissionOrderProvisionCards(rows);
  const page = paginateCommissionOrderProvisionRows(
    rows,
    input.query.page,
    input.query.pageSize
  );

  return {
    source: "COMMISSION_ORDER_SNAPSHOT_ACTIVE",
    periodLabel: formatCommissionOrderProvisionPeriodLabel(input.query),
    filters: input.query,
    cards,
    rows: page.rows,
    pagination: page.pagination,
    message:
      rows.length === 0
        ? "Nenhum pedido com snapshot ACTIVE de comissão no período."
        : null,
  };
}
