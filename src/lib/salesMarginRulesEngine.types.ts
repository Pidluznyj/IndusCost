/**
 * Contratos do motor oficial de regras de Margem de Venda.
 */

import type { SalesOrderMarginStatus, SalesOrderCostSource, SalesOrderCostConfidence } from "./salesOrderMarginTypes.js";
import type { ProductTaxPercentIndex } from "./averageSalesTaxEngine.js";

export type SalesMarginSourceMode = "orderBased" | "invoiceBased";

/** `deductFromGross` aplica imposto médio (TaxRule) sobre receita vendida; `none` espelha margem PV sem camada fiscal. */
export type SalesMarginTaxMode = "deductFromGross" | "none";

export type SalesMarginRulesScope =
  | "item"
  | "order"
  | "customer"
  | "seller"
  | "product"
  | "period"
  | "unified";

export type SalesMarginRulesMetricKey =
  | "grossSalesAmount"
  | "taxAmount"
  | "netSalesAmount"
  | "totalCost"
  | "marginAmount"
  | "marginPercent"
  | "markup"
  | "ordersCount"
  | "itemsCount"
  | "missingCostCount"
  | "missingProductCount"
  | "negativeMarginCount"
  | "validItemsCount";

export type SalesMarginRulesItemInput = {
  salesOrderItemId?: string;
  orderId?: string;
  customerId?: string | null;
  sellerId?: string | null;
  productId?: string | null;
  externalProductId?: string | number | null;
  productSku?: string | null;
  productCode?: string | null;
  productName?: string | null;
  issueDate?: Date | null;
  quantity: number;
  netUnitPrice?: number | null;
  netTotalValue?: number | null;
  itemStatus?: string | number | null;
  isCanceled?: boolean;
  unitCost?: number | null;
  costSource?: SalesOrderCostSource;
  costConfidence?: SalesOrderCostConfidence;
  /** % imposto do produto — quando ausente usa índice/default do contexto. */
  taxPercent?: number | null;
};

export type SalesMarginRulesOrderInput = {
  id: string;
  orderCode?: string;
  customerId?: string | null;
  sellerId?: string | null;
  companyId?: string | null;
  issueDate?: Date | null;
  status?: string;
  items: SalesMarginRulesItemInput[];
};

export type SalesMarginRulesFilters = {
  year?: number | null;
  month?: number | null;
  startDate?: Date | null;
  endDate?: Date | null;
  customerId?: string | null;
  productId?: string | null;
  sellerId?: string | null;
  companyId?: string | null;
  orderId?: string | null;
  includeCanceled?: boolean;
};

export type SalesMarginTaxContext = {
  productTaxIndex: ProductTaxPercentIndex;
  defaultTaxPercent: number;
  defaultTaxLabel: string;
};

export type SalesMarginRulesContext = {
  referenceDate: Date;
  today: Date;
  year: number;
  month: number;
  sourceMode: SalesMarginSourceMode;
  taxMode: SalesMarginTaxMode;
  filters: SalesMarginRulesFilters;
  taxContext?: SalesMarginTaxContext;
};

export type SalesMarginRulesBuildInput = {
  referenceDate?: Date;
  year?: number;
  month?: number;
  sourceMode?: SalesMarginSourceMode;
  taxMode?: SalesMarginTaxMode;
  filters?: Partial<SalesMarginRulesFilters>;
  taxContext?: SalesMarginTaxContext;
};

export type SalesMarginItemResult = {
  salesOrderItemId?: string;
  orderId?: string;
  customerId?: string | null;
  sellerId?: string | null;
  productId?: string | null;
  productSku?: string | null;
  productName?: string | null;
  quantity: number;
  grossSalesAmount: number;
  taxAmount: number;
  taxPercentApplied: number;
  netSalesAmount: number;
  unitCost: number | null;
  totalCost: number | null;
  marginAmount: number | null;
  marginPercent: number | null;
  soldMarginAmount: number | null;
  soldMarginPercent: number | null;
  markup: number | null;
  status: SalesOrderMarginStatus;
  statusLabel: string;
  costSource: SalesOrderCostSource;
  costConfidence: SalesOrderCostConfidence;
  notes: string[];
};

export type SalesMarginOrderResult = {
  orderId: string;
  orderCode?: string;
  customerId?: string | null;
  sellerId?: string | null;
  issueDateCivilKey: string | null;
  items: SalesMarginItemResult[];
  grossSalesAmount: number;
  taxAmount: number;
  netSalesAmount: number;
  totalCost: number;
  marginAmount: number;
  marginPercent: number | null;
  markup: number | null;
  itemsCount: number;
  validItemsCount: number;
  ignoredItemsCount: number;
  hasMissingCost: boolean;
  hasMissingProduct: boolean;
  hasNegativeMargin: boolean;
  hasInvalidRevenue: boolean;
  status: SalesOrderMarginStatus | "PARTIAL" | "OK";
};

export type SalesMarginAggregateResult = {
  grossSalesAmount: number;
  taxAmount: number;
  netSalesAmount: number;
  totalCost: number;
  marginAmount: number;
  marginPercent: number | null;
  markup: number | null;
  ordersCount: number;
  itemsCount: number;
  validItemsCount: number;
  missingCostCount: number;
  missingProductCount: number;
  negativeMarginCount: number;
  taxPercentApplied: number | null;
  taxSourceLabel: string | null;
  totalSalesRevenueInScope: number;
  marginRevenueCovered: number;
  marginRevenueUncovered: number;
  marginCoveragePercent: number | null;
  itemsWithCost: number;
  itemsWithoutCost: number;
  costCoverageStatus: import("./salesOrderMarginTypes.js").SalesOrderMarginCostCoverageStatus;
};

export type SalesMarginMonthlyTimelinePoint = {
  year: number;
  month: number;
  monthLabel: string;
  grossSalesAmount: number;
  taxAmount: number;
  netSalesAmount: number;
  totalCost: number;
  marginAmount: number;
  marginPercent: number | null;
  ordersCount: number;
};

export type SalesMarginGridRow = {
  orderId: string;
  orderCode: string | null;
  customerId: string | null;
  sellerId: string | null;
  issueDate: string | null;
  grossSalesAmount: number;
  netSalesAmount: number;
  totalCost: number;
  marginAmount: number;
  marginPercent: number | null;
  status: string;
  hasMissingCost: boolean;
  hasMissingProduct: boolean;
  hasNegativeMargin: boolean;
};

export type SalesMarginMetricDefinition = {
  key: SalesMarginRulesMetricKey;
  label: string;
  description: string;
  formula: string;
  includes: string[];
  excludes: string[];
  source: string[];
};

export type SalesMarginRulesAuditResult = {
  isFinite: boolean;
  warnings: string[];
  metricsDocumented: number;
  orderResultsCount: number;
  marginMathParityOk: boolean;
  resultMathParityOk: boolean;
};

export type SalesMarginRulesResult = {
  engineVersion: string;
  generatedAt: string;
  referenceDate: string;
  context: SalesMarginRulesContext;
  metrics: SalesMarginAggregateResult;
  orderResults: SalesMarginOrderResult[];
  monthlyTimeline: SalesMarginMonthlyTimelinePoint[];
  byCustomer: Map<string, SalesMarginAggregateResult>;
  bySeller: Map<string, SalesMarginAggregateResult>;
  byProduct: Map<string, SalesMarginAggregateResult>;
  gridRows: SalesMarginGridRow[];
  metricDefinitions: SalesMarginMetricDefinition[];
  audit: SalesMarginRulesAuditResult;
};
