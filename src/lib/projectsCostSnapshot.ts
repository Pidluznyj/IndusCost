import {
  buildProjectCostAmortizationSummary,
  buildProjectAmortizationTargets,
  roundProjectMoney,
  type ProjectCostAmortizationRow,
  type ProjectCostAmortizationSummary,
} from "./projectsCostAmortization.js";
import { computeProjectGuidedCosts } from "./projectsGuidedFlow.js";
import {
  buildProjectCommercialPricingSummary,
  computeLiveProjectPricingView,
  resolveProjectCommercialPricingWeights,
  type ProjectCommercialPricingSummary,
  type ProjectPricingItemView,
} from "./projectsPricing.js";
import type { ProjectDetail } from "@/src/types/projects.js";

/** Snapshot oficial da aba Custos do Projeto — fonte única para relatórios. */
export type ProjectCostSnapshot = {
  projectId: string;
  generatedAt: string;
  costAmortizationSummary: ProjectCostAmortizationSummary;
  guidedCosts: ReturnType<typeof computeProjectGuidedCosts>;
  pricing: {
    view: ProjectPricingView;
    commercialSummary: ProjectCommercialPricingSummary;
    weights: Map<string, number>;
  };
  totals: {
    finalSetPrice: number | null;
    finalSetPriceLabel: string;
    averageSuggestedPriceWithAmortization: number | null;
    itemCount: number;
    pricingPending: boolean;
  };
};

export function resolveProjectCostFinalUnitPrice(
  item: Pick<
    ProjectPricingItemView,
    "suggestedPrice" | "suggestedPriceWithAmortization" | "agreedCustomerPrice" | "status"
  >
): number | null {
  if (item.status !== "CALCULATED") return null;
  const agreed = item.agreedCustomerPrice;
  if (agreed != null && Number.isFinite(agreed) && agreed > 0) {
    return roundProjectMoney(agreed);
  }
  const raw = item.suggestedPriceWithAmortization ?? item.suggestedPrice;
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  return roundProjectMoney(raw);
}

export function resolveProjectCostSetPriceLabel(itemCount: number): string {
  return itemCount <= 1 ? "Preço final da peça" : "Preço final do conjunto";
}

/** Soma dos preços finais (c/ amortização) × quantidade por item — igual ao grid + proposta cliente. */
export function computeProjectCostSetTotal(
  items: ProjectPricingItemView[],
  quantitiesByTargetId?: Map<string, number> | Record<string, number>
): number | null {
  if (items.length === 0) return null;

  const lines: number[] = [];
  for (const item of items) {
    const unit = resolveProjectCostFinalUnitPrice(item);
    if (unit == null) return null;
    let qty = 1;
    if (quantitiesByTargetId) {
      const raw =
        quantitiesByTargetId instanceof Map
          ? quantitiesByTargetId.get(item.targetItemId)
          : quantitiesByTargetId[item.targetItemId];
      if (raw != null && Number.isFinite(raw) && raw >= 1 && Number.isInteger(raw)) {
        qty = raw;
      }
    }
    lines.push(roundProjectMoney(unit * qty));
  }

  return roundProjectMoney(lines.reduce((sum, value) => sum + value, 0));
}

function resolveCostAmortizationSummary(detail: ProjectDetail): ProjectCostAmortizationSummary {
  if (detail.costAmortizationSummary) {
    return detail.costAmortizationSummary as ProjectCostAmortizationSummary;
  }
  const saved = (detail.costAmortizations ?? []) as ProjectCostAmortizationRow[];
  return buildProjectCostAmortizationSummary(detail, saved);
}

function resolvePricingView(detail: ProjectDetail) {
  return computeLiveProjectPricingView(detail);
}

export function resolveProjectPricingItemSku(
  detail: ProjectDetail,
  targetItemId: string
): string {
  const product = detail.simulatedProducts.find((row) => row.id === targetItemId);
  if (product?.provisionalCode?.trim()) return product.provisionalCode.trim();
  const target = buildProjectAmortizationTargets(detail).find(
    (row) => row.targetItemId === targetItemId
  );
  return target?.displayCode?.trim() || "—";
}

export function buildProjectCostSnapshot(
  detail: ProjectDetail,
  options?: {
    generatedAt?: Date;
    quantitiesByTargetId?: Map<string, number> | Record<string, number>;
  }
): ProjectCostSnapshot {
  const pricingView = resolvePricingView(detail);
  const weights = resolveProjectCommercialPricingWeights(detail);
  const commercialSummary = buildProjectCommercialPricingSummary({
    items: pricingView.items,
    weightsByTargetId: weights,
    defaultMarginPercent: pricingView.config.defaultMarginPercent,
  });

  const itemCount = pricingView.items.length;
  const finalSetPrice = computeProjectCostSetTotal(
    pricingView.items,
    options?.quantitiesByTargetId
  );
  const pricingPending =
    itemCount > 0 &&
    pricingView.items.some((item) => resolveProjectCostFinalUnitPrice(item) == null);

  return {
    projectId: detail.id,
    generatedAt: (options?.generatedAt ?? new Date()).toISOString(),
    costAmortizationSummary: resolveCostAmortizationSummary(detail),
    guidedCosts: computeProjectGuidedCosts(detail),
    pricing: {
      view: pricingView,
      commercialSummary,
      weights,
    },
    totals: {
      finalSetPrice,
      finalSetPriceLabel: resolveProjectCostSetPriceLabel(itemCount),
      averageSuggestedPriceWithAmortization:
        commercialSummary.averageSuggestedPriceWithAmortization,
      itemCount,
      pricingPending,
    },
  };
}
