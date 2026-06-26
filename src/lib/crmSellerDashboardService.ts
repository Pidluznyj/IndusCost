/**
 * Serviço do GET /api/crm/seller-dashboard — base principal: SalesOrder.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma";
import {
  computeSellerTicketAverage,
  sellerDashIso,
  sellerDashToNumber,
} from "@/src/lib/crmSellerDashboard";
import {
  buildRawSellerKeyFromRow,
  consolidateSellerRowFragments,
  consolidatedIdentityMatchesUser,
  consolidatedOptionToSellerOption,
  normalizeSellerIdentityName,
} from "@/src/lib/crmSellerIdentityConsolidation";
import {
  mapPrismaOrderToSalesOrderRulesInput,
  resolveOfficialScopedOrderMetrics,
  SALES_ORDER_RULES_PRISMA_SELECT,
  OFFICIAL_SO_RULES_SOURCE,
} from "@/src/lib/salesOrderRulesAdapter.js";
import { loadSalesOrderLinkedNfeContextMap } from "@/src/lib/salesOrderLinkedNfe.js";
import { buildCrmSellerFilterSql } from "@/src/lib/crmSellerMatchSql";

const LIST_LIMIT = 20;
const DATE_YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export type SellerDashboardRequest = {
  scopeMode: "all" | "own";
  externalSellerId: number | null;
  responsible: string | null;
  sellerIdentityKey: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  /** Escopo own: usuário vinculado (para filtrar opções consolidadas). */
  linkedUser?: {
    externalSellerId: number | null;
    sellerResponsibleName: string | null;
  } | null;
};

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

export async function buildCrmSellerDashboardResponse(
  input: SellerDashboardRequest,
  now = new Date()
) {
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

  const buildSellerMatchSql = () =>
    buildCrmSellerFilterSql("so", {
      externalSellerId: filterExternalSellerId,
      responsible: filterResponsible,
      sellerIdentityKey: filterSellerIdentityKey,
    });

  const sellerKeyExprSql = Prisma.sql`
    CASE
      WHEN so."externalSellerId" IS NOT NULL
      THEN 'id:' || so."externalSellerId"::text
      WHEN NULLIF(TRIM(so."responsible"), '') IS NOT NULL
      THEN 'r:' || LOWER(TRIM(so."responsible"))
      ELSE NULL
    END
  `;

  const customerNameSql = Prisma.sql`
    COALESCE(NULLIF(TRIM(c."tradeName"), ''), c."companyName")
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
  const soSellerMatch = buildSellerMatchSql();

  const [
    sellerOptionsRows,
    summaryRow,
    bySellerRows,
    openPortfolioRows,
    invoicedRows,
    topProductRows,
    ordersNoProposalRows,
  ] = await Promise.all([
    prisma.$queryRaw<
      { external_seller_id: number | null; responsible: string | null; orders_count: number }[]
    >(
      Prisma.sql`
        SELECT
          MAX(so."externalSellerId") AS external_seller_id,
          MAX(so."responsible") FILTER (
            WHERE so."responsible" IS NOT NULL AND TRIM(so."responsible") <> ''
          ) AS responsible,
          COUNT(*)::int AS orders_count
        FROM "SalesOrder" so
        WHERE ${soSellerMatch} AND ${soValidOrdersScopeSql}
        GROUP BY ${sellerKeyExprSql}
        HAVING ${sellerKeyExprSql} IS NOT NULL
        ORDER BY orders_count DESC, responsible ASC NULLS LAST
      `
    ),
    prisma.$queryRaw<
      {
        orders_count: number;
        orders_value: unknown;
        invoiced_orders_count: number;
        invoiced_orders_value: unknown;
        open_orders_count: number;
        open_orders_value: unknown;
        cancelled_orders_count: number;
        unique_customers_count: number;
        orders_without_linked_proposal_count: number;
      }[]
    >(
      Prisma.sql`
        SELECT
          (SELECT COUNT(*)::int FROM "SalesOrder" so WHERE ${soSellerMatch} AND ${soValidOrdersScopeSql}) AS orders_count,
          (SELECT COALESCE(SUM(so."totalNetValue"), 0) FROM "SalesOrder" so WHERE ${soSellerMatch} AND ${soValidOrdersScopeSql}) AS orders_value,
          (SELECT COUNT(*)::int FROM "SalesOrder" so WHERE ${soSellerMatch} AND ${soValidOrdersScopeSql} AND ${soInvoicedMetricSql}) AS invoiced_orders_count,
          (SELECT COALESCE(SUM(so."totalNetValue"), 0) FROM "SalesOrder" so WHERE ${soSellerMatch} AND ${soValidOrdersScopeSql} AND ${soInvoicedMetricSql}) AS invoiced_orders_value,
          (SELECT COUNT(*)::int FROM "SalesOrder" so WHERE ${soSellerMatch} AND ${soOpenPortfolioScopeSql}) AS open_orders_count,
          (SELECT COALESCE(SUM(so."totalNetValue"), 0) FROM "SalesOrder" so WHERE ${soSellerMatch} AND ${soOpenPortfolioScopeSql}) AS open_orders_value,
          (SELECT COUNT(*)::int FROM "SalesOrder" so WHERE ${soSellerMatch} AND ${soOrdersScopeSql} AND so.status::text = 'CANCELLED') AS cancelled_orders_count,
          (SELECT COUNT(DISTINCT so."customerId")::int FROM "SalesOrder" so WHERE ${soSellerMatch} AND ${soValidOrdersScopeSql}) AS unique_customers_count,
          (SELECT COUNT(*)::int FROM "SalesOrder" so WHERE ${soSellerMatch} AND ${soValidOrdersScopeSql} AND so."proposalId" IS NULL) AS orders_without_linked_proposal_count
      `
    ),
    prisma.$queryRaw<
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
    >(
      Prisma.sql`
        SELECT
          MAX(so."externalSellerId") AS external_seller_id,
          MAX(so."responsible") FILTER (
            WHERE so."responsible" IS NOT NULL AND TRIM(so."responsible") <> ''
          ) AS responsible,
          COUNT(*) FILTER (WHERE ${soValidOrdersScopeSql})::int AS orders_count,
          COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${soValidOrdersScopeSql}), 0) AS orders_value,
          COUNT(*) FILTER (WHERE ${soValidOrdersScopeSql} AND ${soInvoicedMetricSql})::int AS invoiced_orders_count,
          COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${soValidOrdersScopeSql} AND ${soInvoicedMetricSql}), 0) AS invoiced_orders_value,
          COUNT(*) FILTER (WHERE ${soOpenPortfolioScopeSql})::int AS open_orders_count,
          COALESCE(SUM(so."totalNetValue") FILTER (WHERE ${soOpenPortfolioScopeSql}), 0) AS open_orders_value
        FROM "SalesOrder" so
        WHERE ${soSellerMatch}
        GROUP BY ${sellerKeyExprSql}
        HAVING ${sellerKeyExprSql} IS NOT NULL
        ORDER BY orders_count DESC
      `
    ),
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
        expected_delivery_date: Date | null;
        total_net_value: unknown;
      }[]
    >(
      Prisma.sql`
        SELECT
          so.id AS sales_order_id,
          so."orderCode" AS order_code,
          so."externalSalesOrderId" AS external_sales_order_id,
          so."customerId" AS customer_id,
          ${customerNameSql} AS customer_name,
          so."responsible" AS responsible,
          so."externalSellerId" AS external_seller_id,
          so."issueDate" AS issue_date,
          so."expectedDeliveryDate" AS expected_delivery_date,
          so."totalNetValue" AS total_net_value
        FROM "SalesOrder" so
        INNER JOIN "Customer" c ON c.id = so."customerId"
        WHERE ${soSellerMatch}
          AND ${soOpenPortfolioScopeSql}
        ORDER BY so."issueDate" DESC
        LIMIT ${LIST_LIMIT}
      `
    ),
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
        expected_delivery_date: Date | null;
        total_net_value: unknown;
        invoice_processed_at_text: string | null;
        invoice_number: string | null;
        invoice_series: string | null;
        invoice_key: string | null;
        invoice_status: string | null;
      }[]
    >(
      Prisma.sql`
        SELECT
          so.id AS sales_order_id,
          so."orderCode" AS order_code,
          so."externalSalesOrderId" AS external_sales_order_id,
          so."customerId" AS customer_id,
          ${customerNameSql} AS customer_name,
          so."responsible" AS responsible,
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
        WHERE ${soSellerMatch}
          AND ${soInvoicedMetricSql}
        ORDER BY inv.invoice_sort_date DESC NULLS LAST, so."issueDate" DESC
        LIMIT ${LIST_LIMIT}
      `
    ),
    prisma.$queryRaw<
      {
        product_id: string;
        product_name: string;
        sku_snapshot: string;
        revenue: unknown;
        quantity: unknown;
      }[]
    >(
      Prisma.sql`
        SELECT
          soi."productId" AS product_id,
          MAX(soi."productNameSnapshot") AS product_name,
          MAX(soi."skuSnapshot") AS sku_snapshot,
          COALESCE(SUM(soi."totalNetValue"), 0) AS revenue,
          COALESCE(SUM(soi.quantity), 0) AS quantity
        FROM "SalesOrderItem" soi
        INNER JOIN "SalesOrder" so ON so.id = soi."salesOrderId"
        WHERE ${soSellerMatch}
          AND ${soValidOrdersScopeSql}
        GROUP BY soi."productId"
        ORDER BY revenue DESC
        LIMIT 1
      `
    ),
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
    >(
      Prisma.sql`
        SELECT
          so.id AS sales_order_id,
          so."orderCode" AS order_code,
          so."externalSalesOrderId" AS external_sales_order_id,
          so."customerId" AS customer_id,
          ${customerNameSql} AS customer_name,
          so."responsible" AS responsible,
          so."externalSellerId" AS external_seller_id,
          so."issueDate" AS issue_date,
          so."totalNetValue" AS total_net_value,
          ${orderIsInvoicedSql("so")} AS is_invoiced
        FROM "SalesOrder" so
        INNER JOIN "Customer" c ON c.id = so."customerId"
        WHERE ${soSellerMatch}
          AND ${soIssueDateInPeriodSql()}
          AND so."proposalId" IS NULL
        ORDER BY so."issueDate" DESC
        LIMIT ${LIST_LIMIT}
      `
    ),
  ]);

  const sellerOrderIds = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT so.id FROM "SalesOrder" so WHERE ${soSellerMatch} AND ${soValidOrdersScopeSql}`
  );
  const sellerIdSet = new Set(sellerOrderIds.map((row) => row.id));
  const rulesOrdersRaw =
    sellerIdSet.size > 0
      ? await prisma.salesOrder.findMany({
          where: { id: { in: [...sellerIdSet] } },
          select: SALES_ORDER_RULES_PRISMA_SELECT,
        })
      : [];
  const rulesOrders = rulesOrdersRaw.map(mapPrismaOrderToSalesOrderRulesInput);
  const linkedMap = await loadSalesOrderLinkedNfeContextMap(
    rulesOrdersRaw.map((order) => ({
      id: order.id,
      totalNetValue: order.totalNetValue,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      nomusRawResponse: order.nomusRawResponse,
    })),
    now
  );
  const officialSummary = resolveOfficialScopedOrderMetrics({
    orders: rulesOrders,
    referenceDate: now,
    managementFilters: {
      allYears: true,
      startDate: periodDateFromStart,
      endDate: periodDateToEnd,
      responsible: filterResponsible ?? undefined,
    },
    linkedNfeContextMap: linkedMap,
  });

  const summary = summaryRow[0];
  const ordersCount = officialSummary.filteredOrders;
  const ordersValue = officialSummary.soldAmount;
  const topProduct = topProductRows[0];

  const consolidatedOptions = consolidateSellerRowFragments(sellerOptionsRows);
  const scopedConsolidated =
    sellerScopeMode === "own" && input.linkedUser
      ? consolidatedOptions.filter((opt) =>
          consolidatedIdentityMatchesUser(opt, input.linkedUser!)
        )
      : consolidatedOptions;

  const consolidatedBySeller = consolidateSellerRowFragments(
    bySellerRows.map((row) => ({
      external_seller_id: row.external_seller_id,
      responsible: row.responsible,
      orders_count: row.orders_count,
    }))
  );

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

  return {
    generatedAt: now.toISOString(),
    filters: {
      externalSellerId: filterExternalSellerId,
      responsible: filterResponsible,
      sellerIdentityKey: filterSellerIdentityKey,
      dateFrom: filterDateFrom,
      dateTo: filterDateTo,
    },
    sellerOptions: scopedConsolidated.map(consolidatedOptionToSellerOption),
    summary: {
      ordersCount,
      ordersValue,
      invoicedOrdersCount: officialSummary.invoicedPortfolioCount,
      invoicedOrdersValue: officialSummary.invoicedPortfolioAmount,
      openOrdersCount: officialSummary.openPortfolioCount,
      openOrdersValue: officialSummary.openPortfolioAmount,
      cancelledOrdersCount: summary?.cancelled_orders_count ?? 0,
      uniqueCustomersCount:
        summary?.unique_customers_count ??
        new Set(rulesOrders.map((o) => o.customerId).filter(Boolean)).size,
      ticketAverage: officialSummary.averageTicket,
      metricsSource: OFFICIAL_SO_RULES_SOURCE,
      topProduct: topProduct
        ? {
            productId: topProduct.product_id,
            productName: topProduct.product_name,
            sku: topProduct.sku_snapshot,
            revenue: sellerDashToNumber(topProduct.revenue),
            quantity: sellerDashToNumber(topProduct.quantity),
          }
        : null,
      ordersWithoutLinkedProposalCount: summary?.orders_without_linked_proposal_count ?? 0,
    },
    bySeller: consolidatedBySeller.map((opt) => {
      const rows = bySellerRows.filter((row) =>
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
    openPortfolioOrders: openPortfolioRows.map((row) => {
      const delivery = mapDeliveryDays(row.expected_delivery_date);
      return {
        salesOrderId: row.sales_order_id,
        orderCode: row.order_code,
        externalSalesOrderId: row.external_sales_order_id,
        customerId: row.customer_id,
        customerName: row.customer_name,
        responsible: row.responsible ?? null,
        externalSellerId: row.external_seller_id,
        issueDate: sellerDashIso(row.issue_date),
        expectedDeliveryDate: sellerDashIso(row.expected_delivery_date),
        totalNetValue: sellerDashToNumber(row.total_net_value),
        daysUntilExpectedDelivery: delivery.daysUntilExpectedDelivery,
        daysOverdue: delivery.daysOverdue,
      };
    }),
    invoicedOrders: invoicedRows.map((row) => ({
      salesOrderId: row.sales_order_id,
      orderCode: row.order_code,
      externalSalesOrderId: row.external_sales_order_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      responsible: row.responsible ?? null,
      externalSellerId: row.external_seller_id,
      issueDate: sellerDashIso(row.issue_date),
      expectedDeliveryDate: sellerDashIso(row.expected_delivery_date),
      totalNetValue: sellerDashToNumber(row.total_net_value),
      invoiceProcessedAtText: row.invoice_processed_at_text,
      invoiceNumber: row.invoice_number,
      invoiceSeries: row.invoice_series,
      invoiceKey: row.invoice_key,
      invoiceStatus: row.invoice_status,
    })),
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
  };
}
