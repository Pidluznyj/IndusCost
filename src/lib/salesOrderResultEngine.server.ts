/**
 * Motor server-side da aba Resultado — mesmo escopo da listagem oficial de Pedidos
 * (`parseSalesOrderListQuery` / `resolveSalesOrderListWhere`) + margem oficial
 * (`salesMarginRulesEngine` + custo versionado em issueDate).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  loadSalesMarginNomusConfig,
  salesMarginNomusConfigToCostPolicy,
} from "./salesMarginNomusConfig.js";
import { resolveOfficialSalesMarginTaxContext } from "./salesMarginNomusTaxContext.server.js";
import {
  buildOfficialSalesMarginRulesResult,
  buildOfficialSalesOrderResultMarginPayload,
  mapMarginContextToRulesOrders,
} from "./salesMarginRulesAdapter.js";
import {
  buildSalesOrderMarginContext,
  SALES_ORDER_ITEM_MARGIN_SELECT,
  type SalesOrderForMargin,
} from "./salesOrderMarginService.server.js";
import { buildSalesOrderResultRealizedVsProjected } from "./salesOrderResultProjection.js";
import {
  buildOfficialSalesOrderResultSalesBundle,
  mapPrismaOrderToSalesOrderRulesInput,
  SALES_ORDER_RULES_PRISMA_SELECT,
} from "./salesOrderRulesAdapter.js";
import {
  parseSalesOrderListQuery,
  resolveSalesOrderListSellerWhere,
  resolveSalesOrderListWhere,
} from "./salesOrderListQuery.server.js";
import { decimalToNumber } from "./executiveDashboardHelpers.js";
import { FINANCE_SALES_ORDERS_MONTH_LABELS } from "./financeSalesOrdersDashboardTypes.js";
import type {
  SalesOrderResultDashboardPayload,
  SalesOrderResultFilters,
  SalesOrderResultMonthlySalesComparisonRow,
} from "./salesOrderResultTypes.js";

/** Select único: regras de pedido + itens para margem (mesmo universo da listagem). */
const SALES_ORDER_RESULT_PRISMA_SELECT = {
  ...SALES_ORDER_RULES_PRISMA_SELECT,
  proposalId: true,
  items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
} as const;

function parseAsOfDate(value: unknown, fallback: Date): Date {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  return new Date(y, m, d, 23, 59, 59, 999);
}

function andWhere(
  base: Prisma.SalesOrderWhereInput,
  extra: Prisma.SalesOrderWhereInput | null
): Prisma.SalesOrderWhereInput {
  if (!extra) return base;
  return { AND: [base, extra] };
}

/**
 * Filtros da aba Resultado — alinhados ao parse canônico da listagem de Pedidos.
 * `productId` permanece como filtro adicional (AND em itens).
 */
export function parseSalesOrderResultFilters(
  query: Record<string, unknown>,
  now = new Date()
): SalesOrderResultFilters {
  const listQuery = parseSalesOrderListQuery(query);
  const asOfDate =
    typeof query.asOfDate === "string" && query.asOfDate.trim()
      ? query.asOfDate.trim()
      : now.toISOString().slice(0, 10);
  const productId = String(query.productId ?? "").trim() || undefined;

  return {
    year: listQuery.year ?? now.getFullYear(),
    month: listQuery.month ?? undefined,
    customerId: listQuery.customerId || undefined,
    productId,
    sellerId: listQuery.sellerKeyRaw || listQuery.sellerText || undefined,
    companyId: undefined,
    asOfDate,
    status: listQuery.status || undefined,
    sellerKey: listQuery.sellerKeyRaw || undefined,
    hasInvoice:
      listQuery.hasInvoice === null
        ? undefined
        : listQuery.hasInvoice
          ? "true"
          : "false",
    receivableStatus: listQuery.receivableStatus ?? undefined,
    q: listQuery.q || undefined,
    startDate: listQuery.startDate
      ? listQuery.startDate.toISOString().slice(0, 10)
      : undefined,
    endDate: listQuery.endDate
      ? listQuery.endDate.toISOString().slice(0, 10)
      : undefined,
  };
}

export async function buildSalesOrderResultDashboard(
  db: PrismaClient,
  query: Record<string, unknown>,
  now = new Date()
): Promise<SalesOrderResultDashboardPayload> {
  const filters = parseSalesOrderResultFilters(query, now);
  const referenceDate = parseAsOfDate(filters.asOfDate, now);

  // Escopo oficial = mesma cadeia da listagem / PDF / Resultado Industrial.
  const listQuery = parseSalesOrderListQuery({
    ...query,
    // Garante ano para o dashboard (UI sempre envia; fallback = ano corrente).
    year: query.year ?? filters.year,
  });
  const sellerWhere = await resolveSalesOrderListSellerWhere(db, {
    sellerKeyRaw: listQuery.sellerKeyRaw,
    sellerText: listQuery.sellerText,
  });
  let where = await resolveSalesOrderListWhere(db, listQuery, sellerWhere);

  if (filters.productId) {
    where = andWhere(where, {
      items: { some: { productId: filters.productId } },
    });
  }

  const orders = await db.salesOrder.findMany({
    where,
    select: SALES_ORDER_RESULT_PRISMA_SELECT,
  });

  const rulesOrders = orders.map(mapPrismaOrderToSalesOrderRulesInput);
  const salesBundle = buildOfficialSalesOrderResultSalesBundle({
    orders: rulesOrders,
    year: filters.year,
    month: filters.month,
    referenceDate,
    customerId: filters.customerId,
    sellerId: filters.sellerId,
    companyId: filters.companyId,
    productId: filters.productId,
  });

  const { config: nomusConfig } = await loadSalesMarginNomusConfig(db);
  const marginOrders = orders as SalesOrderForMargin[];
  const marginContext = await buildSalesOrderMarginContext(db, marginOrders, {
    costPolicy: salesMarginNomusConfigToCostPolicy(nomusConfig),
  });
  const marginRulesOrders = mapMarginContextToRulesOrders(
    marginOrders,
    marginContext.byOrderId
  );

  const productIds = orders.flatMap((order) =>
    order.items.map((item) => item.productId).filter((id): id is string => Boolean(id))
  );
  const taxContext = await resolveOfficialSalesMarginTaxContext(db, productIds, nomusConfig);

  const rules = buildOfficialSalesMarginRulesResult(marginRulesOrders, {
    taxMode: nomusConfig.taxMode === "none" ? "none" : "deductFromGross",
    taxContext,
    year: filters.year,
    month: filters.month,
    referenceDate,
    filters: {
      year: filters.year,
      month: filters.month ?? null,
      customerId: filters.customerId ?? null,
      productId: filters.productId ?? null,
      sellerId: filters.sellerId ?? null,
      companyId: filters.companyId ?? null,
    },
  });

  const marginPayload = buildOfficialSalesOrderResultMarginPayload({
    rules,
    salesBundle,
    filters,
  });

  let monthlyCommercialMargin = marginPayload.monthlyMargin.map((row) => ({
    ...row,
    marginAmount: 0,
    marginPercent: null as number | null,
    costAmount: 0,
    taxAmount: 0,
  }));
  try {
    const { buildSalesOrderCommercialMarginReadModels } = await import(
      "./salesOrderCommercialMarginReadService.server.js"
    );
    const { buildMonthlyCommercialMarginRows } = await import(
      "./salesOrderCommercialMarginReadModel.js"
    );
    const commercialByOrder = await buildSalesOrderCommercialMarginReadModels(
      db,
      orders.map((order) => ({
        id: order.id,
        issueDate: order.issueDate,
        items: order.items,
      }))
    );
    monthlyCommercialMargin = buildMonthlyCommercialMarginRows(
      orders.map((order) => ({
        issueDate: order.issueDate,
        commercialMargin: commercialByOrder.get(order.id)?.commercialMargin,
      })),
      filters.year
    );
  } catch (err) {
    console.warn(
      "[buildSalesOrderResultDashboard] falha na série mensal de margem comercial.",
      err
    );
  }

  // Ano anterior: mesma população OP-02 (filtros da listagem), só para série YoY de vendas.
  // Sem mês — o comparativo mensal é sempre o ano completo.
  const previousYear = filters.year - 1;
  const prevListQuery = parseSalesOrderListQuery({
    ...query,
    year: previousYear,
    month: undefined,
  });
  const prevSellerWhere = await resolveSalesOrderListSellerWhere(db, {
    sellerKeyRaw: prevListQuery.sellerKeyRaw,
    sellerText: prevListQuery.sellerText,
  });
  let prevWhere = await resolveSalesOrderListWhere(
    db,
    prevListQuery,
    prevSellerWhere
  );
  if (filters.productId) {
    prevWhere = andWhere(prevWhere, {
      items: { some: { productId: filters.productId } },
    });
  }
  const previousYearOrders = await db.salesOrder.findMany({
    where: prevWhere,
    select: {
      issueDate: true,
      totalNetValue: true,
    },
  });
  const previousYearMonthly = new Map<number, number>();
  for (let m = 1; m <= 12; m += 1) previousYearMonthly.set(m, 0);
  for (const order of previousYearOrders) {
    if (!order.issueDate) continue;
    if (order.issueDate.getFullYear() !== previousYear) continue;
    const month = order.issueDate.getMonth() + 1;
    previousYearMonthly.set(
      month,
      (previousYearMonthly.get(month) ?? 0) +
        (decimalToNumber(order.totalNetValue) ?? 0)
    );
  }

  const monthlySales = salesBundle.monthlyTimeline.map((point) => ({
    month: point.month,
    amount: point.soldAmount,
  }));
  const currentYearMonthly = new Map(
    monthlySales.map((point) => [point.month, point.amount])
  );
  const monthlySalesComparison: SalesOrderResultMonthlySalesComparisonRow[] =
    FINANCE_SALES_ORDERS_MONTH_LABELS.map((monthLabel, index) => {
      const month = index + 1;
      return {
        month,
        monthLabel,
        currentYearAmount: currentYearMonthly.get(month) ?? 0,
        previousYearAmount: previousYearMonthly.get(month) ?? 0,
      };
    });

  const { rows: realizedVsProjected, projection } =
    buildSalesOrderResultRealizedVsProjected({
      monthlySales,
      year: filters.year,
      referenceDate,
      previousYearMonthlySales: previousYearMonthly,
    });

  return {
    filters,
    totals: marginPayload.totals,
    monthlyMargin: marginPayload.monthlyMargin,
    monthlyCommercialMargin,
    monthlySalesComparison,
    realizedVsProjected,
    projection,
    warnings: marginPayload.warnings,
    source: marginPayload.source,
  };
}
