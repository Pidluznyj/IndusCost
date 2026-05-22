/**
 * Helpers puros do Plano de Ação de Equalização.
 *
 * NÃO importar Prisma, @prisma/client ou libs server-side neste arquivo.
 * Apenas mapeamentos de enums técnicos para linguagem humana.
 */

import type {
  ActionPlanNextAction,
  ActionPlanReadiness,
  ActionPlanTargetTab,
} from "@/src/lib/nomusEngineeringEqualizationActionPlanTypes";

export const READINESS_LABEL: Record<ActionPlanReadiness, string> = {
  NO_ACTION_REQUIRED: "Nenhuma ação necessária",
  READY_FOR_MANUAL_REVIEW: "Pronto para revisão manual",
  READY_FOR_CONTROLLED_APPLY: "Pronto para aplicação controlada",
  NEEDS_PRODUCT_IMPORT: "Falta importar o produto",
  NEEDS_OPTIONAL_SELECTION: "Falta selecionar opcionais",
  NEEDS_MATERIAL_MAPPING: "Falta cadastrar/mapear material",
  NEEDS_CHILD_PRODUCT_IMPORT: "Falta importar componente filho",
  NEEDS_ENGINEERING_REVIEW: "Precisa de revisão da Engenharia",
  BLOCKED: "Bloqueado",
  ERROR: "Erro ao gerar plano",
};

export const NEXT_ACTION_LABEL: Record<ActionPlanNextAction, string> = {
  NONE: "Nenhuma ação necessária",
  OPEN_EFFECTIVE_BOM: "Abrir BOM efetiva",
  OPEN_COST_IMPACT: "Abrir impacto de custo",
  OPEN_APPLY_PLAN: "Abrir plano de aplicação",
  OPEN_OPTIONAL_SELECTION: "Abrir opcionais",
  OPEN_PRODUCT_IMPORT: "Abrir importação do produto",
  OPEN_TECHNICAL_DIAGNOSTIC: "Abrir diagnóstico técnico",
  REVIEW_LOCAL_ASSEMBLY: "Revisar montagem local (800.xx)",
  MAP_MATERIAL: "Mapear / cadastrar material",
  IMPORT_CHILD_PRODUCT: "Importar componente filho",
  ASK_ENGINEERING_REVIEW: "Solicitar revisão da Engenharia",
};

export const NEXT_ACTION_TARGET_TAB: Record<ActionPlanNextAction, ActionPlanTargetTab | null> = {
  NONE: null,
  OPEN_EFFECTIVE_BOM: "effective-pricing-bom",
  OPEN_COST_IMPACT: "cost-impact",
  OPEN_APPLY_PLAN: "apply-plan",
  OPEN_OPTIONAL_SELECTION: "pending",
  OPEN_PRODUCT_IMPORT: "product-import",
  OPEN_TECHNICAL_DIAGNOSTIC: "diagnostic",
  REVIEW_LOCAL_ASSEMBLY: "pending",
  MAP_MATERIAL: "diagnostic",
  IMPORT_CHILD_PRODUCT: "product-import",
  ASK_ENGINEERING_REVIEW: "diagnostic",
};

export function readinessLabelFor(readiness: ActionPlanReadiness): string {
  return READINESS_LABEL[readiness] ?? "—";
}

export function nextActionLabelFor(action: ActionPlanNextAction): string {
  return NEXT_ACTION_LABEL[action] ?? "—";
}

export function targetTabFor(action: ActionPlanNextAction): ActionPlanTargetTab | null {
  return NEXT_ACTION_TARGET_TAB[action] ?? null;
}
