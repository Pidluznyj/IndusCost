/** Tipos compartilhados (sem Prisma) para o fluxo "Atualizar engenharia pelo Nomus". */

export type EngineeringSyncScope = "ONE_PRODUCT" | "ALL_NOMUS_PRODUCTS";

export type EngineeringSyncStageSummary = {
  parentsInStage: number;
  componentsInStage: number;
  lastStageSyncAt: string | null;
};

export type EngineeringProductActionType =
  | "CREATE_PRODUCT_FROM_NOMUS"
  | "UPDATE_PRODUCT_FROM_NOMUS"
  | "KEEP_PRODUCT_AS_NOMUS_CONTROLLED"
  | "KEEP_LOCAL_PRODUCT"
  | "MARK_PRODUCT_NOMUS_CONTROLLED"
  | "BLOCKED_AMBIGUOUS_PRODUCT_AND_MATERIAL";

export type EngineeringProductFieldChange = {
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

export type EngineeringProductActionPlan = {
  parentCode: string;
  parentDescription: string | null;
  actionType: EngineeringProductActionType;
  existsInNomus: boolean;
  existsInIndusCost: boolean;
  indusProductId: string | null;
  isAlreadyNomusControlled: boolean;
  reason: string;
  fieldChanges: EngineeringProductFieldChange[];
};

export type EngineeringBomActionType =
  | "CREATE_PRODUCT_BOM_LINE"
  | "UPDATE_PRODUCT_BOM_LINE_QUANTITY"
  | "UPDATE_PRODUCT_BOM_LINE_LOSS"
  | "UPDATE_PRODUCT_BOM_LINE_COMPONENT"
  | "REMOVE_PRODUCT_BOM_LINE_NOT_IN_NOMUS"
  | "KEEP_PRODUCT_BOM_LINE"
  | "KEEP_LOCAL_EXCEPTION"
  | "BLOCK_AMBIGUOUS_COMPONENT"
  | "BLOCK_MISSING_COMPONENT"
  | "BLOCK_OPTIONAL_SELECTION_REQUIRED";

export type EngineeringBomActionPlan = {
  parentCode: string;
  productId: string | null;
  productBomLineId: string | null;
  componentCode: string;
  componentDescription: string | null;
  actionType: EngineeringBomActionType;
  resolvedAs: "MATERIAL" | "PRODUCT" | "BOTH" | "NONE";
  materialId: string | null;
  childProductId: string | null;
  oldQuantity: number | null;
  newQuantity: number | null;
  oldLossPercentage: number | null;
  newLossPercentage: number | null;
  willApply: boolean;
  reason: string;
  resolutionMode?: "PREFER_MATERIAL" | "PREFER_PRODUCT";
  resolvedByRule?: boolean;
};

export type EngineeringSyncBlockingDetail = {
  parentCode: string;
  reason: string;
};

export type EngineeringSyncPlan = {
  generatedAt: string;
  scope: EngineeringSyncScope;
  parentCodes: string[];
  recursive: boolean;
  maxDepth: number;
  stageSummary: EngineeringSyncStageSummary;
  productActions: EngineeringProductActionPlan[];
  bomActions: EngineeringBomActionPlan[];
  blockingReasons: string[];
  blockingDetails: EngineeringSyncBlockingDetail[];
  warnings: string[];
  pendingCostItems: { componentCode: string; reason: string }[];
  pendingRoutingItems: { componentCode: string; reason: string }[];
  canApply: boolean;
  planHash: string;
  confirmationRequiredText: string;
  summary: {
    productsToCreate: number;
    productsToUpdate: number;
    bomLinesToCreate: number;
    bomLinesToUpdate: number;
    bomLinesToRemove: number;
    bomLinesKept: number;
    localExceptionsKept: number;
    blockedItems: number;
  };
};

export type EngineeringSyncApplyResult = {
  runId: string;
  status: "APPLIED" | "PARTIAL" | "FAILED";
  appliedAt: string;
  productsCreated: number;
  productsUpdated: number;
  bomLinesCreated: number;
  bomLinesUpdated: number;
  bomLinesRemoved: number;
  bomLinesKept: number;
  warnings: string[];
  errors: string[];
};

export type EngineeringChangeLogEntryView = {
  id: string;
  entityType: "PRODUCT" | "PRODUCT_BOM" | "MATERIAL" | "ROUTING" | "PRICE_INPUT";
  entityId: string | null;
  productId: string | null;
  productSku: string | null;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  changeOrigin:
    | "NOMUS_SYNC"
    | "NOMUS_ENGINEERING_APPLY"
    | "MANUAL_EDIT"
    | "LOCAL_EXCEPTION";
  reason: string | null;
  changedBy: string | null;
  changedAt: string;
  runId: string | null;
};
