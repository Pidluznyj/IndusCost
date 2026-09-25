/**
 * Motor server-side da aba Resultado — mesmo escopo da listagem oficial de Pedidos
 * (`parseSalesOrderListQuery` / `resolveSalesOrderListWhere`) + margem oficial
 * (`salesMarginRulesEngine` + custo versionado em issueDate).
 *
 * Desempenho (sem mudar números):
 *   - o contexto de custo da margem é calculado UMA vez e compartilhado pelas duas
 *     apurações (gerencial com imposto e comercial dos KPIs) — mesmos pedidos e
 *     mesma política de custo, só leitura;
 *   - a projeção (Realizado vs Projetado) tem função própria com select SEM o JSON
 *     do Nomus: a linha do tempo usa só status, emissão e valor líquido;
 *   - `timings` coleta a duração de cada fase para diagnóstico (Server-Timing/log).
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
  SalesOrderResultMonthlyRow,
  SalesOrderResultMonthlySalesComparisonRow,
  SalesOrderResultProjectionPayload,
} from "./salesOrderResultTypes.js";

/** Série de margem comercial da população anual (gráfico da listagem via charts-cache). */
type ListMarginChartSeriesResult =
  | { kind: "ok"; monthlyCommercialMargin: SalesOrderResultMonthlyRow[] }
  | { kind: "skipped" }
  | { kind: "failed" };

const LIST_MARGIN_CHART_SERIES_SKIPPED: ListMarginChartSeriesResult = { kind: "skipped" };

/** Duração (ms) por fase da requisição — diagnóstico. */
export type SalesOrderResultTimings = Record<string, number>;

export type BuildSalesOrderResultDashboardOptions = {
  /**
   * Série mensal de margem comercial da população ANUAL (gráfico da listagem de
   * Pedidos, servido pelo charts-cache). Default true: o cache e os scripts de
   * auditoria continuam iguais. A rota da tela Resultado passa false — a tela
   * não exibe essa série, e ela era a parte mais cara da requisição (motor de
   * margem sobre todos os pedidos do ano, mesmo com filtro de um único mês).
   */
  includeListMarginChartSeries?: boolean;
  /** Coletor opcional das durações por fase (ms). */
  timings?: SalesOrderResultTimings;
};

/** Select único: regras de pedido + itens para margem (mesmo universo da listagem). */
const SALES_ORDER_RESULT_PRISMA_SELECT = {
  ...SALES_ORDER_RULES_PRISMA_SELECT,
  proposalId: true,
  items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
} as const;

/**
 * Select da projeção: as MESMAS colunas das regras de pedido, sem o JSON do Nomus.
 * A linha do tempo/projeção usa só status, emissão e valor líquido (o JSON só
 * alimenta o status logístico, que a projeção não usa).
 */
export const SALES_ORDER_RESULT_PROJECTION_PRISMA_SELECT = (() => {
  const { nomusRawResponse: _omitNomusRaw, ...select } = SALES_ORDER_RULES_PRISMA_SELECT;
  void _omitNomusRaw;
  return select;
})();

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

type SalesOrderResultScope = {
  filters: SalesOrderResultFilters;
  referenceDate: Date;
  where: Prisma.SalesOrderWhereInput;
};

/** Escopo oficial = mesma cadeia da listagem / PDF / Resultado Industrial (+ produto). */
async function resolveSalesOrderResultScope(
  db: PrismaClient,
  query: Record<string, unknown>,
  now: Date
): Promise<SalesOrderResultScope> {
  const filters = parseSalesOrderResultFilters(query, now);
  const referenceDate = parseAsOfDate(filters.asOfDate, now);
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
  return { filters, referenceDate, where };
}

function buildResultSalesBundle(
  orders: Array<Parameters<typeof mapPrismaOrderToSalesOrderRulesInput>[0]>,
  filters: SalesOrderResultFilters,
  referenceDate: Date
) {
  return buildOfficialSalesOrderResultSalesBundle({
    orders: orders.map(mapPrismaOrderToSalesOrderRulesInput),
    year: filters.year,
    month: filters.month,
    referenceDate,
    customerId: filters.customerId,
    sellerId: filters.sellerId,
    companyId: filters.companyId,
    // O filtro de produto já está no where (pedidos que contêm o produto). O
    // bundle comparava o UUID do produto com o id do ITEM do pedido — nunca
    // casava e zerava Qtde Pedidos e a projeção. Sem repassar, vale o escopo do where.
    productId: undefined,
  });
}

/**
 * Ano anterior: mesma população OP-02 (filtros da listagem), só para série YoY de
 * vendas. Sem mês — o comparativo mensal é sempre o ano completo.
 */
async function loadSalesOrderResultPreviousYearMonthlySales(
  db: PrismaClient,
  query: Record<string, unknown>,
  filters: SalesOrderResultFilters
): Promise<Map<number, number>> {
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
}

/** Comparativo YoY + Realizado vs Projetado a partir do bundle de vendas. */
function buildSalesOrderResultProjectionSection(input: {
  salesBundle: ReturnType<typeof buildResultSalesBundle>;
  previousYearMonthly: Map<number, number>;
  filters: SalesOrderResultFilters;
  referenceDate: Date;
}): Pick<
  SalesOrderResultDashboardPayload,
  "monthlySalesComparison" | "realizedVsProjected" | "projection"
> {
  const monthlySales = input.salesBundle.monthlyTimeline.map((point) => ({
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
        previousYearAmount: input.previousYearMonthly.get(month) ?? 0,
      };
    });

  const { rows: realizedVsProjected, projection } =
    buildSalesOrderResultRealizedVsProjected({
      monthlySales,
      year: input.filters.year,
      referenceDate: input.referenceDate,
      previousYearMonthlySales: input.previousYearMonthly,
    });

  return { monthlySalesComparison, realizedVsProjected, projection };
}

/**
 * Projeção da tela Resultado (Realizado vs Projetado + KPIs de projeção) — leve:
 * mesmo escopo e mesmo bundle de vendas do dashboard completo, sem motor de margem
 * e sem o JSON do Nomus. Números idênticos aos do dashboard completo.
 */
export async function buildSalesOrderResultProjectionPayload(
  db: PrismaClient,
  query: Record<string, unknown>,
  now = new Date(),
  options: { timings?: SalesOrderResultTimings } = {}
): Promise<SalesOrderResultProjectionPayload> {
  const startedAt = Date.now();
  const scope = await resolveSalesOrderResultScope(db, query, now);
  const [orders, previousYearMonthly] = await Promise.all([
    db.salesOrder.findMany({
      where: scope.where,
      select: SALES_ORDER_RESULT_PROJECTION_PRISMA_SELECT,
    }),
    loadSalesOrderResultPreviousYearMonthlySales(db, query, scope.filters),
  ]);
  const salesBundle = buildResultSalesBundle(orders, scope.filters, scope.referenceDate);
  const section = buildSalesOrderResultProjectionSection({
    salesBundle,
    previousYearMonthly,
    filters: scope.filters,
    referenceDate: scope.referenceDate,
  });
  if (options.timings) options.timings.total = Date.now() - startedAt;
  return { filters: scope.filters, ...section };
}

export async function buildSalesOrderResultDashboard(
  db: PrismaClient,
  query: Record<string, unknown>,
  now = new Date(),
  options: BuildSalesOrderResultDashboardOptions = {}
): Promise<SalesOrderResultDashboardPayload> {
  const timings = options.timings;
  const lap = (phase: string, since: number) => {
    if (timings) timings[phase] = Date.now() - since;
  };
  const startedAt = Date.now();
  const includeListMarginChartSeries = options.includeListMarginChartSeries !== false;

  const { filters, referenceDate, where } = await resolveSalesOrderResultScope(db, query, now);
  lap("scope", startedAt);

  const ordersStartedAt = Date.now();
  const orders = await db.salesOrder.findMany({
    where,
    select: SALES_ORDER_RESULT_PRISMA_SELECT,
  });
  lap("orders", ordersStartedAt);

  const salesBundle = buildResultSalesBundle(orders, filters, referenceDate);
  const marginOrders = orders as SalesOrderForMargin[];

  // Contexto de custo da margem (produto, custo versionado, tabela de preço):
  // calculado UMA vez e compartilhado pelas duas apurações abaixo — mesmos
  // pedidos e a mesma política de custo que cada uma calculava por conta
  // própria. As apurações só leem o contexto (montam objetos novos).
  // O contexto fiscal oficial (mesmos produtos, mesma config) também é resolvido
  // uma vez só, em paralelo ao contexto de custo.
  const contextStartedAt = Date.now();
  const nomusConfigPromise = loadSalesMarginNomusConfig(db).then((loaded) => loaded.config);
  const marginContextPromise = nomusConfigPromise
    .then((nomusConfig) =>
      buildSalesOrderMarginContext(db, marginOrders, {
        costPolicy: salesMarginNomusConfigToCostPolicy(nomusConfig),
      })
    )
    .then((marginContext) => {
      lap("marginContext", contextStartedAt);
      return marginContext;
    });
  const productIds = orders.flatMap((order) =>
    order.items.map((item) => item.productId).filter((id): id is string => Boolean(id))
  );
  const taxContextPromise = nomusConfigPromise
    .then((nomusConfig) => resolveOfficialSalesMarginTaxContext(db, productIds, nomusConfig))
    .then((taxContext) => {
      lap("taxContext", contextStartedAt);
      return taxContext;
    });
  const sharedContextPromise = Promise.all([
    nomusConfigPromise,
    marginContextPromise,
    taxContextPromise,
  ]);

  // Apurações independentes entre si, em paralelo (mesmas funções e leituras).
  const [marginPayload, commercialSummary, chartResult, previousYearMonthly] =
    await Promise.all([
      (async () => {
        const [nomusConfig, marginContext, taxContext] = await sharedContextPromise;
        const phaseStartedAt = Date.now();
        const marginRulesOrders = mapMarginContextToRulesOrders(
          marginOrders,
          marginContext.byOrderId
        );
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
        const payload = buildOfficialSalesOrderResultMarginPayload({ rules, salesBundle, filters });
        lap("marginManagerial", phaseStartedAt);
        return payload;
      })(),
      // KPIs de cabeçalho (R$ Custo / R$ Margem / % Margem / Margem média/un.)
      // seguem a MESMA regra da listagem de Pedidos de Venda — "Margem comercial"
      // (buildOfficialSalesOrderListMarginSummary), não a margem gerencial com
      // dedução de imposto. Decisão do usuário: paridade com a listagem, mesmo
      // que a apuração fiscal detalhada continue disponível em `rules`/`source`.
      (async () => {
        const [nomusConfig, marginContext, officialTaxContext] = await sharedContextPromise;
        const phaseStartedAt = Date.now();
        const summary = await buildOfficialSalesOrderListMarginSummary(db, marginOrders, {
          year: filters.year,
          precomputedMarginContext: { nomusConfig, marginContext, officialTaxContext },
        });
        lap("marginCommercial", phaseStartedAt);
        return summary;
      })(),
      // Série de margem comercial da população ANUAL (gráfico da listagem, via
      // charts-cache). A tela Resultado não a exibe: pulada quando a rota pede.
      !includeListMarginChartSeries
        ? Promise.resolve(LIST_MARGIN_CHART_SERIES_SKIPPED)
        : (async (): Promise<ListMarginChartSeriesResult> => {
        const phaseStartedAt = Date.now();
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
          // Recarrega itens apenas dos pedidos que vieram sem eles.
          const idsMissingItems = chartOrders
            .filter((order) => !order.items?.length)
            .map((order) => order.id);
          let itemsByOrder = new Map<string, SalesOrderForMargin["items"]>();
          if (idsMissingItems.length > 0) {
            const { loadSalesOrderItemsForMargin } = await import(
              "./salesOrderMarginService.server.js"
            );
            itemsByOrder = await loadSalesOrderItemsForMargin(db, idsMissingItems);
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
          lap("listMarginChartSeries", phaseStartedAt);
          return { kind: "ok", monthlyCommercialMargin };
        } catch (err) {
          console.warn(
            "[buildSalesOrderResultDashboard] falha na série mensal de margem comercial.",
            err
          );
          return { kind: "failed" };
        }
      })(),
      (async () => {
        const phaseStartedAt = Date.now();
        const monthly = await loadSalesOrderResultPreviousYearMonthlySales(db, query, filters);
        lap("previousYear", phaseStartedAt);
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

  // Pulada (rota Resultado): lista vazia — série não calculada nesta rota.
  // Falha: mantém o fallback anterior (linhas zeradas por mês).
  const monthlyCommercialMargin: SalesOrderResultMonthlyRow[] =
    chartResult.kind === "ok"
    ? chartResult.monthlyCommercialMargin
    : chartResult.kind === "skipped"
      ? []
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

  const projectionSection = buildSalesOrderResultProjectionSection({
    salesBundle,
    previousYearMonthly,
    filters,
    referenceDate,
  });
  lap("total", startedAt);

  return {
    filters,
    totals,
    monthlyMargin: marginPayload.monthlyMargin,
    monthlyCommercialMargin,
    ...projectionSection,
    warnings: marginPayload.warnings,
    source: marginPayload.source,
  };
}
