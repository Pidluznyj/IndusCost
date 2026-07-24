export type NomusProductImportActionType =
  | "CREATE_PRODUCT_FROM_NOMUS"
  | "USE_EXISTING_PRODUCT"
  | "USE_EXISTING_MATERIAL"
  | "CREATE_COMPONENT_PRODUCT_FROM_NOMUS"
  | "CREATE_PLACEHOLDER_COMPONENT_WITHOUT_COST"
  | "BLOCKED_UNRESOLVED"
  | "OPTIONAL_SELECTION_REQUIRED"
  | "AMBIGUOUS_PRODUCT_AND_MATERIAL"
  | "USE_EXISTING_MATERIAL_BY_RULE"
  | "MATERIAL_INACTIVE_REQUIRES_REVIEW"
  | "HISTORICAL_CLASSIFICATION_CONFLICT"
  | "BLOCKED";

export type NomusProductImportBomActionType =
  | "CREATE_PRODUCT_BOM_LINE"
  | "SKIP_OPTIONAL_NOT_SELECTED"
  | "BLOCKED_AMBIGUOUS_COMPONENT"
  | "BLOCKED_MISSING_COMPONENT"
  | "BLOCKED_INACTIVE_MATERIAL";

export type NomusProductImportProductAction = {
  parentCode: string;
  parentDescription: string | null;
  existsInNomus: boolean;
  existsInIndusCost: boolean;
  indusProductId: string | null;
  proposedAction: NomusProductImportActionType;
  reason: string;
};

export type NomusProductImportComponentAction = {
  componentCode: string;
  componentDescription: string | null;
  quantity: number | null;
  nomusFlags: {
    opcional: boolean;
    alternativo: boolean;
    preferencial: boolean;
    itemDeEmbarque: boolean;
  };
  existsAsProduct: boolean;
  existsAsMaterial: boolean;
  existsInBoth: boolean;
  existsInNeither: boolean;
  hasNomusSubBom: boolean;
  parentCodeContext: string;
  level: number;
  proposedAction: NomusProductImportActionType;
  productId: string | null;
  materialId: string | null;
  reason: string;
  includedInPricingBom: boolean;
  resolutionMode?: "PREFER_MATERIAL" | "PREFER_PRODUCT";
  resolvedByRule?: boolean;
};

export type NomusProductImportBomLinePlan = {
  bomActionType: NomusProductImportBomActionType;
  componentCode: string;
  componentDescription: string | null;
  quantity: number | null;
  lossPercentage: number;
  materialId: string | null;
  childProductId: string | null;
  source: string | null;
  willCreate: boolean;
  reason: string;
};

export type NomusProductImportMissingCostItem = {
  componentCode: string;
  kind: "MATERIAL" | "PRODUCT" | "PLACEHOLDER" | "PARENT";
  reason: string;
};

export type NomusProductImportMissingRoutingItem = {
  componentCode: string;
  kind: "PARENT" | "COMPONENT";
  reason: string;
};

export type NomusProductImportOptionalPending = {
  componentCode: string;
  componentDescription: string | null;
  reason: string;
};

export type NomusProductImportAmbiguousItem = {
  componentCode: string;
  productId: string;
  materialId: string;
  reason: string;
  suggestedResolution: "PREFER_PRODUCT" | "PREFER_MATERIAL" | "REQUIRE_MANUAL_CHOICE";
  resolutionMode?: "PREFER_MATERIAL" | "PREFER_PRODUCT";
  resolvedByRule?: boolean;
};

export type NomusProductImportSimulationPreview = {
  generatedAt: string;
  parentCode: string;
  parentDescription: string | null;
  existsInIndusCost: boolean;
  indusProductId: string | null;
  existsInNomus: boolean;
  canImport: boolean;
  canSimulateCost: boolean;
  costSimulationStatus: "COMPLETE" | "INCOMPLETE_COST" | "BLOCKED";
  blockingReasons: string[];
  warnings: string[];
  planHash: string;
  confirmationRequiredText: string;
  /** Ação do produto principal (alias legível). */
  productAction: NomusProductImportProductAction;
  productActions: NomusProductImportProductAction[];
  componentActions: NomusProductImportComponentAction[];
  bomActions: NomusProductImportBomLinePlan[];
  missingCostItems: NomusProductImportMissingCostItem[];
  missingRoutingItems: NomusProductImportMissingRoutingItem[];
  optionalPendingItems: NomusProductImportOptionalPending[];
  ambiguousItems: NomusProductImportAmbiguousItem[];
  engineeringPending: string[];
  recursive: boolean;
  maxDepth: number;
  effectiveBomStatus: string | null;
  optionalPricingStatus: string | null;
};

export type NomusProductImportSimulationResult = {
  imported: boolean;
  productId: string | null;
  parentCode: string;
  importedProducts: Array<{ sku: string; productId: string; action: string }>;
  createdBomLines: number;
  warnings: string[];
  canSimulateCost: boolean;
  costSimulationStatus: "COMPLETE" | "INCOMPLETE_COST" | "BLOCKED";
  missingCostItems: NomusProductImportMissingCostItem[];
  missingRoutingItems: NomusProductImportMissingRoutingItem[];
  runId: string | null;
  costAnalysisPartial?: boolean;
  costAnalysisError?: string | null;
  totalIndustrialCost?: number | null;
};
