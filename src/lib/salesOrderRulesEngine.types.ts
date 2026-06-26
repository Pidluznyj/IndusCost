/**
 * Contratos do motor oficial de regras de Pedidos de Venda.
 */

import type { SalesOrderListFilters, SalesOrderListSummary } from "./salesOrdersListSummary.js";
import type { SalesOrderManagementFilters } from "./salesOrderManagement.js";
import type { SalesOrderManagementSummary } from "./salesOrderManagementTypes.js";
import type { SalesOrderFulfillmentKpis } from "./salesOrderManagementFulfillment.js";
import type { SalesOrderManagementRow } from "./salesOrderManagementTypes.js";
import type { SalesOrderLinkedNfeContext } from "./salesOrderLinkedNfe.js";
import type { ManagementStatusCardId } from "./salesOrderManagementStatus.js";
import type { SalesOrderMarginSummaryPayload } from "./salesOrderMarginTypes.js";
import type { BiLogisticStatusCardId } from "./salesOrderLogisticStatus.js";

export type SalesOrderRulesScope = "list" | "management" | "executive" | "unified";

export type SalesOrderRulesDateRole =
  | "issueDate"
  | "expectedDeliveryDate"
  | "nfeProcessingDate"
  | "operationalDueDate";

export type SalesOrderRulesMetricKey =
  | "totalOrders"
  | "filteredOrders"
  | "uniqueOrders"
  | "soldAmount"
  | "netAmount"
  | "grossAmount"
  | "totalItems"
  | "averageTicket"
  | "invoicedAmount"
  | "soldInvoicedGap"
  | "withNfeCount"
  | "withoutNfeCount"
  | "withProductionOrderCount"
  | "withoutProductionOrderCount"
  | "deliveredOnTimeCount"
  | "deliveredLateCount"
  | "pendingOnTimeCount"
  | "pendingLateCount"
  | "partialCount"
  | "withCutCount"
  | "reviewDataCount"
  | "averageSlaDays"
  | "onTimePercent"
  | "ordersMonth"
  | "ordersYtd"
  | "soldAmountMonth"
  | "soldAmountYtd"
  | "soldAmountPreviousYearMonth"
  | "soldAmountPreviousYearYtd"
  | "monthProjection"
  | "monthTarget"
  | "ytdTarget";

export type SalesOrderRulesItemInput = {
  id: string;
  externalProductId?: number | null;
  skuSnapshot?: string | null;
  productNameSnapshot?: string | null;
  quantity: unknown;
  status?: string | null;
};

export type SalesOrderRulesOrderInput = {
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
  items: SalesOrderRulesItemInput[];
  marginSummary?: SalesOrderMarginSummaryPayload | null;
};

export type NormalizedSalesOrderRecord = {
  id: string;
  orderCode: string;
  status: string;
  issueDate: Date;
  issueDateCivilKey: string;
  expectedDeliveryDate: Date | null;
  expectedDeliveryDateCivilKey: string | null;
  totalNetValue: number;
  totalGrossValue: number;
  totalItems: number;
  isCancelled: boolean;
  hasNfe: boolean;
  hasLinkedProductionOrder: boolean;
  logisticStatusCardId: ManagementStatusCardId | null;
  invoicedValue: number;
  marginSummary: SalesOrderMarginSummaryPayload | null;
};

export type SalesOrderRulesFilters = {
  list: SalesOrderListFilters;
  management: SalesOrderManagementFilters;
};

export type SalesOrderRulesContext = {
  referenceDate: Date;
  today: Date;
  year: number;
  month: number;
  scope: SalesOrderRulesScope;
  filters: SalesOrderRulesFilters;
  ytdStart: Date;
  ytdEnd: Date;
  monthStart: Date;
  monthEnd: Date;
  excludeCancelledExecutive: boolean;
};

export type SalesOrderMetricDefinition = {
  key: SalesOrderRulesMetricKey;
  label: string;
  description: string;
  valueField: string;
  dateField: string;
  includes: string[];
  excludes: string[];
  dateBasisNote?: string;
};

export type SalesOrderMetrics = {
  totalOrders: number;
  filteredOrders: number;
  uniqueOrders: number;
  soldAmount: number;
  netAmount: number;
  grossAmount: number;
  totalItems: number;
  averageTicket: number;
  invoicedAmount: number;
  soldInvoicedGap: number;
  withNfeCount: number;
  withoutNfeCount: number;
  withProductionOrderCount: number;
  withoutProductionOrderCount: number;
  deliveredOnTimeCount: number;
  deliveredLateCount: number;
  pendingOnTimeCount: number;
  pendingLateCount: number;
  partialCount: number;
  withCutCount: number;
  reviewDataCount: number;
  averageSlaDays: number | null;
  onTimePercent: number | null;
  ordersMonth: number;
  ordersYtd: number;
  soldAmountMonth: number;
  soldAmountYtd: number;
  soldAmountPreviousYearMonth: number;
  soldAmountPreviousYearYtd: number;
  monthProjection: number | null;
  monthTarget: number | null;
  ytdTarget: number | null;
};

export type SalesOrderMonthlyTimelinePoint = {
  year: number;
  month: number;
  monthLabel: string;
  orderCount: number;
  soldAmount: number;
};

export type SalesOrderGridRow = {
  id: string;
  orderCode: string;
  customerName: string | null;
  sellerName: string | null;
  companyName: string | null;
  issueDate: string | null;
  expectedDeliveryDate: string | null;
  totalNetValue: number;
  invoicedValue: number;
  soldInvoicedGap: number;
  hasNfe: boolean;
  hasLinkedProductionOrder: boolean;
  logisticStatusCardId: BiLogisticStatusCardId | ManagementStatusCardId | string;
  logisticStatusLabel: string;
  completionStatus: string;
  hasCut: boolean;
  needsDataReview: boolean;
  marginSummary: SalesOrderMarginSummaryPayload | null;
};

export type SalesOrderRulesAuditResult = {
  isFinite: boolean;
  warnings: string[];
  metricsDocumented: number;
  managementRowsCount: number;
  listParityOk: boolean;
  managementParityOk: boolean;
};

export type SalesOrderRulesResult = {
  engineVersion: string;
  generatedAt: string;
  referenceDate: string;
  context: SalesOrderRulesContext;
  metrics: SalesOrderMetrics;
  listSummary: SalesOrderListSummary;
  fulfillmentKpis: SalesOrderFulfillmentKpis;
  managementSummary: SalesOrderManagementSummary;
  monthlyTimeline: SalesOrderMonthlyTimelinePoint[];
  gridRows: SalesOrderGridRow[];
  metricDefinitions: SalesOrderMetricDefinition[];
  audit: SalesOrderRulesAuditResult;
};

export type SalesOrderRulesBuildInput = {
  listFilters?: Partial<SalesOrderListFilters>;
  managementFilters?: Partial<SalesOrderManagementFilters>;
  referenceDate?: Date;
  year?: number;
  month?: number;
  scope?: SalesOrderRulesScope;
  linkedNfeContextMap?: Map<string, SalesOrderLinkedNfeContext>;
};
