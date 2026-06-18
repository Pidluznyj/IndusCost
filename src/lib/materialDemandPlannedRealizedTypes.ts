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
  productId: string;
  productSku: string | null;
  productName: string | null;
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
