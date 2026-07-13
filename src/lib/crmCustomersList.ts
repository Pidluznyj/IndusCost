/**
 * Listagem de clientes CRM — escopo por Responsável Comercial + enriquecimento SalesOrder.
 * Vendedor Nomus do pedido: auditoria apenas. Sem propostas como histórico de compra.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import type { CrmCommercialAccessScope } from "@/src/lib/crmCommercialAccessScope.js";
import { buildCrmSellerFilterSql } from "@/src/lib/crmSellerMatchSql.js";
import { crmCommercialSellerMatchFilters } from "@/src/lib/crmCommercialAccessScope.js";
import {
  buildManualCommercialOwnerPortfolioWhere,
  loadManualCommercialOwnersForCustomers,
} from "@/src/lib/crmCustomerCommercialOwner.js";
import type { ResolvedCustomerCommercialOwner } from "@/src/lib/crmCustomerCommercialOwnerTypes.js";
import { normalizeSellerIdentityName } from "@/src/lib/crmSellerIdentityConsolidation.js";
import { resolveSalesOrderHasInvoicing } from "@/src/lib/crmCommercialOrderRules.js";
import { isNomusSellerInformed } from "@/src/lib/salesOrderNomusSeller.shared.js";
import {
  buildCrmCustomersListSourceInfo,
  resolveCrmCustomersListPeriod,
  resolveCrmPortfolioStatus,
} from "@/src/lib/crmCustomersListOfficialOrders.js";
import {
  CRM_CUSTOMER_LIST_FILTERS,
  type CrmCustomerListFilter,
  type CrmCustomerListItem,
  type CrmCustomerListLeadingProduct,
  type CrmCustomersListResponse,
} from "@/src/lib/crmCustomersListTypes.js";

export { CRM_CUSTOMER_LIST_FILTERS };
export type { CrmCustomerListFilter, CrmCustomerListItem };

const DONE_LIKE_STATUSES = [
  "DONE",
  "done",
  "Done",
  "CLOSED",
  "closed",
  "CANCELLED",
  "Canceled",
  "CANCELED",
  "canceled",
  "cancelled",
];

export function parseCrmCustomerListFilter(raw: unknown): CrmCustomerListFilter {
  const s = typeof raw === "string" ? raw.trim() : "all";
  return (CRM_CUSTOMER_LIST_FILTERS as readonly string[]).includes(s)
    ? (s as CrmCustomerListFilter)
    : "all";
}

export type CrmCustomerListSellerQuery = {
  externalSellerId: number | null;
  sellerIdentityKey: string | null;
};

export function parseCrmCustomerListSellerQuery(
  queryExternalSellerId: unknown,
  querySellerIdentityKey: unknown
): CrmCustomerListSellerQuery {
  let externalSellerId: number | null = null;
  if (queryExternalSellerId !== undefined && queryExternalSellerId !== null && queryExternalSellerId !== "") {
    const n = Number.parseInt(String(queryExternalSellerId).trim(), 10);
    if (Number.isFinite(n)) externalSellerId = n;
  }
  const sellerIdentityKey =
    typeof querySellerIdentityKey === "string" && querySellerIdentityKey.trim()
      ? normalizeSellerIdentityName(querySellerIdentityKey)
      : null;
  return { externalSellerId, sellerIdentityKey };
}

/**
 * @deprecated Preferir {@link resolveCrmCustomerListScopeWhere}.
 * Escopo de carteira = somente Responsável Comercial (não vendedor Nomus do pedido).
 */
export function buildCrmCustomerListScopeWhere(
  commercialScope: CrmCommercialAccessScope,
  sellerQuery: CrmCustomerListSellerQuery
): Prisma.CustomerWhereInput | undefined {
  if (commercialScope.dataScope === "own") {
    const manualWhere = buildManualCommercialOwnerPortfolioWhere(commercialScope);
    if (manualWhere) return { CrmCustomerCommercialOwner: { is: manualWhere } };
    return { id: { in: [] } };
  }
  if (commercialScope.dataScope !== "global") return undefined;

  const hasSellerFilter =
    sellerQuery.sellerIdentityKey !== null || sellerQuery.externalSellerId !== null;
  if (!hasSellerFilter) return undefined;

  const match = crmCommercialSellerMatchFilters(
    sellerQuery.externalSellerId,
    null,
    sellerQuery.sellerIdentityKey
  );

  const manualWhere = buildManualCommercialOwnerPortfolioWhere({
    externalSellerId: match.externalSellerId,
    responsible: match.responsible,
    sellerIdentityKey: match.sellerIdentityKey,
  });
  if (manualWhere) return { CrmCustomerCommercialOwner: { is: manualWhere } };
  return { id: { in: [] } };
}

/** Filtro consolidado de vendedor (mesma forma usada por `buildCrmSellerFilterSql`). */
export type CrmSellerScopeFilter = {
  externalSellerId: number | null;
  responsible: string | null;
  sellerIdentityKey: string | null;
};

/**
 * Decide o filtro efetivo de vendedor da carteira (puro, testável):
 * - `own`: o próprio vínculo consolidado do usuário (prioriza sellerIdentityKey);
 * - `global` sem filtro: "all" (sem restrição de vendedor);
 * - `global` com filtro: o vendedor escolhido pelo gestor;
 * - demais (none): "none" (carteira vazia por segurança).
 */
export function resolveCrmCustomerListSellerScopeFilter(
  commercialScope: CrmCommercialAccessScope,
  sellerQuery: CrmCustomerListSellerQuery
): CrmSellerScopeFilter | "all" | "none" {
  if (commercialScope.dataScope === "own") {
    return {
      externalSellerId: commercialScope.externalSellerId,
      responsible: commercialScope.responsible,
      sellerIdentityKey: commercialScope.sellerIdentityKey,
    };
  }
  if (commercialScope.dataScope !== "global") return "none";

  const hasSellerFilter =
    sellerQuery.sellerIdentityKey !== null || sellerQuery.externalSellerId !== null;
  if (!hasSellerFilter) return "all";

  return crmCommercialSellerMatchFilters(
    sellerQuery.externalSellerId,
    null,
    sellerQuery.sellerIdentityKey
  );
}

/**
 * Clientes elegíveis por vendedor a partir de SalesOrder, usando a MESMA regra SQL
 * normalizada do dashboard (`buildCrmSellerFilterSql`). Normaliza caixa, acento e espaços
 * múltiplos — resolve o caso "GISLENE  LIMA" vs "gislene lima".
 */
export async function fetchCrmSellerScopeCustomerIds(
  prismaClient: { $queryRaw: <T>(q: Prisma.Sql) => Promise<T> },
  filter: CrmSellerScopeFilter
): Promise<string[]> {
  const sellerMatch = buildCrmSellerFilterSql("so", filter);
  const rows = await prismaClient.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT DISTINCT so."customerId" AS id
    FROM "SalesOrder" so
    WHERE so.status::text NOT IN ('CANCELLED', 'ERROR')
      AND so."customerId" IS NOT NULL
      AND ${sellerMatch}
  `);
  return rows.map((r) => r.id).filter((id): id is string => Boolean(id));
}

type ManualOwnerFinder = {
  crmCustomerCommercialOwner: {
    findMany: (args: {
      where: Prisma.CrmCustomerCommercialOwnerWhereInput;
      select: { customerId: true };
    }) => Promise<{ customerId: string }[]>;
  };
};

/** Clientes com vínculo manual ativo que casam com o vendedor (independe de pedido recente). */
export async function fetchCrmManualOwnerCustomerIds(
  prismaClient: ManualOwnerFinder,
  filter: CrmSellerScopeFilter
): Promise<string[]> {
  const manualWhere = buildManualCommercialOwnerPortfolioWhere(filter);
  if (!manualWhere) return [];
  const rows = await prismaClient.crmCustomerCommercialOwner.findMany({
    where: manualWhere,
    select: { customerId: true },
  });
  return rows.map((r) => r.customerId);
}

/**
 * Escopo efetivo da carteira: somente clientes com Responsável Comercial ativo
 * que casa com o filtro (eixo oficial). Não inclui clientes só por vendedor Nomus do pedido.
 */
export async function resolveCrmCustomerListScopeWhere(
  prismaClient: PrismaClient,
  commercialScope: CrmCommercialAccessScope,
  sellerQuery: CrmCustomerListSellerQuery
): Promise<Prisma.CustomerWhereInput | undefined> {
  const decision = resolveCrmCustomerListSellerScopeFilter(commercialScope, sellerQuery);
  if (decision === "all") return undefined;
  if (decision === "none") return { id: { in: [] } };

  const manualIds = await fetchCrmManualOwnerCustomerIds(prismaClient, decision);
  return { id: { in: manualIds } };
}

const nomusNfesElementsSql = (alias: string) => Prisma.sql`
  jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(${Prisma.raw(`${alias}."nomusRawResponse"`)}) = 'array'
      THEN ${Prisma.raw(`${alias}."nomusRawResponse"`)}->'nfes'
      WHEN jsonb_typeof(${Prisma.raw(`${alias}."nomusRawResponse"`)}->'nfes') = 'array'
      THEN ${Prisma.raw(`${alias}."nomusRawResponse"`)}->'nfes'
      ELSE '[]'::jsonb
    END
  ) AS nfe
`;

const salesOrderIsInvoicedSql = (alias: string) => Prisma.sql`
  EXISTS (
    SELECT 1
    FROM ${nomusNfesElementsSql(alias)}
    WHERE NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'dataProcessamento', '')), '') IS NOT NULL
  )
`;

export function buildCrmCustomerListFilterWhere(
  filter: CrmCustomerListFilter,
  now = new Date()
): Prisma.CustomerWhereInput | undefined {
  const since30 = new Date(now);
  since30.setUTCDate(since30.getUTCDate() - 30);
  const in7 = new Date(now);
  in7.setUTCDate(in7.getUTCDate() + 7);

  if (filter === "withContact30") {
    return {
      CommercialActivity: {
        some: {
          OR: [
            { AND: [{ contactDate: { not: null } }, { contactDate: { gte: since30 } }] },
            { AND: [{ contactDate: null }, { createdAt: { gte: since30 } }] },
          ],
        },
      },
    };
  }
  if (filter === "withoutContact30") {
    return {
      NOT: {
        CommercialActivity: {
          some: {
            OR: [
              { AND: [{ contactDate: { not: null } }, { contactDate: { gte: since30 } }] },
              { AND: [{ contactDate: null }, { createdAt: { gte: since30 } }] },
            ],
          },
        },
      },
    };
  }
  if (filter === "overdueFollowUp") {
    return {
      CommercialActivity: {
        some: {
          nextActionAt: { not: null, lt: now },
          status: { notIn: DONE_LIKE_STATUSES },
        },
      },
    };
  }
  if (filter === "upcomingFollowUp7") {
    return {
      CommercialActivity: {
        some: {
          nextActionAt: { not: null, gte: now, lt: in7 },
          status: { notIn: DONE_LIKE_STATUSES },
        },
      },
    };
  }
  if (filter === "withPurchaseHistory") {
    return {
      salesOrders: {
        some: { status: { notIn: ["CANCELLED", "ERROR"] } },
      },
    };
  }
  return undefined;
}

export function buildCustomerHasOpenPortfolioExistsSql(customerIdExpr: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM "SalesOrder" so
      WHERE so."customerId" = ${customerIdExpr}
        AND so.status::text NOT IN ('CANCELLED', 'ERROR')
        AND NOT ${salesOrderIsInvoicedSql("so")}
    )
  `;
}

type CustomerRow = {
  id: string;
  companyName: string;
  tradeName: string | null;
  taxId: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
};

type ActivityAgg = {
  contactCount: number;
  lastContactAt: Date | null;
  nextFollowUpAt: Date | null;
  hasOverdueFollowUp: boolean;
};

export function aggregateCustomerActivities(
  activities: {
    customerId: string;
    contactDate: Date | null;
    createdAt: Date;
    nextActionAt: Date | null;
    status: string | null;
  }[],
  now = new Date()
): Map<string, ActivityAgg> {
  const isClosedStatus = (status?: string | null) =>
    ["done", "closed", "cancelled", "canceled"].includes(String(status ?? "").trim().toLowerCase());

  const aggMap = new Map<string, ActivityAgg>();
  for (const activity of activities) {
    const key = activity.customerId;
    const current = aggMap.get(key) ?? {
      contactCount: 0,
      lastContactAt: null,
      nextFollowUpAt: null,
      hasOverdueFollowUp: false,
    };

    current.contactCount += 1;
    const effectiveContactDate = activity.contactDate ?? activity.createdAt;
    if (
      effectiveContactDate &&
      (!current.lastContactAt || effectiveContactDate > current.lastContactAt)
    ) {
      current.lastContactAt = effectiveContactDate;
    }

    if (
      activity.nextActionAt &&
      activity.nextActionAt > now &&
      !isClosedStatus(activity.status)
    ) {
      if (!current.nextFollowUpAt || activity.nextActionAt < current.nextFollowUpAt) {
        current.nextFollowUpAt = activity.nextActionAt;
      }
    }

    if (
      activity.nextActionAt &&
      activity.nextActionAt < now &&
      !isClosedStatus(activity.status)
    ) {
      current.hasOverdueFollowUp = true;
    }

    aggMap.set(key, current);
  }
  return aggMap;
}

export type SalesOrderEnrichment = {
  hasPurchaseHistory: boolean;
  hasOpenPortfolio: boolean;
  lastOrderAt: Date | null;
  lastOrderCode: string | null;
  daysSinceLastOrder: number | null;
  ordersCount: number;
  historicalPurchaseValue: number;
  periodPurchaseValue: number;
  periodOrdersCount: number;
  hasOrderWithoutNomusSeller: boolean;
  lastOrderNomusSellerName: string | null;
  lastOrderExternalSellerId: number | null;
  /** Nomus sellers seen on any valid order (for divergence vs commercial owner). */
  orderSellerIdentityKeys: string[];
  orderSellerExternalIds: number[];
  leadingProduct: CrmCustomerListLeadingProduct | null;
};

function toMoney(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function orderNomusName(order: {
  nomusSellerName?: string | null;
  responsible?: string | null;
}): string | null {
  return order.nomusSellerName?.trim() || order.responsible?.trim() || null;
}

/**
 * Agrega histórico oficial de compra a partir de SalesOrder (sem filtrar por vendedor Nomus).
 * Não inventa compra: sem pedidos válidos → hasPurchaseHistory=false e valores 0.
 */
export function enrichCustomersFromSalesOrders(
  orders: {
    customerId: string;
    orderCode?: string | null;
    responsible: string | null;
    nomusSellerName?: string | null;
    externalSellerId: number | null;
    status: string;
    issueDate: Date;
    totalNetValue?: unknown;
    nomusRawResponse: unknown;
  }[],
  args: {
    now?: Date;
    periodFrom?: Date | null;
    periodTo?: Date | null;
  } = {}
): Map<string, SalesOrderEnrichment> {
  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  const periodFromMs = args.periodFrom?.getTime() ?? null;
  const periodToMs = args.periodTo?.getTime() ?? null;
  const byCustomer = new Map<string, SalesOrderEnrichment>();
  const sorted = [...orders].sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime());

  for (const order of sorted) {
    const valid = !["CANCELLED", "ERROR"].includes(String(order.status));
    const current = byCustomer.get(order.customerId) ?? {
      hasPurchaseHistory: false,
      hasOpenPortfolio: false,
      lastOrderAt: null,
      lastOrderCode: null,
      daysSinceLastOrder: null,
      ordersCount: 0,
      historicalPurchaseValue: 0,
      periodPurchaseValue: 0,
      periodOrdersCount: 0,
      hasOrderWithoutNomusSeller: false,
      lastOrderNomusSellerName: null,
      lastOrderExternalSellerId: null,
      orderSellerIdentityKeys: [],
      orderSellerExternalIds: [],
      leadingProduct: null,
    };

    if (!valid) {
      byCustomer.set(order.customerId, current);
      continue;
    }

    current.hasPurchaseHistory = true;
    current.ordersCount += 1;
    const value = toMoney(order.totalNetValue);
    current.historicalPurchaseValue += value;

    const issueMs = order.issueDate.getTime();
    const inPeriod =
      (periodFromMs == null || issueMs >= periodFromMs) &&
      (periodToMs == null || issueMs <= periodToMs);
    if (inPeriod) {
      current.periodPurchaseValue += value;
      current.periodOrdersCount += 1;
    }

    if (!current.lastOrderAt) {
      current.lastOrderAt = order.issueDate;
      current.lastOrderCode = order.orderCode?.trim() || null;
      current.daysSinceLastOrder = Number.isFinite(issueMs)
        ? Math.max(0, Math.floor((nowMs - issueMs) / 86400000))
        : null;
      current.lastOrderNomusSellerName = orderNomusName(order);
      current.lastOrderExternalSellerId = order.externalSellerId;
    }

    if (
      !resolveSalesOrderHasInvoicing({
        status: order.status,
        nomusRawResponse: order.nomusRawResponse,
      })
    ) {
      current.hasOpenPortfolio = true;
    }

    const nomusInformed = isNomusSellerInformed({
      externalSellerId: order.externalSellerId,
      nomusSellerName: order.nomusSellerName ?? null,
    });
    if (!nomusInformed) {
      current.hasOrderWithoutNomusSeller = true;
    } else {
      const name = orderNomusName(order);
      if (name) {
        const key = normalizeSellerIdentityName(name);
        if (!current.orderSellerIdentityKeys.includes(key)) {
          current.orderSellerIdentityKeys.push(key);
        }
      }
      if (
        order.externalSellerId != null &&
        !current.orderSellerExternalIds.includes(order.externalSellerId)
      ) {
        current.orderSellerExternalIds.push(order.externalSellerId);
      }
    }

    byCustomer.set(order.customerId, current);
  }
  return byCustomer;
}

export function enrichLeadingProductsFromOrderItems(
  items: {
    customerId: string;
    productId: string | null;
    productName: string | null;
    sku: string | null;
    revenue: unknown;
    quantity: unknown;
  }[]
): Map<string, CrmCustomerListLeadingProduct> {
  const byCustomerProduct = new Map<
    string,
    Map<string, CrmCustomerListLeadingProduct>
  >();
  for (const item of items) {
    const productKey =
      item.productId?.trim() || item.sku?.trim() || item.productName?.trim() || "unknown";
    const custMap =
      byCustomerProduct.get(item.customerId) ??
      new Map<string, CrmCustomerListLeadingProduct>();
    const cur = custMap.get(productKey) ?? {
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      revenue: 0,
      quantity: 0,
    };
    cur.revenue += toMoney(item.revenue);
    cur.quantity += toMoney(item.quantity);
    if (!cur.productName && item.productName) cur.productName = item.productName;
    if (!cur.sku && item.sku) cur.sku = item.sku;
    if (!cur.productId && item.productId) cur.productId = item.productId;
    custMap.set(productKey, cur);
    byCustomerProduct.set(item.customerId, custMap);
  }

  const leading = new Map<string, CrmCustomerListLeadingProduct>();
  for (const [customerId, products] of byCustomerProduct) {
    const top = [...products.values()].sort((a, b) => b.revenue - a.revenue)[0];
    if (top) leading.set(customerId, top);
  }
  return leading;
}

function ownerDiffersFromOrderSellers(
  owner: ResolvedCustomerCommercialOwner | undefined,
  enrichment: SalesOrderEnrichment | undefined
): boolean {
  if (!owner || !enrichment?.hasPurchaseHistory) return false;
  const ownerKey = owner.sellerIdentityKey
    ? normalizeSellerIdentityName(owner.sellerIdentityKey)
    : owner.sellerCanonicalName
      ? normalizeSellerIdentityName(owner.sellerCanonicalName)
      : null;
  const ownerId = owner.sellerExternalId ?? null;

  if (enrichment.hasOrderWithoutNomusSeller && enrichment.ordersCount > 0) {
    // pedido sem Nomus não conta como divergência de identidade; há campo separado
  }

  if (ownerId != null && enrichment.orderSellerExternalIds.length > 0) {
    if (enrichment.orderSellerExternalIds.some((id) => id !== ownerId)) return true;
  }
  if (ownerKey && enrichment.orderSellerIdentityKeys.length > 0) {
    if (enrichment.orderSellerIdentityKeys.some((k) => k !== ownerKey)) return true;
  }
  return false;
}

export function mapCustomerRowsToListItems(
  rows: CustomerRow[],
  activityAgg: Map<string, ActivityAgg>,
  orderEnrichment: Map<string, SalesOrderEnrichment>,
  manualOwners?: Map<string, ResolvedCustomerCommercialOwner>
): CrmCustomerListItem[] {
  return rows.map((c) => {
    const agg = activityAgg.get(c.id);
    const ord = orderEnrichment.get(c.id);
    const manual = manualOwners?.get(c.id);
    const ownerName = manual?.sellerCanonicalName?.trim() || null;
    const ownerId = manual?.sellerExternalId ?? null;
    const hasPurchaseHistory = ord?.hasPurchaseHistory ?? false;
    const hasOpenPortfolio = ord?.hasOpenPortfolio ?? false;
    return {
      id: c.id,
      displayName: c.companyName,
      tradeName: c.tradeName ?? null,
      taxId: c.taxId,
      email: c.email ?? null,
      phone: c.phone ?? null,
      city: c.city ?? null,
      state: c.state ?? null,
      address: c.address ?? null,
      lastContactAt: agg?.lastContactAt ? agg.lastContactAt.toISOString() : null,
      nextFollowUpAt: agg?.nextFollowUpAt ? agg.nextFollowUpAt.toISOString() : null,
      contactCount: agg?.contactCount ?? 0,
      primarySellerResponsible: ownerName,
      primaryExternalSellerId: ownerId,
      commercialOwnerName: ownerName,
      commercialOwnerExternalId: ownerId,
      hasCommercialOwner: Boolean(manual),
      hasPurchaseHistory,
      hasOpenPortfolio,
      hasOverdueFollowUp: agg?.hasOverdueFollowUp ?? false,
      portfolioStatus: resolveCrmPortfolioStatus({ hasPurchaseHistory, hasOpenPortfolio }),
      lastOrderAt: ord?.lastOrderAt ? ord.lastOrderAt.toISOString() : null,
      lastOrderCode: ord?.lastOrderCode ?? null,
      daysSinceLastOrder: ord?.daysSinceLastOrder ?? null,
      ordersCount: ord?.ordersCount ?? 0,
      historicalPurchaseValue: ord?.historicalPurchaseValue ?? 0,
      periodPurchaseValue: ord?.periodPurchaseValue ?? 0,
      periodOrdersCount: ord?.periodOrdersCount ?? 0,
      leadingProduct: ord?.leadingProduct ?? null,
      lastOrderNomusSellerName: ord?.lastOrderNomusSellerName ?? null,
      lastOrderExternalSellerId: ord?.lastOrderExternalSellerId ?? null,
      hasOrderWithoutNomusSeller: ord?.hasOrderWithoutNomusSeller ?? false,
      hasOwnerSellerDivergence: ownerDiffersFromOrderSellers(manual, ord),
    };
  });
}

export async function fetchOpenPortfolioCustomerIds(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> }
): Promise<string[]> {
  const ids = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT DISTINCT c.id
    FROM "Customer" c
    WHERE ${buildCustomerHasOpenPortfolioExistsSql(Prisma.sql`c.id`)}
  `);
  return ids.map((r) => r.id);
}

export function buildCrmCustomerListAndWhere(
  parts: (Prisma.CustomerWhereInput | undefined)[]
): Prisma.CustomerWhereInput {
  const andParts = parts.filter((p): p is Prisma.CustomerWhereInput => p !== undefined);
  if (andParts.length === 0) return {};
  if (andParts.length === 1) return andParts[0]!;
  return { AND: andParts };
}

export function buildSellerFilterSqlForOrders(
  sellerQuery: CrmCustomerListSellerQuery,
  commercialScope: CrmCommercialAccessScope
): Prisma.Sql {
  if (commercialScope.dataScope === "own") {
    return buildCrmSellerFilterSql("so", {
      externalSellerId: commercialScope.externalSellerId,
      responsible: commercialScope.responsible,
      sellerIdentityKey: commercialScope.sellerIdentityKey,
    });
  }
  if (sellerQuery.sellerIdentityKey || sellerQuery.externalSellerId !== null) {
    const match = crmCommercialSellerMatchFilters(
      sellerQuery.externalSellerId,
      null,
      sellerQuery.sellerIdentityKey
    );
    return buildCrmSellerFilterSql("so", {
      externalSellerId: match.externalSellerId,
      responsible: match.responsible,
      sellerIdentityKey: match.sellerIdentityKey,
    });
  }
  return Prisma.sql`TRUE`;
}

/**
 * WHERE de busca textual do cliente (puro/testável). Cobre nome/razão social (`companyName`),
 * nome fantasia (`tradeName`), e-mail, telefone, cidade, UF e inscrição estadual (`stateTaxId`).
 * O match de documento (CNPJ/CPF) entra via `taxIdMatchedIds`, pré-resolvido por SQL com
 * normalização de dígitos (suporta busca com ou sem pontuação). Retorna `undefined` quando
 * não há termo de busca — assim a busca se combina por AND com o escopo do vendedor.
 */
export function buildCrmCustomerSearchWhere(
  search: string,
  taxIdMatchedIds: string[] = []
): Prisma.CustomerWhereInput | undefined {
  const term = search.trim();
  if (term.length === 0) return undefined;
  const ors: Prisma.CustomerWhereInput[] = [
    { companyName: { contains: term, mode: "insensitive" } },
    { tradeName: { contains: term, mode: "insensitive" } },
    { email: { contains: term, mode: "insensitive" } },
    { phone: { contains: term, mode: "insensitive" } },
    { city: { contains: term, mode: "insensitive" } },
    { state: { contains: term, mode: "insensitive" } },
    { stateTaxId: { contains: term, mode: "insensitive" } },
  ];
  if (taxIdMatchedIds.length > 0) ors.push({ id: { in: taxIdMatchedIds } });
  return { OR: ors };
}

export type FetchCrmCustomersListInput = {
  search: string;
  filter: CrmCustomerListFilter;
  limit: number;
  offset: number;
  sellerQuery: CrmCustomerListSellerQuery;
  dateFrom?: string | null;
  dateTo?: string | null;
};

function emptyListResponse(args: {
  limit: number;
  offset: number;
  commercialScope: CrmCommercialAccessScope;
  sellerQuery: CrmCustomerListSellerQuery;
  period: { dateFrom: string; dateTo: string };
}): CrmCustomersListResponse {
  return {
    customers: [],
    pagination: { limit: args.limit, offset: args.offset, returned: 0, hasMore: false },
    scope: {
      dataScope: args.commercialScope.dataScope,
      sellerFilterActive:
        args.commercialScope.dataScope === "global" &&
        (args.sellerQuery.sellerIdentityKey !== null ||
          args.sellerQuery.externalSellerId !== null),
      portfolioAxis: "RESPONSAVEL_COMERCIAL_CLIENTE",
    },
    period: args.period,
    totals: {
      customersWithoutCommercialOwner: 0,
      customersWithoutPurchase: 0,
      customersWithOrderWithoutNomusSeller: 0,
      customersWithOwnerSellerDivergence: 0,
    },
    sourceInfo: buildCrmCustomersListSourceInfo(args.period),
  };
}

export async function fetchCrmCustomersList(
  prisma: PrismaClient,
  commercialScope: CrmCommercialAccessScope,
  input: FetchCrmCustomersListInput,
  now = new Date()
): Promise<CrmCustomersListResponse> {
  const { search, filter, limit, offset, sellerQuery } = input;
  const period = resolveCrmCustomersListPeriod(
    { dateFrom: input.dateFrom, dateTo: input.dateTo },
    now
  );
  const periodFrom = new Date(`${period.dateFrom}T00:00:00`);
  const periodTo = new Date(`${period.dateTo}T23:59:59.999`);

  let searchWhere: Prisma.CustomerWhereInput | undefined;
  if (search.length > 0) {
    const digits = search.replace(/\D/g, "");
    let taxIdIds: string[] = [];
    if (digits.length >= 2) {
      const like = `%${digits}%`;
      taxIdIds = (
        await prisma.$queryRaw<{ id: string }[]>(
          Prisma.sql`
            SELECT c."id"
            FROM "Customer" c
            WHERE regexp_replace(COALESCE(c."taxId", ''), '[^0-9]', '', 'g') LIKE ${like}
          `
        )
      ).map((r) => r.id);
    }
    searchWhere = buildCrmCustomerSearchWhere(search, taxIdIds);
  }

  const filterWhere =
    filter === "withOpenPortfolio" ? undefined : buildCrmCustomerListFilterWhere(filter, now);

  const scopeWhere = await resolveCrmCustomerListScopeWhere(prisma, commercialScope, sellerQuery);
  let where = buildCrmCustomerListAndWhere([scopeWhere, filterWhere, searchWhere]);

  if (filter === "withOpenPortfolio") {
    const openIds = await fetchOpenPortfolioCustomerIds(prisma);
    if (openIds.length === 0) {
      return emptyListResponse({ limit, offset, commercialScope, sellerQuery, period });
    }
    where = buildCrmCustomerListAndWhere([where, { id: { in: openIds } }]);
  }

  const take = limit + 1;
  const rows = await prisma.customer.findMany({
    where,
    orderBy: { companyName: "asc" },
    skip: offset,
    take,
    select: {
      id: true,
      companyName: true,
      tradeName: true,
      taxId: true,
      email: true,
      phone: true,
      city: true,
      state: true,
      address: true,
    },
  });

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const ids = pageRows.map((r) => r.id);

  const activityAgg = new Map<string, ActivityAgg>();
  const orderEnrichment = new Map<string, SalesOrderEnrichment>();

  if (ids.length > 0) {
    const activities = await prisma.commercialActivity.findMany({
      where: { customerId: { in: ids } },
      select: {
        customerId: true,
        contactDate: true,
        createdAt: true,
        nextActionAt: true,
        status: true,
      },
    });
    for (const [k, v] of aggregateCustomerActivities(activities, now)) {
      activityAgg.set(k, v);
    }

    // Histórico oficial: todos os pedidos do cliente (sem filtrar por vendedor Nomus).
    const orders = await prisma.$queryRaw<
      {
        customer_id: string;
        order_code: string | null;
        responsible: string | null;
        nomus_seller_name: string | null;
        external_seller_id: number | null;
        status: string;
        issue_date: Date;
        total_net_value: unknown;
        nomus_raw_response: unknown;
      }[]
    >(
      Prisma.sql`
        SELECT
          so."customerId" AS customer_id,
          so."orderCode" AS order_code,
          so."responsible" AS responsible,
          so."nomusSellerName" AS nomus_seller_name,
          so."externalSellerId" AS external_seller_id,
          so.status::text AS status,
          so."issueDate" AS issue_date,
          so."totalNetValue" AS total_net_value,
          so."nomusRawResponse" AS nomus_raw_response
        FROM "SalesOrder" so
        WHERE so."customerId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
          AND so.status::text NOT IN ('CANCELLED', 'ERROR')
        ORDER BY so."issueDate" DESC
      `
    );

    const mappedOrders = orders.map((o) => ({
      customerId: o.customer_id,
      orderCode: o.order_code,
      responsible: o.responsible,
      nomusSellerName: o.nomus_seller_name,
      externalSellerId: o.external_seller_id,
      status: o.status,
      issueDate: o.issue_date,
      totalNetValue: o.total_net_value,
      nomusRawResponse: o.nomus_raw_response,
    }));
    for (const [k, v] of enrichCustomersFromSalesOrders(mappedOrders, {
      now,
      periodFrom,
      periodTo,
    })) {
      orderEnrichment.set(k, v);
    }

    const itemRows = await prisma.$queryRaw<
      {
        customer_id: string;
        product_id: string | null;
        product_name: string | null;
        sku: string | null;
        revenue: unknown;
        quantity: unknown;
      }[]
    >(Prisma.sql`
      SELECT
        so."customerId" AS customer_id,
        soi."productId" AS product_id,
        soi."productNameSnapshot" AS product_name,
        soi."skuSnapshot" AS sku,
        soi."totalNetValue" AS revenue,
        soi.quantity AS quantity
      FROM "SalesOrderItem" soi
      INNER JOIN "SalesOrder" so ON so.id = soi."salesOrderId"
      WHERE so."customerId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        AND so.status::text NOT IN ('CANCELLED', 'ERROR')
    `);

    const leadingByCustomer = enrichLeadingProductsFromOrderItems(
      itemRows.map((r) => ({
        customerId: r.customer_id,
        productId: r.product_id,
        productName: r.product_name,
        sku: r.sku,
        revenue: r.revenue,
        quantity: r.quantity,
      }))
    );
    for (const [customerId, leading] of leadingByCustomer) {
      const cur = orderEnrichment.get(customerId);
      if (cur) cur.leadingProduct = leading;
    }
  }

  const manualOwners =
    ids.length > 0 ? await loadManualCommercialOwnersForCustomers(ids) : new Map();

  const customers = mapCustomerRowsToListItems(
    pageRows,
    activityAgg,
    orderEnrichment,
    manualOwners
  );

  return {
    customers,
    pagination: { limit, offset, returned: customers.length, hasMore },
    scope: {
      dataScope: commercialScope.dataScope,
      sellerFilterActive:
        commercialScope.dataScope === "global" &&
        (sellerQuery.sellerIdentityKey !== null || sellerQuery.externalSellerId !== null),
      portfolioAxis: "RESPONSAVEL_COMERCIAL_CLIENTE",
    },
    period,
    totals: {
      customersWithoutCommercialOwner: customers.filter((c) => !c.hasCommercialOwner).length,
      customersWithoutPurchase: customers.filter((c) => !c.hasPurchaseHistory).length,
      customersWithOrderWithoutNomusSeller: customers.filter((c) => c.hasOrderWithoutNomusSeller)
        .length,
      customersWithOwnerSellerDivergence: customers.filter((c) => c.hasOwnerSellerDivergence)
        .length,
    },
    sourceInfo: buildCrmCustomersListSourceInfo(period),
  };
}
