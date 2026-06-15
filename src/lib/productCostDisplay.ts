import { formatAdaptiveCurrency } from "@/src/lib/proposalMaterialConsolidation";
import { resolveOfficialProductFinalCostFromAnalysis } from "./productOfficialFinalCost.js";

/** Mesmo motor que GET /api/products/:id/cost-analysis (ProductBOM salva). */
export const PRODUCT_COST_MOTOR_HINT =
  "Calculado com a ProductBOM atualmente salva, pelo motor getProductCostAnalysis.";

export const GRID_CIU_COLUMN_LABEL = "CIU atual";
export const GRID_CIU_COLUMN_TOOLTIP =
  "Custo industrial unitário ao vivo (MP + HH + HM) com a ProductBOM salva. Mesma origem da aba Análise de Custo.";

export const MODAL_CURRENT_COST_LABEL = "Custo atual do IndusCost";
export const MODAL_CURRENT_COST_SUBTEXT = "Calculado com a ProductBOM atualmente salva.";

export const OPEN_BOOK_CIU_LABEL = "Custo atual do IndusCost (CIU)";

export const NOMUS_IMPACT_CURRENT_LABEL = "Custo atual no IndusCost";
export const NOMUS_IMPACT_SIMULATED_LABEL = "Custo simulado pela BOM efetiva Nomus";
export const NOMUS_IMPACT_DELTA_MONEY_LABEL = "Diferença prevista se aplicar";
export const NOMUS_IMPACT_DELTA_PCT_LABEL = "Diferença %";
export const NOMUS_IMPACT_EXPLANATION =
  "Este valor não é custo extra. É a variação entre o custo atual e o custo simulado após aplicar a BOM efetiva.";
export const NOMUS_IMPACT_USAGE_NOTE =
  "Use este comparativo para decidir se a BOM efetiva deve ser aplicada. O custo simulado só vira custo atual depois que a ProductBOM for alterada pela aplicação controlada.";

export function formatProductCiu(value: unknown): string {
  return formatAdaptiveCurrency(value);
}

export type CostSummaryFromAnalysis = {
  totalIndustrialCost: number;
  partial?: boolean;
};

/** Extrai CIU e flag parcial de GET /api/products/:id/cost-analysis. */
export function costSummaryFromCostAnalysis(data: unknown): CostSummaryFromAnalysis | null {
  const resolved = resolveOfficialProductFinalCostFromAnalysis(data);
  if (!resolved.ok) return null;
  return {
    totalIndustrialCost: resolved.finalUnitCost,
    partial: resolved.costAnalysisPartial,
  };
}
