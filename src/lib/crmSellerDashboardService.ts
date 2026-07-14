/**
 * Serviço do GET /api/crm/seller-dashboard (aba "Gestão por Vendedor").
 *
 * Eixo oficial de carteira: Responsável Comercial do Cliente (CrmCustomerCommercialOwner).
 * Vendedor Nomus do pedido: auditoria/divergência apenas — não define carteira nem comissão nesta visão.
 * Fonte de pedidos: SalesOrder / SalesOrderItem (sem Proposal).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import { sellerDashIso, sellerDashToNumber } from "@/src/lib/crmSellerDashboard";
import {
  buildRawSellerKeyFromRow,
  consolidateSellerRowFragments,
  consolidatedIdentityMatchesUser,
  consolidatedOptionToSellerOption,
  normalizeSellerIdentityName,
} from "@/src/lib/crmSellerIdentityConsolidation";
import {
  buildCrmSalesOrderMetrics,
  CRM_SALES_ORDER_METRICS_PRISMA_SELECT,
  injectCommercialResponsibleIntoOrders,
  type CrmMetricsOrderInput,
} from "@/src/lib/commercial/crmSalesOrderMetricsService.js";
import { resolveCommercialResponsibleMap } from "@/src/lib/commercial/crmCommercialResponsibleResolver.js";
import { loadSalesOrderLinkedNfeContextMap } from "@/src/lib/salesOrderLinkedNfe.js";
import {
  buildCrmCommercialOwnerOnlyOrderScopeSql,
  buildCrmOrderSellerNameSql,
  buildCrmSellerFilterSql,
  hasCrmSellerMatchFilter,
  type CrmSellerMatchFilter,
} from "@/src/lib/crmSellerMatchSql";
import { fetchCrmManualOwnerCustomerIds } from "@/src/lib/crmCustomersList";
import { crmOrderWithoutFollowUpNotExistsSql } from "@/src/lib/crmOrderPortfolioSql";
import {
  buildSellerDashboardSourceInfo,
  mergeOfficialMetricsIntoSellerSummary,
  resolveSelectedCommercialOwnerLabel,
} from "@/src/lib/crmSellerDashboardOfficialOrders.js";
import type { SellerDashboardResponse } from "@/src/components/crmSellerDashboardTypes";

const LIST_LIMIT = 20;
const DATE_YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export type SellerDashboardRequest = {
  scopeMode: "all" | "own";
  /** Responsável da carteira */
  externalSellerId: number | null;
  responsible: string | null;
  sellerIdentityKey: string | null;
  /** Vendedor do pedido (Nomus) — opcional, AND sobre o escopo de carteira */
  orderSellerExternalId?: number | null;
  orderSellerResponsible?: string | null;
  orderSellerIdentityKey?: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  linkedUser?: {
    externalSellerId: number | null;
    sellerResponsibleName: string | null;
  } | null;
};

function salesOrderMatchesOrderSellerFilter(
  order: {
    externalSellerId?: number | null;
    nomusSellerName?: string | null;
    responsible?: string | null;
  },
  filter: CrmSellerMatchFilter
): boolean {
  if (!hasCrmSellerMatchFilter(filter)) return true;
  const name = (order.nomusSellerName?.trim() || order.responsible?.trim() || "") || null;
  const norm = name ? normalizeSellerIdentityName(name) : "";
  const key = filter.sellerIdentityKey?.trim();
  if (key) {
    if (key.startsWith("__ID_ONLY__:")) {
      const id = Number.parseInt(key.slice("__ID_ONLY__:".length), 10);
      return Number.isFinite(id) && order.externalSellerId === id;
    }
    return norm === normalizeSellerIdentityName(key);
  }
  if (filter.externalSellerId != null) {
    return order.externalSellerId === filter.externalSellerId;
  }
  if (filter.responsible?.trim()) {
    return norm === normalizeSellerIdentityName(filter.responsible);
  }
  return true;
}

export class SellerDashboardBadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SellerDashboardBadRequest";
  }
}

type YmdParse = string | null | "INVALID";

function parseYmdDate(raw: unknown): YmdParse {
  if (raw === undefined || raw === null || raw === "") return null;
  const s = String(raw).trim();
  if (!DATE_YMD_RE.test(s)) return "INVALID";
  const [ys, ms, ds] = s.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return "INVALID";
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return "INVALID";
  }
  return s;
}

function mapRowToMetricsOrder(row: any): CrmMetricsOrderInput {
  return {
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
          // Customer não tem externalCustomerId — espelha o do pedido.
          externalCustomerId: row.externalCustomerId ?? null,
          // Injetado depois por resolveCommercialResponsibleMap.
          CrmCustomerCommercialOwner: null,
        }
      : null,
    items: (row.items ?? []).map((item: any) => ({
      productId: item.productId,
      skuSnapshot: item.skuSnapshot,
      productNameSnapshot: item.productNameSnapshot,
      quantity: item.quantity,
      totalNetValue: item.totalNetValue,
    })),
  };
}

function emptyMetricsPayload(args: {
  now: Date;
  filterExternalSellerId: number | null;
  filterResponsible: string | null;
  filterSellerIdentityKey: string | null;
  filterOrderSellerExternalId?: number | null;
  filterOrderSellerResponsible?: string | null;
  filterOrderSellerIdentityKey?: string | null;
  filterDateFrom: string | null;
  filterDateTo: string | null;
  sellerOptions: SellerDashboardResponse["sellerOptions"];
  orderSellerOptions?: SellerDashboardResponse["orderSellerOptions"];
  customerCount: number;
  emptyStateReason: SellerDashboardResponse["emptyStateReason"];
}): SellerDashboardResponse {
  const summary = mergeOfficialMetricsIntoSellerSummary({
    metrics: buildCrmSalesOrderMetrics({ orders: [] }),
    ordersWithoutLinkedProposalCount: 0,
  });
  const sourceInfo = buildSellerDashboardSourceInfo({
    metricsSource: summary.metricsSource,
    period: { dateFrom: args.filterDateFrom, dateTo: args.filterDateTo },
  });
  return {
    generatedAt: args.now.toISOString(),
    filters: {
      externalSellerId: args.filterExternalSellerId,
      responsible: args.filterResponsible,
      sellerIdentityKey: args.filterSellerIdentityKey,
      orderSellerExternalId: args.filterOrderSellerExternalId ?? null,
      orderSellerResponsible: args.filterOrderSellerResponsible ?? null,
      orderSellerIdentityKey: args.filterOrderSellerIdentityKey ?? null,
      dateFrom: args.filterDateFrom,
      dateTo: args.filterDateTo,
    },
    selectedCommercialOwner: {
      label: resolveSelectedCommercialOwnerLabel({
        responsible: args.filterResponsible,
        sellerIdentityKey: args.filterSellerIdentityKey,
        externalSellerId: args.filterExternalSellerId,
      }),
      sellerIdentityKey: args.filterSellerIdentityKey,
      externalSellerId: args.filterExternalSellerId,
      customerCount: args.customerCount,
    },
    period: { dateFrom: args.filterDateFrom, dateTo: args.filterDateTo },
    sellerOptions: args.sellerOptions,
    orderSellerOptions: args.orderSellerOptions ?? [],
    summary,
    totalOrders: 0,
    totalOrderValue: 0,
    openPortfolioOrderCount: 0,
    openPortfolioValue: 0,
    invoicedOrderCount: 0,
    invoicedValue: 0,
    canceledOrders: 0,
    averageTicket: 0,
    customersWithOrders: 0,
    leadingProduct: null,
    topCustomers: [],
    recentOrders: [],
    followUpCandidates: [],
    ordersWithoutNomusSeller: 0,
    ordersWithDifferentNomusSeller: 0,
    bySeller: [],
    openPortfolioOrders: [],
    invoicedOrders: [],
    ordersWithoutLinkedProposal: [],
    sourceInfo,
    emptyStateReason: args.emptyStateReason,
  };
}

export async function buildCrmSellerDashboardResponse(
  input: SellerDashboardRequest,
  now = new Date()
): Promise<SellerDashboardResponse> {
  const filterDateFrom = parseYmdDate(input.dateFrom);
  if (filterDateFrom === "INVALID") {
    throw new SellerDashboardBadRequest(
      "dateFrom inválido. Use o formato YYYY-MM-DD (ex.: 2026-05-01)."
    );
  }
  const filterDateTo = parseYmdDate(input.dateTo);
  if (filterDateTo === "INVALID") {
    throw new SellerDashboardBadRequest(
      "dateTo inválido. Use o formato YYYY-MM-DD (ex.: 2026-05-31)."
    );
  }
  if (filterDateFrom && filterDateTo && filterDateFrom > filterDateTo) {
    throw new SellerDashboardBadRequest("dateFrom não pode ser maior que dateTo.");
  }

  const filterExternalSellerId = input.externalSellerId;
  const filterResponsible = input.responsible;
  const filterSellerIdentityKey =
    input.sellerIdentityKey?.trim() ||
    (filterResponsible?.trim() ? normalizeSellerIdentityName(filterResponsible) : null);
  const sellerScopeMode = input.scopeMode;
  const nowMs = now.getTime();

  const hasPeriodFilter = filterDateFrom !== null || filterDateTo !== null;
  const periodDateFromStart = filterDateFrom ? new Date(`${filterDateFrom}T00:00:00`) : null;
  const periodDateToEnd = filterDateTo ? new Date(`${filterDateTo}T23:59:59.999`) : null;

  const sellerFilter = {
    externalSellerId: filterExternalSellerId,
    responsible: filterResponsible,
    sellerIdentityKey: filterSellerIdentityKey,
  };
  const orderSellerFilter: CrmSellerMatchFilter = {
    externalSellerId: input.orderSellerExternalId ?? null,
    responsible: input.orderSellerResponsible?.trim() || null,
    sellerIdentityKey:
      input.orderSellerIdentityKey?.trim() ||
      (input.orderSellerResponsible?.trim()
        ? normalizeSellerIdentityName(input.orderSellerResponsible)
        : null),
  };
  const hasOwnerFilter = hasCrmSellerMatchFilter(sellerFilter);
  const hasOrderSellerFilter = hasCrmSellerMatchFilter(orderSellerFilter);
  const commercialOwnerCustomerIds = await fetchCrmManualOwnerCustomerIds(prisma, sellerFilter);
  const soOwnerScope = buildCrmCommercialOwnerOnlyOrderScopeSql(
    "so",
    sellerFilter,
    commercialOwnerCustomerIds
  );
  const soOrderSellerScope = hasOrderSellerFilter
    ? buildCrmSellerFilterSql("so", orderSellerFilter)
    : Prisma.sql`TRUE`;
  /** Carteira (owner) AND vendedor do pedido (opcional). */
  const soOrdersAxisScope = Prisma.sql`(${soOwnerScope}) AND (${soOrderSellerScope})`;

  const orderSellerNameSql = buildCrmOrderSellerNameSql("so");
  const customerNameSql = Prisma.sql`
    COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName")
  `;

  const nomusNfesElementsSql = (alias: string) => Prisma.sql`
    jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(${Prisma.raw(`${alias}."nomusRawResponse"`)}->'nfes') = 'array'
        THEN ${Prisma.raw(`${alias}."nomusRawResponse"`)}->'nfes'
        ELSE '[]'::jsonb
      END
    ) AS nfe
  `;

  const orderIsInvoicedSql = (alias: string) => Prisma.sql`
    EXISTS (
      SELECT 1
      FROM ${nomusNfesElementsSql(alias)}
      WHERE NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'dataProcessamento', '')), '') IS NOT NULL
    )
  `;

  const nfeProcessamentoDateSql = Prisma.sql`
    CASE
      WHEN NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'dataProcessamento', '')), '') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
      THEN to_date(TRIM(nfe->>'dataProcessamento'), 'DD/MM/YYYY')
      ELSE NULL
    END
  `;

  const nfeProcessamentoInPeriodSql = () => {
    if (!hasPeriodFilter) {
      return Prisma.sql`NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'dataProcessamento', '')), '') IS NOT NULL`;
    }
    const parts: Prisma.Sql[] = [Prisma.sql`(${nfeProcessamentoDateSql}) IS NOT NULL`];
    if (filterDateFrom) {
      parts.push(Prisma.sql`(${nfeProcessamentoDateSql}) >= ${filterDateFrom}::date`);
    }
    if (filterDateTo) {
      parts.push(Prisma.sql`(${nfeProcessamentoDateSql}) <= ${filterDateTo}::date`);
    }
    return Prisma.join(parts, " AND ");
  };

  const orderHasInvoicedNfeInPeriodSql = Prisma.sql`
    EXISTS (
      SELECT 1
      FROM ${nomusNfesElementsSql("so")}
      WHERE ${nfeProcessamentoInPeriodSql()}
    )
  `;

  const soInvoicedMetricSql = hasPeriodFilter ? orderHasInvoicedNfeInPeriodSql : orderIsInvoicedSql("so");

  const soIssueDateInPeriodSql = () => {
    if (!hasPeriodFilter) return Prisma.sql`TRUE`;
    if (periodDateFromStart && periodDateToEnd) {
      return Prisma.sql`so."issueDate" >= ${periodDateFromStart} AND so."issueDate" <= ${periodDateToEnd}`;
    }
    if (periodDateFromStart) return Prisma.sql`so."issueDate" >= ${periodDateFromStart}`;
    if (periodDateToEnd) return Prisma.sql`so."issueDate" <= ${periodDateToEnd}`;
    return Prisma.sql`TRUE`;
  };

  const soOrdersScopeSql = hasPeriodFilter ? soIssueDateInPeriodSql() : Prisma.sql`TRUE`;
  const soValidMetricsSql = Prisma.sql`so.status::text NOT IN ('CANCELLED', 'ERROR')`;
  const soValidOrdersScopeSql = Prisma.sql`${soOrdersScopeSql} AND ${soValidMetricsSql}`;
  const soOpenPortfolioScopeSql = Prisma.sql`${soValidOrdersScopeSql} AND NOT ${orderIsInvoicedSql("so")}`;
  const orderNoFollowUpSql = crmOrderWithoutFollowUpNotExistsSql("so");

  // Opções do seletor = responsáveis comerciais (não vendedores Nomus do pedido).
  const commercialOwnerOptionRows = await prisma.$queryRaw<
    {
      external_seller_id: number | null;
      responsible: string | null;
      seller_identity_key: string | null;
      customers_count: number;
      orders_count: number;
    }[]
  >(Prisma.sql`
    SELECT
      MAX(own."sellerExternalId") AS external_seller_id,
      MAX(COALESCE(NULLIF(TRIM(own."sellerCanonicalName"), ''), NULLIF(TRIM(own."sellerResponsibleName"), ''))) AS responsible,
      own."sellerIdentityKey" AS seller_identity_key,
      COUNT(DISTINCT own."customerId")::int AS customers_count,
      COUNT(so.id) FILTER (WHERE ${soValidOrdersScopeSql})::int AS orders_count
    FROM "CrmCustomerCommercialOwner" own
    LEFT JOIN "SalesOrder" so
      ON so."customerId" = own."customerId"
      AND ${soOrdersScopeSql}
    WHERE own."isActive" = true
      AND NULLIF(TRIM(COALESCE(own."sellerIdentityKey", '')), '') IS NOT NULL
    GROUP BY own."sellerIdentityKey"
    ORDER BY orders_count DESC, responsible ASC NULLS LAST
  `);

  const consolidatedOptions = consolidateSellerRowFragments(
    commercialOwnerOptionRows.map((row) => ({
      external_seller_id: row.external_seller_id,
      responsible: row.responsible,
      orders_count: row.orders_count,
    }))
  );
  const scopedConsolidated =
    sellerScopeMode === "own" && input.linkedUser
      ? consolidatedOptions.filter((opt) =>
          consolidatedIdentityMatchesUser(opt, input.linkedUser!)
        )
      : consolidatedOptions;
  const sellerOptions = scopedConsolidated.map(consolidatedOptionToSellerOption);

  // Opções do filtro Vendedor do pedido = vendedores Nomus em SalesOrder (não owners).
  const orderSellerOptionRows = await prisma.$queryRaw<
    {
      external_seller_id: number | null;
      responsible: string | null;
      orders_count: number;
    }[]
  >(Prisma.sql`
    SELECT
      so."externalSellerId" AS external_seller_id,
      ${orderSellerNameSql} AS responsible,
      COUNT(*)::int AS orders_count
    FROM "SalesOrder" so
    WHERE so.status::text NOT IN ('CANCELLED', 'ERROR')
      AND (
        so."externalSellerId" IS NOT NULL
        OR (so."nomusSellerName" IS NOT NULL AND TRIM(so."nomusSellerName") <> '')
        OR (so."responsible" IS NOT NULL AND TRIM(so."responsible") <> '')
      )
      AND (${soOwnerScope})
    GROUP BY so."externalSellerId", ${orderSellerNameSql}
    ORDER BY orders_count DESC, responsible ASC NULLS LAST
    LIMIT 200
  `);
  const orderSellerOptions = consolidateSellerRowFragments(
    orderSellerOptionRows.map((row) => ({
      external_seller_id: row.external_seller_id,
      responsible: row.responsible,
      orders_count: row.orders_count,
    }))
  ).map(consolidatedOptionToSellerOption);

  // Escopo `own` nunca pode cair em where aberto: sem filtro / IDs vazios
  // → dashboard vazio (vendedor sem carteira ou sem vínculo). Evita 500 e vazamento.
  if (
    sellerScopeMode === "own" &&
    (!hasOwnerFilter || commercialOwnerCustomerIds.length === 0)
  ) {
    return emptyMetricsPayload({
      now,
      filterExternalSellerId,
      filterResponsible,
      filterSellerIdentityKey,
      filterOrderSellerExternalId: orderSellerFilter.externalSellerId,
      filterOrderSellerResponsible: orderSellerFilter.responsible,
      filterOrderSellerIdentityKey: orderSellerFilter.sellerIdentityKey,
      filterDateFrom,
      filterDateTo,
      sellerOptions,
      orderSellerOptions,
      customerCount: 0,
      emptyStateReason: "NO_CUSTOMERS_FOR_COMMERCIAL_OWNER",
    });
  }

  if (hasOwnerFilter && commercialOwnerCustomerIds.length === 0) {
    return emptyMetricsPayload({
      now,
      filterExternalSellerId,
      filterResponsible,
      filterSellerIdentityKey,
      filterOrderSellerExternalId: orderSellerFilter.externalSellerId,
      filterOrderSellerResponsible: orderSellerFilter.responsible,
      filterOrderSellerIdentityKey: orderSellerFilter.sellerIdentityKey,
      filterDateFrom,
      filterDateTo,
      sellerOptions,
      orderSellerOptions,
      customerCount: 0,
      emptyStateReason: "NO_CUSTOMERS_FOR_COMMERCIAL_OWNER",
    });
  }

  const orderWhere: Record<string, unknown> = {};
  if (hasOwnerFilter) {
    orderWhere.customerId = { in: commercialOwnerCustomerIds };
  } else if (sellerScopeMode === "own") {
    // Cinto de segurança: own sem IDs nunca consulta o universo.
    orderWhere.customerId = { in: [] as string[] };
  }
  if (periodDateFromStart || periodDateToEnd) {
    orderWhere.issueDate = {
      ...(periodDateFromStart ? { gte: periodDateFromStart } : {}),
      ...(periodDateToEnd ? { lte: periodDateToEnd } : {}),
    };
  }

  const [
    metricsRows,
    openPortfolioRows,
    invoicedRows,
    recentOrderRows,
    followUpRows,
    ordersNoProposalRows,
    proposalLinkCountRow,
  ] = await Promise.all([
    prisma.salesOrder.findMany({
      where: orderWhere as never,
      select: CRM_SALES_ORDER_METRICS_PRISMA_SELECT as never,
      orderBy: { issueDate: "desc" },
      take: 20000,
    }),
    prisma.$queryRaw<
      {
        sales_order_id: string;
        order_code: string;
        external_sales_order_id: number | null;
        customer_id: string;
        customer_name: string;
        responsible: string | null;
        nomus_seller_name: string | null;
        commercial_owner_name: string | null;
        external_seller_id: number | null;
        issue_date: Date;
        expected_delivery_date: Date | null;
        total_net_value: unknown;
      }[]
    >(Prisma.sql`
      SELECT
        so.id AS sales_order_id,
        so."orderCode" AS order_code,
        so."externalSalesOrderId" AS external_sales_order_id,
        so."customerId" AS customer_id,
        ${customerNameSql} AS customer_name,
        ${orderSellerNameSql} AS responsible,
        NULLIF(TRIM(COALESCE(so."nomusSellerName", '')), '') AS nomus_seller_name,
        COALESCE(NULLIF(TRIM(own."sellerCanonicalName"), ''), NULLIF(TRIM(own."sellerResponsibleName"), '')) AS commercial_owner_name,
        so."externalSellerId" AS external_seller_id,
        so."issueDate" AS issue_date,
        so."expectedDeliveryDate" AS expected_delivery_date,
        so."totalNetValue" AS total_net_value
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      LEFT JOIN "CrmCustomerCommercialOwner" own
        ON own."customerId" = so."customerId" AND own."isActive" = true
      WHERE ${soOrdersAxisScope}
        AND ${soOpenPortfolioScopeSql}
      ORDER BY so."issueDate" DESC
      LIMIT ${LIST_LIMIT}
    `),
    prisma.$queryRaw<
      {
        sales_order_id: string;
        order_code: string;
        external_sales_order_id: number | null;
        customer_id: string;
        customer_name: string;
        responsible: string | null;
        nomus_seller_name: string | null;
        commercial_owner_name: string | null;
        external_seller_id: number | null;
        issue_date: Date;
        expected_delivery_date: Date | null;
        total_net_value: unknown;
        invoice_processed_at_text: string | null;
        invoice_number: string | null;
        invoice_series: string | null;
        invoice_key: string | null;
        invoice_status: string | null;
      }[]
    >(Prisma.sql`
      SELECT
        so.id AS sales_order_id,
        so."orderCode" AS order_code,
        so."externalSalesOrderId" AS external_sales_order_id,
        so."customerId" AS customer_id,
        ${customerNameSql} AS customer_name,
        ${orderSellerNameSql} AS responsible,
        NULLIF(TRIM(COALESCE(so."nomusSellerName", '')), '') AS nomus_seller_name,
        COALESCE(NULLIF(TRIM(own."sellerCanonicalName"), ''), NULLIF(TRIM(own."sellerResponsibleName"), '')) AS commercial_owner_name,
        so."externalSellerId" AS external_seller_id,
        so."issueDate" AS issue_date,
        so."expectedDeliveryDate" AS expected_delivery_date,
        so."totalNetValue" AS total_net_value,
        inv.invoice_processed_at_text,
        inv.invoice_number,
        inv.invoice_series,
        inv.invoice_key,
        inv.invoice_status
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      LEFT JOIN "CrmCustomerCommercialOwner" own
        ON own."customerId" = so."customerId" AND own."isActive" = true
      LEFT JOIN LATERAL (
        SELECT
          NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'dataProcessamento', '')), '') AS invoice_processed_at_text,
          NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'numero', '')), '') AS invoice_number,
          NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'serie', '')), '') AS invoice_series,
          NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'chave', '')), '') AS invoice_key,
          NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'status', '')), '') AS invoice_status,
          CASE
            WHEN NULLIF(TRIM(BOTH FROM COALESCE(nfe->>'dataProcessamento', '')), '') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
            THEN to_date(TRIM(nfe->>'dataProcessamento'), 'DD/MM/YYYY')
            ELSE NULL
          END AS invoice_sort_date
        FROM ${nomusNfesElementsSql("so")}
        WHERE ${nfeProcessamentoInPeriodSql()}
        ORDER BY invoice_sort_date DESC NULLS LAST, nfe->>'dataProcessamento' DESC
        LIMIT 1
      ) inv ON TRUE
      WHERE ${soOrdersAxisScope}
        AND ${soInvoicedMetricSql}
      ORDER BY inv.invoice_sort_date DESC NULLS LAST, so."issueDate" DESC
      LIMIT ${LIST_LIMIT}
    `),
    prisma.$queryRaw<
      {
        sales_order_id: string;
        order_code: string;
        external_sales_order_id: number | null;
        customer_id: string;
        customer_name: string;
        responsible: string | null;
        nomus_seller_name: string | null;
        commercial_owner_name: string | null;
        external_seller_id: number | null;
        issue_date: Date;
        expected_delivery_date: Date | null;
        total_net_value: unknown;
        is_invoiced: boolean;
      }[]
    >(Prisma.sql`
      SELECT
        so.id AS sales_order_id,
        so."orderCode" AS order_code,
        so."externalSalesOrderId" AS external_sales_order_id,
        so."customerId" AS customer_id,
        ${customerNameSql} AS customer_name,
        ${orderSellerNameSql} AS responsible,
        NULLIF(TRIM(COALESCE(so."nomusSellerName", '')), '') AS nomus_seller_name,
        COALESCE(NULLIF(TRIM(own."sellerCanonicalName"), ''), NULLIF(TRIM(own."sellerResponsibleName"), '')) AS commercial_owner_name,
        so."externalSellerId" AS external_seller_id,
        so."issueDate" AS issue_date,
        so."expectedDeliveryDate" AS expected_delivery_date,
        so."totalNetValue" AS total_net_value,
        ${orderIsInvoicedSql("so")} AS is_invoiced
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      LEFT JOIN "CrmCustomerCommercialOwner" own
        ON own."customerId" = so."customerId" AND own."isActive" = true
      WHERE ${soOrdersAxisScope}
        AND ${soIssueDateInPeriodSql()}
      ORDER BY so."issueDate" DESC
      LIMIT ${LIST_LIMIT}
    `),
    prisma.$queryRaw<
      {
        sales_order_id: string;
        order_code: string;
        customer_id: string;
        customer_name: string;
        issue_date: Date;
        total_net_value: unknown;
        updated_at: Date;
      }[]
    >(Prisma.sql`
      SELECT
        so.id AS sales_order_id,
        so."orderCode" AS order_code,
        so."customerId" AS customer_id,
        ${customerNameSql} AS customer_name,
        so."issueDate" AS issue_date,
        so."totalNetValue" AS total_net_value,
        so."updatedAt" AS updated_at
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      WHERE ${soOrdersAxisScope}
        AND ${soOpenPortfolioScopeSql}
        AND ${orderNoFollowUpSql}
      ORDER BY so."updatedAt" ASC
      LIMIT ${LIST_LIMIT}
    `),
    prisma.$queryRaw<
      {
        sales_order_id: string;
        order_code: string;
        external_sales_order_id: number | null;
        customer_id: string;
        customer_name: string;
        responsible: string | null;
        external_seller_id: number | null;
        issue_date: Date;
        total_net_value: unknown;
        is_invoiced: boolean;
      }[]
    >(Prisma.sql`
      SELECT
        so.id AS sales_order_id,
        so."orderCode" AS order_code,
        so."externalSalesOrderId" AS external_sales_order_id,
        so."customerId" AS customer_id,
        ${customerNameSql} AS customer_name,
        ${orderSellerNameSql} AS responsible,
        so."externalSellerId" AS external_seller_id,
        so."issueDate" AS issue_date,
        so."totalNetValue" AS total_net_value,
        ${orderIsInvoicedSql("so")} AS is_invoiced
      FROM "SalesOrder" so
      INNER JOIN "Customer" c ON c.id = so."customerId"
      WHERE ${soOrdersAxisScope}
        AND ${soIssueDateInPeriodSql()}
        AND so."proposalId" IS NULL
      ORDER BY so."issueDate" DESC
      LIMIT ${LIST_LIMIT}
    `),
    prisma.$queryRaw<{ c: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS c
      FROM "SalesOrder" so
      WHERE ${soOrdersAxisScope}
        AND ${soValidOrdersScopeSql}
        AND so."proposalId" IS NULL
    `),
  ]);

  const orders = (metricsRows as any[])
    .map(mapRowToMetricsOrder)
    .filter((order) => salesOrderMatchesOrderSellerFilter(order, orderSellerFilter));

  // Responsável Comercial vem do cadastro do cliente (CrmCustomerCommercialOwner),
  // NÃO do SalesOrder. Resolvido em batch para evitar N+1 e para não depender
  // do Prisma Client estar em sync com a migration em produção.
  const customerIds = orders
    .map((o) => o.customerId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const commercialResponsibleMap = await resolveCommercialResponsibleMap(
    prisma,
    customerIds
  );
  injectCommercialResponsibleIntoOrders(orders, commercialResponsibleMap);

  const linkedMap = await loadSalesOrderLinkedNfeContextMap(
    orders.map((order) => ({
      id: order.id,
      totalNetValue: order.totalNetValue,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate ?? null,
      nomusRawResponse: order.nomusRawResponse ?? null,
    })),
    now
  );

  const metrics = buildCrmSalesOrderMetrics({
    orders,
    filters: {
      from: filterDateFrom,
      to: filterDateTo,
      // Reforço do eixo carteira (já filtrado por customerId na query quando há filtro).
      responsibleCommercialId: hasOwnerFilter ? filterExternalSellerId : null,
      responsibleCommercialName: hasOwnerFilter
        ? filterResponsible || filterSellerIdentityKey
        : null,
      includeCancelled: true,
    },
    referenceDate: now,
    linkedNfeContextMap: linkedMap,
  });

  const summary = mergeOfficialMetricsIntoSellerSummary({
    metrics,
    ordersWithoutLinkedProposalCount: proposalLinkCountRow?.[0]?.c ?? 0,
  });

  const mapDeliveryDays = (expected: Date | null) => {
    if (!expected) {
      return { daysUntilExpectedDelivery: null, daysOverdue: null };
    }
    const t = expected.getTime();
    if (!Number.isFinite(t)) {
      return { daysUntilExpectedDelivery: null, daysOverdue: null };
    }
    const diffDays = Math.floor((t - nowMs) / 86400000);
    return {
      daysUntilExpectedDelivery: diffDays,
      daysOverdue: diffDays < 0 ? Math.abs(diffDays) : 0,
    };
  };

  const ownerKey = filterSellerIdentityKey
    ? normalizeSellerIdentityName(filterSellerIdentityKey)
    : filterResponsible
      ? normalizeSellerIdentityName(filterResponsible)
      : null;

  const mapOrderRow = (row: {
    sales_order_id: string;
    order_code: string;
    external_sales_order_id?: number | null;
    customer_id: string;
    customer_name: string;
    responsible: string | null;
    nomus_seller_name?: string | null;
    commercial_owner_name?: string | null;
    external_seller_id: number | null;
    issue_date: Date;
    expected_delivery_date?: Date | null;
    total_net_value: unknown;
    is_invoiced?: boolean;
    invoice_processed_at_text?: string | null;
    invoice_number?: string | null;
    invoice_series?: string | null;
    invoice_key?: string | null;
    invoice_status?: string | null;
  }) => {
    const delivery = mapDeliveryDays(row.expected_delivery_date ?? null);
    const nomusName = row.nomus_seller_name ?? row.responsible ?? null;
    const ownerName = row.commercial_owner_name ?? null;
    const nomusKey = nomusName ? normalizeSellerIdentityName(nomusName) : null;
    const differs =
      Boolean(ownerKey && nomusKey && ownerKey !== nomusKey) ||
      Boolean(
        filterExternalSellerId != null &&
          row.external_seller_id != null &&
          filterExternalSellerId !== row.external_seller_id
      );
    return {
      salesOrderId: row.sales_order_id,
      orderCode: row.order_code,
      externalSalesOrderId: row.external_sales_order_id ?? null,
      customerId: row.customer_id,
      customerName: row.customer_name,
      responsible: row.responsible ?? null,
      externalSellerId: row.external_seller_id,
      issueDate: sellerDashIso(row.issue_date),
      expectedDeliveryDate: sellerDashIso(row.expected_delivery_date ?? null),
      totalNetValue: sellerDashToNumber(row.total_net_value),
      daysUntilExpectedDelivery: delivery.daysUntilExpectedDelivery,
      daysOverdue: delivery.daysOverdue,
      invoiceProcessedAtText: row.invoice_processed_at_text,
      invoiceNumber: row.invoice_number,
      invoiceSeries: row.invoice_series,
      invoiceKey: row.invoice_key,
      invoiceStatus: row.invoice_status,
      isInvoiced: row.is_invoiced,
      nomusSellerName: nomusName,
      commercialOwnerName: ownerName,
      ownerDiffersFromNomusSeller: differs,
    };
  };

  // bySeller = auditoria do vendedor Nomus DENTRO da carteira do responsável (não redefine carteira).
  const byNomusSellerRows = await prisma.$queryRaw<
    {
      external_seller_id: number | null;
      responsible: string | null;
      orders_count: number;
      orders_value: unknown;
      invoiced_orders_count: number;
      invoiced_orders_value: unknown;
      open_orders_count: number;
      open_orders_value: unknown;
    }[]
  >(Prisma.sql`
    SELECT
      so."externalSellerId" AS external_seller_id,
      ${orderSellerNameSql} AS responsible,
      COUNT(*) FILTER (WHERE ${soValidOrdersScopeSql})::int AS orders_count,
      COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${soValidOrdersScopeSql}), 0) AS orders_value,
      COUNT(*) FILTER (WHERE ${soValidOrdersScopeSql} AND ${soInvoicedMetricSql})::int AS invoiced_orders_count,
      COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${soValidOrdersScopeSql} AND ${soInvoicedMetricSql}), 0) AS invoiced_orders_value,
      COUNT(*) FILTER (WHERE ${soOpenPortfolioScopeSql})::int AS open_orders_count,
      COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${soOpenPortfolioScopeSql}), 0) AS open_orders_value
    FROM "SalesOrder" so
    WHERE ${soOrdersAxisScope}
    GROUP BY so."externalSellerId", ${orderSellerNameSql}
    ORDER BY orders_count DESC
    LIMIT 50
  `);

  const consolidatedBySeller = consolidateSellerRowFragments(
    byNomusSellerRows.map((row) => ({
      external_seller_id: row.external_seller_id,
      responsible: row.responsible,
      orders_count: row.orders_count,
    }))
  );

  const sourceInfo = buildSellerDashboardSourceInfo({
    metricsSource: metrics.debug.metricsSource,
    rulesEngineVersion: metrics.debug.rulesEngineVersion,
    period: { dateFrom: filterDateFrom, dateTo: filterDateTo },
  });

  return {
    generatedAt: now.toISOString(),
    filters: {
      externalSellerId: filterExternalSellerId,
      responsible: filterResponsible,
      sellerIdentityKey: filterSellerIdentityKey,
      orderSellerExternalId: orderSellerFilter.externalSellerId,
      orderSellerResponsible: orderSellerFilter.responsible,
      orderSellerIdentityKey: orderSellerFilter.sellerIdentityKey,
      dateFrom: filterDateFrom,
      dateTo: filterDateTo,
    },
    selectedCommercialOwner: {
      label: resolveSelectedCommercialOwnerLabel({
        responsible: filterResponsible,
        sellerIdentityKey: filterSellerIdentityKey,
        externalSellerId: filterExternalSellerId,
      }),
      sellerIdentityKey: filterSellerIdentityKey,
      externalSellerId: filterExternalSellerId,
      customerCount: commercialOwnerCustomerIds.length,
    },
    period: { dateFrom: filterDateFrom, dateTo: filterDateTo },
    sellerOptions,
    orderSellerOptions,
    summary,
    totalOrders: metrics.totalOrders,
    totalOrderValue: metrics.totalOrderValue,
    openPortfolioOrderCount: metrics.openPortfolioOrders,
    openPortfolioValue: metrics.openPortfolioValue,
    invoicedOrderCount: metrics.invoicedOrders,
    invoicedValue: metrics.invoicedValue,
    canceledOrders: metrics.canceledOrders,
    averageTicket: metrics.averageTicket,
    customersWithOrders: metrics.customersWithOrders,
    leadingProduct: summary.topProduct,
    topCustomers: metrics.topCustomers,
    recentOrders: recentOrderRows.map(mapOrderRow),
    followUpCandidates: followUpRows.map((row) => ({
      salesOrderId: row.sales_order_id,
      orderCode: row.order_code,
      customerId: row.customer_id,
      customerName: row.customer_name,
      issueDate: sellerDashIso(row.issue_date),
      totalNetValue: sellerDashToNumber(row.total_net_value),
      daysWithoutFollowUp: Math.max(
        0,
        Math.floor((nowMs - row.updated_at.getTime()) / 86400000)
      ),
    })),
    ordersWithoutNomusSeller: metrics.ordersWithoutNomusSeller,
    ordersWithDifferentNomusSeller: metrics.ordersWithResponsibleDifferentFromOrderSeller,
    bySeller: consolidatedBySeller.map((opt) => {
      const rows = byNomusSellerRows.filter((row) =>
        opt.sourceSellerKeys.includes(
          buildRawSellerKeyFromRow(row.external_seller_id, row.responsible)
        )
      );
      return {
        displayName: opt.displayName,
        sellerIdentityKey: opt.sellerIdentityKey,
        externalSellerId: opt.externalSellerId,
        externalSellerIds: opt.externalSellerIds,
        responsible: opt.responsible,
        ordersCount: opt.ordersCount,
        ordersValue: rows.reduce((sum, r) => sum + sellerDashToNumber(r.orders_value), 0),
        invoicedOrdersCount: rows.reduce((sum, r) => sum + (r.invoiced_orders_count ?? 0), 0),
        invoicedOrdersValue: rows.reduce(
          (sum, r) => sum + sellerDashToNumber(r.invoiced_orders_value),
          0
        ),
        openOrdersCount: rows.reduce((sum, r) => sum + (r.open_orders_count ?? 0), 0),
        openOrdersValue: rows.reduce((sum, r) => sum + sellerDashToNumber(r.open_orders_value), 0),
      };
    }),
    openPortfolioOrders: openPortfolioRows.map(mapOrderRow),
    invoicedOrders: invoicedRows.map(mapOrderRow),
    ordersWithoutLinkedProposal: ordersNoProposalRows.map((row) => ({
      salesOrderId: row.sales_order_id,
      orderCode: row.order_code,
      externalSalesOrderId: row.external_sales_order_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      responsible: row.responsible ?? null,
      externalSellerId: row.external_seller_id,
      issueDate: sellerDashIso(row.issue_date),
      totalNetValue: sellerDashToNumber(row.total_net_value),
      isInvoiced: Boolean(row.is_invoiced),
    })),
    sourceInfo,
    emptyStateReason: null,
  };
}
