/**
 * Avaliação do Pedido de Compra Nomus — regras puras (sem Prisma).
 *
 * Reutiliza o motor OP-26 (`computeSupplierOrderEvaluation`). Não duplica fórmula.
 * Identidade oficial = NomusPurchaseOrder.id. Nunca PurchaseOrder interno.
 * Sugestão automática não existe no MVP OP-26 — devolve null, nunca 0.
 */

import {
  NOMUS_PURCHASE_ORDER_STAGES,
  type NomusPurchaseOrderStage,
} from "@/src/lib/nomus/nomusPurchaseOrderTypes.js";
import type {
  PurchaseOrderRelationConfidence,
  PurchaseOrderRelationMethod,
} from "@/src/lib/nomus/nomusPurchaseOrder360.js";
import {
  SUPPLIER_EVALUATION_HISTORY_ACTIONS,
  computeSupplierOrderEvaluation,
  describePurchaseOrderSupplierEvaluationEligibility,
  isPurchaseOrderSupplierEvaluationEligible,
  type SupplierEvaluationCriterionKey,
  type SupplierEvaluationScores,
  type SupplierPerformanceEvaluationStatusFilter,
  type SupplierPerformanceSummaryDto,
} from "./supplierPerformance.js";

/** Toda a base Nomus é avaliável — inclusive pedidos novos/abertos. */
export const NOMUS_SUPPLIER_EVALUATION_ELIGIBLE_STAGES: readonly NomusPurchaseOrderStage[] =
  NOMUS_PURCHASE_ORDER_STAGES;

export const NOMUS_SUPPLIER_EVALUATION_SAFE_CONFIDENCE: readonly PurchaseOrderRelationConfidence[] =
  ["EXACT", "HIGH"];

export const NOMUS_SUPPLIER_EVALUATION_BATCH_MAX_ITEMS = 50;

export const NOMUS_SUPPLIER_EVALUATION_HISTORY_ACTIONS = SUPPLIER_EVALUATION_HISTORY_ACTIONS;

export type NomusSupplierEvaluationStatus = "PENDING" | "EVALUATED" | "INELIGIBLE";

export type NomusSupplierEvaluationSuggestion = Record<
  SupplierEvaluationCriterionKey,
  number | null
>;

export function isNomusPurchaseOrderSupplierEvaluationEligible(
  _stage?: string | null,
  _canceled?: boolean | null
): boolean {
  return true;
}

export function describeNomusPurchaseOrderSupplierEvaluationEligibility(
  _stage?: string | null,
  _canceled?: boolean | null
): { eligible: boolean; eligibilityReason: string | null } {
  return { eligible: true, eligibilityReason: null };
}

export function nomusSupplierEvaluationStatus(input: {
  eligible: boolean;
  hasEvaluation: boolean;
}): NomusSupplierEvaluationStatus {
  if (!input.eligible) return "INELIGIBLE";
  return input.hasEvaluation ? "EVALUATED" : "PENDING";
}

/**
 * Identidade segura para consolidar no FinancialSupplier.
 * FALLBACK (nome) e UNRESOLVED nunca gravam supplierId.
 * HIGH sem financialSupplierId também é inseguro.
 */
export function isSupplierIdentitySafeForEvaluation(input: {
  matchConfidence: PurchaseOrderRelationConfidence | string | null | undefined;
  financialSupplierId: string | null | undefined;
}): boolean {
  if (!input.financialSupplierId) return false;
  const confidence = String(input.matchConfidence ?? "");
  return (NOMUS_SUPPLIER_EVALUATION_SAFE_CONFIDENCE as readonly string[]).includes(confidence);
}

/** Engine de sugestão do MVP OP-26: todas as notas são manuais. Desconhecido = null. */
export function suggestNomusPurchaseOrderEvaluationScores(): NomusSupplierEvaluationSuggestion {
  return {
    quality: null,
    delivery: null,
    conformity: null,
    service: null,
  };
}

export function previewNomusPurchaseOrderEvaluation(input: {
  qualityScore: unknown;
  deliveryScore: unknown;
  conformityScore: unknown;
  serviceScore: unknown;
}): { scores: SupplierEvaluationScores; overallScore: number } {
  return computeSupplierOrderEvaluation(input);
}

export type NomusSupplierEvaluationDto = {
  id: string;
  nomusPurchaseOrderId: string;
  financialSupplierId: string | null;
  supplierMatchMethod: PurchaseOrderRelationMethod | string;
  supplierMatchConfidence: PurchaseOrderRelationConfidence | string;
  supplierIdentitySafe: boolean;
  scores: SupplierEvaluationScores & { overall: number };
  methodologyVersion: number;
  notes: string | null;
  revision: number;
  createdAt: string;
  createdBy: { id: string | null; name: string | null };
  updatedAt: string;
  updatedBy: { id: string | null; name: string | null };
};

export type NomusSupplierEvaluationWorklistRow = {
  nomusPurchaseOrderId: string;
  externalId: number;
  orderNumber: string | null;
  issuedAt: string | null;
  stage: string;
  canceled: boolean | null;
  eligible: boolean;
  eligibilityReason: string | null;
  evaluationStatus: NomusSupplierEvaluationStatus;
  supplier: {
    nomusExternalId: number | null;
    nomusName: string | null;
    resolvedName: string | null;
    resolvedDocument: string | null;
    financialSupplierId: string | null;
    matchMethod: string;
    matchConfidence: string;
    identitySafe: boolean;
  };
  evaluation: NomusSupplierEvaluationDto | null;
  suggestions: NomusSupplierEvaluationSuggestion;
};

export type NomusSupplierEvaluationWorklistKpis = SupplierPerformanceSummaryDto;

export type NomusSupplierEvaluationWorklistResponse = {
  page: number;
  pageSize: number;
  total: number;
  kpis: NomusSupplierEvaluationWorklistKpis;
  items: NomusSupplierEvaluationWorklistRow[];
};

export type NomusSupplierEvaluationBatchItemInput = {
  nomusPurchaseOrderId: unknown;
  qualityScore: unknown;
  deliveryScore: unknown;
  conformityScore: unknown;
  serviceScore: unknown;
  notes?: unknown;
  expectedRevision?: unknown;
  revisionReason?: unknown;
};

export type NomusSupplierEvaluationBatchItemResult =
  | {
      nomusPurchaseOrderId: string;
      success: true;
      evaluation: NomusSupplierEvaluationDto;
    }
  | {
      nomusPurchaseOrderId: string;
      success: false;
      code: string;
      error: string;
    };

export type NomusSupplierEvaluationWorklistFilter = {
  evaluationStatus: SupplierPerformanceEvaluationStatusFilter;
};

/** Sugestão de autocomplete: vem da base Nomus, não de uma lista paralela. */
export type NomusEvaluationSupplierSuggestion = {
  supplierExternalId: number | null;
  nomusName: string | null;
  resolvedName: string | null;
  resolvedDocument: string | null;
  financialSupplierId: string | null;
  matchConfidence: string;
  identitySafe: boolean;
  orderCount: number;
};

/** Confirma que o motor interno de PO não é a identidade desta aba. */
export function assertInternalPurchaseOrderNotUsedAsNomusIdentity(): {
  internalEligibleFn: typeof isPurchaseOrderSupplierEvaluationEligible;
  internalDescribeFn: typeof describePurchaseOrderSupplierEvaluationEligibility;
} {
  return {
    internalEligibleFn: isPurchaseOrderSupplierEvaluationEligible,
    internalDescribeFn: describePurchaseOrderSupplierEvaluationEligibility,
  };
}
