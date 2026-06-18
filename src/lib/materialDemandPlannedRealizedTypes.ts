export type MaterialDemandInvoicingScope = "all" | "invoiced" | "portfolio";

export type MaterialUsageVarianceStatus =
  | "within_planned"
  | "below_planned"
  | "above_planned"
  | "no_realized"
  | "no_planned_base"
  | "incomplete_data";

export const MATERIAL_USAGE_VARIANCE_STATUS_LABELS: Record<MaterialUsageVarianceStatus, string> = {
  within_planned: "Dentro do previsto",
  below_planned: "Abaixo do previsto",
  above_planned: "Acima do previsto",
  no_realized: "Sem realizado",
  no_planned_base: "Sem base prevista",
  incomplete_data: "Dados incompletos",
};

export type MaterialUsagePlannedRealizedRow = {
  materialId: string;
  materialCode: string | null;
  materialName: string;
  unit: string | null;
  unitKey: string;
  unitLabel: string;
  plannedQuantity: number;
  realizedQuantity: number;
  remainingQuantity: number;
  accuracyPercent: number | null;
  varianceQuantity: number;
  variancePercent: number | null;
  unitCost: number | null;
  plannedCost: number;
  realizedCost: number;
  costVariance: number;
  plannedOrdersCount: number;
  realizedOrdersCount: number;
  notInvoicedOrdersCount: number;
  partiallyInvoicedOrdersCount: number;
  invoicedPercent: number | null;
  relatedProductsCount: number;
  status: MaterialUsageVarianceStatus;
  dataQuality: string[];
};

export type MaterialUsagePlannedRealizedSummary = {
  materialsCount: number;
  plannedQuantityTotal: number;
  realizedQuantityTotal: number;
  remainingQuantityTotal: number;
  plannedCostTotal: number;
  realizedCostTotal: number;
  costVarianceTotal: number;
  accuracyPercent: number | null;
  plannedOrdersCount: number;
  realizedOrdersCount: number;
  quantityTotalsComparable: boolean;
  activeUnitLabel: string | null;
};

export type MaterialUsagePlannedRealizedDataQuality = {
  warnings: string[];
  sources: string[];
  partialInvoiceFallbacks: number;
  missingBomItems: number;
  missingCosts: number;
  unitConversionWarnings: number;
  excludedCancelledOrError: number;
};

export type MaterialUsagePlannedRealizedResponse = {
  filtersApplied: Record<string, unknown>;
  summary: MaterialUsagePlannedRealizedSummary;
  rows: MaterialUsagePlannedRealizedRow[];
  dataQuality: MaterialUsagePlannedRealizedDataQuality;
};

export type MaterialUsageContribution = {
  materialId: string;
  materialCode: string | null;
  materialDescription: string;
  unit: string | null;
  unitKey: string;
  unitLabel: string;
  orderId: string;
  orderCode: string;
  orderStatus: string;
  issueDate: string;
  expectedDeliveryDate: string | null;
  customerName: string | null;
  productId: string;
  productSku: string | null;
  productName: string | null;
  productSoldUnit: string | null;
  materialQtyPerUnit: number;
  valuePerUnit: number | null;
  unitCost: number | null;
  plannedOrderQty: number;
  realizedOrderQty: number;
  hasInvoicing: boolean;
  usedPartialInvoiceFallback: boolean;
  missingCost: boolean;
  incompleteData?: boolean;
};

export type MaterialUsageNfeSummary = {
  dataProcessamento: string;
  numero: string | null;
  serie: string | null;
};

export type MaterialPlannedRealizedDetailProduct = {
  productId: string;
  productSku: string | null;
  productName: string | null;
  plannedQuantity: number;
  realizedQuantity: number;
};

export type MaterialPlannedRealizedDetailOrder = {
  salesOrderId: string;
  orderCode: string;
  orderStatus: string;
  issueDate: string;
  hasInvoicing: boolean;
  plannedQuantity: number;
  realizedQuantity: number;
  nfes: MaterialUsageNfeSummary[];
};

export type MaterialPlannedRealizedDetailResponse = {
  materialId: string;
  materialCode: string | null;
  materialName: string;
  unitLabel: string;
  products: MaterialPlannedRealizedDetailProduct[];
  plannedOrders: MaterialPlannedRealizedDetailOrder[];
  realizedOrders: MaterialPlannedRealizedDetailOrder[];
};

export type MaterialUsageAuditSummary = {
  plannedQuantity: number;
  realizedQuantity: number;
  pendingQuantity: number;
  balanceQuantity: number;
  partialQuantity: number;
  accuracyPercent: number | null;
  unitCost: number | null;
  plannedCost: number;
  realizedCost: number;
  pendingCost: number;
  costDifference: number;
  plannedOrdersCount: number;
  realizedOrdersCount: number;
  notInvoicedOrdersCount: number;
  partiallyInvoicedOrdersCount: number;
  pendingOrdersCount: number;
  invoicedPercent: number | null;
  costDifferenceExplanation: string;
};

export type MaterialUsageAuditDifferenceBridge = {
  totalBalanceQuantity: number;
  notInvoicedOrdersQuantity: number;
  partiallyInvoicedOrdersQuantity: number;
  invoiceLinkWarningQuantity: number;
  missingBomQuantity: number;
  missingCostQuantity: number;
  unexplainedQuantity: number;
  reconciles: boolean;
};

export type MaterialUsageAuditProductStatus =
  | "ok"
  | "pending_invoice"
  | "partial"
  | "not_invoiced"
  | "warning";

export type MaterialUsageAuditProduct = {
  productId: string;
  productCode: string | null;
  productDescription: string;
  productSoldUnit: string | null;
  plannedProductQuantity: number;
  realizedProductQuantity: number;
  pendingProductQuantity: number;
  materialFactor: number;
  plannedMaterialQuantity: number;
  realizedMaterialQuantity: number;
  pendingMaterialQuantity: number;
  balanceMaterialQuantity: number;
  plannedCost: number;
  realizedCost: number;
  pendingCost: number;
  costDifference: number;
  plannedOrdersCount: number;
  realizedOrdersCount: number;
  notInvoicedOrdersCount: number;
  partiallyInvoicedOrdersCount: number;
  status: MaterialUsageAuditProductStatus;
};

export type MaterialUsageAuditNotInvoicedOrder = {
  salesOrderId: string;
  salesOrderNumber: string;
  customerName: string;
  issueDate: string;
  expectedDeliveryDate: string | null;
  productCode: string | null;
  productDescription: string;
  orderedQuantity: number;
  materialFactor: number;
  plannedMaterialQuantity: number;
  plannedCost: number;
  orderStatus: string;
  daysOpen: number | null;
};

export type MaterialUsageAuditPartiallyInvoicedOrder = {
  salesOrderId: string;
  salesOrderNumber: string;
  customerName: string;
  productCode: string | null;
  productDescription: string;
  orderedQuantity: number;
  invoicedQuantity: number;
  pendingQuantity: number;
  plannedMaterialQuantity: number;
  realizedMaterialQuantity: number;
  pendingMaterialQuantity: number;
  invoices: string[];
};

export type MaterialUsageAuditPlannedOrder = {
  salesOrderId: string;
  salesOrderNumber: string;
  customerName: string;
  issueDate: string;
  productCode: string | null;
  productDescription: string;
  productSoldUnit: string | null;
  productQuantity: number;
  materialFactor: number;
  plannedMaterialQuantity: number;
  plannedCost: number;
  status: string;
  invoiceNumber: string | null;
  hasInvoicing: boolean;
};

export type MaterialUsageAuditRealizedOrder = {
  salesOrderId: string;
  salesOrderNumber: string;
  invoiceNumber: string | null;
  customerName: string;
  invoiceDate: string | null;
  productCode: string | null;
  productDescription: string;
  productSoldUnit: string | null;
  invoicedProductQuantity: number;
  materialFactor: number;
  realizedMaterialQuantity: number;
  realizedCost: number;
  usedPartialInvoiceFallback: boolean;
};

export type MaterialUsageAuditProductVariance = {
  productId: string;
  productCode: string | null;
  productDescription: string;
  balanceMaterialQuantity: number;
  costDifference: number;
};

export type MaterialUsageAuditDataQuality = {
  warnings: string[];
  missingBomItems: number;
  missingCosts: number;
  unitConversionWarnings: number;
  partialInvoiceFallbacks: number;
  invoiceLinkWarnings: number;
};

export type MaterialUsageAuditPayload = {
  material: {
    id: string;
    code: string | null;
    description: string;
    unit: string;
  };
  summary: MaterialUsageAuditSummary;
  differenceBridge: MaterialUsageAuditDifferenceBridge;
  products: MaterialUsageAuditProduct[];
  notInvoicedOrders: MaterialUsageAuditNotInvoicedOrder[];
  partiallyInvoicedOrders: MaterialUsageAuditPartiallyInvoicedOrder[];
  realizedOrders: MaterialUsageAuditRealizedOrder[];
  /** @deprecated Lista completa de linhas previstas — preferir notInvoicedOrders */
  plannedOrders: MaterialUsageAuditPlannedOrder[];
  productVarianceRanking: MaterialUsageAuditProductVariance[];
  dataQuality: MaterialUsageAuditDataQuality;
};

export type MaterialUsageAuditResponse = {
  filtersApplied: Record<string, unknown>;
  audit: MaterialUsageAuditPayload;
};
