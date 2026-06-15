import {
  buildProjectAmortizationTargets,
  buildProjectCostAmortizationSummary,
  roundProjectMoney,
  type ProjectCostAmortizationRow,
  type ProjectCostAmortizationSummary,
  type ProjectCostAmortizationTargetType,
} from "./projectsCostAmortization.js";
import {
  calculateSalePriceFromCost,
  roundPricingMoney,
  sumTaxRuleComponentPercents,
} from "./pricingCalculations.js";
import type { ProjectDetail } from "@/src/types/projects.js";

export type ProjectPricingTaxRuleOption = {
  id: string;
  name: string;
  description: string | null;
  taxPercent: number;
};

export type ProjectPricingItemStatus = "NO_COST" | "PENDING" | "CALCULATED" | "ERROR";

export type ProjectPricingItemView = {
  targetItemId: string;
  targetItemType: ProjectCostAmortizationTargetType;
  displayName: string;
  costBaseUnit: number;
  amortizationUnitCost: number;
  finalUnitCost: number;
  fiscalRuleId: string | null;
  fiscalRuleName: string | null;
  taxPercent: number;
  targetMarginPercent: number;
  suggestedPrice: number | null;
  taxAmount: number | null;
  marginAmount: number | null;
  status: ProjectPricingItemStatus;
  statusLabel: string;
  errorMessage: string | null;
};

export type ProjectPricingConfigView = {
  fiscalRuleId: string | null;
  defaultMarginPercent: number | null;
};

export type ProjectPricingView = {
  config: ProjectPricingConfigView;
  items: ProjectPricingItemView[];
  taxRules: ProjectPricingTaxRuleOption[];
  hasSavedPricing: boolean;
};

export type SavedProjectPricingItem = {
  targetItemId: string;
  targetItemType: ProjectCostAmortizationTargetType;
  targetDescriptionSnapshot: string;
  fiscalRuleId: string | null;
  fiscalRuleNameSnapshot: string | null;
  costBaseUnitSnapshot: number;
  amortizationUnitCostSnapshot: number;
  finalUnitCostSnapshot: number;
  taxPercentSnapshot: number;
  targetMarginPercent: number;
  suggestedPrice: number | null;
  taxAmount: number | null;
  marginAmount: number | null;
  status: ProjectPricingItemStatus;
};

const STATUS_LABEL: Record<ProjectPricingItemStatus, string> = {
  NO_COST: "Sem custo",
  PENDING: "Pendente",
  CALCULATED: "Calculado",
  ERROR: "Erro",
};

export const PROJECT_PRICING_INCOMPLETE_AMORTIZATION_LABEL =
  "Precificação com amortização incompleta";

const INCOMPLETE_AMORTIZATION_STATUSES = new Set([
  "INCOMPLETE",
  "EXCESS",
  "NOT_CONFIGURED",
]);

/** Primeira entrega: somente itens simulados (referência de Simulações). */
export function listProjectPricingEligibleTargets(detail: ProjectDetail) {
  return buildProjectAmortizationTargets(detail).filter(
    (target) => target.targetItemType === "SIMULATION"
  );
}

export function resolveTaxRulePercentFromOption(rule: ProjectPricingTaxRuleOption | undefined): number {
  return rule?.taxPercent ?? 0;
}

function resolveCostSummary(
  detail: ProjectDetail,
  savedAmortizations: ProjectCostAmortizationRow[] = []
): ProjectCostAmortizationSummary {
  if (detail.costAmortizationSummary) {
    return detail.costAmortizationSummary as ProjectCostAmortizationSummary;
  }
  const amortizations =
    savedAmortizations.length > 0
      ? savedAmortizations
      : ((detail.costAmortizations ?? []) as ProjectCostAmortizationRow[]);
  return buildProjectCostAmortizationSummary(detail, amortizations);
}

/** Mesma origem da tabela de Custos do Projeto (base + amortização = custo final). */
export function resolveProjectPricingItemCosts(
  target: { targetItemId: string; baseUnitCost: number },
  rollup?: {
    baseUnitCost: number;
    unitAmortizedCost: number;
    finalUnitCost: number;
  }
): {
  costBaseUnit: number;
  amortizationUnitCost: number;
  finalUnitCost: number;
  pricingCost: number;
} {
  const costBaseUnit = roundPricingMoney(rollup?.baseUnitCost ?? target.baseUnitCost);
  const amortizationUnitCost = roundPricingMoney(rollup?.unitAmortizedCost ?? 0);
  const finalUnitCost = roundPricingMoney(
    rollup != null ? rollup.finalUnitCost : costBaseUnit + amortizationUnitCost
  );
  return {
    costBaseUnit,
    amortizationUnitCost,
    finalUnitCost,
    pricingCost: finalUnitCost,
  };
}

export function computeProjectPricingItem(
  target: {
    targetItemId: string;
    targetItemType: ProjectCostAmortizationTargetType;
    displayName: string;
    baseUnitCost: number;
    unitAmortizedCost: number;
    finalUnitCost: number;
  },
  options: {
    fiscalRuleId: string | null;
    fiscalRuleName: string | null;
    taxPercent: number;
    targetMarginPercent: number | null;
  }
): ProjectPricingItemView {
  const costBaseUnit = roundPricingMoney(target.baseUnitCost);
  const amortizationUnitCost = roundPricingMoney(target.unitAmortizedCost);
  const finalUnitCost = roundPricingMoney(target.finalUnitCost);
  const margin = options.targetMarginPercent;

  if (finalUnitCost <= 0) {
    return {
      targetItemId: target.targetItemId,
      targetItemType: target.targetItemType,
      displayName: target.displayName,
      costBaseUnit,
      amortizationUnitCost,
      finalUnitCost,
      fiscalRuleId: options.fiscalRuleId,
      fiscalRuleName: options.fiscalRuleName,
      taxPercent: options.taxPercent,
      targetMarginPercent: margin ?? 0,
      suggestedPrice: null,
      taxAmount: null,
      marginAmount: null,
      status: "NO_COST",
      statusLabel: STATUS_LABEL.NO_COST,
      errorMessage: null,
    };
  }

  if (!options.fiscalRuleId) {
    return {
      targetItemId: target.targetItemId,
      targetItemType: target.targetItemType,
      displayName: target.displayName,
      costBaseUnit,
      amortizationUnitCost,
      finalUnitCost,
      fiscalRuleId: null,
      fiscalRuleName: null,
      taxPercent: options.taxPercent,
      targetMarginPercent: margin ?? 0,
      suggestedPrice: null,
      taxAmount: null,
      marginAmount: null,
      status: "PENDING",
      statusLabel: STATUS_LABEL.PENDING,
      errorMessage: null,
    };
  }

  if (margin == null || !Number.isFinite(margin)) {
    return {
      targetItemId: target.targetItemId,
      targetItemType: target.targetItemType,
      displayName: target.displayName,
      costBaseUnit,
      amortizationUnitCost,
      finalUnitCost,
      fiscalRuleId: options.fiscalRuleId,
      fiscalRuleName: options.fiscalRuleName,
      taxPercent: options.taxPercent,
      targetMarginPercent: 0,
      suggestedPrice: null,
      taxAmount: null,
      marginAmount: null,
      status: "PENDING",
      statusLabel: STATUS_LABEL.PENDING,
      errorMessage: null,
    };
  }

  const result = calculateSalePriceFromCost({
    cost: finalUnitCost,
    taxPercent: options.taxPercent,
    targetMarginPercent: margin,
  });

  if (result.ok === false) {
    return {
      targetItemId: target.targetItemId,
      targetItemType: target.targetItemType,
      displayName: target.displayName,
      costBaseUnit,
      amortizationUnitCost,
      finalUnitCost,
      fiscalRuleId: options.fiscalRuleId,
      fiscalRuleName: options.fiscalRuleName,
      taxPercent: options.taxPercent,
      targetMarginPercent: margin,
      suggestedPrice: null,
      taxAmount: null,
      marginAmount: null,
      status: "ERROR",
      statusLabel: STATUS_LABEL.ERROR,
      errorMessage: result.error,
    };
  }

  return {
    targetItemId: target.targetItemId,
    targetItemType: target.targetItemType,
    displayName: target.displayName,
    costBaseUnit,
    amortizationUnitCost,
    finalUnitCost,
    fiscalRuleId: options.fiscalRuleId,
    fiscalRuleName: options.fiscalRuleName,
    taxPercent: options.taxPercent,
    targetMarginPercent: margin,
    suggestedPrice: result.suggestedPrice,
    taxAmount: result.taxAmount,
    marginAmount: result.marginAmount,
    status: "CALCULATED",
    statusLabel: STATUS_LABEL.CALCULATED,
    errorMessage: null,
  };
}

export function buildProjectPricingView(input: {
  detail: ProjectDetail;
  taxRules: ProjectPricingTaxRuleOption[];
  config?: ProjectPricingConfigView | null;
  savedItems?: SavedProjectPricingItem[];
  savedAmortizations?: ProjectCostAmortizationRow[];
}): ProjectPricingView {
  const { detail, taxRules } = input;
  const summary = resolveCostSummary(detail, input.savedAmortizations ?? []);
  const rollupById = new Map(summary.itemRollups.map((row) => [row.targetItemId, row]));
  const savedByTarget = new Map((input.savedItems ?? []).map((row) => [row.targetItemId, row]));

  const defaultMargin =
    input.config?.defaultMarginPercent ?? detail.targetMarginPercent ?? null;
  const defaultFiscalRuleId = input.config?.fiscalRuleId ?? null;
  const defaultTaxRule = taxRules.find((rule) => rule.id === defaultFiscalRuleId);
  const incompleteAmortization = summary.amortizations.some((row) =>
    INCOMPLETE_AMORTIZATION_STATUSES.has(row.status)
  );

  const items = listProjectPricingEligibleTargets(detail).map((target) => {
    const rollup = rollupById.get(target.targetItemId);
    const saved = savedByTarget.get(target.targetItemId);
    const fiscalRuleId = saved?.fiscalRuleId ?? defaultFiscalRuleId;
    const taxRule = taxRules.find((rule) => rule.id === fiscalRuleId);
    const taxPercent = saved?.taxPercentSnapshot ?? resolveTaxRulePercentFromOption(taxRule);
    const margin = saved?.targetMarginPercent ?? defaultMargin;
    const costs = resolveProjectPricingItemCosts(target, rollup);

    const computed = computeProjectPricingItem(
      {
        targetItemId: target.targetItemId,
        targetItemType: target.targetItemType,
        displayName: target.displayName,
        baseUnitCost: costs.costBaseUnit,
        unitAmortizedCost: costs.amortizationUnitCost,
        finalUnitCost: costs.pricingCost,
      },
      {
        fiscalRuleId,
        fiscalRuleName: saved?.fiscalRuleNameSnapshot ?? taxRule?.name ?? null,
        taxPercent,
        targetMarginPercent: margin,
      }
    );

    if (
      incompleteAmortization &&
      computed.status !== "NO_COST" &&
      computed.status !== "ERROR"
    ) {
      return {
        ...computed,
        statusLabel: PROJECT_PRICING_INCOMPLETE_AMORTIZATION_LABEL,
      };
    }

    return computed;
  });

  const hasSavedPricing = (input.savedItems ?? []).some(
    (row) => row.suggestedPrice != null && row.suggestedPrice > 0
  );

  return {
    config: {
      fiscalRuleId: defaultFiscalRuleId,
      defaultMarginPercent: defaultMargin,
    },
    items,
    taxRules,
    hasSavedPricing,
  };
}

export function serializeTaxRulesForProjectPricing(
  rules: Array<{
    id: string;
    name: string;
    description: string | null;
    TaxComponent: Array<{ percentage: unknown }>;
  }>
): ProjectPricingTaxRuleOption[] {
  return rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    taxPercent: sumTaxRuleComponentPercents(rule.TaxComponent),
  }));
}

export function projectPricingHasCommercialAnalysis(view: ProjectPricingView | null | undefined): boolean {
  if (!view?.hasSavedPricing) return false;
  return view.items.some((item) => item.suggestedPrice != null && item.suggestedPrice > 0);
}

export function projectPricingPrimaryItem(view: ProjectPricingView | null | undefined) {
  if (!view) return null;
  return view.items.find((item) => item.suggestedPrice != null && item.suggestedPrice > 0) ?? null;
}

export function roundProjectPricingSnapshot(value: number): number {
  return roundProjectMoney(value);
}
