import type { RawMaterialDemandStatus, RawMaterialEstimationConfidence } from "./salesOrderRawMaterialEstimation.js";
import type {
  MaterialUsageContribution,
  MaterialUsagePlannedRealizedDataQuality,
  MaterialUsagePlannedRealizedRow,
  MaterialUsagePlannedRealizedSummary,
} from "./materialDemandPlannedRealizedTypes.js";
import type { MaterialUsageNfeSummary } from "./materialDemandPlannedRealizedTypes.js";

export type MaterialDemandCalculationMode = "recommended" | "conservative";

export const MATERIAL_DEMAND_CALCULATION_MODES: readonly MaterialDemandCalculationMode[] = [
  "recommended",
  "conservative",
] as const;

export type MaterialDemandIntelligenceFilters = {
  periodStart: string | null;
  periodEnd: string | null;
  calculationMode: MaterialDemandCalculationMode;
  estimationStatus: RawMaterialDemandStatus | "ALL";
  customerId: string | null;
  productId: string | null;
  materialId: string | null;
  seller: string | null;
  search: string;
};

export type RawMaterialIntelligenceSummaryBlock = {
  recommendedDemandQuantity: number;
  conservativeDemandQuantity: number;
  uncertaintyDemandQuantity: number;
  recommendedDemandValue: number;
  conservativeDemandValue: number;
  uncertaintyDemandValue: number;
  reviewItemsCount: number;
  missingBomCount: number;
  criticalUnservedBalanceAmount: number;
  unservedRevenuePotential: number;
  confidence: RawMaterialEstimationConfidence;
  consideredOrdersCount: number;
  consideredItemsCount: number;
  excludedFullyInvoicedCount: number;
  stalePartialBalanceCount: number;
};

export type RawMaterialIntelligenceMaterialRow = {
  materialId: string;
  materialCode: string | null;
  materialName: string;
  unit: string | null;
  unitKey: string;
  unitLabel: string;
  recommendedQuantity: number;
  conservativeQuantity: number;
  uncertaintyQuantity: number;
  reviewQuantity: number;
  recommendedValue: number;
  conservativeValue: number;
  relatedProductsCount: number;
  relatedOrdersCount: number;
  confidence: RawMaterialEstimationConfidence;
  statusSummary: string;
};

export type RawMaterialIntelligenceOrderRow = {
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  sellerName: string | null;
  productCode: string | null;
  productName: string | null;
  soldQuantity: number;
  invoicedQuantity: number;
  openQuantity: number;
  soldNetAmount: number;
  invoicedNetAmount: number;
  openNetAmount: number;
  issueDate: string;
  expectedDeliveryDate: string | null;
  lastInvoiceDate: string | null;
  estimatedWindowStart: string | null;
  estimatedWindowEnd: string | null;
  daysAfterLiveWindow: number;
  estimationStatus: RawMaterialDemandStatus;
  estimationStatusLabel: string;
  factorUsed: number;
  recommendedIncluded: boolean;
  conservativeIncluded: boolean;
  reviewRequired: boolean;
  warnings: string[];
};

export type RawMaterialIntelligenceUnservedBalanceRow = {
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  sellerName: string | null;
  productCode: string | null;
  productName: string | null;
  openQuantity: number;
  openNetAmount: number;
  issueDate: string;
  expectedDeliveryDate: string | null;
  lastInvoiceDate: string | null;
  daysAfterLiveWindow: number;
  agingBucket: string;
  statusLabel: string;
};

export type RawMaterialIntelligenceReviewItem = {
  reason: string;
  orderId: string;
  orderNumber: string;
  productCode: string | null;
  productName: string | null;
  impact: string;
  suggestedAction: string;
};

export type RawMaterialIntelligenceAudit = {
  source: string;
  rulesVersion: string;
  billingCycleDays: number;
  partialBillingLiveDays: number;
  staleBalanceDays: number;
  filtersApplied: Record<string, unknown>;
  lastSyncInfo: string | null;
  warnings: string[];
};

export type RawMaterialIntelligenceBlock = {
  summary: RawMaterialIntelligenceSummaryBlock;
  materials: RawMaterialIntelligenceMaterialRow[];
  orders: RawMaterialIntelligenceOrderRow[];
  unservedBalances: RawMaterialIntelligenceUnservedBalanceRow[];
  reviewItems: RawMaterialIntelligenceReviewItem[];
  audit: RawMaterialIntelligenceAudit;
};

export type SalesOrderRawMaterialIntelligencePayload = {
  filtersApplied: Record<string, unknown>;
  summary: MaterialUsagePlannedRealizedSummary;
  rows: MaterialUsagePlannedRealizedRow[];
  dataQuality: MaterialUsagePlannedRealizedDataQuality;
  contributions: MaterialUsageContribution[];
  nfeByOrderId: Record<string, MaterialUsageNfeSummary[]>;
  intelligence: RawMaterialIntelligenceBlock;
};

export type SalesOrderIntelligenceSourceOrder = {
  id: string;
  orderCode: string;
  status: string;
  issueDate: Date;
  expectedDeliveryDate: Date | null;
  totalNetValue: number;
  responsible: string | null;
  nomusRawResponse: unknown;
  customerName: string | null;
  items: Array<{
    id: string;
    productId: string;
    externalProductId?: number | null;
    skuSnapshot?: string | null;
    productNameSnapshot?: string | null;
    quantity: number;
    totalNetValue: number;
    unit?: string | null;
  }>;
};

export type ProductBomExplosionRow = {
  materialId: string;
  materialCode: string | null;
  materialName: string;
  unit: string | null;
  unitKey: string;
  unitLabel: string;
  quantityPerUnit: number;
  valuePerUnit: number | null;
  unitCost: number | null;
};
