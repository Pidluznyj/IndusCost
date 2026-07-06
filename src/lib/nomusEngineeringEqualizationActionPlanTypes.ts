/**
 * Tipos puros do Plano de Ação de Equalização por produto.
 *
 * NÃO importar Prisma, @prisma/client ou libs server-side neste arquivo.
 * Este módulo é seguro para frontend e backend.
 *
 * Fase: NOMUS-ENGINEERING-EQUALIZATION-WORKFLOW-A.
 */

import type {
  CockpitOperatorStatus,
  CockpitSeverity,
} from "@/src/lib/nomusEngineeringOperationsCockpitTypes";

export type ActionPlanMode = "READ_ONLY";

export type ActionPlanReadiness =
  | "NO_ACTION_REQUIRED"
  | "READY_FOR_MANUAL_REVIEW"
  | "READY_FOR_CONTROLLED_APPLY"
  | "NEEDS_PRODUCT_IMPORT"
  | "NEEDS_OPTIONAL_SELECTION"
  | "NEEDS_MATERIAL_MAPPING"
  | "NEEDS_CHILD_PRODUCT_IMPORT"
  | "NEEDS_ENGINEERING_REVIEW"
  | "BLOCKED"
  | "ERROR";

export type ActionPlanNextAction =
  | "NONE"
  | "OPEN_EFFECTIVE_BOM"
  | "OPEN_COST_IMPACT"
  | "OPEN_APPLY_PLAN"
  | "OPEN_OPTIONAL_SELECTION"
  | "OPEN_PRODUCT_IMPORT"
  | "OPEN_TECHNICAL_DIAGNOSTIC"
  | "REVIEW_LOCAL_ASSEMBLY"
  | "MAP_MATERIAL"
  | "IMPORT_CHILD_PRODUCT"
  | "ASK_ENGINEERING_REVIEW";

export type ActionPlanStepStatus =
  | "DONE"
  | "PENDING"
  | "BLOCKED"
  | "REVIEW"
  | "NOT_REQUIRED";

export type ActionPlanTargetTab =
  | "overview"
  | "pending"
  | "effective-pricing-bom"
  | "cost-impact"
  | "apply-plan"
  | "diagnostic"
  | "product-import"
  | "engineering-sync";

export type ActionPlanStepKey =
  | "PRODUCT_EXISTS"
  | "BOM_COMPARISON"
  | "OPTIONAL_SELECTION"
  | "MATERIAL_MAPPING"
  | "CHILD_PRODUCT_IMPORT"
  | "LOCAL_ASSEMBLY"
  | "COST_IMPACT"
  | "APPLY_PLAN"
  | "FINAL_APPLY";

export type ActionPlanStep = {
  key: ActionPlanStepKey;
  label: string;
  status: ActionPlanStepStatus;
  description: string;
  actionLabel?: string;
  targetTab?: ActionPlanTargetTab;
};

export type ActionPlanCostImpactSummary = {
  hasStructuralChanges: boolean;
  deltaTotalCost: number | null;
  deltaMaterialCost: number | null;
  impactStatus: string;
  optionalPricingStatus: string;
  effectiveBomStatus: string;
  noOpReason: string | null;
  warnings: string[];
};

export type ActionPlanApplyPreviewSummary = {
  actionClass: string;
  riskLevel: string;
  canApplyWithApproval: boolean;
  isBlocked: boolean;
  isProductImportCandidate: boolean;
  optionalPricingStatus: string | null;
  importProductActions: number;
  createBomActions: number;
  updateQuantityActions: number;
  addBomLineActions: number;
  removeBomLineActions: number;
  keepIndusLineActions: number;
  ignoreOperationalItemActions: number;
  blockedActions: number;
  noActionCount: number;
  optionalSelectionRequiredActions: number;
  optionalItemNotAutoAppliedActions: number;
  totalActions: number;
  reasons: string[];
};

export type ActionPlanImportPreviewSummary = {
  productProposedAction: string;
  productReason: string;
  isBlocked: boolean;
  blockingReasons: string[];
  warnings: string[];
  engineeringPending: string[];
};

export type ActionPlanLocalExceptionSummary = {
  hasAssemblyLocal: boolean;
  hasLocalKeep: boolean;
  assemblyLocalLines: Array<{
    componentCode: string;
    componentDescription: string | null;
    quantity: number | null;
  }>;
};

export type ActionPlanOptionalSummary = {
  status: "PENDING" | "RESOLVED" | "NO_OPTIONALS" | "STALE" | "UNKNOWN";
  hasOptionalPending: boolean;
};

export type ActionPlanTechnicalRefs = {
  cockpitRowAvailable: boolean;
  costImpactAvailable: boolean;
  applyPreviewAvailable: boolean;
  importPreviewAvailable: boolean;
  effectiveBomAvailable: boolean;
};

export type ActionPlanProductInfo = {
  productId: string | null;
  productName: string | null;
  productSku: string | null;
  costingMode: "OWN_PROCESS" | "BOM_ONLY" | "FINISHING_SERVICE" | null;
};

export type EngineeringEqualizationActionPlanResult = {
  mode: ActionPlanMode;
  generatedAt: string;
  parentCode: string;
  parentDescription: string | null;
  product: ActionPlanProductInfo;

  existsInIndusCost: boolean;
  existsInNomusStage: boolean;

  operatorStatus: CockpitOperatorStatus;
  operatorStatusLabel: string;
  severity: CockpitSeverity;

  summary: string;
  readiness: ActionPlanReadiness;
  readinessLabel: string;

  nextRecommendedAction: ActionPlanNextAction;
  nextRecommendedActionLabel: string;
  nextRecommendedActionTargetTab: ActionPlanTargetTab | null;

  canProceedManually: boolean;
  requiresHumanDecision: boolean;

  blockers: string[];
  warnings: string[];

  steps: ActionPlanStep[];

  technicalRefs: ActionPlanTechnicalRefs;

  costImpactSummary: ActionPlanCostImpactSummary | null;
  applyPreviewSummary: ActionPlanApplyPreviewSummary | null;
  importPreviewSummary: ActionPlanImportPreviewSummary | null;
  localExceptionSummary: ActionPlanLocalExceptionSummary;
  optionalSummary: ActionPlanOptionalSummary;
};
