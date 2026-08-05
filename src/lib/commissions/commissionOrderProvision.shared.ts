/**
 * Provisão / acumulado de comissão por pedido (snapshot oficial).
 * Não usa settlementDate nem ledger de fechamento por título.
 *
 * Fórmula canônica (já materializada):
 * totalFinalCommissionAmount = Σ CommissionOrderItemSnapshot.finalCommissionAmount
 * Cliente excluído → final do item = 0 (reflete no total do pedido).
 */

import {
  formatCommissionReportMonthsLabel,
  type CommissionReportsMonthsFilter,
} from "./commissionReports.shared.js";

export type CommissionOrderProvisionMonthsFilter = CommissionReportsMonthsFilter;

export type CommissionOrderProvisionQuery = {
  year: number | null;
  /** @deprecated Preferir `months`. Mantido para compatibilidade de resposta. */
  month: number | null;
  months: CommissionOrderProvisionMonthsFilter;
  from: string | null;
  to: string | null;
  canonicalSellerId: string | null;
  rawSellerId: number | null;
  customer: string | null;
  orderCode: string | null;
  includeZeroCommission: boolean;
  /**
   * Quando `true`, o backend devolve SOMENTE pedidos com
   * `totalFinalCommissionAmount ≤ 0` (comissão zerada — normalmente cliente
   * excluído, snapshot com regra sem base, ou rateio anulado). É mutuamente
   * exclusivo com `includeZeroCommission`: se `onlyZeroCommission=true`, o
   * `includeZeroCommission` é ignorado (o resultado só tem zeros por
   * definição). Útil para o gestor auditar quais pedidos ficaram sem comissão
   * e por quê.
   */
  onlyZeroCommission: boolean;
  page: number;
  pageSize: number;
};

export type CommissionOrderProvisionSellerOption = {
  value: string;
  label: string;
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
  sellerOptions: CommissionOrderProvisionSellerOption[];
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

/**
 * Parsing canônico de months.
 * - `months` tem precedência sobre `month` legado quando presente (mesmo vazio/"all").
 * - Tokens inválidos (0, 13, abc) são descartados; se nada válido restar → `all`.
 * - Duplicados são removidos; ordem sempre ascendente 1..12.
 */
function parseMonthsFilter(query: Record<string, unknown>): CommissionOrderProvisionMonthsFilter {
  const hasMonthsKey = Object.prototype.hasOwnProperty.call(query, "months");
  if (hasMonthsKey) {
    const monthsRaw = query.months;
    if (monthsRaw == null || monthsRaw === "") return "all";
    if (monthsRaw === "all") return "all";
    if (Array.isArray(monthsRaw)) {
      if (monthsRaw.length === 0) return "all";
      const parsed = monthsRaw
        .map((item) => asInt(item))
        .filter((n): n is number => n != null && n >= 1 && n <= 12);
      const unique = [...new Set(parsed)].sort((a, b) => a - b);
      if (unique.length === 0 || unique.length === 12) return "all";
      return unique;
    }
    if (typeof monthsRaw === "string") {
      const trimmed = monthsRaw.trim();
      if (!trimmed || trimmed.toLowerCase() === "all") return "all";
      const parsed = trimmed
        .split(/[,\s]+/)
        .filter(Boolean)
        .map((part) => asInt(part))
        .filter((n): n is number => n != null && n >= 1 && n <= 12);
      const unique = [...new Set(parsed)].sort((a, b) => a - b);
      if (unique.length === 0 || unique.length === 12) return "all";
      return unique;
    }
    return "all";
  }

  const monthRaw = asInt(query.month);
  if (monthRaw != null && monthRaw >= 1 && monthRaw <= 12) return [monthRaw];
  return "all";
}

export function resolveCommissionOrderProvisionMonths(
  months: CommissionOrderProvisionMonthsFilter
): number[] {
  if (months === "all" || (Array.isArray(months) && months.length === 0)) {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  }
  return [...new Set(months.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort(
    (a, b) => a - b
  );
}

export function isCommissionOrderProvisionAllMonths(
  months: CommissionOrderProvisionMonthsFilter
): boolean {
  if (months === "all") return true;
  return resolveCommissionOrderProvisionMonths(months).length === 12;
}

export function parseCommissionOrderProvisionQuery(
  query: Record<string, unknown>
): CommissionOrderProvisionQuery {
  const now = new Date();
  const yearRaw = asInt(query.year);
  const from = asTrimmed(query.from);
  const to = asTrimmed(query.to);
  const months = parseMonthsFilter(query);
  const hasExplicitRange = Boolean(
    from || to || yearRaw != null || query.months != null || query.month != null
  );

  const resolvedMonths = isCommissionOrderProvisionAllMonths(months)
    ? ("all" as const)
    : resolveCommissionOrderProvisionMonths(months);
  const legacyMonth =
    Array.isArray(resolvedMonths) && resolvedMonths.length === 1
      ? resolvedMonths[0]!
      : null;

  // sellerId no padrão Relatórios = CommissionPerson.id (canonical)
  const sellerIdRaw = asTrimmed(query.sellerId);
  const canonicalFromSellerId =
    sellerIdRaw && sellerIdRaw !== "all" ? asUuid(sellerIdRaw) : null;

  return {
    year: yearRaw ?? (hasExplicitRange ? null : now.getFullYear()),
    month: legacyMonth,
    months: resolvedMonths,
    from,
    to,
    canonicalSellerId: asUuid(query.canonicalSellerId) ?? canonicalFromSellerId,
    rawSellerId: asInt(query.rawSellerId),
    customer: asTrimmed(query.customer ?? query.customerName),
    orderCode: asTrimmed(query.orderCode ?? query.order),
    includeZeroCommission: asBool(query.includeZeroCommission, false),
    onlyZeroCommission: asBool(query.onlyZeroCommission, false),
    page: clampPage(asInt(query.page), 1),
    pageSize: clampPageSize(asInt(query.pageSize)),
  };
}

/** Intervalo contínuo (from/to, ano inteiro ou um único mês). */
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
  if (query.year == null) return null;

  if (isCommissionOrderProvisionAllMonths(query.months)) {
    return {
      gte: new Date(query.year, 0, 1, 0, 0, 0, 0),
      lte: new Date(query.year, 11, 31, 23, 59, 59, 999),
    };
  }

  const months = resolveCommissionOrderProvisionMonths(query.months);
  if (months.length === 1) {
    const m = months[0]!;
    return {
      gte: new Date(query.year, m - 1, 1, 0, 0, 0, 0),
      lte: new Date(query.year, m, 0, 23, 59, 59, 999),
    };
  }

  // Vários meses (possivelmente não contíguos): envelope para pré-filtro;
  // o server aplica OR mensal exato.
  const min = months[0]!;
  const max = months[months.length - 1]!;
  return {
    gte: new Date(query.year, min - 1, 1, 0, 0, 0, 0),
    lte: new Date(query.year, max, 0, 23, 59, 59, 999),
  };
}

/** Faixas mensais exatas (para OR Prisma quando há 2+ meses selecionados). */
export function resolveCommissionOrderProvisionMonthRanges(
  query: CommissionOrderProvisionQuery
): Array<{ gte: Date; lte: Date }> | null {
  if (query.from || query.to || query.year == null) return null;
  if (isCommissionOrderProvisionAllMonths(query.months)) return null;
  const months = resolveCommissionOrderProvisionMonths(query.months);
  if (months.length <= 1) return null;
  return months.map((m) => ({
    gte: new Date(query.year!, m - 1, 1, 0, 0, 0, 0),
    lte: new Date(query.year!, m, 0, 23, 59, 59, 999),
  }));
}

/**
 * Filtro efetivo de saleDate usado pelo server:
 * - `or_months`: OR de intervalos independentes (nunca envelope contínuo);
 * - `range`: ano inteiro, um mês, ou from/to.
 */
export function resolveCommissionOrderProvisionSaleDateFilter(
  query: CommissionOrderProvisionQuery
):
  | { kind: "none" }
  | { kind: "range"; gte: Date; lte: Date }
  | { kind: "or_months"; ranges: Array<{ gte: Date; lte: Date }> } {
  const monthRanges = resolveCommissionOrderProvisionMonthRanges(query);
  if (monthRanges) return { kind: "or_months", ranges: monthRanges };
  const bounds = resolveCommissionOrderProvisionSaleDateBounds(query);
  if (!bounds) return { kind: "none" };
  return { kind: "range", gte: bounds.gte, lte: bounds.lte };
}

/** Chip ativo ↔ select (fonte: sellerId canônico ou rawSellerId do chip). */
export function isCommissionOrderProvisionSellerChipActive(input: {
  seller: { key: string; canonicalSellerId: string | null };
  sellerId: string;
  selectedSellerKey: string | null;
  selectedRawSellerId: number | null;
}): boolean {
  const { seller, sellerId, selectedSellerKey, selectedRawSellerId } = input;
  if (selectedSellerKey != null && selectedSellerKey === seller.key) return true;
  if (
    sellerId !== "all" &&
    seller.canonicalSellerId != null &&
    seller.canonicalSellerId === sellerId
  ) {
    return true;
  }
  if (
    selectedRawSellerId != null &&
    seller.key === `raw:${selectedRawSellerId}`
  ) {
    return true;
  }
  return false;
}

/** Query string do frontend — nunca envia `month` legado nem months contraditórios. */
export function buildCommissionOrderProvisionClientQuery(input: {
  year: string;
  months: CommissionOrderProvisionMonthsFilter;
  sellerId: string;
  selectedRawSellerId: number | null;
  customer: string;
  orderCode: string;
  includeZeroCommission: boolean;
  onlyZeroCommission?: boolean;
  page: number;
  pageSize?: number;
}): string {
  const params = new URLSearchParams();
  if (input.year) params.set("year", input.year);
  if (
    input.months === "all" ||
    (Array.isArray(input.months) && input.months.length === 0)
  ) {
    params.set("months", "all");
  } else {
    const normalized = resolveCommissionOrderProvisionMonths(input.months);
    params.set(
      "months",
      normalized.length === 12 ? "all" : normalized.join(",")
    );
  }
  if (input.customer.trim()) params.set("customer", input.customer.trim());
  if (input.orderCode.trim()) params.set("orderCode", input.orderCode.trim());
  if (input.includeZeroCommission) params.set("includeZeroCommission", "true");
  if (input.onlyZeroCommission) params.set("onlyZeroCommission", "true");
  if (input.sellerId && input.sellerId !== "all") {
    params.set("canonicalSellerId", input.sellerId);
    params.set("sellerId", input.sellerId);
  } else if (input.selectedRawSellerId != null) {
    params.set("rawSellerId", String(input.selectedRawSellerId));
  }
  params.set("page", String(Math.max(1, input.page)));
  params.set("pageSize", String(input.pageSize ?? 50));
  return params.toString();
}

export function formatCommissionOrderProvisionPeriodLabel(
  query: CommissionOrderProvisionQuery
): string {
  if (query.from || query.to) {
    return `${query.from ?? "…"} → ${query.to ?? "…"}`;
  }
  if (query.year != null) {
    const monthsLabel = formatCommissionReportMonthsLabel(query.months);
    if (isCommissionOrderProvisionAllMonths(query.months)) {
      return `Ano ${query.year}`;
    }
    return `${monthsLabel} / ${query.year}`;
  }
  return "Todo o histórico materializado";
}

export function buildCommissionOrderProvisionSellerOptions(
  sellers: ReadonlyArray<CommissionOrderProvisionSellerCard>
): CommissionOrderProvisionSellerOption[] {
  const options: CommissionOrderProvisionSellerOption[] = [
    { value: "all", label: "Todos os vendedores" },
  ];
  const seen = new Set(["all"]);
  for (const seller of sellers) {
    const value = seller.canonicalSellerId ?? seller.key;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: seller.sellerName });
  }
  return options;
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
  if (input.query.onlyZeroCommission) {
    // Filtro exclusivo: SÓ pedidos com comissão final zerada (rateio anulado,
    // cliente excluído, snapshot sem base). Ignora `includeZeroCommission`
    // por definição — o resultado já é composto só de zeros.
    rows = rows.filter((r) => r.totalFinalCommissionAmount <= 0.009);
  } else if (!input.query.includeZeroCommission) {
    rows = rows.filter((r) => r.totalFinalCommissionAmount > 0.009);
  }
  const cards = buildCommissionOrderProvisionCards(rows);
  const sellerOptions = buildCommissionOrderProvisionSellerOptions(cards.sellers);
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
    sellerOptions,
    rows: page.rows,
    pagination: page.pagination,
    message:
      rows.length === 0
        ? "Nenhum pedido com snapshot ACTIVE de comissão no período."
        : null,
  };
}
