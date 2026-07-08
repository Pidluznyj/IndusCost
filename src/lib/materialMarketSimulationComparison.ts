/**
 * Cards de comparação Atual | Simulado | Diferença — simulação what-if (stateless).
 */
import type { MaterialProductFinancialImpactResponse } from "./materialProductFinancialImpact.js";
import { resolveReajusteNecessario } from "./materialProductFinancialImpact.js";
import type {
  MaterialMarketSimulationMarginSummary,
  MaterialMarketSimulationProductImpact,
} from "./materialMarketSimulation.js";

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

export type MaterialSimulationComparison = {
  material: {
    currentPrice: number;
    simulatedPrice: number;
    differenceBRL: number;
    differencePct: number | null;
  };
  margin: {
    currentAvg: number | null;
    simulatedAvg: number | null;
    differencePct: number | null;
  };
  productsAtRisk: {
    current: number;
    simulated: number;
  };
  totalCostImpactBRL: number | null;
};

export type MaterialSimulationComparisonVariant = "default" | "success" | "danger" | "warning";

export function buildMaterialSimulationComparison(input: {
  currentPrice: number;
  simulatedPrice: number;
  productImpacts: MaterialMarketSimulationProductImpact[];
  marginSummary: MaterialMarketSimulationMarginSummary;
  financial: MaterialProductFinancialImpactResponse;
}): MaterialSimulationComparison {
  const differenceBRL = roundMoney(input.simulatedPrice - input.currentPrice);
  const differencePct =
    input.currentPrice > 0
      ? roundPercent((differenceBRL / input.currentPrice) * 100)
      : null;

  const marginDifferencePct =
    input.marginSummary.avgPreviousMargin != null &&
    input.marginSummary.avgSimulatedMargin != null
      ? roundPercent(
          input.marginSummary.avgSimulatedMargin - input.marginSummary.avgPreviousMargin
        )
      : null;

  const productsAtRiskCurrent = input.financial.items.filter((row) =>
    resolveReajusteNecessario({
      simulatedMargin: row.previousMargin,
      targetMarginPct: row.targetMarginPct,
      defaultThresholdPct: input.financial.marginThresholdPct,
    })
  ).length;

  const hasCostImpact = input.productImpacts.some((row) => row.costDifferenceBRL != null);
  const totalCostImpactBRL = hasCostImpact
    ? roundMoney(
        input.productImpacts.reduce((sum, row) => sum + (row.costDifferenceBRL ?? 0), 0)
      )
    : null;

  return {
    material: {
      currentPrice: roundMoney(input.currentPrice),
      simulatedPrice: roundMoney(input.simulatedPrice),
      differenceBRL,
      differencePct,
    },
    margin: {
      currentAvg: input.marginSummary.avgPreviousMargin,
      simulatedAvg: input.marginSummary.avgSimulatedMargin,
      differencePct: marginDifferencePct,
    },
    productsAtRisk: {
      current: productsAtRiskCurrent,
      simulated: input.financial.reajusteCount,
    },
    totalCostImpactBRL,
  };
}

export function resolveMaterialPriceDifferenceVariant(
  differenceBRL: number | null
): MaterialSimulationComparisonVariant {
  if (differenceBRL == null || differenceBRL === 0) return "default";
  return differenceBRL > 0 ? "danger" : "success";
}

export function resolveMarginDifferenceVariant(
  differencePct: number | null
): MaterialSimulationComparisonVariant {
  if (differencePct == null || differencePct === 0) return "default";
  return differencePct > 0 ? "success" : "danger";
}

export function resolveProductsAtRiskVariant(
  current: number,
  simulated: number
): MaterialSimulationComparisonVariant {
  if (simulated > current) return "danger";
  if (simulated < current) return "success";
  return "default";
}
