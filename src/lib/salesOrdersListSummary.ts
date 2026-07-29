import type { Prisma } from "@prisma/client";
import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";
import { computeTicketAverage } from "@/src/lib/salesOrderDashboardRules.js";
import { resolveSalesOrderIssueDateRange } from "@/src/lib/salesOrderPeriodFilter.js";
import {
  buildSalesOrderSearchCodeTokens,
  normalizeSalesOrderSearchTerm,
} from "@/src/lib/salesOrderSmartSearch.js";
import { NOMUS_NFE_STATUS_CANCELLED } from "@/src/lib/nomusNfeClassification.js";
import { mergeSalesOrderOperationalPresenceWhere } from "@/src/lib/nomus/nomusSourcePresencePolicy.js";
import { buildEconomicGroupCustomerPrismaExclusion } from "@/src/lib/financeInternalGroupExclusions.js";

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
  /**
   * @deprecated Use `seller` / `sellerWhere`. Mantido só para compat de query string
   * (`?responsible=`); a resolução oficial é por `externalSellerId` Nomus.
   */
  responsible?: string;
  /** Filtro de vendedor Nomus (nome resolvido ou ID). Preferir sobre `responsible`. */
  seller?: string;
  /**
   * Restrição Prisma já resolvida (IDs Nomus). Quando informado, prevalece sobre
   * o filtro textual e **nunca** usa `SalesOrder.responsible`.
   */
  sellerWhere?: Prisma.SalesOrderWhereInput | null;
  startDate?: Date | null;
  endDate?: Date | null;
  /** Ano de emissão (filtro executivo) — base em SalesOrder.issueDate. */
  year?: number | null;
  /** Mês de emissão (1-12); só aplica quando `year` é válido. */
  month?: number | null;
  /** Busca inteligente (q): pedido/NF/cliente/vendedor/empresa/itens. */
  q?: string | null;
  /**
   * Filtro Com NF / Sem NF (aba Resultado).
   * Aproxima `hasInvoice` do motor: vínculo oficial com data de processamento
   * e status diferente de cancelada (7). Cancelada sozinha = Sem NF.
   */
  hasInvoice?: boolean | null;
  /** Valor líquido mínimo (SalesOrder.totalNetValue). */
  minNetValue?: number | null;
  /** Valor líquido máximo (SalesOrder.totalNetValue). */
  maxNetValue?: number | null;
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

  or.push({ nomusSellerName: { contains: term, ...insensitive } });
  or.push({ companyIssuer: { contains: term, ...insensitive } });
  // ID numérico de vendedor Nomus (idPessoaVendedor / externalSellerId)
  // e ID externo do pedido (externalSalesOrderId).
  const asNum = Number(term);
  if (Number.isInteger(asNum) && asNum > 0) {
    or.push({ externalSellerId: asNum });
    or.push({ externalSalesOrderId: asNum });
  }
  or.push({ Customer: { is: { companyName: { contains: term, ...insensitive } } } });
  or.push({ Customer: { is: { tradeName: { contains: term, ...insensitive } } } });
  or.push({ Customer: { is: { taxId: { contains: term, ...insensitive } } } });
  or.push({ nfeLinks: { some: { nfeKey: { contains: term, ...insensitive } } } });
  or.push({ items: { some: { productNameSnapshot: { contains: term, ...insensitive } } } });
  or.push({ items: { some: { skuSnapshot: { contains: term, ...insensitive } } } });

  return or;
}

/**
 * Vínculo oficial de NF válida para filtro de listagem (aproxima `hasNfe` do motor):
 * tem `SalesOrderNfeLink` com data de processamento e status ≠ cancelada.
 */
export function buildSalesOrderValidNfeLinkWhere(): Prisma.SalesOrderNfeLinkWhereInput {
  return {
    AND: [
      { dataProcessamento: { not: null } },
      {
        OR: [
          { nfeStatus: null },
          { nfeStatus: { not: NOMUS_NFE_STATUS_CANCELLED } },
        ],
      },
    ],
  };
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

export type BuildSalesOrderListWhereOptions = {
  /** Override de env para testes; default = process.env. */
  env?: Record<string, string | undefined>;
  /** Auditoria/histórico: não exclui MISSING_CONFIRMED. */
  includeConfirmedMissing?: boolean;
  /**
   * Opt-in: exclui clientes do grupo econômico (Lazarios/Koppetel/SM).
   * Default false — paridade com a listagem Comercial (Pedidos de Venda) pré-d8daf91.
   * Domínios oficiais (DRE/executivo/AR/AP) passam true explicitamente quando aplicável.
   */
  excludeEconomicGroupCustomers?: boolean;
};

/** Where Prisma alinhado ao GET /api/sales-orders (mesmos filtros da listagem). */
export function buildSalesOrderListWhere(
  filters: SalesOrderListFilters,
  options?: BuildSalesOrderListWhereOptions
): Prisma.SalesOrderWhereInput {
  const status = filters.status?.trim() ?? "";
  const customerId = filters.customerId?.trim() ?? "";
  const sellerTerm =
    filters.seller?.trim() || filters.responsible?.trim() || "";
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

  const sellerWhere =
    filters.sellerWhere != null
      ? filters.sellerWhere
      : sellerTerm
        ? // Sem contexto de identidade: restringe só por ID numérico / evita responsible legado
          (() => {
            const asNum = Number(sellerTerm);
            if (Number.isInteger(asNum) && asNum > 0) {
              return { externalSellerId: asNum };
            }
            return {
              OR: [
                { nomusSellerName: { contains: sellerTerm, mode: "insensitive" as const } },
              ],
            };
          })()
        : null;

  const and: Prisma.SalesOrderWhereInput[] = [];
  if (status && isValidSalesOrderListStatus(status)) and.push({ status });
  else {
    // Operacional: pedidos cancelados não entram na população (exceto filtro explícito CANCELLED).
    and.push({ status: { not: "CANCELLED" } });
  }
  if (customerId) and.push({ customerId });
  if (hasIssueDateFilter) and.push({ issueDate });
  if (searchOr) and.push({ OR: searchOr });
  if (sellerWhere) and.push(sellerWhere);
  if (filters.hasInvoice === true) {
    and.push({ nfeLinks: { some: buildSalesOrderValidNfeLinkWhere() } });
  } else if (filters.hasInvoice === false) {
    and.push({ nfeLinks: { none: buildSalesOrderValidNfeLinkWhere() } });
  }

  const minNet =
    filters.minNetValue != null && Number.isFinite(filters.minNetValue)
      ? filters.minNetValue
      : null;
  const maxNet =
    filters.maxNetValue != null && Number.isFinite(filters.maxNetValue)
      ? filters.maxNetValue
      : null;
  if (minNet != null || maxNet != null) {
    and.push({
      totalNetValue: {
        ...(minNet != null ? { gte: minNet } : {}),
        ...(maxNet != null ? { lte: maxNet } : {}),
      },
    });
  }

  if (options?.excludeEconomicGroupCustomers === true) {
    and.push(buildEconomicGroupCustomerPrismaExclusion());
  }

  const commercialWhere: Prisma.SalesOrderWhereInput =
    and.length === 0 ? {} : and.length === 1 ? and[0]! : { AND: and };

  // Presença operacional no AND raiz — busca inteligente (OR) não contorna a exclusão.
  return mergeSalesOrderOperationalPresenceWhere(commercialWhere, {
    env: options?.env,
    includeConfirmedMissing: options?.includeConfirmedMissing,
  }) as Prisma.SalesOrderWhereInput;
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

/**
 * Totais oficiais da listagem operacional — Σ `SalesOrder.totalNetValue` / contagem
 * dos pedidos já filtrados pelo mesmo `where` do GET /api/sales-orders.
 * Totais da população já filtrada pelo mesmo `where` do GET /api/sales-orders
 * (listagem Comercial não exclui grupo econômico por default).
 *
 * Preferir `buildSalesOrderListSummary` a partir de `prisma.salesOrder.aggregate`
 * na rota HTTP (PERF 05). Esta função permanece para dashboards/testes que já
 * têm as linhas em memória.
 */
export function buildSalesOrderListTotalsFromPrismaOrders(
  orders: Array<{ totalNetValue: unknown; totalItems: number }>
): SalesOrderListSummary {
  return summarizeSalesOrderListRows(orders);
}

/**
 * Paridade: totais via aggregate (count/sum) ≡ totais via soma em memória
 * da mesma população (mesmos campos, mesma ordem de conversão Decimal→number
 * no total agregado).
 */
export function buildSalesOrderListSummaryFromAggregate(input: {
  totalOrders: number;
  sumNetValue: unknown;
  sumItems: unknown;
}): SalesOrderListSummary {
  return buildSalesOrderListSummary({
    totalOrders: input.totalOrders,
    totalNetAmount: input.sumNetValue ?? 0,
    totalItems: input.sumItems ?? 0,
  });
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
