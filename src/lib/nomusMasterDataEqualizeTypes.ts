/**
 * Tipos puros do fluxo "Igualar bases" Nomus.
 *
 * NÃO importar Prisma, @prisma/client ou libs server-side neste arquivo.
 * Seguro para frontend e backend.
 *
 * Fase: NOMUS-MASTER-DATA-EQUALIZE-A.
 */

import type { MasterDataCreatePayloadPreview } from "@/src/lib/nomusMasterDataImportTypes";

export type EqualizeMode = "READ_ONLY" | "APPLY_SAFE";

export type EqualizeAction =
  | "CREATE_PRODUCT"
  | "CREATE_MATERIAL"
  | "UPDATE_PRODUCT"
  | "UPDATE_MATERIAL"
  | "DEACTIVATE_PRODUCT"
  | "DEACTIVATE_MATERIAL"
  | "PRESERVE_LOCAL"
  | "PRESERVE_NOMUS_CONTROLLED"
  | "AMBIGUOUS_REVIEW"
  | "BLOCKED_LOCAL_PROCESS_CODE"
  | "BLOCKED_MISSING_DESCRIPTION"
  | "NO_CHANGES";

export type EqualizeTarget = "PRODUCT" | "MATERIAL" | "NONE";

export type EqualizeFieldChange = {
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
};

export type EqualizeRow = {
  code: string;
  description: string | null;
  action: EqualizeAction;
  actionLabel: string;
  target: EqualizeTarget;
  /** Snapshot resumido do estado atual no IndusCost (quando aplicável). */
  currentSnapshot: {
    productId: string | null;
    materialId: string | null;
    productName: string | null;
    productSourceSystem: string | null;
    productIsNomusControlled: boolean | null;
    productStatus: string | null;
    materialDescription: string | null;
    materialCategory: string | null;
    materialStatus: string | null;
  };
  /** Payload de criação previsto, quando a ação for CREATE_*. */
  createPayload: MasterDataCreatePayloadPreview;
  /** Lista de campos que seriam atualizados, quando a ação for UPDATE_*. */
  fieldChanges: EqualizeFieldChange[];
  /** Mensagem humana explicando a ação. */
  reason: string;
  blockers: string[];
  warnings: string[];
  isControlledByNomus: boolean;
  appearsInNomusStage: boolean;
};

export type EqualizeTotals = {
  createProducts: number;
  createMaterials: number;
  updateProducts: number;
  updateMaterials: number;
  deactivateProducts: number;
  deactivateMaterials: number;
  preserveLocalProducts: number;
  preserveLocalMaterials: number;
  preserveNomusControlled: number;
  ambiguous: number;
  blocked: number;
  noChanges: number;
  totalRowsConsidered: number;
};

export type EqualizePagination = {
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  totalRowsMatched: number;
};

export type EqualizePreviewResult = {
  mode: "READ_ONLY";
  generatedAt: string;
  totals: EqualizeTotals;
  rows: EqualizeRow[];
  pagination: EqualizePagination;
  warnings: string[];
};

export type EqualizeApplyStatus =
  | "APPLIED"
  | "NO_CHANGES"
  | "BLOCKED"
  | "FAILED"
  | "PARTIAL";

export type EqualizeApplySafety = {
  productBomChanged: boolean;
  costsChanged: boolean;
  pricesChanged: boolean;
  proposalsChanged: boolean;
  ordersChanged: boolean;
  routingChanged: boolean;
};

export type EqualizeApplyErrorItem = {
  code: string;
  action: EqualizeAction;
  message: string;
  userMessage: string;
  resolutionHint: string;
  sku: string;
};

export type EqualizeApplyTechnicalDetails = {
  planHash: string | null;
  generatedAt: string;
  confirmationRequiredText: "IGUALAR BASES NOMUS";
  semanticRunStatus?: string;
};

export type EqualizeApplyReportItem = {
  code: string;
  action: EqualizeAction;
  target: EqualizeTarget;
  outcome:
    | "CREATED"
    | "UPDATED"
    | "DEACTIVATED"
    | "PRESERVED"
    | "SKIPPED"
    | "BLOCKED"
    | "FAILED";
  message: string;
  createdId: string | null;
  fieldChangesApplied: EqualizeFieldChange[];
};

export type EqualizeApplyResult = {
  mode: "APPLY_SAFE";
  generatedAt: string;
  status: EqualizeApplyStatus;
  /** Mensagem técnica resumida (compatível com CLI). */
  message: string;
  /** Mensagem principal em linguagem de operador. */
  userMessage: string;
  runId: string;
  createdProducts: number;
  createdMaterials: number;
  updatedProducts: number;
  updatedMaterials: number;
  deactivatedProducts: number;
  deactivatedMaterials: number;
  preservedLocal: number;
  blocked: number;
  errors: number;
  historyEntriesCreated: number;
  totalRequested: number;
  report: EqualizeApplyReportItem[];
  /** Totais do preview pós-análise (quando disponível no servidor). */
  previewTotals?: EqualizeTotals;
  safety: EqualizeApplySafety;
  applyErrors: EqualizeApplyErrorItem[];
  technicalDetails: EqualizeApplyTechnicalDetails;
};

export const EQUALIZE_CONFIRMATION_TEXT = "IGUALAR BASES NOMUS" as const;
export type EqualizeConfirmationText = typeof EQUALIZE_CONFIRMATION_TEXT;
