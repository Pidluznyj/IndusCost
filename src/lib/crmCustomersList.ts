/**
 * Listagem de clientes CRM — escopo por vendedor, filtros e enriquecimento com SalesOrder.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import type { CrmCommercialAccessScope } from "@/src/lib/crmCommercialAccessScope.js";
import { buildCrmSellerFilterSql } from "@/src/lib/crmSellerMatchSql.js";
import {
  buildCrmSellerCustomerPortfolioWhere,
  buildCrmSellerSalesOrderWhere,
} from "@/src/lib/crmCustomerSellerScope.js";
import { crmCommercialSellerMatchFilters } from "@/src/lib/crmCommercialAccessScope.js";
import {
  buildManualCommercialOwnerPortfolioWhere,
  loadManualCommercialOwnersForCustomers,
} from "@/src/lib/crmCustomerCommercialOwner.js";
import type { ResolvedCustomerCommercialOwner } from "@/src/lib/crmCustomerCommercialOwnerTypes.js";
import { normalizeSellerIdentityName } from "@/src/lib/crmSellerIdentityConsolidation.js";
import { resolveSalesOrderHasInvoicing } from "@/src/lib/crmCommercialOrderRules.js";
import {
  CRM_CUSTOMER_LIST_FILTERS,
  type CrmCustomerListFilter,
  type CrmCustomerListItem,
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

/** Escopo efetivo da carteira: own do usuário ou filtro de vendedor escolhido pelo gestor. */
export function buildCrmCustomerListScopeWhere(
  commercialScope: CrmCommercialAccessScope,
  sellerQuery: CrmCustomerListSellerQuery
): Prisma.CustomerWhereInput | undefined {
  if (commercialScope.dataScope === "own") {
    return buildCrmSellerCustomerPortfolioWhere(commercialScope);
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

  const orderMatch: Prisma.CustomerWhereInput = {
    salesOrders: {
      some: buildCrmSellerSalesOrderWhere(
        match.externalSellerId,
        match.responsible,
        match.sellerIdentityKey
      ),
    },
  };

  const manualWhere = buildManualCommercialOwnerPortfolioWhere({
    externalSellerId: match.externalSellerId,
    responsible: match.responsible,
    sellerIdentityKey: match.sellerIdentityKey,
  });
  const manualMatch: Prisma.CustomerWhereInput | undefined = manualWhere
    ? { CrmCustomerCommercialOwner: { is: manualWhere } }
    : undefined;

  if (manualMatch) {
    return { OR: [orderMatch, manualMatch] };
  }
  return orderMatch;
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
  primarySellerResponsible: string | null;
  primaryExternalSellerId: number | null;
  hasPurchaseHistory: boolean;
  hasOpenPortfolio: boolean;
};

export function enrichCustomersFromSalesOrders(
  orders: {
    customerId: string;
    responsible: string | null;
    externalSellerId: number | null;
    status: string;
    issueDate: Date;
    nomusRawResponse: unknown;
  }[]
): Map<string, SalesOrderEnrichment> {
  const byCustomer = new Map<string, SalesOrderEnrichment>();
  const sorted = [...orders].sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime());

  for (const order of sorted) {
    const valid = !["CANCELLED", "ERROR"].includes(String(order.status));
    const current = byCustomer.get(order.customerId) ?? {
      primarySellerResponsible: null,
      primaryExternalSellerId: null,
      hasPurchaseHistory: false,
      hasOpenPortfolio: false,
    };

    if (!current.primarySellerResponsible && order.responsible?.trim()) {
      current.primarySellerResponsible = order.responsible.trim();
      current.primaryExternalSellerId = order.externalSellerId;
    }

    if (valid) {
      current.hasPurchaseHistory = true;
      if (!resolveSalesOrderHasInvoicing({ status: order.status, nomusRawResponse: order.nomusRawResponse })) {
        current.hasOpenPortfolio = true;
      }
    }

    byCustomer.set(order.customerId, current);
  }
  return byCustomer;
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
      primarySellerResponsible:
        manual?.sellerCanonicalName ?? ord?.primarySellerResponsible ?? null,
      primaryExternalSellerId:
        manual?.sellerExternalId ?? ord?.primaryExternalSellerId ?? null,
      hasPurchaseHistory: ord?.hasPurchaseHistory ?? false,
      hasOpenPortfolio: ord?.hasOpenPortfolio ?? false,
      hasOverdueFollowUp: agg?.hasOverdueFollowUp ?? false,
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

export type FetchCrmCustomersListInput = {
  search: string;
  filter: CrmCustomerListFilter;
  limit: number;
  offset: number;
  sellerQuery: CrmCustomerListSellerQuery;
};

export async function fetchCrmCustomersList(
  prisma: PrismaClient,
  commercialScope: CrmCommercialAccessScope,
  input: FetchCrmCustomersListInput,
  now = new Date()
) {
  const { search, filter, limit, offset, sellerQuery } = input;

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
    const ors: Prisma.CustomerWhereInput[] = [
      { companyName: { contains: search, mode: "insensitive" } },
      { tradeName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
      { city: { contains: search, mode: "insensitive" } },
      { state: { contains: search, mode: "insensitive" } },
    ];
    if (taxIdIds.length > 0) ors.push({ id: { in: taxIdIds } });
    searchWhere = { OR: ors };
  }

  const filterWhere =
    filter === "withOpenPortfolio" ? undefined : buildCrmCustomerListFilterWhere(filter, now);

  const scopeWhere = buildCrmCustomerListScopeWhere(commercialScope, sellerQuery);
  let where = buildCrmCustomerListAndWhere([scopeWhere, filterWhere, searchWhere]);

  if (filter === "withOpenPortfolio") {
    const openIds = await fetchOpenPortfolioCustomerIds(prisma);
    if (openIds.length === 0) {
      return {
        customers: [] as CrmCustomerListItem[],
        pagination: { limit, offset, returned: 0, hasMore: false },
        scope: {
          dataScope: commercialScope.dataScope,
          sellerFilterActive:
            commercialScope.dataScope === "global" &&
            (sellerQuery.sellerIdentityKey !== null || sellerQuery.externalSellerId !== null),
        },
      };
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

    const sellerMatchSql = buildSellerFilterSqlForOrders(sellerQuery, commercialScope);
    const orders = await prisma.$queryRaw<
      {
        customer_id: string;
        responsible: string | null;
        external_seller_id: number | null;
        status: string;
        issue_date: Date;
        nomus_raw_response: unknown;
      }[]
    >(
      Prisma.sql`
        SELECT
          so."customerId" AS customer_id,
          so."responsible" AS responsible,
          so."externalSellerId" AS external_seller_id,
          so.status::text AS status,
          so."issueDate" AS issue_date,
          so."nomusRawResponse" AS nomus_raw_response
        FROM "SalesOrder" so
        WHERE so."customerId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
          AND so.status::text NOT IN ('CANCELLED', 'ERROR')
          AND ${sellerMatchSql}
        ORDER BY so."issueDate" DESC
      `
    );

    const mappedOrders = orders.map((o) => ({
      customerId: o.customer_id,
      responsible: o.responsible,
      externalSellerId: o.external_seller_id,
      status: o.status,
      issueDate: o.issue_date,
      nomusRawResponse: o.nomus_raw_response,
    }));
    for (const [k, v] of enrichCustomersFromSalesOrders(mappedOrders)) {
      orderEnrichment.set(k, v);
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
    },
  };
}
