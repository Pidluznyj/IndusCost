/**
 * Preview/auditoria da margem Nomus — delega ao motor oficial.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  loadProductTaxPercentIndex,
  resolveSalesTaxRuleById,
  type ResolvedSalesTaxRule,
} from "./averageSalesTaxEngine.js";
import {
  buildOfficialSalesMarginRulesResult,
  mapMarginContextToRulesOrders,
  OFFICIAL_SM_RULES_SOURCE,
  resolveOfficialScopedMarginMetrics,
} from "./salesMarginRulesAdapter.js";
import { resolveOfficialSalesMarginTaxContext } from "./salesMarginNomusTaxContext.server.js";
import {
  assessSalesMarginNomusFiscalConfig,
  loadSalesMarginNomusConfig,
  type SalesMarginNomusConfig,
  salesMarginNomusConfigToCostPolicy,
  salesMarginNomusRequiresDefaultTaxRule,
} from "./salesMarginNomusConfig.js";
import {
  buildSalesOrderMarginContext,
  SALES_ORDER_ITEM_MARGIN_SELECT,
} from "./salesOrderMarginService.server.js";
import type { SalesOrderCostSource } from "./salesOrderMarginTypes.js";
import { buildSalesOrderListWhere } from "./salesOrdersListSummary.js";
import { SALES_MARGIN_RULES_ENGINE_VERSION } from "./salesMarginRulesEngine.js";

const LIVE_FALLBACK_SOURCES = new Set<SalesOrderCostSource>([
  "LIVE_PRODUCT_COST",
  "RECALCULATED_CURRENT_COST",
  "OFFICIAL_FINAL_COST",
  "CURRENT_ENGINEERING_COST",
  "CURRENT_COST",
  "MANUAL_COST",
]);

export type SalesMarginNomusPreviewQuery = {
  year: number;
  month: number;
  customerId?: string | null;
  productId?: string | null;
  asOfDate?: string | null;
};

export type SalesMarginNomusPreviewPayload = {
  generatedAt: string;
  filters: SalesMarginNomusPreviewQuery;
  config: SalesMarginNomusConfig;
  configRowId: string | null;
  taxRule: ResolvedSalesTaxRule | null;
  taxRuleSource: string;
  productTaxPriorityNote: string;
  metricsSource: typeof OFFICIAL_SM_RULES_SOURCE;
  rulesEngineVersion: string;
  ordersCount: number;
  itemsTotal: number;
  itemsWithFrozenSnapshot: number;
  itemsUsingLiveFallback: number;
  itemsWithoutCost: number;
  totalSalesRevenueInScope: number;
  marginRevenueCovered: number;
  marginRevenueUncovered: number;
  marginCoveragePercent: number | null;
  costCoverageStatus: string;
  grossSalesAmount: number;
  taxAmount: number;
  netSalesAmount: number;
  totalCost: number;
  marginValue: number;
  marginPercent: number | null;
  scopeNote: string;
  calculationSources: Array<{ label: string; value: string }>;
  warnings: string[];
};

function buildPreviewWhere(query: SalesMarginNomusPreviewQuery): Prisma.SalesOrderWhereInput {
  const base = buildSalesOrderListWhere({ year: query.year, month: query.month });
  const and: Prisma.SalesOrderWhereInput[] = [base];
  if (query.customerId?.trim()) {
    and.push({ customerId: query.customerId.trim() });
  }
  if (query.productId?.trim()) {
    and.push({ items: { some: { productId: query.productId.trim() } } });
  }
  return and.length === 1 ? base : { AND: and };
}

export async function buildSalesMarginNomusPreview(
  db: PrismaClient,
  rawQuery: SalesMarginNomusPreviewQuery
): Promise<SalesMarginNomusPreviewPayload> {
  const { config, configRowId } = await loadSalesMarginNomusConfig(db);
  const warnings: string[] = [];
  const where = buildPreviewWhere(rawQuery);
  const ref = rawQuery.asOfDate
    ? new Date(`${rawQuery.asOfDate}T23:59:59`)
    : new Date();

  const orders = await db.salesOrder.findMany({
    where,
    select: {
      id: true,
      nomusRawResponse: true,
      items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
    },
  });

  const productIds = orders.flatMap((order) =>
    order.items.map((item) => item.productId).filter((id): id is string => Boolean(id))
  );

  const marginContext = await buildSalesOrderMarginContext(db, orders, {
    costPolicy: salesMarginNomusConfigToCostPolicy(config),
  });

  let itemsWithProductionCost = 0;
  let itemsUsingLiveFallback = 0;
  let itemsWithoutCost = 0;
  for (const result of marginContext.byOrderId.values()) {
    for (const item of result.itemResults) {
      if (item.status === "SEM_CUSTO") itemsWithoutCost += 1;
      if (item.costSource && LIVE_FALLBACK_SOURCES.has(item.costSource)) {
        itemsUsingLiveFallback += 1;
        itemsWithProductionCost += 1;
      } else if (item.costSource === "HISTORICAL_SNAPSHOT") {
        itemsWithProductionCost += 1;
      }
    }
  }

  const rulesOrders = mapMarginContextToRulesOrders(orders, marginContext.byOrderId);
  const taxContext = await resolveOfficialSalesMarginTaxContext(db, productIds, config);
  const taxRule = config.defaultTaxRuleId
    ? await resolveSalesTaxRuleById(db, config.defaultTaxRuleId)
    : null;

  const fiscalAssessment = assessSalesMarginNomusFiscalConfig(
    config,
    taxRule,
    taxContext.taxRuleSource
  );

  if (fiscalAssessment.status === "BLOQUEANTE") {
    warnings.push("Configuração fiscal incompleta.");
    for (const reason of fiscalAssessment.reasons) warnings.push(reason);
  } else if (fiscalAssessment.status === "ALERTA") {
    for (const reason of fiscalAssessment.reasons) warnings.push(reason);
  }

  if (!taxContext.fiscalConfigComplete && salesMarginNomusRequiresDefaultTaxRule(config)) {
    warnings.push(
      "Motor operando com configuração fiscal incompleta — imposto gerencial não será deduzido até corrigir a TaxRule."
    );
  }

  if (taxContext.usesTaxRuleFallback || fiscalAssessment.usesFallback) {
    warnings.push("Fallback fiscal detectado — revise Parâmetros Globais > Margem Nomus.");
  }

  const rules = buildOfficialSalesMarginRulesResult(rulesOrders, {
    taxMode: config.taxMode,
    taxContext,
    year: rawQuery.year,
    month: rawQuery.month,
    referenceDate: ref,
    filters: { year: rawQuery.year, month: rawQuery.month },
  });
  const scoped = resolveOfficialScopedMarginMetrics(rules);

  if (scoped.costCoverageStatus === "PARTIAL" && config.showPartialCoverageWarning) {
    warnings.push(scoped.scopeNote.trim());
  }
  if (scoped.costCoverageStatus === "NONE") {
    warnings.push("Margem indisponível — nenhuma linha com custo no filtro.");
  }

  const productTaxIndex = await loadProductTaxPercentIndex(db, productIds);
  const productsWithSpecificRule = productIds.filter((id) => productTaxIndex.has(id)).length;

  return {
    generatedAt: new Date().toISOString(),
    filters: rawQuery,
    config,
    configRowId,
    taxRule,
    taxRuleSource: taxContext.taxRuleSource,
    productTaxPriorityNote:
      productsWithSpecificRule > 0
        ? `${productsWithSpecificRule} produto(s) com TaxRule específica via ProductPricing; demais usam regra padrão Nomus.`
        : "Nenhum produto com TaxRule específica no filtro — imposto usa regra padrão configurada.",
    metricsSource: OFFICIAL_SM_RULES_SOURCE,
    rulesEngineVersion: SALES_MARGIN_RULES_ENGINE_VERSION,
    ordersCount: orders.length,
    itemsTotal: scoped.itemsTotal,
    itemsWithFrozenSnapshot: itemsWithProductionCost,
    itemsUsingLiveFallback,
    itemsWithoutCost,
    totalSalesRevenueInScope: scoped.totalSalesRevenueInScope,
    marginRevenueCovered: scoped.marginRevenueCovered,
    marginRevenueUncovered: scoped.marginRevenueUncovered,
    marginCoveragePercent: scoped.marginCoveragePercent,
    costCoverageStatus: scoped.costCoverageStatus,
    grossSalesAmount: scoped.grossSalesAmount,
    taxAmount: scoped.taxAmount,
    netSalesAmount: scoped.netSalesAmount,
    totalCost: scoped.totalCost,
    marginValue: scoped.marginAmount,
    marginPercent: scoped.marginPercent,
    scopeNote: scoped.scopeNote,
    calculationSources: [
      { label: "Receita", value: "Pedidos Nomus / SalesOrder + SalesOrderItem" },
      {
        label: "Custo de produção",
        value: "Motor industrial IndusCost (getProductCostAnalysis) — SalesOrderItem.unitCost NÃO é custo",
      },
      {
        label: "Fallback de custo",
        value: config.allowLiveCostFallback
          ? "getProductCostAnalysis / CostCalculationLog"
          : "Desabilitado pela configuração",
      },
      {
        label: "Imposto",
        value:
          config.taxMode === "deductFromGross"
            ? `TaxRule (${taxContext.defaultTaxLabel}) + ProductPricing por produto`
            : "Não deduzido (taxMode none)",
      },
      { label: "Parâmetros globais", value: "Configurações > Gerais / Parâmetros Globais" },
      { label: "Motor", value: OFFICIAL_SM_RULES_SOURCE },
    ],
    warnings,
  };
}
