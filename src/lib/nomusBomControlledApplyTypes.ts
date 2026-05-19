/** Tipos da aplicação controlada Nomus → ProductBOM (sem Prisma — seguro para frontend). */

export type ControlledApplyActionType =
  | "CREATE_PRODUCT_BOM_LINE"
  | "UPDATE_PRODUCT_BOM_QUANTITY"
  | "KEEP_PRODUCT_BOM_LINE"
  | "REMOVE_PRODUCT_BOM_LINE"
  | "SKIP_UNRESOLVED"
  | "BLOCKED";

export type ControlledApplyComponentKind = "Material" | "Produto" | "Local" | "Desconhecido";

export type ControlledApplyRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";

export type ControlledApplyAction = {
  actionType: ControlledApplyActionType;
  componentCode: string;
  componentDescription?: string | null;
  componentKind: ControlledApplyComponentKind;
  currentQuantity?: number | null;
  effectiveQuantity?: number | null;
  productBomLineId?: string | null;
  reason: string;
  riskLevel: ControlledApplyRiskLevel;
  reviewDecisionType?: string | null;
  relatedNomusComponentCode?: string | null;
};

export type ControlledApplyBomSummary = {
  lineCount: number;
  materialLines: number;
  childProductLines: number;
};

export type ControlledApplyCostImpactSummary = {
  status: string;
  currentTotalCost?: number | null;
  effectiveTotalCost?: number | null;
  deltaTotalCost?: number | null;
  deltaTotalCostPct?: number | null;
  unresolvedCostLines?: number;
};

export type ControlledApplyPreview = {
  generatedAt: string;
  parentCode: string;
  productId: string | null;
  canApply: boolean;
  blockingReasons: string[];
  warnings: string[];
  planHash: string;
  effectiveBomHash: string;
  confirmationRequiredText: string;
  beforeSummary: ControlledApplyBomSummary;
  afterSummary: ControlledApplyBomSummary;
  actions: ControlledApplyAction[];
  costImpactSummary: ControlledApplyCostImpactSummary | null;
  effectiveBomStatus: string;
  optionalPricingStatus: string;
};

export type ControlledApplyResult = {
  applied: boolean;
  applyRunId: string;
  parentCode: string;
  productId: string;
  summary: {
    created: number;
    updated: number;
    kept: number;
    removed: number;
    skipped: number;
    blocked: number;
  };
  beforeBom: unknown[];
  afterBom: unknown[];
  actionsApplied: ControlledApplyAction[];
};
