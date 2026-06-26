/**
 * Adapter fino — transforma o motor oficial de Pedidos de Venda para DTOs existentes.
 * Sem regra de negócio: apenas mapeamento, renomeação e compatibilidade de payload.
 */
import type { SalesOrderLinkedNfeContext } from "./salesOrderLinkedNfe.js";
import type { SalesOrderListFilters } from "./salesOrdersListSummary.js";
import type { SalesOrderManagementFilters } from "./salesOrderManagement.js";
import {
  buildSalesOrderRulesResult,
  SALES_ORDER_RULES_ENGINE_VERSION,
  type SalesOrderRulesBuildInput,
  type SalesOrderRulesOrderInput,
  type SalesOrderRulesResult,
} from "./salesOrderRulesEngine.js";
import type { SalesOrderListSummary } from "./salesOrdersListSummary.js";
import type { SalesOrderMetrics } from "./salesOrderRulesEngine.types.js";

export const OFFICIAL_SO_RULES_SOURCE = "official-sales-order-rules-engine" as const;

export type OfficialSalesOrderRulesBuildInput = {
  orders: SalesOrderRulesOrderInput[];
  listFilters?: Partial<SalesOrderListFilters>;
  managementFilters?: Partial<SalesOrderManagementFilters>;
  referenceDate?: Date;
  year?: number;
  month?: number;
  linkedNfeContextMap?: Map<string, SalesOrderLinkedNfeContext>;
  scope?: SalesOrderRulesBuildInput["scope"];
};

function toRulesBuildInput(input: OfficialSalesOrderRulesBuildInput): SalesOrderRulesBuildInput {
  return {
    listFilters: input.listFilters,
    managementFilters: input.managementFilters,
    referenceDate: input.referenceDate,
    year: input.year,
    month: input.month,
    scope: input.scope,
    linkedNfeContextMap: input.linkedNfeContextMap,
  };
}

/** Executa o motor oficial de regras de Pedidos de Venda. */
export function buildOfficialSalesOrderRulesResult(
  input: OfficialSalesOrderRulesBuildInput
): SalesOrderRulesResult & {
  metricsSource: typeof OFFICIAL_SO_RULES_SOURCE;
  rulesEngineVersion: string;
} {
  const result = buildSalesOrderRulesResult(input.orders, toRulesBuildInput(input));
  return {
    ...result,
    metricsSource: OFFICIAL_SO_RULES_SOURCE,
    rulesEngineVersion: SALES_ORDER_RULES_ENGINE_VERSION,
  };
}

export type OfficialSalesOrderListPayload = {
  summary: SalesOrderListSummary;
  metrics: SalesOrderMetrics;
  metricsSource: typeof OFFICIAL_SO_RULES_SOURCE;
  rulesEngineVersion: string;
};

/** Payload resumo da listagem Pedidos de Venda — cards/totais do motor oficial. */
export function buildOfficialSalesOrderListPayload(
  input: OfficialSalesOrderRulesBuildInput
): OfficialSalesOrderListPayload {
  const rules = buildOfficialSalesOrderRulesResult({
    ...input,
    scope: input.scope ?? "list",
  });
  return {
    summary: rules.listSummary,
    metrics: rules.metrics,
    metricsSource: OFFICIAL_SO_RULES_SOURCE,
    rulesEngineVersion: rules.rulesEngineVersion,
  };
}

/** Núcleo gestão — cards, KPIs e linhas do motor oficial (sem paginação/margem). */
export function buildOfficialSalesOrderManagementCore(input: OfficialSalesOrderRulesBuildInput) {
  const rules = buildOfficialSalesOrderRulesResult({
    ...input,
    scope: input.scope ?? "management",
  });
  return {
    cards: rules.managementBundle.cards,
    cardAmounts: rules.managementBundle.cardAmounts,
    dashboardCards: rules.managementBundle.dashboardCards,
    summary: rules.managementSummary,
    fulfillmentKpis: rules.fulfillmentKpis,
    fulfillmentCharts: rules.managementBundle.fulfillmentCharts,
    rows: rules.managementBundle.rows,
    metrics: rules.metrics,
    metricsSource: OFFICIAL_SO_RULES_SOURCE,
    rulesEngineVersion: rules.rulesEngineVersion,
  };
}

/** Métricas executivas (Relatório / aba Pedidos) — motor oficial. */
export function resolveOfficialSalesOrderExecutiveMetrics(
  orders: SalesOrderRulesOrderInput[],
  referenceDate: Date,
  year: number,
  month: number,
  linkedNfeContextMap?: Map<string, SalesOrderLinkedNfeContext>
) {
  const rules = buildOfficialSalesOrderRulesResult({
    orders,
    referenceDate,
    year,
    month,
    linkedNfeContextMap,
    scope: "executive",
  });
  return {
    metrics: rules.metrics,
    monthlyTimeline: rules.monthlyTimeline,
    metricsSource: OFFICIAL_SO_RULES_SOURCE,
    rulesEngineVersion: rules.rulesEngineVersion,
  };
}

/** Mapeia registro Prisma mínimo para entrada do motor oficial. */
export function mapPrismaOrderToSalesOrderRulesInput(order: {
  id: string;
  orderCode: string;
  status: string;
  customerId?: string | null;
  issueDate: Date;
  expectedDeliveryDate?: Date | null;
  totalNetValue: unknown;
  totalGrossValue?: unknown;
  totalItems: number;
  responsible?: string | null;
  nomusRawResponse?: unknown;
  companyIssuer?: string | null;
  externalSalesOrderId?: number | null;
  Customer?: { companyName?: string | null; tradeName?: string | null; taxId?: string | null };
  items: Array<{
    id: string;
    externalProductId?: number | null;
    skuSnapshot?: string | null;
    productNameSnapshot?: string | null;
    quantity: unknown;
    status?: string | null;
  }>;
  marginSummary?: import("./salesOrderMarginTypes.js").SalesOrderMarginSummaryPayload | null;
}): SalesOrderRulesOrderInput {
  return {
    id: order.id,
    orderCode: order.orderCode,
    status: order.status,
    customerId: order.customerId,
    issueDate: order.issueDate,
    expectedDeliveryDate: order.expectedDeliveryDate ?? null,
    totalNetValue: order.totalNetValue,
    totalGrossValue: order.totalGrossValue,
    totalItems: order.totalItems,
    responsible: order.responsible ?? null,
    nomusRawResponse: order.nomusRawResponse ?? null,
    companyIssuer: order.companyIssuer ?? null,
    externalSalesOrderId: order.externalSalesOrderId ?? null,
    Customer: order.Customer,
    items: order.items.map((item) => ({
      id: item.id,
      externalProductId: item.externalProductId,
      skuSnapshot: item.skuSnapshot,
      productNameSnapshot: item.productNameSnapshot,
      quantity: item.quantity,
      status: item.status,
    })),
    marginSummary: order.marginSummary ?? null,
  };
}

export const SALES_ORDER_RULES_PRISMA_SELECT = {
  id: true,
  orderCode: true,
  status: true,
  customerId: true,
  issueDate: true,
  expectedDeliveryDate: true,
  totalNetValue: true,
  totalGrossValue: true,
  totalItems: true,
  responsible: true,
  nomusRawResponse: true,
  companyIssuer: true,
  externalSalesOrderId: true,
  Customer: { select: { companyName: true, tradeName: true, taxId: true } },
  items: {
    select: {
      id: true,
      externalProductId: true,
      skuSnapshot: true,
      productNameSnapshot: true,
      quantity: true,
      status: true,
    },
  },
} as const;
