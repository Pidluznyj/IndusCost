/**
 * Parse compartilhado dos parâmetros da listagem Comercial de Pedidos de Venda.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { loadCommissionSellerIdentityContext } from "./commissions/commissionSellerIdentity.server.js";
import {
  buildSalesOrderNomusSellerWhereFilter,
  buildSalesOrderNomusSellerWhereFromSellerKey,
  buildSalesOrderSellerFilterOptionLabel,
  buildSalesOrderSellerKey,
  parseSalesOrderSellerKey,
  type ParsedSalesOrderSellerKey,
  type SalesOrderSellerFilterOption,
} from "./salesOrderNomusSellerDisplay.js";
import {
  buildSalesOrderListWhere,
  isValidSalesOrderListStatus,
} from "./salesOrdersListSummary.js";
import {
  parseSalesOrderMonthParam,
  parseSalesOrderYearParam,
} from "./salesOrderPeriodFilter.js";
import {
  andSalesOrderListWhere,
  parseSalesOrderListReceivableStatusParam,
  resolveSalesOrderListReceivableStatusWhere,
  type SalesOrderListReceivableStatus,
} from "./salesOrderListReceivableFilter.js";

export type SalesOrderListQuery = {
  status: string;
  customerId: string;
  sellerKeyRaw: string;
  sellerKey: ParsedSalesOrderSellerKey;
  sellerText: string;
  startDate: Date | null;
  endDate: Date | null;
  year: number | null;
  month: number | null;
  q: string;
  /** `true` = Com NF; `false` = Sem NF; `null` = Todos. */
  hasInvoice: boolean | null;
  /** Status de CR oficial via NF: open | settled | none. */
  receivableStatus: SalesOrderListReceivableStatus | null;
  page: number;
  pageSize: number;
};

function parseDateQueryStart(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(`${value.trim()}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseDateQueryEnd(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(`${value.trim()}T23:59:59.999`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parsePositiveIntQuery(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.trunc(n);
}

/** Aceita `true`/`false` (e 1/0) da query string; vazio = todos. */
export function parseSalesOrderListHasInvoiceParam(
  value: unknown
): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const token = value.trim().toLowerCase();
  if (token === "true" || token === "1") return true;
  if (token === "false" || token === "0") return false;
  return null;
}

export function parseSalesOrderListQuery(query: Record<string, unknown>): SalesOrderListQuery {
  const sellerKeyRaw = String(query.sellerKey ?? "").trim();
  return {
    status: String(query.status ?? "").trim(),
    customerId: String(query.customerId ?? "").trim(),
    sellerKeyRaw,
    sellerKey: parseSalesOrderSellerKey(sellerKeyRaw),
    sellerText: String(query.seller ?? query.responsible ?? "").trim(),
    startDate: parseDateQueryStart(query.startDate),
    endDate: parseDateQueryEnd(query.endDate),
    year: parseSalesOrderYearParam(query.year),
    month: parseSalesOrderMonthParam(query.month),
    q: String(query.q ?? "").trim(),
    hasInvoice: parseSalesOrderListHasInvoiceParam(query.hasInvoice),
    receivableStatus: parseSalesOrderListReceivableStatusParam(
      query.receivableStatus
    ),
    page: parsePositiveIntQuery(query.page, 1),
    pageSize: Math.min(parsePositiveIntQuery(query.pageSize, 20), 100),
  };
}

export async function resolveSalesOrderListSellerWhere(
  prisma: PrismaClient,
  input: { sellerKeyRaw: string; sellerText: string }
): Promise<Prisma.SalesOrderWhereInput | null> {
  const sellerKeyWhere = buildSalesOrderNomusSellerWhereFromSellerKey(input.sellerKeyRaw);
  if (sellerKeyWhere !== null) return sellerKeyWhere;
  if (!input.sellerText) return null;
  const ctx = await loadCommissionSellerIdentityContext(prisma);
  return buildSalesOrderNomusSellerWhereFilter(input.sellerText, ctx);
}

export function buildSalesOrderListWhereForQuery(
  query: SalesOrderListQuery,
  sellerWhere: Prisma.SalesOrderWhereInput | null,
  options?: { env?: Record<string, string | undefined>; includeConfirmedMissing?: boolean }
): Prisma.SalesOrderWhereInput {
  const useLegacySellerText = query.sellerKey.kind === "all" && query.sellerText;
  return buildSalesOrderListWhere(
    {
      status:
        query.status && isValidSalesOrderListStatus(query.status) ? query.status : undefined,
      customerId: query.customerId || undefined,
      seller: useLegacySellerText ? query.sellerText : undefined,
      sellerWhere,
      startDate: query.startDate,
      endDate: query.endDate,
      year: query.year,
      month: query.month,
      q: query.q || undefined,
      hasInvoice: query.hasInvoice,
    },
    options
  );
}

/**
 * Where completo da listagem (filtros sync + status de CR via NF + presença operacional).
 * Mesma população alimenta linhas, count, cards e exportações.
 */
export async function resolveSalesOrderListWhere(
  prisma: PrismaClient,
  query: SalesOrderListQuery,
  sellerWhere: Prisma.SalesOrderWhereInput | null,
  options?: { env?: Record<string, string | undefined>; includeConfirmedMissing?: boolean }
): Promise<Prisma.SalesOrderWhereInput> {
  const base = buildSalesOrderListWhereForQuery(query, sellerWhere, options);
  const receivableWhere = await resolveSalesOrderListReceivableStatusWhere(
    prisma,
    query.receivableStatus
  );
  return andSalesOrderListWhere(base, receivableWhere);
}

/** Where da listagem sem filtro de vendedor (opções do select). */
export function buildSalesOrderListWhereExcludingSeller(
  query: SalesOrderListQuery,
  options?: { env?: Record<string, string | undefined>; includeConfirmedMissing?: boolean }
): Prisma.SalesOrderWhereInput {
  return buildSalesOrderListWhere(
    {
      status:
        query.status && isValidSalesOrderListStatus(query.status) ? query.status : undefined,
      customerId: query.customerId || undefined,
      startDate: query.startDate,
      endDate: query.endDate,
      year: query.year,
      month: query.month,
      q: query.q || undefined,
      hasInvoice: query.hasInvoice,
    },
    options
  );
}

export async function resolveSalesOrderListWhereExcludingSeller(
  prisma: PrismaClient,
  query: SalesOrderListQuery,
  options?: { env?: Record<string, string | undefined>; includeConfirmedMissing?: boolean }
): Promise<Prisma.SalesOrderWhereInput> {
  const base = buildSalesOrderListWhereExcludingSeller(query, options);
  const receivableWhere = await resolveSalesOrderListReceivableStatusWhere(
    prisma,
    query.receivableStatus
  );
  return andSalesOrderListWhere(base, receivableWhere);
}

export async function loadSalesOrderSellerFilterOptions(
  prisma: PrismaClient,
  query: Record<string, unknown>
): Promise<SalesOrderSellerFilterOption[]> {
  const parsed = parseSalesOrderListQuery(query);
  const where = await resolveSalesOrderListWhereExcludingSeller(prisma, parsed);
  const groups = await prisma.salesOrder.groupBy({
    by: ["externalSellerId"],
    where,
    _count: { _all: true },
  });
  const ctx = await loadCommissionSellerIdentityContext(prisma);
  const options = groups
    .map((group) => {
      const externalSellerId =
        group.externalSellerId != null && group.externalSellerId > 0
          ? group.externalSellerId
          : null;
      return {
        sellerKey: buildSalesOrderSellerKey(externalSellerId),
        label: buildSalesOrderSellerFilterOptionLabel(externalSellerId, ctx),
        externalSellerId,
        orderCount: group._count._all,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  return options;
}

export function buildSalesOrderListFilterLabels(
  query: SalesOrderListQuery,
  sellerLabel?: string | null
): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (query.status) rows.push({ label: "Situação", value: query.status });
  if (query.customerId) rows.push({ label: "Cliente (ID)", value: query.customerId });
  if (sellerLabel) rows.push({ label: "Vendedor", value: sellerLabel });
  else if (query.sellerKey.kind === "no_seller") {
    rows.push({ label: "Vendedor", value: "Sem vendedor no pedido Nomus" });
  } else if (query.sellerKey.kind === "seller_id") {
    rows.push({ label: "Vendedor (ID Nomus)", value: String(query.sellerKey.externalSellerId) });
  } else if (query.sellerText) {
    rows.push({ label: "Vendedor (busca)", value: query.sellerText });
  }
  if (query.year) rows.push({ label: "Ano emissão", value: String(query.year) });
  if (query.month) rows.push({ label: "Mês emissão", value: String(query.month) });
  if (query.startDate) {
    rows.push({ label: "Emissão de", value: query.startDate.toISOString().slice(0, 10) });
  }
  if (query.endDate) {
    rows.push({ label: "Emissão até", value: query.endDate.toISOString().slice(0, 10) });
  }
  if (query.q) rows.push({ label: "Busca", value: query.q });
  if (query.hasInvoice === true) rows.push({ label: "Vínculo NF", value: "Com NF" });
  if (query.hasInvoice === false) rows.push({ label: "Vínculo NF", value: "Sem NF" });
  if (query.receivableStatus === "open") {
    rows.push({ label: "Status CR", value: "CR em aberto" });
  } else if (query.receivableStatus === "settled") {
    rows.push({ label: "Status CR", value: "CR quitado" });
  } else if (query.receivableStatus === "none") {
    rows.push({ label: "Status CR", value: "Sem CR" });
  }
  return rows;
}
