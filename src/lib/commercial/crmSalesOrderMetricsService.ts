/**
 * Métricas comerciais do CRM — mesma fonte oficial da tela Pedidos de Venda.
 *
 * Norma: docs/commercial/crm-commercial-official-rules.md
 * Eixo de carteira: Responsável Comercial do Cliente.
 * Vendedor Nomus do pedido: auditoria/filtro opcional apenas.
 * Propostas e módulo de comissões: fora de escopo (não consultar).
 */

import type { PrismaClient } from "@prisma/client";
import { isCancelledSalesOrderStatus } from "@/src/lib/salesOrderDashboardRules.js";
import { isNomusSellerInformed } from "@/src/lib/salesOrderNomusSeller.shared.js";
import { isSalesOrderMarketCustomer } from "@/src/lib/groupCompanyCustomer.js";
import { normalizeSellerIdentityName } from "@/src/lib/crmSellerIdentityConsolidation.js";
import { crmCanonicalSalesOrderWhere } from "@/src/lib/commercial/crmCanonicalSalesOrderScope.server.js";
import {
  CRM_OFFICIAL_UI_MESSAGES,
  CRM_PORTFOLIO_AXIS,
  SALES_ORDER_SELLER_AXIS,
} from "@/src/lib/crmCommercialOfficialConcepts.js";
import {
  mapPrismaOrderToSalesOrderRulesInput,
  OFFICIAL_SO_RULES_SOURCE,
  resolveOfficialScopedOrderMetrics,
  SALES_ORDER_RULES_PRISMA_SELECT,
} from "@/src/lib/salesOrderRulesAdapter.js";
import { loadSalesOrderLinkedNfeContextMap } from "@/src/lib/salesOrderLinkedNfe.js";
import { isSalesOrderItemActiveForCommercialValue } from "@/src/lib/sales/nomusSalesOrderItemStatus.js";
import {
  resolveCommercialResponsibleMap,
  type CommercialResponsibleMap,
} from "@/src/lib/commercial/crmCommercialResponsibleResolver.js";
import {
  ORDER_SELLER_UNMAPPED_LABEL,
  resolveCommercialOwnerDisplay,
} from "@/src/lib/commercial/commercialPersonIdentityResolver.js";

export const CRM_SALES_ORDER_METRICS_SOURCE = "crm-sales-order-metrics-via-official-so-rules" as const;

export const CRM_NO_COMMERCIAL_OWNER_BUCKET = "Sem responsável comercial" as const;

export type CrmSalesOrderMetricsFilters = {
  from?: string | Date | null;
  to?: string | Date | null;
  /** ID Nomus do responsável comercial (CrmCustomerCommercialOwner.sellerExternalId). */
  responsibleCommercialId?: number | null;
  responsibleCommercialName?: string | null;
  customerExternalId?: number | null;
  customerName?: string | null;
  /** Auditoria opcional — não define carteira. */
  sellerExternalId?: number | null;
  /** Auditoria opcional — não define carteira. */
  sellerName?: string | null;
  status?: string | null;
  /** Recorte canônico (mesmo vocabulário da tela Pedidos de Venda). */
  year?: number | null;
  month?: number | null;
  allYears?: boolean | null;
  /** @deprecated Sem efeito no universo — a régua de período é ano/mês canônico. */
  includeCancelled?: boolean;
  companyIssuer?: string | null;
};

export type CrmMetricsLeadingProduct = {
  productId: string | null;
  productName: string | null;
  sku: string | null;
  revenue: number;
  quantity: number;
};

/** Quantos grupos a UI exibe. O ranking COMPLETO vai nos *RankingTotals. */
export const RANKING_TOP_N = 10;

/**
 * Agregado do ranking INTEIRO (todos os grupos), não do Top N.
 *
 * Existe porque "Σ do Top 10 = valor vendido" é falso assim que houver mais
 * de 10 grupos — a reconciliação tem que ser feita contra o ranking completo,
 * e o Top N é só recorte de exibição.
 */
export type CrmMetricsRankingTotals = {
  /** Quantidade de grupos no ranking completo. */
  groups: number;
  /** Σ do valor de TODOS os grupos. */
  value: number;
  /** Σ de pedidos de TODOS os grupos. */
  orders: number;
  /** true quando a UI mostra menos grupos do que existem. */
  truncatedForDisplay: boolean;
};

export type CrmMetricsTopRow = {
  key: string;
  label: string;
  orders: number;
  value: number;
};

export type CrmSalesOrderMetricsResult = {
  totalOrders: number;
  totalOrderValue: number;
  openPortfolioOrders: number;
  openPortfolioValue: number;
  invoicedOrders: number;
  invoicedValue: number;
  canceledOrders: number;
  averageTicket: number;
  customersWithOrders: number;
  leadingProduct: CrmMetricsLeadingProduct | null;
  topCustomers: CrmMetricsTopRow[];
  topProducts: CrmMetricsTopRow[];
  /** Ranking por Responsável Comercial do Cliente (eixo de carteira). */
  topCommercialOwners: CrmMetricsTopRow[];
  /** Reconciliação: agregado de TODOS os clientes (não só o Top N exibido). */
  customerRankingTotals: CrmMetricsRankingTotals;
  /** Reconciliação: agregado de TODOS os responsáveis. */
  commercialOwnerRankingTotals: CrmMetricsRankingTotals;
  ordersWithoutNomusSeller: number;
  /** Pedidos do universo sem cliente vinculado — qualidade de dado, não cliente. */
  ordersWithoutCustomerLink: number;
  customersWithoutCommercialResponsible: number;
  ordersWithResponsibleDifferentFromOrderSeller: number;
  debug: {
    sourceInfo: typeof CRM_SALES_ORDER_METRICS_SOURCE;
    metricsSource: typeof OFFICIAL_SO_RULES_SOURCE;
    portfolioAxis: typeof CRM_PORTFOLIO_AXIS;
    orderSellerAxis: typeof SALES_ORDER_SELLER_AXIS;
    rulesEngineVersion: string;
    filtersApplied: CrmSalesOrderMetricsFilters;
    universeOrderCount: number;
    /**
     * Carga truncada pelo teto de segurança do `findMany`. `true` significa
     * número SUBESTIMADO — a UI precisa avisar em vez de exibir um total
     * silenciosamente errado.
     */
    truncated?: boolean;
    /** Pedidos que casam o filtro no banco (antes do teto). */
    matchedOrderCount?: number;
    messages: typeof CRM_OFFICIAL_UI_MESSAGES;
  };
};

export type CrmMetricsOrderItemInput = {
  productId?: string | null;
  skuSnapshot?: string | null;
  productNameSnapshot?: string | null;
  quantity?: unknown;
  totalNetValue?: unknown;
  nomusIsCanceled?: boolean | null;
  nomusIsStale?: boolean | null;
  nomusItemStatusNormalized?: string | null;
};

export type CrmMetricsCommercialOwnerInput = {
  sellerCanonicalName?: string | null;
  sellerResponsibleName?: string | null;
  sellerIdentityKey?: string | null;
  sellerExternalId?: number | null;
  isActive?: boolean | null;
} | null;

/** Pedido + cliente já hidratados (teste / pós-query). */
export type CrmMetricsOrderInput = {
  id: string;
  orderCode: string;
  status: string;
  customerId?: string | null;
  issueDate: Date;
  expectedDeliveryDate?: Date | null;
  totalNetValue: unknown;
  totalGrossValue?: unknown;
  totalItems?: number;
  responsible?: string | null;
  nomusSellerName?: string | null;
  externalSellerId?: number | null;
  nomusRawResponse?: unknown;
  companyIssuer?: string | null;
  externalSalesOrderId?: number | null;
  externalCustomerId?: number | null;
  Customer?: {
    id?: string;
    companyName?: string | null;
    tradeName?: string | null;
    taxId?: string | null;
    externalCustomerId?: number | null;
    CrmCustomerCommercialOwner?: CrmMetricsCommercialOwnerInput;
  } | null;
  items?: CrmMetricsOrderItemInput[];
};

function toFiniteNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rankingTotals(rows: readonly CrmMetricsTopRow[]): CrmMetricsRankingTotals {
  let value = 0;
  let orders = 0;
  for (const row of rows) {
    value += row.value;
    orders += row.orders;
  }
  return {
    groups: rows.length,
    value: Math.round((value + Number.EPSILON) * 100) / 100,
    orders,
    truncatedForDisplay: rows.length > RANKING_TOP_N,
  };
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function parseBoundaryDate(value: string | Date | null | undefined, endOfDay: boolean): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(endOfDay ? `${s}T23:59:59.999` : `${s}T00:00:00`);
}

function customerDisplayName(order: CrmMetricsOrderInput): string {
  const trade = order.Customer?.tradeName?.trim();
  const company = order.Customer?.companyName?.trim();
  return trade || company || order.customerId || "(cliente)";
}

function resolveActiveCommercialOwner(
  order: CrmMetricsOrderInput
): {
  name: string | null;
  identityKey: string | null;
  externalId: number | null;
  bucketLabel: string;
} {
  const owner = order.Customer?.CrmCustomerCommercialOwner;
  if (owner && owner.isActive !== false) {
    const display = resolveCommercialOwnerDisplay({
      rawId: owner.sellerExternalId,
      rawName: owner.sellerResponsibleName,
      canonicalName: owner.sellerCanonicalName,
      source: "CRM",
    });
    const name =
      display.source === "NONE" ? null : display.displayName;
    const identityKey =
      owner.sellerIdentityKey?.trim() ||
      (name && name !== ORDER_SELLER_UNMAPPED_LABEL
        ? normalizeSellerIdentityName(name)
        : owner.sellerExternalId != null
          ? `__ID_ONLY__:${owner.sellerExternalId}`
          : null);
    return {
      name,
      identityKey,
      externalId: owner.sellerExternalId ?? null,
      bucketLabel: name || CRM_NO_COMMERCIAL_OWNER_BUCKET,
    };
  }
  return {
    name: null,
    identityKey: null,
    externalId: null,
    bucketLabel: CRM_NO_COMMERCIAL_OWNER_BUCKET,
  };
}

function orderNomusSellerName(order: CrmMetricsOrderInput): string | null {
  return order.nomusSellerName?.trim() || null;
}

function orderHasNomusSeller(order: CrmMetricsOrderInput): boolean {
  return isNomusSellerInformed({
    externalSellerId: order.externalSellerId ?? null,
    nomusSellerName: orderNomusSellerName(order),
  });
}

function ownerDiffersFromOrderSeller(order: CrmMetricsOrderInput): boolean {
  const owner = resolveActiveCommercialOwner(order);
  if (!owner.identityKey && owner.externalId == null) return false;
  if (!orderHasNomusSeller(order)) return false;

  if (owner.externalId != null && order.externalSellerId != null) {
    return owner.externalId !== order.externalSellerId;
  }
  const orderKey = orderNomusSellerName(order)
    ? normalizeSellerIdentityName(orderNomusSellerName(order)!)
    : null;
  if (owner.identityKey && orderKey) {
    return owner.identityKey !== orderKey;
  }
  return false;
}

/** Filtra universo em memória (eixo carteira = responsável; seller Nomus opcional). */
export function filterCrmSalesOrderMetricsUniverse(
  orders: readonly CrmMetricsOrderInput[],
  filters: CrmSalesOrderMetricsFilters
): CrmMetricsOrderInput[] {
  const from = parseBoundaryDate(filters.from ?? null, false);
  const to = parseBoundaryDate(filters.to ?? null, true);
  const includeCancelled = filters.includeCancelled !== false;
  const ownerNameKey = filters.responsibleCommercialName?.trim()
    ? normalizeSellerIdentityName(filters.responsibleCommercialName)
    : null;
  const ownerId = filters.responsibleCommercialId ?? null;
  const sellerNameKey = filters.sellerName?.trim()
    ? normalizeSellerIdentityName(filters.sellerName)
    : null;
  const sellerId = filters.sellerExternalId ?? null;
  const customerNameNeedle = filters.customerName?.trim().toLowerCase() || null;
  const customerExtId = filters.customerExternalId ?? null;
  const status = filters.status?.trim() || null;
  const company = filters.companyIssuer?.trim() || null;

  return orders.filter((order) => {
    const issue = order.issueDate?.getTime?.() ?? NaN;
    if (from && !(Number.isFinite(issue) && issue >= from.getTime())) return false;
    if (to && !(Number.isFinite(issue) && issue <= to.getTime())) return false;

    if (!includeCancelled && isCancelledSalesOrderStatus(order.status)) return false;
    if (status && order.status !== status) return false;
    if (company && (order.companyIssuer?.trim() || "") !== company) return false;

    if (customerExtId != null) {
      const ext =
        order.Customer?.externalCustomerId ?? order.externalCustomerId ?? null;
      if (ext !== customerExtId) return false;
    }
    if (customerNameNeedle) {
      const hay = customerDisplayName(order).toLowerCase();
      if (!hay.includes(customerNameNeedle)) return false;
    }

    // Eixo carteira: responsável comercial
    if (ownerNameKey || ownerId != null) {
      const owner = resolveActiveCommercialOwner(order);
      const nameOk = ownerNameKey
        ? owner.identityKey === ownerNameKey ||
          (owner.name ? normalizeSellerIdentityName(owner.name) === ownerNameKey : false)
        : true;
      const idOk = ownerId != null ? owner.externalId === ownerId : true;
      if (ownerNameKey && ownerId != null) {
        if (!(nameOk || idOk)) return false;
      } else if (ownerNameKey && !nameOk) {
        return false;
      } else if (ownerId != null && !idOk) {
        return false;
      }
    }

    // Auditoria opcional: vendedor do pedido
    if (sellerId != null || sellerNameKey) {
      const idOk = sellerId != null ? order.externalSellerId === sellerId : true;
      const nameOk = sellerNameKey
        ? normalizeSellerIdentityName(orderNomusSellerName(order) || "") === sellerNameKey
        : true;
      if (sellerId != null && sellerNameKey) {
        if (!(idOk || nameOk)) return false;
      } else if (sellerId != null && !idOk) {
        return false;
      } else if (sellerNameKey && !nameOk) {
        return false;
      }
    }

    return true;
  });
}

function buildLeadingProduct(
  orders: readonly CrmMetricsOrderInput[]
): { leading: CrmMetricsLeadingProduct | null; topProducts: CrmMetricsTopRow[] } {
  const byProduct = new Map<
    string,
    { productId: string | null; name: string | null; sku: string | null; revenue: number; qty: number }
  >();

  for (const order of orders) {
    if (isCancelledSalesOrderStatus(order.status) || order.status === "ERROR") continue;
    for (const item of order.items ?? []) {
      if (
        !isSalesOrderItemActiveForCommercialValue({
          nomusIsCanceled: item.nomusIsCanceled,
          nomusIsStale: item.nomusIsStale,
          nomusItemStatusNormalized: item.nomusItemStatusNormalized,
          quantity:
            item.quantity == null ? null : Number(item.quantity as number),
          totalNetValue:
            item.totalNetValue == null
              ? null
              : Number(item.totalNetValue as number),
        })
      ) {
        continue;
      }
      const productId = item.productId?.trim() || null;
      const name = item.productNameSnapshot?.trim() || null;
      const sku = item.skuSnapshot?.trim() || null;
      const key = productId || sku || name || "unknown";
      const cur = byProduct.get(key) ?? {
        productId,
        name,
        sku,
        revenue: 0,
        qty: 0,
      };
      cur.revenue += toFiniteNumber(item.totalNetValue);
      cur.qty += toFiniteNumber(item.quantity);
      if (!cur.name && name) cur.name = name;
      if (!cur.sku && sku) cur.sku = sku;
      if (!cur.productId && productId) cur.productId = productId;
      byProduct.set(key, cur);
    }
  }

  const ranked = [...byProduct.entries()]
    .map(([key, v]) => ({
      key,
      label: v.name || v.sku || v.productId || key,
      orders: 0,
      value: roundMoney(v.revenue),
      raw: v,
    }))
    .sort((a, b) => b.value - a.value);

  const top = ranked.slice(0, 10).map(({ key, label, value }) => ({
    key,
    label,
    orders: 0,
    value,
  }));

  const best = ranked[0];
  const leading: CrmMetricsLeadingProduct | null = best
    ? {
        productId: best.raw.productId,
        productName: best.raw.name,
        sku: best.raw.sku,
        revenue: roundMoney(best.raw.revenue),
        quantity: best.raw.qty,
      }
    : null;

  return { leading, topProducts: top };
}

function buildCustomerRanking(orders: readonly CrmMetricsOrderInput[]): {
  top: CrmMetricsTopRow[];
  totals: CrmMetricsRankingTotals;
} {
  const byCustomer = new Map<string, { label: string; orders: number; value: number }>();
  for (const order of orders) {
    if (isCancelledSalesOrderStatus(order.status) || order.status === "ERROR") continue;
    const key = order.customerId || customerDisplayName(order);
    const cur = byCustomer.get(key) ?? {
      label: customerDisplayName(order),
      orders: 0,
      value: 0,
    };
    cur.orders += 1;
    cur.value += toFiniteNumber(order.totalNetValue);
    byCustomer.set(key, cur);
  }
  const ranked = [...byCustomer.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      orders: v.orders,
      value: roundMoney(v.value),
    }))
    .sort((a, b) => b.value - a.value);
  return { top: ranked.slice(0, RANKING_TOP_N), totals: rankingTotals(ranked) };
}

function buildCommercialOwnerRanking(orders: readonly CrmMetricsOrderInput[]): {
  top: CrmMetricsTopRow[];
  totals: CrmMetricsRankingTotals;
} {
  const byOwner = new Map<string, { orders: number; value: number }>();
  for (const order of orders) {
    if (isCancelledSalesOrderStatus(order.status) || order.status === "ERROR") continue;
    const owner = resolveActiveCommercialOwner(order);
    const key = owner.bucketLabel;
    const cur = byOwner.get(key) ?? { orders: 0, value: 0 };
    cur.orders += 1;
    cur.value += toFiniteNumber(order.totalNetValue);
    byOwner.set(key, cur);
  }
  const ranked = [...byOwner.entries()]
    .map(([key, v]) => ({
      key,
      label: key,
      orders: v.orders,
      value: roundMoney(v.value),
    }))
    .sort((a, b) => b.value - a.value);
  return { top: ranked.slice(0, RANKING_TOP_N), totals: rankingTotals(ranked) };
}

/**
 * Calcula métricas CRM a partir de pedidos já carregados.
 * Reutiliza `resolveOfficialScopedOrderMetrics` (motor oficial Pedidos).
 */
export function buildCrmSalesOrderMetrics(args: {
  orders: readonly CrmMetricsOrderInput[];
  filters?: CrmSalesOrderMetricsFilters;
  referenceDate?: Date;
  linkedNfeContextMap?: Map<string, import("@/src/lib/salesOrderLinkedNfe.js").SalesOrderLinkedNfeContext>;
}): CrmSalesOrderMetricsResult {
  const filters = args.filters ?? {};
  const universeAll = filterCrmSalesOrderMetricsUniverse(args.orders, filters);
  // Venda intercompany não é venda de mercado: o motor oficial já a exclui dos
  // KPIs (`excludeGroupCompanyCustomers`), então rankings e contadores daqui
  // precisam excluir também — senão Σ(Top clientes) não fecha com o Valor
  // vendido e a Koppetel aparece como cliente no ranking do gestor.
  const universe = universeAll.filter((order) => isSalesOrderMarketCustomer(order));
  const from = parseBoundaryDate(filters.from ?? null, false);
  const to = parseBoundaryDate(filters.to ?? null, true);

  // Universo de métricas: EXATAMENTE o da tela Pedidos de Venda — só o
  // cancelado sai. Excluir ERROR aqui (como era antes) tornava impossível
  // reconciliar: a tela oficial conta esses pedidos.
  const metricsUniverse = universe.filter((o) => !isCancelledSalesOrderStatus(o.status));

  const rulesOrders = metricsUniverse.map((order) =>
    mapPrismaOrderToSalesOrderRulesInput({
      id: order.id,
      orderCode: order.orderCode,
      status: order.status,
      customerId: order.customerId,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate ?? null,
      totalNetValue: order.totalNetValue,
      totalGrossValue: order.totalGrossValue,
      totalItems: order.totalItems ?? order.items?.length ?? 0,
      responsible: order.responsible ?? null,
      nomusSellerName: order.nomusSellerName ?? null,
      externalSellerId: order.externalSellerId ?? null,
      nomusRawResponse: order.nomusRawResponse ?? null,
      companyIssuer: order.companyIssuer ?? null,
      externalSalesOrderId: order.externalSalesOrderId ?? null,
      Customer: order.Customer
        ? {
            companyName: order.Customer.companyName,
            tradeName: order.Customer.tradeName,
            taxId: order.Customer.taxId,
            CrmCustomerCommercialOwner: order.Customer.CrmCustomerCommercialOwner
              ? {
                  sellerCanonicalName:
                    order.Customer.CrmCustomerCommercialOwner.sellerCanonicalName,
                  sellerResponsibleName:
                    order.Customer.CrmCustomerCommercialOwner.sellerResponsibleName,
                  isActive: order.Customer.CrmCustomerCommercialOwner.isActive ?? true,
                }
              : null,
          }
        : undefined,
      items: (order.items ?? []).map((item, idx) => ({
        id: `${order.id}-item-${idx}`,
        externalProductId: null,
        skuSnapshot: item.skuSnapshot,
        productNameSnapshot: item.productNameSnapshot,
        quantity: item.quantity ?? 0,
      })),
    })
  );

  const official = resolveOfficialScopedOrderMetrics({
    orders: rulesOrders,
    referenceDate: args.referenceDate ?? new Date(),
    managementFilters: {
      allYears: true,
      startDate: from,
      endDate: to,
      // Sem filtro de responsible/vendedor — eixo CRM já aplicado no universo.
      companyIssuer: filters.companyIssuer?.trim() || undefined,
      status: filters.status?.trim() || undefined,
    },
    linkedNfeContextMap: args.linkedNfeContextMap,
  });

  const canceledOrders = universe.filter((o) => isCancelledSalesOrderStatus(o.status)).length;
  const ordersWithoutNomusSeller = metricsUniverse.filter((o) => !orderHasNomusSeller(o)).length;
  const ordersWithResponsibleDifferentFromOrderSeller = metricsUniverse.filter((o) =>
    ownerDiffersFromOrderSeller(o)
  ).length;

  // Cliente é contado pelo VÍNCULO (customerId). O fallback antigo pelo nome
  // exibido criava cliente fantasma para pedido sem vínculo e fundia homônimos
  // — os dois distorciam "Clientes com pedido" e o Top clientes. Pedido sem
  // vínculo vira indicador de qualidade de dado, não vira cliente.
  const customerIds = new Set<string>();
  const customersWithoutOwner = new Set<string>();
  let ordersWithoutCustomerLink = 0;
  for (const order of metricsUniverse) {
    const cid = order.customerId?.trim() || null;
    if (!cid) {
      ordersWithoutCustomerLink += 1;
      continue;
    }
    customerIds.add(cid);
    const owner = resolveActiveCommercialOwner(order);
    if (!owner.identityKey && owner.externalId == null) {
      customersWithoutOwner.add(cid);
    }
  }

  const { leading, topProducts } = buildLeadingProduct(metricsUniverse);
  const customerRanking = buildCustomerRanking(metricsUniverse);
  const commercialOwnerRanking = buildCommercialOwnerRanking(metricsUniverse);

  return {
    totalOrders: official.filteredOrders,
    totalOrderValue: official.soldAmount,
    openPortfolioOrders: official.openPortfolioCount,
    openPortfolioValue: official.openPortfolioAmount,
    invoicedOrders: official.invoicedPortfolioCount,
    invoicedValue: official.invoicedPortfolioAmount,
    canceledOrders,
    averageTicket: official.averageTicket,
    customersWithOrders: customerIds.size,
    leadingProduct: leading,
    topCustomers: customerRanking.top,
    topProducts,
    topCommercialOwners: commercialOwnerRanking.top,
    customerRankingTotals: customerRanking.totals,
    commercialOwnerRankingTotals: commercialOwnerRanking.totals,
    ordersWithoutNomusSeller,
    ordersWithoutCustomerLink,
    customersWithoutCommercialResponsible: customersWithoutOwner.size,
    ordersWithResponsibleDifferentFromOrderSeller,
    debug: {
      sourceInfo: CRM_SALES_ORDER_METRICS_SOURCE,
      metricsSource: OFFICIAL_SO_RULES_SOURCE,
      portfolioAxis: CRM_PORTFOLIO_AXIS,
      orderSellerAxis: SALES_ORDER_SELLER_AXIS,
      rulesEngineVersion: official.rulesEngineVersion,
      filtersApplied: { ...filters },
      universeOrderCount: universe.length,
      messages: CRM_OFFICIAL_UI_MESSAGES,
    },
  };
}

/**
 * Select do Prisma para SalesOrder + Customer (SEM CrmCustomerCommercialOwner).
 *
 * IMPORTANTE — Responsável Comercial NÃO vai aqui.
 *
 * O Responsável Comercial vem do cadastro do cliente (`CrmCustomerCommercialOwner`),
 * mas é resolvido em BATCH via `resolveCommercialResponsibleMap` fora do
 * `findMany`, e injetado no shape do `CrmMetricsOrderInput` depois. Isso protege
 * o dashboard contra Prisma Client desatualizado em produção e mantém o eixo
 * "carteira do cliente" explícito no código.
 */
export const CRM_SALES_ORDER_METRICS_PRISMA_SELECT = {
  ...SALES_ORDER_RULES_PRISMA_SELECT,
  /** ID Nomus do cliente fica no pedido — Customer não tem esse campo. */
  externalCustomerId: true,
  Customer: {
    select: {
      id: true,
      companyName: true,
      tradeName: true,
      taxId: true,
    },
  },
  items: {
    select: {
      id: true,
      productId: true,
      externalProductId: true,
      skuSnapshot: true,
      productNameSnapshot: true,
      quantity: true,
      totalNetValue: true,
    },
  },
} as const;

/**
 * Injeta em cada pedido o Responsável Comercial resolvido em batch.
 * Chamar SEMPRE após buscar pedidos com `CRM_SALES_ORDER_METRICS_PRISMA_SELECT`
 * e antes de passar para `buildCrmSalesOrderMetrics`.
 */
export function injectCommercialResponsibleIntoOrders(
  orders: CrmMetricsOrderInput[],
  map: CommercialResponsibleMap
): CrmMetricsOrderInput[] {
  for (const order of orders) {
    if (!order.Customer) continue;
    const customerId = order.customerId?.trim();
    const injection = customerId ? map.get(customerId) ?? null : null;
    order.Customer.CrmCustomerCommercialOwner = injection;
  }
  return orders;
}

/**
 * Carrega pedidos oficiais e calcula métricas CRM.
 * Não consulta tabela de propostas. Não toca módulo de comissão.
 */
export async function loadCrmSalesOrderMetrics(
  prisma: PrismaClient,
  filters: CrmSalesOrderMetricsFilters = {},
  options?: { referenceDate?: Date; take?: number }
): Promise<CrmSalesOrderMetricsResult> {
  // População oficial: o CRM NÃO monta where próprio — consome o mesmo
  // construtor da tela Pedidos de Venda (status ≠ CANCELLED, presença
  // operacional, faixa de emissão meio-aberta e exclusão intercompany).
  const canonicalWhere = crmCanonicalSalesOrderWhere({
    year: filters.year ?? null,
    month: filters.month ?? null,
    allYears: filters.allYears ?? false,
  });
  const where: Record<string, unknown> = { ...(canonicalWhere as Record<string, unknown>) };
  if (filters.status?.trim()) where.status = filters.status.trim();
  if (filters.companyIssuer?.trim()) where.companyIssuer = filters.companyIssuer.trim();
  if (filters.customerExternalId != null) where.externalCustomerId = filters.customerExternalId;

  // Presença operacional e exclusão intercompany já vêm no where canônico.
  const presenceWhere = where;
  const take = options?.take ?? 20000;

  // Conta ANTES de carregar: com o filtro de ano (ou "todos os anos") o teto
  // do findMany passa a ser alcançável, e truncar em silêncio entregaria um
  // total menor que o real sem ninguém perceber.
  const [matchedOrderCount, rows] = await Promise.all([
    prisma.salesOrder.count({ where: presenceWhere as never }),
    prisma.salesOrder.findMany({
      where: presenceWhere as never,
      select: CRM_SALES_ORDER_METRICS_PRISMA_SELECT as never,
      orderBy: { issueDate: "desc" },
      take,
    }),
  ]);

  const orders: CrmMetricsOrderInput[] = rows.map((row: any) => ({
    id: row.id,
    orderCode: row.orderCode,
    status: row.status,
    customerId: row.customerId,
    issueDate: row.issueDate,
    expectedDeliveryDate: row.expectedDeliveryDate,
    totalNetValue: row.totalNetValue,
    totalGrossValue: row.totalGrossValue,
    totalItems: row.totalItems,
    responsible: row.responsible,
    nomusSellerName: row.nomusSellerName,
    externalSellerId: row.externalSellerId,
    nomusRawResponse: row.nomusRawResponse,
    companyIssuer: row.companyIssuer,
    externalSalesOrderId: row.externalSalesOrderId,
    externalCustomerId: row.externalCustomerId,
    Customer: row.Customer
      ? {
          id: row.Customer.id,
          companyName: row.Customer.companyName,
          tradeName: row.Customer.tradeName,
          taxId: row.Customer.taxId,
          // Espelha o ID Nomus do pedido (Customer não tem externalCustomerId).
          externalCustomerId: row.externalCustomerId ?? null,
          // CrmCustomerCommercialOwner é injetado depois via resolver batch
          // (ver `resolveCommercialResponsibleMap`). Nunca vem do findMany.
          CrmCustomerCommercialOwner: null,
        }
      : null,
    items: (row.items ?? []).map((item: any) => ({
      productId: item.productId,
      skuSnapshot: item.skuSnapshot,
      productNameSnapshot: item.productNameSnapshot,
      quantity: item.quantity,
      totalNetValue: item.totalNetValue,
      nomusIsCanceled: item.nomusIsCanceled ?? false,
      nomusIsStale: item.nomusIsStale ?? false,
      nomusItemStatusNormalized: item.nomusItemStatusNormalized ?? null,
    })),
  }));

  // Resolve Responsável Comercial em BATCH (customerId → owner) e injeta.
  const customerIds = orders
    .map((o) => o.customerId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const commercialResponsibleMap = await resolveCommercialResponsibleMap(prisma, customerIds);
  injectCommercialResponsibleIntoOrders(orders, commercialResponsibleMap);

  const filtered = filterCrmSalesOrderMetricsUniverse(orders, filters);
  const linkedMap = await loadSalesOrderLinkedNfeContextMap(
    filtered.map((order) => ({
      id: order.id,
      totalNetValue: order.totalNetValue,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate ?? null,
      nomusRawResponse: order.nomusRawResponse ?? null,
    })),
    options?.referenceDate ?? new Date()
  );

  const result = buildCrmSalesOrderMetrics({
    orders: filtered,
    filters: {
      from: filters.from,
      to: filters.to,
      includeCancelled: filters.includeCancelled,
      status: filters.status,
      companyIssuer: filters.companyIssuer,
    },
    referenceDate: options?.referenceDate,
    linkedNfeContextMap: linkedMap,
  });

  return {
    ...result,
    debug: {
      ...result.debug,
      matchedOrderCount,
      truncated: matchedOrderCount > rows.length,
    },
  };
}

/** Agrupa totais por bucket de responsável (inclui "Sem responsável comercial"). */
export function buildCrmMetricsByCommercialOwnerBuckets(
  orders: readonly CrmMetricsOrderInput[],
  filters: CrmSalesOrderMetricsFilters = {}
): Array<{ bucket: string; metrics: CrmSalesOrderMetricsResult }> {
  const universe = filterCrmSalesOrderMetricsUniverse(orders, {
    ...filters,
    responsibleCommercialId: null,
    responsibleCommercialName: null,
  });
  const buckets = new Map<string, CrmMetricsOrderInput[]>();
  for (const order of universe) {
    const owner = resolveActiveCommercialOwner(order);
    const key = owner.bucketLabel;
    const list = buckets.get(key) ?? [];
    list.push(order);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .map(([bucket, list]) => ({
      bucket,
      metrics: buildCrmSalesOrderMetrics({ orders: list, filters: {} }),
    }))
    .sort((a, b) => b.metrics.totalOrderValue - a.metrics.totalOrderValue);
}
