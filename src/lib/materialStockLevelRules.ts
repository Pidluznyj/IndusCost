/**
 * Regras puras de nível de estoque (Conferência de Matéria-Prima).
 * Sem React, sem Prisma, sem persistência de status, sem custos.
 *
 * estoque total = estoque atual (Material.quantity).
 * Contingência / mínimo / recomendado nunca somam ao estoque.
 */

import {
  isStockLevelConfigured,
  roundMaterialStockQuantity,
} from "./materialStockConferenceMath.js";

export type MaterialStockStatus =
  | "NAO_CONFIGURADO"
  | "SEM_ESTOQUE"
  | "EMERGENCIA"
  | "CRITICO"
  | "ATENCAO"
  | "SAUDAVEL";

export const MATERIAL_STOCK_STATUS_LABELS: Record<MaterialStockStatus, string> = {
  NAO_CONFIGURADO: "Não configurado",
  SEM_ESTOQUE: "Sem estoque",
  EMERGENCIA: "Emergência",
  CRITICO: "Crítico",
  ATENCAO: "Atenção",
  SAUDAVEL: "Saudável",
};

export type MaterialStockLevelParams = {
  /** Estoque atual oficial (`Material.quantity`). */
  currentQuantity: unknown;
  contingencyQuantity: unknown;
  minimumQuantity: unknown;
  recommendedQuantity: unknown;
  /** Ignorado nos cálculos — unidade não influencia. */
  unit?: unknown;
};

export type StockLevelHierarchyValidation =
  | { ok: true; contingency: number; minimum: number; recommended: number }
  | { ok: false; reason: "MISSING_PARAMS" | "INVALID_HIERARCHY" | "INVALID_NUMBER" };

function parseConfiguredQuantity(value: unknown): number | null {
  if (!isStockLevelConfigured(value)) return null;
  const n = roundMaterialStockQuantity(value);
  return Number.isFinite(n) ? n : null;
}

function parseCurrentQuantity(value: unknown): number {
  const n = roundMaterialStockQuantity(value);
  if (!Number.isFinite(n)) return 0;
  return n;
}

/** Estoque físico total = estoque atual. Nunca soma contingência/mínimo/recomendado. */
export function computeTotalPhysicalStock(currentQuantity: unknown): number {
  return parseCurrentQuantity(currentQuantity);
}

/**
 * Disponível acima da contingência: max(atual − contingência, 0).
 * null se contingência não configurada.
 */
export function computeAvailableAboveContingency(
  currentQuantity: unknown,
  contingencyQuantity: unknown
): number | null {
  const contingency = parseConfiguredQuantity(contingencyQuantity);
  if (contingency == null) return null;
  const current = parseCurrentQuantity(currentQuantity);
  return Math.max(roundMaterialStockQuantity(current - contingency), 0);
}

/**
 * Sugestão de reposição: max(recomendado − atual, 0).
 * null se recomendado não configurado.
 */
export function computeReplenishmentSuggestion(
  currentQuantity: unknown,
  recommendedQuantity: unknown
): number | null {
  const recommended = parseConfiguredQuantity(recommendedQuantity);
  if (recommended == null) return null;
  const current = parseCurrentQuantity(currentQuantity);
  return Math.max(roundMaterialStockQuantity(recommended - current), 0);
}

/**
 * Hierarquia válida: contingência <= mínimo <= recomendado.
 * Qualquer parâmetro nulo ⇒ MISSING_PARAMS.
 */
export function validateStockLevelHierarchy(input: {
  contingencyQuantity: unknown;
  minimumQuantity: unknown;
  recommendedQuantity: unknown;
}): StockLevelHierarchyValidation {
  const contingency = parseConfiguredQuantity(input.contingencyQuantity);
  const minimum = parseConfiguredQuantity(input.minimumQuantity);
  const recommended = parseConfiguredQuantity(input.recommendedQuantity);
  if (contingency == null || minimum == null || recommended == null) {
    return { ok: false, reason: "MISSING_PARAMS" };
  }
  if (
    !Number.isFinite(contingency) ||
    !Number.isFinite(minimum) ||
    !Number.isFinite(recommended)
  ) {
    return { ok: false, reason: "INVALID_NUMBER" };
  }
  if (!(contingency <= minimum && minimum <= recommended)) {
    return { ok: false, reason: "INVALID_HIERARCHY" };
  }
  return { ok: true, contingency, minimum, recommended };
}

/**
 * Classifica o status com prioridade exclusiva (sem sobreposição):
 * 1) NÃO_CONFIGURADO (params ausentes ou hierarquia inválida)
 * 2) SEM_ESTOQUE (atual === 0)
 * 3) EMERGÊNCIA (atual < contingência)
 * 4) CRÍTICO (atual < mínimo && atual >= contingência)
 * 5) ATENÇÃO (atual < recomendado && atual >= mínimo)
 * 6) SAUDÁVEL (atual >= recomendado)
 */
export function resolveMaterialStockStatus(
  input: MaterialStockLevelParams
): MaterialStockStatus {
  const hierarchy = validateStockLevelHierarchy(input);
  if (!hierarchy.ok) return "NAO_CONFIGURADO";

  const current = parseCurrentQuantity(input.currentQuantity);
  const { contingency, minimum, recommended } = hierarchy;

  if (current === 0) return "SEM_ESTOQUE";
  if (current < contingency) return "EMERGENCIA";
  if (current < minimum) return "CRITICO";
  if (current < recommended) return "ATENCAO";
  return "SAUDAVEL";
}

/** Snapshot completo para UI/API futura — status nunca é gravado no banco por estas funções. */
export function evaluateMaterialStockLevels(input: MaterialStockLevelParams): {
  totalPhysicalStock: number;
  availableAboveContingency: number | null;
  replenishmentSuggestion: number | null;
  hierarchyValid: boolean;
  status: MaterialStockStatus;
} {
  const hierarchy = validateStockLevelHierarchy(input);
  return {
    totalPhysicalStock: computeTotalPhysicalStock(input.currentQuantity),
    availableAboveContingency: computeAvailableAboveContingency(
      input.currentQuantity,
      input.contingencyQuantity
    ),
    replenishmentSuggestion: computeReplenishmentSuggestion(
      input.currentQuantity,
      input.recommendedQuantity
    ),
    hierarchyValid: hierarchy.ok,
    status: resolveMaterialStockStatus(input),
  };
}
