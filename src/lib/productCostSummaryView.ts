/**
 * View-model do resumo de custo industrial usado no modal Editar Engenharia.
 *
 * Fase: INDUSCOST-ENGINEERING-COST-SUMMARY-PRELOAD-A.
 *
 * Arquivo puro — seguro para frontend e backend.
 *
 * Regra:
 *  - Nunca devolver "R$ 0,00" como fallback enganoso de "não carregado".
 *  - Distinguir os estados:
 *      • idle          — modal ainda não tem produto / criação nova;
 *      • loading       — fetch em andamento, sem valor cacheado;
 *      • error         — fetch falhou e não há valor anterior;
 *      • loaded        — fetch concluiu com valor real (inclui zero real);
 *      • stale         — valor anterior disponível enquanto recarrega.
 *  - Zero só aparece quando `state === "loaded"` (cálculo real retornou 0).
 *  - Mensagens de UI fixas para evitar variação acidental.
 */

import { resolveOfficialProductFinalCostFromAnalysis } from "./productOfficialFinalCost.js";

export type CostSummaryViewKind =
  | "idle"
  | "loading"
  | "loaded"
  | "stale"
  | "error";

export type CostSummaryView = {
  kind: CostSummaryViewKind;
  /** Valor numérico válido apenas em `loaded` ou `stale`. */
  totalIndustrialCost: number | null;
  partial: boolean;
  message: string;
  showRetry: boolean;
};

export const COST_SUMMARY_LABELS = {
  idle: "Custo não calculado",
  loading: "Calculando custo…",
  error: "Não foi possível calcular o custo",
  retry: "Atualizar custo",
  partial: "Parcial",
} as const;

export type CostSummaryInput = {
  productId: string | null | undefined;
  loading: boolean;
  errorMessage: string | null | undefined;
  /** `null` significa "não carregado ainda"; objeto significa "carregado" (zero é valor real). */
  cost:
    | null
    | {
        totalIndustrialCost: number;
        partial?: boolean;
      };
};

function safeFinite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Calcula o estado visual do rodapé/cards a partir do estado do fetch.
 *
 * - Sem produto ainda (criação) → idle.
 * - Loading SEM valor anterior → loading (mostra "Calculando custo…").
 * - Loading COM valor anterior  → stale (mostra valor antigo + ainda atualizando).
 * - Erro SEM valor anterior     → error (mostra mensagem + botão Atualizar).
 * - Erro COM valor anterior     → stale (não apaga valor que já foi calculado).
 * - Valor presente sem loading/erro → loaded (mostra valor — pode ser 0 real).
 */
export function buildProductCostSummaryView(input: CostSummaryInput): CostSummaryView {
  if (!input.productId) {
    return {
      kind: "idle",
      totalIndustrialCost: null,
      partial: false,
      message: COST_SUMMARY_LABELS.idle,
      showRetry: false,
    };
  }

  const cost = input.cost;
  const total = cost ? safeFinite(cost.totalIndustrialCost) : null;
  const partial = cost ? Boolean(cost.partial) : false;

  if (input.loading && total == null) {
    return {
      kind: "loading",
      totalIndustrialCost: null,
      partial: false,
      message: COST_SUMMARY_LABELS.loading,
      showRetry: false,
    };
  }

  if (input.errorMessage && total == null) {
    return {
      kind: "error",
      totalIndustrialCost: null,
      partial: false,
      message: COST_SUMMARY_LABELS.error,
      showRetry: true,
    };
  }

  if (input.loading && total != null) {
    return {
      kind: "stale",
      totalIndustrialCost: total,
      partial,
      message: COST_SUMMARY_LABELS.loading,
      showRetry: false,
    };
  }

  if (input.errorMessage && total != null) {
    return {
      kind: "stale",
      totalIndustrialCost: total,
      partial,
      message: COST_SUMMARY_LABELS.error,
      showRetry: true,
    };
  }

  if (total != null) {
    return {
      kind: "loaded",
      totalIndustrialCost: total,
      partial,
      message: "",
      showRetry: false,
    };
  }

  return {
    kind: "idle",
    totalIndustrialCost: null,
    partial: false,
    message: COST_SUMMARY_LABELS.idle,
    showRetry: false,
  };
}

/** Helper conveniente para extrair `cost` a partir do payload de `/api/products/:id/cost-analysis`. */
export function pickCostSummaryFromAnalysis(
  data: unknown
): CostSummaryInput["cost"] {
  const resolved = resolveOfficialProductFinalCostFromAnalysis(data);
  if (!resolved.ok) return null;
  return {
    totalIndustrialCost: resolved.finalUnitCost,
    partial: resolved.costAnalysisPartial,
  };
}
