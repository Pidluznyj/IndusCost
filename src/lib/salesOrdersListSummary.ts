import type { Prisma } from "@prisma/client";
import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";
import { computeTicketAverage } from "@/src/lib/salesOrderDashboardRules.js";
import { resolveSalesOrderIssueDateRange } from "@/src/lib/salesOrderPeriodFilter.js";
import {
  buildSalesOrderSearchCodeTokens,
  normalizeSalesOrderSearchTerm,
} from "@/src/lib/salesOrderSmartSearch.js";

export const SALES_ORDER_LIST_STATUS_VALUES = [
  "DRAFT",
  "READY_TO_SEND",
  "SENT_TO_NOMUS",
  "CANCELLED",
  "ERROR",
] as const;

export type SalesOrderListStatus = (typeof SALES_ORDER_LIST_STATUS_VALUES)[number];

export type SalesOrderListFilters = {
  status?: string;
  customerId?: string;
  responsible?: string;
  startDate?: Date | null;
  endDate?: Date | null;
  /** Ano de emissão (filtro executivo) — base em SalesOrder.issueDate. */
  year?: number | null;
  /** Mês de emissão (1-12); só aplica quando `year` é válido. */
  month?: number | null;
  /** Busca inteligente (q): pedido/NF/cliente/vendedor/empresa/itens. */
  q?: string | null;
};

/**
 * Monta o `OR` da busca inteligente sobre campos reais do schema.
 * Tokens de código (com/sem prefixo PD, sem espaços, com/sem zeros à esquerda)
 * batem em `orderCode`/`externalSalesOrderCode`/NF; o termo livre bate em
 * cliente/vendedor/empresa/itens. Retorna null quando não há termo.
 */
export function buildSalesOrderSearchOr(
  q: string | null | undefined
): Prisma.SalesOrderWhereInput[] | null {
  const term = normalizeSalesOrderSearchTerm(q);
  if (!term) return null;

  const insensitive = { mode: "insensitive" as const };
  const or: Prisma.SalesOrderWhereInput[] = [];

  for (const token of buildSalesOrderSearchCodeTokens(q)) {
    or.push({ orderCode: { contains: token, ...insensitive } });
    or.push({ externalSalesOrderCode: { contains: token, ...insensitive } });
    or.push({ nfeLinks: { some: { nfeNumber: { contains: token, ...insensitive } } } });
    or.push({ nfeLinks: { some: { orderCode: { contains: token, ...insensitive } } } });
    or.push({
      nfeLinks: { some: { externalSalesOrderCode: { contains: token, ...insensitive } } },
    });
  }

  or.push({ responsible: { contains: term, ...insensitive } });
  or.push({ companyIssuer: { contains: term, ...insensitive } });
  or.push({ Customer: { is: { companyName: { contains: term, ...insensitive } } } });
  or.push({ Customer: { is: { tradeName: { contains: term, ...insensitive } } } });
  or.push({ Customer: { is: { taxId: { contains: term, ...insensitive } } } });
  or.push({ nfeLinks: { some: { nfeKey: { contains: term, ...insensitive } } } });
  or.push({ items: { some: { productNameSnapshot: { contains: term, ...insensitive } } } });
  or.push({ items: { some: { skuSnapshot: { contains: term, ...insensitive } } } });

  return or;
}

export type SalesOrderListSummary = {
  totalOrders: number;
  totalNetAmount: number;
  totalItems: number;
  averageTicket: number;
};

export function isValidSalesOrderListStatus(value: unknown): value is SalesOrderListStatus {
  return (
    typeof value === "string" &&
    SALES_ORDER_LIST_STATUS_VALUES.includes(value as SalesOrderListStatus)
  );
}

/** Where Prisma alinhado ao GET /api/sales-orders (mesmos filtros da listagem). */
export function buildSalesOrderListWhere(
  filters: SalesOrderListFilters
): Prisma.SalesOrderWhereInput {
  const status = filters.status?.trim() ?? "";
  const customerId = filters.customerId?.trim() ?? "";
  const responsible = filters.responsible?.trim() ?? "";
  const startDate = filters.startDate ?? null;
  const endDate = filters.endDate ?? null;

  // Filtro executivo Ano/Mês (sempre sobre issueDate, fim exclusivo).
  const periodRange = resolveSalesOrderIssueDateRange(
    filters.year ?? null,
    filters.month ?? null
  );

  const issueDate: Prisma.DateTimeFilter = {};
  if (startDate) issueDate.gte = startDate;
  if (endDate) issueDate.lte = endDate;
  if (periodRange) {
    // Combina com um startDate explícito mantendo o limite inferior mais restritivo.
    const currentGte = issueDate.gte instanceof Date ? issueDate.gte : null;
    if (!currentGte || periodRange.gte > currentGte) {
      issueDate.gte = periodRange.gte;
    }
    issueDate.lt = periodRange.lt;
  }

  const hasIssueDateFilter =
    issueDate.gte != null || issueDate.lte != null || issueDate.lt != null;

  const searchOr = buildSalesOrderSearchOr(filters.q);

  return {
    ...(status && isValidSalesOrderListStatus(status) ? { status } : {}),
    ...(customerId ? { customerId } : {}),
    ...(responsible ? { responsible } : {}),
    ...(hasIssueDateFilter ? { issueDate } : {}),
    ...(searchOr ? { OR: searchOr } : {}),
  };
}

export function buildSalesOrderListSummary(input: {
  totalOrders: number;
  totalNetAmount: unknown;
  totalItems: unknown;
}): SalesOrderListSummary {
  const totalOrders = Math.max(0, input.totalOrders);
  const totalNetAmount = decimalToNumber(input.totalNetAmount) ?? 0;
  const totalItemsRaw = decimalToNumber(input.totalItems);
  const totalItems =
    totalItemsRaw != null && Number.isFinite(totalItemsRaw)
      ? Math.trunc(totalItemsRaw)
      : 0;
  const averageTicket = computeTicketAverage(totalNetAmount, totalOrders) ?? 0;

  return {
    totalOrders,
    totalNetAmount,
    totalItems,
    averageTicket: Number.isFinite(averageTicket) ? averageTicket : 0,
  };
}

/** Agrega linhas em memória — útil para testes de paridade com a tabela. */
export function summarizeSalesOrderListRows(
  rows: Array<{ totalNetValue: unknown; totalItems: number }>
): SalesOrderListSummary {
  let totalNetAmount = 0;
  let totalItems = 0;
  for (const row of rows) {
    totalNetAmount += decimalToNumber(row.totalNetValue) ?? 0;
    totalItems += row.totalItems ?? 0;
  }
  return buildSalesOrderListSummary({
    totalOrders: rows.length,
    totalNetAmount,
    totalItems,
  });
}
