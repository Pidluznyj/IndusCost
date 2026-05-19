/** Tipos da análise de impacto de custo — sem Prisma (seguro para frontend). */

import type {
  EffectivePricingBomStatus,
  PricingOptionalStatus,
} from "@/src/lib/nomusEffectivePricingBomTypes";

export type CostImpactStatus =
  | "READY"
  | "BLOCKED_EFFECTIVE_BOM_NOT_READY"
  | "NO_INDUS_PRODUCT"
  | "CURRENT_COST_UNAVAILABLE";

export type CostLineComparisonStatus =
  | "SAME_COMPONENT_SAME_QTY"
  | "SAME_COMPONENT_QTY_DIFF"
  | "ONLY_CURRENT_INDUS"
  | "ONLY_EFFECTIVE_NOMUS"
  | "INCLUDED_BY_REVIEW"
  | "EXCLUDED_BY_NOMUS_EFFECTIVE"
  | "UNRESOLVED_COST";

export type CostResolvedAs = "MATERIAL" | "PRODUCT" | "LOCAL_PRODUCT_BOM" | "UNRESOLVED";

export type CostBreakdown = {
  materialCost: number;
  transformationCost: number;
  totalCost: number;
};

export type CostImpactDelta = {
  materialCost: number;
  transformationCost: number;
  totalCost: number;
  materialCostPct: number | null;
  totalCostPct: number | null;
};

export type CostImpactLine = {
  componentCode: string;
  description: string | null;
  quantity: number | null;
  source: string;
  decision: string;
  includedForPricing: boolean;
  resolvedAs: CostResolvedAs;
  resolvedId: string | null;
  unitCost: number | null;
  totalCost: number | null;
  currentQuantity: number | null;
  effectiveQuantity: number | null;
  currentLineCost: number | null;
  effectiveLineCost: number | null;
  deltaCost: number | null;
  warnings: string[];
};

export type CostImpactComparisonLine = {
  componentCode: string;
  description: string | null;
  currentQuantity: number | null;
  effectiveQuantity: number | null;
  currentCost: number | null;
  effectiveCost: number | null;
  deltaCost: number | null;
  status: CostLineComparisonStatus;
  explanation: string;
};

export type CostImpactSummary = {
  comparisonLinesCount: number;
  includedEffectiveLinesCount: number;
  excludedEffectiveLinesCount: number;
  unresolvedCostLinesCount: number;
  onlyCurrentCount: number;
  onlyEffectiveCount: number;
  qtyDiffCount: number;
  transformationUsesCurrent: boolean;
  scopeNote: string;
};

export type NomusEffectiveBomCostImpactResult = {
  generatedAt: string;
  parentCode: string;
  parentDescription: string | null;
  indusProductId: string | null;
  status: CostImpactStatus;
  optionalPricingStatus: PricingOptionalStatus;
  effectiveBomStatus: EffectivePricingBomStatus;
  currentCost: CostBreakdown | null;
  effectiveNomusCost: CostBreakdown | null;
  delta: CostImpactDelta | null;
  summary: CostImpactSummary;
  lines: CostImpactComparisonLine[];
  includedLines: CostImpactLine[];
  excludedLines: CostImpactLine[];
  unresolvedLines: CostImpactLine[];
  warnings: string[];
};
