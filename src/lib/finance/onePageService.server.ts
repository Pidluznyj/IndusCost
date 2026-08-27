/**
 * Financeiro > One Page — orquestração server-side.
 *
 * Fontes canônicas (idênticas às telas oficiais):
 * - Faturamento: buildBillingDashboardFromNfes com dateBase "emissao" — a MESMA
 *   fonte/semântica do Financeiro > Faturamento (FINANCE_BILLING_SOURCE_DEFAULT
 *   = "nfe": NF autorizada, mercado, MARKET_REVENUE, valor líquido NF-e).
 * - Pedidos: buildSalesOrdersDashboardTab (salesOrderRulesEngine, 3 empresas,
 *   sem intercompany).
 * - Margem: motor comercial oficial (Σ margem R$ ÷ Σ venda coberta) sobre a
 *   população da listagem Comercial no período (mês selecionado ou YTD).
 *
 * O One Page não recalcula regra financeira — só seleciona e formata (mapper).
 */
import { prisma } from "../prisma.js";
import { buildBillingDashboardFromNfes } from "../financeBillingNfeDashboard.js";
import { buildSalesOrdersDashboardTab } from "../salesOrdersDashboardMetrics.js";
import { getSalesOrdersCommercialMargins } from "../salesOrderCommercialMarginReadService.server.js";
import { aggregateCommercialMarginSummaries } from "../salesOrderCommercialMarginReadModel.js";
import type { SalesOrderCommercialMarginSummaryDTO } from "../salesOrderCommercialMarginReadModel.js";
import { isIntercompanySalesOrder } from "../financeInternalGroupExclusions.js";
import { buildSalesOrderListWhere } from "../salesOrdersListSummary.js";
import { getFinanceDreOnePageSummaryFromSnapshot } from "../financeDreSnapshot.server.js";
import { FINANCE_DRE_ONE_PAGE_UNAVAILABLE } from "../financeDreOnePageSummary.js";
import { resolveOnePagePeriod, type OnePagePeriod } from "./onePagePeriod.js";
import { buildOnePagePayload, type OnePageMarginInput } from "./onePageMapper.js";
import type { OnePageDashboardPayload } from "./onePageTypes.js";

export type { OnePageDashboardPayload } from "./onePageTypes.js";

/**
 * Margem comercial ponderada do período (Σ margem R$ ÷ Σ venda coberta) sobre a
 * população oficial da listagem Comercial (sem intercompany). Nunca média
 * simples de percentuais mensais.
 */
async function computeOnePageCommercialMargin(
  period: OnePagePeriod
): Promise<OnePageMarginInput> {
  const listWhere = buildSalesOrderListWhere({ year: period.selectedYear });
  const periodOrders = await prisma.salesOrder.findMany({
    where: {
      AND: [
        listWhere,
        {
          issueDate: {
            gte: period.marginRange.start,
            lte: period.marginRange.end,
          },
        },
      ],
    },
    select: {
      id: true,
      customerId: true,
      Customer: {
        select: {
          companyName: true,
          tradeName: true,
          taxId: true,
        },
      },
    },
  });

  const marketOrderIds = periodOrders
    .filter((order) => !isIntercompanySalesOrder(order))
    .map((order) => order.id);

  if (marketOrderIds.length === 0) {
    return { percent: null, orderCount: 0 };
  }

  const marginsMap = await getSalesOrdersCommercialMargins(prisma, marketOrderIds);
  const summaries = marketOrderIds
    .map((id) => marginsMap.get(id))
    .filter((summary): summary is SalesOrderCommercialMarginSummaryDTO =>
      Boolean(summary)
    );
  const aggregated = aggregateCommercialMarginSummaries(summaries);
  return {
    percent: aggregated.commercialMarginTotalPercent ?? null,
    orderCount: summaries.length,
  };
}

export async function getFinanceOnePageDashboard(
  yearParam: unknown,
  monthParam?: unknown,
  now: Date = new Date()
): Promise<OnePageDashboardPayload> {
  const period = resolveOnePagePeriod(yearParam, monthParam, now);

  const [billingTab, salesTab, margin, dre] = await Promise.all([
    buildBillingDashboardFromNfes(period.yearCtx, "emissao"),
    buildSalesOrdersDashboardTab(period.yearCtx, { month: period.metricMonth }),
    computeOnePageCommercialMargin(period),
    // DRE: EXCLUSIVAMENTE snapshot canônico (nunca o motor live). MISS/erro
    // nunca bloqueiam o restante do One Page — bloco vira "em preparação".
    getFinanceDreOnePageSummaryFromSnapshot(
      { year: period.selectedYear, month: period.metricMonth, periodMode: period.mode },
      now
    ).catch((error) => {
      console.error("[one-page] resumo DRE indisponível (One Page segue):", error);
      return FINANCE_DRE_ONE_PAGE_UNAVAILABLE;
    }),
  ]);

  return buildOnePagePayload({ period, billingTab, salesTab, margin, dre, now });
}
