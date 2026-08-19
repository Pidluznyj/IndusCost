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
  buildOfficialSalesOrderListMarginSummary,
  buildOfficialSalesOrderResultMarginPayload,
  mapMarginContextToRulesOrders,
} from "./salesMarginRulesAdapter.js";
import { roundPricingMoney } from "./pricingCalculations.js";
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
import { formatSalesOrderListReceivableStatusParam } from "./salesOrderListReceivableFilter.js";
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
    receivableStatus:
      formatSalesOrderListReceivableStatusParam(listQuery.receivableStatuses) ||
      undefined,
    q: listQuery.q || undefined,
    startDate: listQuery.startDate
      ? listQuery.startDate.toISOString().slice(0, 10)
      : undefined,
    endDate: listQuery.endDate
      ? listQuery.endDate.toISOString().slice(0, 10)
      : undefined,
    minNetValue:
      listQuery.minNetValue != null ? String(listQuery.minNetValue) : undefined,
    maxNetValue:
      listQuery.maxNetValue != null ? String(listQuery.maxNetValue) : undefined,
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

  const marginOrders = orders as SalesOrderForMargin[];

  // As quatro apurações abaixo (margem gerencial com imposto, margem
  // comercial da listagem, série mensal do gráfico, ano anterior para YoY)
  // são independentes entre si — cada uma resolve seu próprio custo/preço
  // versionado e nenhuma depende do resultado das outras. Rodavam em série
  // (o dashboard somava a latência das quatro); rodar em paralelo elimina
  // a maior parte do tempo de carregamento sem mudar nenhum cálculo — mesmas
  // funções, mesmas leituras, só deixam de esperar umas pelas outras.
  const [marginPayload, commercialSummary, chartResult, previousYearMonthly] =
    await Promise.all([
      (async () => {
        const { config: nomusConfig } = await loadSalesMarginNomusConfig(db);
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
        return buildOfficialSalesOrderResultMarginPayload({ rules, salesBundle, filters });
      })(),
      // KPIs de cabeçalho (R$ Custo / R$ Margem / % Margem / Margem média/un.)
      // seguem a MESMA regra da listagem de Pedidos de Venda — "Margem comercial"
      // (buildOfficialSalesOrderListMarginSummary), não a margem gerencial com
      // dedução de imposto. Decisão do usuário: paridade com a listagem, mesmo
      // que a apuração fiscal detalhada continue disponível em `rules`/`source`.
      buildOfficialSalesOrderListMarginSummary(db, marginOrders, { year: filters.year }),
      (async () => {
        try {
          const { buildSalesOrderCommercialMarginReadModels } = await import(
            "./salesOrderCommercialMarginReadService.server.js"
          );
          const { buildMonthlyCommercialMarginRows } = await import(
            "./salesOrderCommercialMarginReadModel.js"
          );
          const { loadSalesOrderListChartYearOrders } = await import(
            "./salesOrderListMarginSummary.server.js"
          );
          // Série do gráfico: ano civil da request, sem demais filtros da tela.
          const chartOrders = await loadSalesOrderListChartYearOrders(db, filters.year);
          const needsItemLoad = chartOrders.some((order) => !order.items?.length);
          let itemsByOrder = new Map<string, SalesOrderForMargin["items"]>();
          if (needsItemLoad) {
            const { loadSalesOrderItemsForMargin } = await import(
              "./salesOrderMarginService.server.js"
            );
            itemsByOrder = await loadSalesOrderItemsForMargin(
              db,
              chartOrders.map((order) => order.id)
            );
          }
          const { calculateOfficialSalesOrderMarginsForOrders } = await import(
            "./salesMarginRulesAdapter.js"
          );
          const [commercialByOrder, officialByOrder] = await Promise.all([
            buildSalesOrderCommercialMarginReadModels(
              db,
              chartOrders.map((order) => ({
                id: order.id,
                issueDate:
                  order.issueDate instanceof Date
                    ? order.issueDate
                    : order.issueDate
                      ? new Date(order.issueDate)
                      : null,
                items: order.items?.length
                  ? order.items
                  : (itemsByOrder.get(order.id) ?? []),
              }))
            ),
            calculateOfficialSalesOrderMarginsForOrders(db, chartOrders),
          ]);

          const monthlyCommercialMargin = buildMonthlyCommercialMarginRows(
            chartOrders.map((order) => {
              const comm = commercialByOrder.get(order.id)?.commercialMargin;
              const off = officialByOrder.get(order.id)?.marginSummary;
              return {
                issueDate: order.issueDate,
                commercialMargin: comm,
                officialMargin: off
                  ? { marginValue: off.marginValue, netRevenue: off.netRevenue }
                  : null,
              };
            }),
            filters.year
          );
          return { ok: true as const, monthlyCommercialMargin };
        } catch (err) {
          console.warn(
            "[buildSalesOrderResultDashboard] falha na série mensal de margem comercial.",
            err
          );
          return { ok: false as const };
        }
      })(),
      // Ano anterior: mesma população OP-02 (filtros da listagem), só para série YoY de vendas.
      // Sem mês — o comparativo mensal é sempre o ano completo.
      (async () => {
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
        let prevWhere = await resolveSalesOrderListWhere(db, prevListQuery, prevSellerWhere);
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
        const monthly = new Map<number, number>();
        for (let m = 1; m <= 12; m += 1) monthly.set(m, 0);
        for (const order of previousYearOrders) {
          if (!order.issueDate) continue;
          if (order.issueDate.getFullYear() !== previousYear) continue;
          const month = order.issueDate.getMonth() + 1;
          monthly.set(
            month,
            (monthly.get(month) ?? 0) + (decimalToNumber(order.totalNetValue) ?? 0)
          );
        }
        return monthly;
      })(),
    ]);

  const totals = {
    ...marginPayload.totals,
    costAmount: commercialSummary.totalCost,
    marginAmount: commercialSummary.totalMarginValue,
    marginPercent: commercialSummary.totalMarginPercentage,
    taxAmount: commercialSummary.taxAmount,
    netSalesAmount: roundPricingMoney(
      marginPayload.totals.salesAmount - commercialSummary.taxAmount
    ),
    averageUnitMargin:
      marginPayload.totals.totalQuantity > 0
        ? roundPricingMoney(
            commercialSummary.totalMarginValue / marginPayload.totals.totalQuantity
          )
        : null,
    taxSourceLabel: "Margem comercial — mesma regra da listagem de Pedidos de Venda",
  };

  const monthlyCommercialMargin = chartResult.ok
    ? chartResult.monthlyCommercialMargin
    : marginPayload.monthlyMargin.map((row) => ({
        ...row,
        marginAmount: 0,
        marginPercent: null as number | null,
        costAmount: 0,
        taxAmount: 0,
        coveredNetValue: 0,
        totalNetValue: 0,
        isPartial: false,
        coveredOrders: 0,
        totalEligibleOrders: row.ordersCount,
      }));

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
    totals,
    monthlyMargin: marginPayload.monthlyMargin,
    monthlyCommercialMargin,
    monthlySalesComparison,
    realizedVsProjected,
    projection,
    warnings: marginPayload.warnings,
    source: marginPayload.source,
  };
}
