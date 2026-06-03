/**
 * Tipos puros da Carga Mestre Nomus → IndusCost.
 *
 * NÃO importar Prisma, @prisma/client ou libs server-side neste arquivo.
 * Seguro para frontend e backend.
 *
 * Fase: NOMUS-MASTER-DATA-IMPORT-A.
 */

export type MasterDataImportMode = "READ_ONLY" | "APPLY_SAFE";

export type MasterDataClassification =
  | "EXISTING_PRODUCT"
  | "EXISTING_MATERIAL"
  | "EXISTING_BOTH_AMBIGUOUS"
  | "RESOLVED_AS_MATERIAL"
  | "RESOLVED_AS_PRODUCT"
  | "SAFE_PRODUCT_CANDIDATE"
  | "SAFE_MATERIAL_CANDIDATE"
  | "AMBIGUOUS_REVIEW"
  | "BLOCKED_INVALID_CODE"
  | "BLOCKED_LOCAL_PROCESS_CODE"
  | "BLOCKED_MISSING_DESCRIPTION"
  | "BLOCKED_UNSUPPORTED_REQUIRED_FIELDS"
  | "SKIPPED_OPTIONAL_MASTER_ALREADY_EXISTS";

export type MasterDataRecommendedTarget = "PRODUCT" | "MATERIAL" | "NONE";

export type MasterDataConfidence = "HIGH" | "MEDIUM" | "LOW";

export type MasterDataProductCreatePayloadPreview = {
  kind: "PRODUCT";
  sku: string;
  name: string;
  description: string | null;
  type: "PRODUCT" | "COMPONENT";
  sourceSystem: string;
  isNomusControlled: boolean;
  status: string;
  defaultLotSize: number;
};

export type MasterDataMaterialCreatePayloadPreview = {
  kind: "MATERIAL";
  code: string;
  description: string;
  unit: string;
  category: string;
  currentCost: number;
  averageCost: number;
  standardCost: number;
  freight: number;
  standardLoss: number;
  conversionFactor: number;
  status: string;
};

export type MasterDataCreatePayloadPreview =
  | MasterDataProductCreatePayloadPreview
  | MasterDataMaterialCreatePayloadPreview
  | null;

export type MasterDataRow = {
  code: string;
  description: string | null;
  appearsAsParent: boolean;
  appearsAsComponent: boolean;
  hasOwnBom: boolean;
  isOptional: boolean;
  isAlternative: boolean;
  parentCount: number;
  componentCount: number;
  nomusExamples: string[];
  existingProductId: string | null;
  existingMaterialId: string | null;
  classification: MasterDataClassification;
  classificationLabel: string;
  recommendedTarget: MasterDataRecommendedTarget;
  confidence: MasterDataConfidence;
  reason: string;
  blockers: string[];
  warnings: string[];
  canImportSafely: boolean;
  proposedCreatePayloadPreview: MasterDataCreatePayloadPreview;
};

export type MasterDataTotals = {
  distinctNomusCodes: number;
  existingProducts: number;
  existingMaterials: number;
  /** Ambiguidade real (Product+Material sem evidência de resolução). */
  existingBothAmbiguous: number;
  resolvedAsMaterial: number;
  resolvedAsProduct: number;
  missingTotal: number;
  safeProductCandidates: number;
  safeMaterialCandidates: number;
  ambiguousReview: number;
  blocked: number;
};

export type MasterDataPagination = {
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  totalRowsMatched: number;
};

export type MasterDataImportDiagnosticResult = {
  mode: "READ_ONLY";
  generatedAt: string;
  totals: MasterDataTotals;
  rows: MasterDataRow[];
  pagination: MasterDataPagination;
  warnings: string[];
};

export type MasterDataImportPreviewItem = {
  code: string;
  description: string | null;
  classification: MasterDataClassification;
  recommendedTarget: MasterDataRecommendedTarget;
  payload: MasterDataCreatePayloadPreview;
  reason: string;
};

export type MasterDataImportPreviewResult = {
  mode: "READ_ONLY";
  generatedAt: string;
  totals: {
    candidatesPlanned: number;
    productsPlanned: number;
    materialsPlanned: number;
    skippedExistingPlanned: number;
    blockedPlanned: number;
  };
  toCreate: MasterDataImportPreviewItem[];
  skippedExisting: MasterDataImportPreviewItem[];
  blocked: MasterDataImportPreviewItem[];
};

export type MasterDataImportApplyStatus = "APPLIED" | "NO_CHANGES" | "BLOCKED" | "FAILED";

export type MasterDataImportApplyReportItem = {
  code: string;
  description: string | null;
  kind: "PRODUCT" | "MATERIAL";
  outcome: "CREATED" | "SKIPPED_EXISTING" | "BLOCKED" | "FAILED";
  message: string;
  createdId: string | null;
};

export type MasterDataImportApplyResult = {
  mode: "APPLY_SAFE";
  generatedAt: string;
  status: MasterDataImportApplyStatus;
  message: string;
  createdProducts: number;
  createdMaterials: number;
  skippedExisting: number;
  blocked: number;
  errors: number;
  totalRequested: number;
  report: MasterDataImportApplyReportItem[];
};

export type MasterDataConfirmationText = "IMPORTAR CADASTRO MESTRE NOMUS";

export const MASTER_DATA_CONFIRMATION_TEXT: MasterDataConfirmationText =
  "IMPORTAR CADASTRO MESTRE NOMUS";

export type MasterDataApplyMode = "SAFE_ONLY";
