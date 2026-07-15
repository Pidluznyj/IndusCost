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
  roundPricingPercent,
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
  /** Amortization that enters product cost (margin base). */
  amortizationUnitCost: number;
  /** Pass-through recovery added after product price (no product margin). */
  amortizationPriceAddOnUnit: number;
  finalUnitCost: number;
  fiscalRuleId: string | null;
  fiscalRuleName: string | null;
  taxPercent: number;
  targetMarginPercent: number;
  /** Preço comercial final (= product price + price add-on). */
  suggestedPrice: number | null;
  suggestedPriceWithoutAmortization: number | null;
  suggestedPriceWithAmortization: number | null;
  /** Preço unitário acordado com o cliente. Null = usar sugerido c/ amortização. */
  agreedCustomerPrice: number | null;
  /** Product price before FINAL_PRICE recovery add-on. */
  calculatedProductPrice: number | null;
  taxAmountWithoutAmortization: number | null;
  marginAmountWithoutAmortization: number | null;
  taxAmount: number | null;
  /** Product operating margin (excludes project recovery add-on). */
  marginAmount: number | null;
  /** Same as amortizationPriceAddOnUnit when calculated — investment recovery. */
  projectRecoveryValue: number | null;
  /** Commissionable base hint: product price without project recovery. */
  commissionableBaseWithoutProjectRecovery: number | null;
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
  suggestedPriceWithoutAmortization: number | null;
  suggestedPriceWithAmortization: number | null;
  agreedCustomerPrice?: number | null;
  taxAmountWithoutAmortization: number | null;
  marginAmountWithoutAmortization: number | null;
  taxAmount: number | null;
  marginAmount: number | null;
  status: ProjectPricingItemStatus;
  amortizationPriceAddOnUnit?: number;
  projectRecoveryValue?: number | null;
  commissionableBaseWithoutProjectRecovery?: number | null;
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

/** Mesma origem da tabela de Custos do Projeto (base + amortização no custo = custo final). */
export function resolveProjectPricingItemCosts(
  target: { targetItemId: string; baseUnitCost: number },
  rollup?: {
    baseUnitCost: number;
    unitAmortizedCost: number;
    costComponentUnit?: number;
    priceAddOnUnit?: number;
    finalUnitCost: number;
  }
): {
  costBaseUnit: number;
  amortizationUnitCost: number;
  amortizationPriceAddOnUnit: number;
  finalUnitCost: number;
  pricingCost: number;
} {
  const costBaseUnit = roundPricingMoney(rollup?.baseUnitCost ?? target.baseUnitCost);
  const costComponentUnit = roundPricingMoney(
    rollup?.costComponentUnit ?? rollup?.unitAmortizedCost ?? 0
  );
  const amortizationPriceAddOnUnit = roundPricingMoney(rollup?.priceAddOnUnit ?? 0);
  const finalUnitCost = roundPricingMoney(
    rollup != null ? rollup.finalUnitCost : costBaseUnit + costComponentUnit
  );
  return {
    costBaseUnit,
    amortizationUnitCost: costComponentUnit,
    amortizationPriceAddOnUnit,
    finalUnitCost,
    pricingCost: finalUnitCost,
  };
}

function emptyPricingAmounts() {
  return {
    suggestedPrice: null,
    suggestedPriceWithoutAmortization: null,
    suggestedPriceWithAmortization: null,
    agreedCustomerPrice: null,
    calculatedProductPrice: null,
    taxAmountWithoutAmortization: null,
    marginAmountWithoutAmortization: null,
    taxAmount: null,
    marginAmount: null,
    projectRecoveryValue: null,
    commissionableBaseWithoutProjectRecovery: null,
  };
}

function buildPricingItemBase(
  target: {
    targetItemId: string;
    targetItemType: ProjectCostAmortizationTargetType;
    displayName: string;
    baseUnitCost: number;
    unitAmortizedCost: number;
    amortizationPriceAddOnUnit?: number;
    finalUnitCost: number;
  },
  options: {
    fiscalRuleId: string | null;
    fiscalRuleName: string | null;
    taxPercent: number;
    targetMarginPercent: number;
  }
): Omit<ProjectPricingItemView, "status" | "statusLabel" | "errorMessage"> {
  const costBaseUnit = roundPricingMoney(target.baseUnitCost);
  const amortizationUnitCost = roundPricingMoney(target.unitAmortizedCost);
  const amortizationPriceAddOnUnit = roundPricingMoney(target.amortizationPriceAddOnUnit ?? 0);
  const finalUnitCost = roundPricingMoney(target.finalUnitCost);
  return {
    targetItemId: target.targetItemId,
    targetItemType: target.targetItemType,
    displayName: target.displayName,
    costBaseUnit,
    amortizationUnitCost,
    amortizationPriceAddOnUnit,
    finalUnitCost,
    fiscalRuleId: options.fiscalRuleId,
    fiscalRuleName: options.fiscalRuleName,
    taxPercent: options.taxPercent,
    targetMarginPercent: options.targetMarginPercent,
    ...emptyPricingAmounts(),
  };
}

export function computeProjectPricingItem(
  target: {
    targetItemId: string;
    targetItemType: ProjectCostAmortizationTargetType;
    displayName: string;
    baseUnitCost: number;
    unitAmortizedCost: number;
    amortizationPriceAddOnUnit?: number;
    finalUnitCost: number;
  },
  options: {
    fiscalRuleId: string | null;
    fiscalRuleName: string | null;
    taxPercent: number;
    targetMarginPercent: number | null;
  }
): ProjectPricingItemView {
  const margin = options.targetMarginPercent;
  const priceAddOn = roundPricingMoney(target.amortizationPriceAddOnUnit ?? 0);
  const base = buildPricingItemBase(
    { ...target, amortizationPriceAddOnUnit: priceAddOn },
    {
      ...options,
      targetMarginPercent: margin ?? 0,
    }
  );

  if (base.finalUnitCost <= 0) {
    return {
      ...base,
      status: "NO_COST",
      statusLabel: STATUS_LABEL.NO_COST,
      errorMessage: null,
    };
  }

  if (!options.fiscalRuleId) {
    return {
      ...base,
      targetMarginPercent: margin ?? 0,
      status: "PENDING",
      statusLabel: STATUS_LABEL.PENDING,
      errorMessage: null,
    };
  }

  if (margin == null || !Number.isFinite(margin)) {
    return {
      ...base,
      targetMarginPercent: 0,
      status: "PENDING",
      statusLabel: STATUS_LABEL.PENDING,
      errorMessage: null,
    };
  }

  const pricingInput = {
    taxPercent: options.taxPercent,
    targetMarginPercent: margin,
  };

  const withoutAmortization =
    base.costBaseUnit > 0
      ? calculateSalePriceFromCost({ cost: base.costBaseUnit, ...pricingInput })
      : ({ ok: false, error: "Custo base inválido." } as const);

  /**
   * Product price uses costing base only (finalUnitCost = base + COST-mode amort).
   * FINAL_PRICE add-on is applied after margin — never as margin base.
   */
  const productFromCost = calculateSalePriceFromCost({
    cost: base.finalUnitCost,
    ...pricingInput,
  });

  if (productFromCost.ok === false) {
    return {
      ...base,
      targetMarginPercent: margin,
      status: "ERROR",
      statusLabel: STATUS_LABEL.ERROR,
      errorMessage: productFromCost.error,
    };
  }

  const withoutValues =
    withoutAmortization.ok === true
      ? {
          suggestedPriceWithoutAmortization: withoutAmortization.suggestedPrice,
          taxAmountWithoutAmortization: withoutAmortization.taxAmount,
          marginAmountWithoutAmortization: withoutAmortization.marginAmount,
        }
      : {
          suggestedPriceWithoutAmortization: null,
          taxAmountWithoutAmortization: null,
          marginAmountWithoutAmortization: null,
        };

  const calculatedProductPrice = productFromCost.suggestedPrice;
  const finalPriceWithAmortization = roundPricingMoney(calculatedProductPrice + priceAddOn);

  return {
    ...base,
    targetMarginPercent: margin,
    ...withoutValues,
    calculatedProductPrice,
    suggestedPriceWithAmortization: finalPriceWithAmortization,
    suggestedPrice: finalPriceWithAmortization,
    taxAmount: productFromCost.taxAmount,
    marginAmount: productFromCost.marginAmount,
    projectRecoveryValue: priceAddOn,
    commissionableBaseWithoutProjectRecovery: calculatedProductPrice,
    status: "CALCULATED",
    statusLabel: STATUS_LABEL.CALCULATED,
    errorMessage: withoutAmortization.ok === false ? withoutAmortization.error : null,
  };
}

export type LiveProjectPricingOptions = {
  taxRules?: ProjectPricingTaxRuleOption[];
  config?: ProjectPricingConfigView;
  /** Margem por item (formulário). Ausente = usa config salva. */
  itemMargins?: Record<string, number | null | undefined>;
  /** Regra fiscal por item (formulário). Ausente = usa config salva. */
  itemFiscalRules?: Record<string, string | null | undefined>;
};

/**
 * Motor vivo da aba Custos do Projeto — custos atuais + regras fiscais vigentes.
 * Relatórios e grid comercial devem usar esta função (não snapshots persistidos).
 */
export function computeLiveProjectPricingView(
  detail: ProjectDetail,
  options?: LiveProjectPricingOptions
): ProjectPricingView {
  const saved = detail.projectPricing;
  const taxRules = options?.taxRules ?? saved?.taxRules ?? [];
  const config = options?.config ??
    saved?.config ?? {
      fiscalRuleId: null,
      defaultMarginPercent: detail.targetMarginPercent,
    };
  const defaultFiscalRuleId = config.fiscalRuleId ?? null;
  const defaultMargin = config.defaultMarginPercent ?? detail.targetMarginPercent ?? null;
  const savedByTarget = new Map((saved?.items ?? []).map((row) => [row.targetItemId, row]));
  const savedAmortizations = (detail.costAmortizations ?? []) as ProjectCostAmortizationRow[];

  const draft = buildProjectPricingView({
    detail,
    taxRules,
    config,
    savedItems: [],
    savedAmortizations,
  });

  const items = draft.items.map((item) => {
    const savedItem = savedByTarget.get(item.targetItemId);
    const itemMarginRaw = options?.itemMargins?.[item.targetItemId];
    const margin =
      itemMarginRaw != null && Number.isFinite(itemMarginRaw)
        ? itemMarginRaw
        : savedItem?.targetMarginPercent ?? defaultMargin ?? item.targetMarginPercent;

    const itemRuleRaw = options?.itemFiscalRules?.[item.targetItemId];
    const fiscalRuleId =
      options?.itemFiscalRules && item.targetItemId in options.itemFiscalRules
        ? itemRuleRaw || defaultFiscalRuleId || null
        : savedItem?.fiscalRuleId ?? defaultFiscalRuleId;
    const taxRule = taxRules.find((rule) => rule.id === fiscalRuleId);

    const costs = resolveProjectPricingItemCosts(
      { targetItemId: item.targetItemId, baseUnitCost: item.costBaseUnit },
      {
        baseUnitCost: item.costBaseUnit,
        unitAmortizedCost: item.amortizationUnitCost,
        costComponentUnit: item.amortizationUnitCost,
        priceAddOnUnit: item.amortizationPriceAddOnUnit,
        finalUnitCost: item.finalUnitCost,
      }
    );

    return {
      ...computeProjectPricingItem(
        {
          targetItemId: item.targetItemId,
          targetItemType: item.targetItemType,
          displayName: item.displayName,
          baseUnitCost: costs.costBaseUnit,
          unitAmortizedCost: costs.amortizationUnitCost,
          amortizationPriceAddOnUnit: costs.amortizationPriceAddOnUnit,
          finalUnitCost: costs.pricingCost,
        },
        {
          fiscalRuleId: fiscalRuleId || null,
          fiscalRuleName: taxRule?.name ?? savedItem?.fiscalRuleName ?? null,
          taxPercent: taxRule?.taxPercent ?? 0,
          targetMarginPercent: margin,
        }
      ),
      agreedCustomerPrice:
        savedItem?.agreedCustomerPrice != null && Number.isFinite(savedItem.agreedCustomerPrice)
          ? savedItem.agreedCustomerPrice
          : null,
    };
  });

  const hasSavedPricing =
    saved?.hasSavedPricing ??
    (saved?.items ?? []).some((row) => row.suggestedPrice != null && row.suggestedPrice > 0);

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
    const taxPercent =
      taxRule != null
        ? resolveTaxRulePercentFromOption(taxRule)
        : saved?.taxPercentSnapshot ?? 0;
    const margin = saved?.targetMarginPercent ?? defaultMargin;
    const costs = resolveProjectPricingItemCosts(target, rollup);

    const computed = computeProjectPricingItem(
      {
        targetItemId: target.targetItemId,
        targetItemType: target.targetItemType,
        displayName: target.displayName,
        baseUnitCost: costs.costBaseUnit,
        unitAmortizedCost: costs.amortizationUnitCost,
        amortizationPriceAddOnUnit: costs.amortizationPriceAddOnUnit,
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
        agreedCustomerPrice:
          saved?.agreedCustomerPrice != null && Number.isFinite(saved.agreedCustomerPrice)
            ? saved.agreedCustomerPrice
            : null,
        statusLabel: PROJECT_PRICING_INCOMPLETE_AMORTIZATION_LABEL,
      };
    }

    return {
      ...computed,
      agreedCustomerPrice:
        saved?.agreedCustomerPrice != null && Number.isFinite(saved.agreedCustomerPrice)
          ? saved.agreedCustomerPrice
          : null,
    };
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

export type ProjectCommercialPricingAggregationMode = "weighted" | "simple" | "empty";

export type ProjectCommercialPricingSummary = {
  totalItems: number;
  calculatedItems: number;
  pendingItems: number;
  averageBaseUnitCost: number | null;
  averageUnitAmortization: number | null;
  averageFinalUnitCost: number | null;
  averageSuggestedPriceWithoutAmortization: number | null;
  averageSuggestedPriceWithAmortization: number | null;
  averageAmortizationPriceDelta: number | null;
  targetMarginLabel: string;
  hasMultipleMargins: boolean;
  hasMultipleTaxRules: boolean;
  aggregationMode: ProjectCommercialPricingAggregationMode;
  aggregationHint: string;
  hasItems: boolean;
  isEmpty: boolean;
};

function resolveItemWeight(
  targetItemId: string,
  weightsByTargetId?: Map<string, number> | Record<string, number>
): number {
  if (!weightsByTargetId) return 1;
  const weight =
    weightsByTargetId instanceof Map
      ? weightsByTargetId.get(targetItemId)
      : weightsByTargetId[targetItemId];
  return weight != null && Number.isFinite(weight) && weight > 0 ? weight : 1;
}

function aggregateUnitAverage(
  rows: Array<{ value: number | null | undefined; weight: number }>
): number | null {
  const valid = rows.filter(
    (row) => row.value != null && Number.isFinite(row.value) && row.weight > 0
  );
  if (valid.length === 0) return null;
  const totalWeight = valid.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= 0) return null;
  const total = valid.reduce((sum, row) => sum + row.value! * row.weight, 0);
  return roundPricingMoney(total / totalWeight);
}

function detectAggregationMode(
  calculatedItems: ProjectPricingItemView[],
  weightsByTargetId?: Map<string, number> | Record<string, number>
): ProjectCommercialPricingAggregationMode {
  if (calculatedItems.length === 0) return "empty";
  const weights = calculatedItems.map((item) =>
    resolveItemWeight(item.targetItemId, weightsByTargetId)
  );
  const allEqual = weights.every((weight) => weight === weights[0]);
  const allUnit = weights.every((weight) => weight === 1);
  return allEqual && allUnit ? "simple" : "weighted";
}

export function isProjectCommercialPricingItemPending(item: ProjectPricingItemView): boolean {
  if (item.status !== "CALCULATED") return true;
  if (item.finalUnitCost <= 0) return true;
  if (!item.fiscalRuleId) return true;
  if (item.suggestedPriceWithAmortization == null || item.suggestedPriceWithAmortization <= 0) {
    return true;
  }
  return false;
}

export function resolveProjectCommercialPricingWeights(detail: ProjectDetail): Map<string, number> {
  const weights = new Map<string, number>();
  for (const target of listProjectPricingEligibleTargets(detail)) {
    const match = buildProjectAmortizationTargets(detail).find(
      (row) => row.targetItemId === target.targetItemId
    );
    weights.set(target.targetItemId, match?.suggestedQuantity ?? 1);
  }
  return weights;
}

export function buildProjectCommercialPricingSummary(input: {
  items: ProjectPricingItemView[];
  weightsByTargetId?: Map<string, number> | Record<string, number>;
  defaultMarginPercent?: number | null;
}): ProjectCommercialPricingSummary {
  const { items } = input;
  const calculatedItems = items.filter((item) => item.status === "CALCULATED");
  const pendingItems = items.filter(isProjectCommercialPricingItemPending).length;
  const aggregationMode = detectAggregationMode(calculatedItems, input.weightsByTargetId);

  if (items.length === 0) {
    return {
      totalItems: 0,
      calculatedItems: 0,
      pendingItems: 0,
      averageBaseUnitCost: null,
      averageUnitAmortization: null,
      averageFinalUnitCost: null,
      averageSuggestedPriceWithoutAmortization: null,
      averageSuggestedPriceWithAmortization: null,
      averageAmortizationPriceDelta: null,
      targetMarginLabel: "—",
      hasMultipleMargins: false,
      hasMultipleTaxRules: false,
      aggregationMode: "empty",
      aggregationHint: "Nenhum item elegível para precificação neste projeto.",
      hasItems: false,
      isEmpty: true,
    };
  }

  const weightRows = (selector: (item: ProjectPricingItemView) => number | null | undefined) =>
    calculatedItems.map((item) => ({
      value: selector(item),
      weight: resolveItemWeight(item.targetItemId, input.weightsByTargetId),
    }));

  const averageBaseUnitCost = aggregateUnitAverage(
    weightRows((item) => item.costBaseUnit)
  );
  const averageUnitAmortization = aggregateUnitAverage(
    weightRows((item) => item.amortizationUnitCost)
  );
  const averageFinalUnitCost = aggregateUnitAverage(
    weightRows((item) => item.finalUnitCost)
  );
  const averageSuggestedPriceWithoutAmortization = aggregateUnitAverage(
    weightRows((item) => item.suggestedPriceWithoutAmortization)
  );
  const averageSuggestedPriceWithAmortization = aggregateUnitAverage(
    weightRows((item) => item.suggestedPriceWithAmortization ?? item.suggestedPrice)
  );

  const averageAmortizationPriceDelta =
    averageSuggestedPriceWithoutAmortization != null &&
    averageSuggestedPriceWithAmortization != null
      ? roundPricingMoney(
          averageSuggestedPriceWithAmortization - averageSuggestedPriceWithoutAmortization
        )
      : null;

  const margins = new Set(
    calculatedItems.map((item) => roundPricingPercent(item.targetMarginPercent))
  );
  const taxRules = new Set(
    calculatedItems.map((item) => item.fiscalRuleId).filter((id): id is string => !!id)
  );

  let targetMarginLabel = "—";
  if (margins.size === 1) {
    targetMarginLabel = `${[...margins][0]!.toFixed(1)}%`;
  } else if (margins.size > 1) {
    targetMarginLabel = "Múltiplas margens";
  } else if (input.defaultMarginPercent != null && Number.isFinite(input.defaultMarginPercent)) {
    targetMarginLabel = `${input.defaultMarginPercent.toFixed(1)}%`;
  }

  const aggregationHint =
    aggregationMode === "weighted"
      ? "Média ponderada pelo volume/quantidade estimada de cada item."
      : aggregationMode === "simple"
        ? "Média simples dos itens calculados (sem volume distinto por item)."
        : "Sem itens calculados para agregar.";

  return {
    totalItems: items.length,
    calculatedItems: calculatedItems.length,
    pendingItems,
    averageBaseUnitCost,
    averageUnitAmortization,
    averageFinalUnitCost,
    averageSuggestedPriceWithoutAmortization,
    averageSuggestedPriceWithAmortization,
    averageAmortizationPriceDelta,
    targetMarginLabel,
    hasMultipleMargins: margins.size > 1,
    hasMultipleTaxRules: taxRules.size > 1,
    aggregationMode,
    aggregationHint,
    hasItems: true,
    isEmpty: calculatedItems.length === 0,
  };
}

export function formatProjectCommercialPricingSummaryMoney(
  value: number | null | undefined,
  summary: Pick<ProjectCommercialPricingSummary, "isEmpty" | "hasItems">
): string {
  if (!summary.hasItems) return "Sem itens";
  if (summary.isEmpty) return "Sem itens calculados";
  if (value == null || !Number.isFinite(value)) return "Indisponível";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}
