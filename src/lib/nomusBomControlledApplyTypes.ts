/** Tipos da aplicação controlada Nomus → ProductBOM (sem Prisma — seguro para frontend). */

export type ControlledApplyResolutionMode =
  | "SAME_CHILD_PRODUCT"
  | "SAME_MATERIAL"
  | "PREFER_PRODUCT_FROM_EFFECTIVE"
  | "PREFER_MATERIAL_FROM_EFFECTIVE";

export type ControlledApplyActionType =
  | "CREATE_PRODUCT_BOM_LINE"
  | "UPDATE_PRODUCT_BOM_QUANTITY"
  | "KEEP_PRODUCT_BOM_LINE"
  | "REMOVE_PRODUCT_BOM_LINE"
  | "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES"
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
  /** Soma das quantidades nas linhas IndusCost duplicadas antes da consolidação. */
  currentQuantityTotal?: number | null;
  /** IDs de todas as linhas ProductBOM duplicadas para este componente. */
  duplicateBomLineIds?: string[];
  keepBomLineId?: string | null;
  removeBomLineIds?: string[];
  resolutionMode?: ControlledApplyResolutionMode | null;
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

export type ControlledApplyBlockingCode =
  | "NO_PRODUCT"
  | "NO_NOMUS_BOM"
  | "EFFECTIVE_BOM_BLOCKED"
  | "OPTIONAL_PENDING"
  | "LOCAL_REVIEW_PENDING"
  | "NEEDS_ENGINEERING_REVIEW"
  | "UNRESOLVED_INCLUDED_COMPONENT"
  | "BLOCKED_ACTION"
  | "COST_UNRESOLVED"
  | "DRY_PLAN_BLOCKED"
  | "AMBIGUOUS_DUPLICATE_PRODUCT_BOM_LINE";

export type ControlledApplyBlockingDetail = {
  code: ControlledApplyBlockingCode;
  componentCode?: string | null;
  componentDescription?: string | null;
  source?: string | null;
  decisionType?: string | null;
  reason: string;
  suggestedFix: string;
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
  blockingDetails: ControlledApplyBlockingDetail[];
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

export type ControlledApplyResultStatus = "APPLIED" | "NO_CHANGES" | "BLOCKED" | "FAILED";

export type ControlledApplyResult = {
  applied: boolean;
  /** Status estruturado da operação para a UI mostrar mensagem clara (sucesso/no-op/erro). */
  resultStatus: ControlledApplyResultStatus;
  /** Mensagem amigável já localizada em PT-BR. */
  message: string;
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
