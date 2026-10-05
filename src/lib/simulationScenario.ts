/**
 * Cenário de produto existente — "e se meu custo mudar?" (puro, sem I/O).
 *
 * A base (PUBLISHED ou LIVE) é congelada na criação do cenário; a comparação é sempre
 * BASE × CENÁRIO sobre esse snapshot de SIMULAÇÃO. O resultado nunca é custo oficial.
 */
import {
  priceFromCostAndMargin,
  markupFactor,
  type CommercialPricePremises,
} from "./pricing/commercialPriceFormula.js";
import {
  LEGACY_LIVE_BASELINE,
  productCostBaselineBadge,
  productCostBaselineLabel,
  type OwnProcessDecomposition,
  type ProductCostBaselineOk,
  type RecordedCostBaselineSource,
} from "./productCostBaseline.js";
import { simulateScenarioDrivers, simulateScenarioFromBreakdown } from "./simulationFormula.js";

export const SCENARIO_BASELINE_SNAPSHOT_VERSION = 1 as const;

export type ScenarioPricingPremises = {
  taxRuleId: string | null;
  taxRuleName: string | null;
  taxRatePct: number;
  commRatePct: number;
  otherRatePct: number;
  marginRatePct: number;
  freight: number;
};

/** Gravado em Simulation.baselineSnapshot — snapshot de simulação, não de custo oficial. */
export type ScenarioBaselineSnapshot = {
  schemaVersion: typeof SCENARIO_BASELINE_SNAPSHOT_VERSION;
  kind: "SCENARIO_BASELINE";
  capturedAt: string;
  cost: {
    source: "PUBLISHED" | "LIVE";
    productId: string;
    sku: string | null;
    name: string | null;
    mp: number;
    hh: number;
    hm: number;
    costBase: number;
    productionCostVersionId: string | null;
    productionCostVersionCode: string | null;
    productionCostRevision: number | null;
    effectiveDate: string | null;
    publishedAt: string | null;
    calculatedAt: string | null;
    ownProcess: OwnProcessDecomposition | null;
    warnings: string[];
  };
  pricing: ScenarioPricingPremises;
};

export type ScenarioAdjustments = {
  materialAdjPct: number;
  laborAdjPct: number;
  hmAdjPct: number;
  efficiencyAdjPct: number;
  marginAdjPct: number;
};

export function buildScenarioBaselineSnapshot(input: {
  cost: ProductCostBaselineOk;
  pricing: ScenarioPricingPremises;
  capturedAt: Date;
}): ScenarioBaselineSnapshot {
  const { cost } = input;
  return {
    schemaVersion: SCENARIO_BASELINE_SNAPSHOT_VERSION,
    kind: "SCENARIO_BASELINE",
    capturedAt: input.capturedAt.toISOString(),
    cost: {
      source: cost.source,
      productId: cost.productId,
      sku: cost.sku,
      name: cost.name,
      mp: cost.totalMaterialCost,
      hh: cost.totalHHUnit,
      hm: cost.totalHMUnit,
      costBase: cost.totalMaterialCost + cost.totalHHUnit + cost.totalHMUnit,
      productionCostVersionId: cost.productionCostVersionId,
      productionCostVersionCode: cost.productionCostVersionCode,
      productionCostRevision: cost.productionCostRevision,
      effectiveDate: cost.effectiveDate,
      publishedAt: cost.publishedAt,
      calculatedAt: cost.calculatedAt,
      ownProcess: cost.ownProcess,
      warnings: cost.warnings.map((w) => w.message),
    },
    pricing: input.pricing,
  };
}

export function parseScenarioBaselineSnapshot(raw: unknown): ScenarioBaselineSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const snap = raw as Partial<ScenarioBaselineSnapshot>;
  if (snap.schemaVersion !== SCENARIO_BASELINE_SNAPSHOT_VERSION || !snap.cost || !snap.pricing) return null;
  const { cost, pricing } = snap;
  const numbers = [cost.mp, cost.hh, cost.hm, pricing.taxRatePct, pricing.commRatePct, pricing.otherRatePct, pricing.marginRatePct, pricing.freight];
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (cost.source !== "PUBLISHED" && cost.source !== "LIVE") return null;
  return snap as ScenarioBaselineSnapshot;
}

export type ScenarioIssue = { code: string; message: string };

export type ScenarioDelta = { abs: number; pct: number | null };

export type ScenarioComparison = {
  simulationMethod: "DRIVER_SIMULATION" | "LEGACY_AGGREGATE_SCALING";
  simulationNote: string;
  baseline: {
    source: RecordedCostBaselineSource;
    label: string;
    badge: string;
    productionCostVersionId: string | null;
    productionCostVersionCode: string | null;
    productionCostRevision: number | null;
    effectiveDate: string | null;
    calculatedAt: string | null;
    capturedAt: string | null;
    warnings: string[];
  };
  base: {
    product: string | null;
    sku: string | null;
    ciu: number;
    premissas: { taxRate: number; commRate: number; otherRate: number; marginRate: number; freight: number };
    resultados: { suggestedPrice: number | null };
  };
  simulated: {
    ciu: number;
    suggestedPrice: number | null;
    marginRate: number;
    markup: number | null;
    breakdown: { mp: number; hh: number; hm: number; costBase: number };
  };
  breakdown: {
    base: { mp: number; hh: number; hm: number; costBase: number };
    simulated: { mp: number; hh: number; hm: number; costBase: number };
  };
  /** Processo = HH + HM. */
  deltas: {
    mp: ScenarioDelta;
    hh: ScenarioDelta;
    hm: ScenarioDelta;
    process: ScenarioDelta;
    total: ScenarioDelta;
  };
  delta: { price: number | null; pricePct: number | null; ciu: number; ciuPct: number | null };
  efficiencyApplied: boolean;
  /** Problema que impede o custo simulado (ex.: eficiência sem decomposição). */
  costIssue: ScenarioIssue | null;
  /** Problema nas premissas de preço (ex.: divisor ≤ 0) — custo continua válido. */
  pricingIssue: ScenarioIssue | null;
};

function delta(base: number, simulated: number): ScenarioDelta {
  const abs = simulated - base;
  return { abs, pct: base > 0 ? (abs / base) * 100 : null };
}

function toFormulaPremises(p: ScenarioPricingPremises): CommercialPricePremises {
  return {
    taxRatePct: p.taxRatePct,
    commissionRatePct: p.commRatePct,
    otherRatePct: p.otherRatePct,
    freight: p.freight,
  };
}

export const DRIVER_SIMULATION_NOTE =
  "Ajustes aplicados sobre a base congelada do cenário: MP, HH e HM por fator; eficiência somente sobre a transformação do processo próprio (setup e componentes filhos não mudam). Resultado é custo SIMULADO.";

/** Comparação BASE × CENÁRIO a partir da base congelada na criação. */
export function computeScenarioComparison(
  baseline: ScenarioBaselineSnapshot,
  adjustments: ScenarioAdjustments
): ScenarioComparison {
  const { cost, pricing } = baseline;
  const baseBreakdown = { mp: cost.mp, hh: cost.hh, hm: cost.hm, costBase: cost.mp + cost.hh + cost.hm };

  const drivers = simulateScenarioDrivers(
    { mp: cost.mp, hh: cost.hh, hm: cost.hm, ownProcess: cost.ownProcess },
    adjustments
  );
  const costIssue: ScenarioIssue | null = drivers.ok === true ? null : { code: drivers.code, message: drivers.message };
  const simBreakdown = drivers.ok === true ? drivers.simulated : baseBreakdown;

  const premises = toFormulaPremises(pricing);
  const simMarginRate = pricing.marginRatePct * (1 + adjustments.marginAdjPct / 100);
  const basePrice = priceFromCostAndMargin(baseBreakdown.costBase, premises, pricing.marginRatePct);
  const simPrice = drivers.ok === true
    ? priceFromCostAndMargin(simBreakdown.costBase, premises, simMarginRate)
    : null;

  let pricingIssue: ScenarioIssue | null = null;
  if (basePrice.ok === false) pricingIssue = { code: basePrice.code, message: `Base: ${basePrice.message}` };
  else if (simPrice && simPrice.ok === false) pricingIssue = { code: simPrice.code, message: `Cenário: ${simPrice.message}` };

  const basePriceValue = basePrice.ok === true ? basePrice.price : null;
  const simPriceValue = simPrice && simPrice.ok === true ? simPrice.price : null;
  const priceDelta = basePriceValue != null && simPriceValue != null ? simPriceValue - basePriceValue : null;

  const total = delta(baseBreakdown.costBase, simBreakdown.costBase);
  return {
    simulationMethod: "DRIVER_SIMULATION",
    simulationNote: DRIVER_SIMULATION_NOTE,
    baseline: {
      source: cost.source,
      label: productCostBaselineLabel(cost.source),
      badge: productCostBaselineBadge(cost.source),
      productionCostVersionId: cost.productionCostVersionId,
      productionCostVersionCode: cost.productionCostVersionCode,
      productionCostRevision: cost.productionCostRevision,
      effectiveDate: cost.effectiveDate,
      calculatedAt: cost.calculatedAt,
      capturedAt: baseline.capturedAt,
      warnings: cost.warnings,
    },
    base: {
      product: cost.name,
      sku: cost.sku,
      ciu: baseBreakdown.costBase,
      premissas: {
        taxRate: pricing.taxRatePct,
        commRate: pricing.commRatePct,
        otherRate: pricing.otherRatePct,
        marginRate: pricing.marginRatePct,
        freight: pricing.freight,
      },
      resultados: { suggestedPrice: basePriceValue },
    },
    simulated: {
      ciu: simBreakdown.costBase,
      suggestedPrice: simPriceValue,
      marginRate: simMarginRate,
      markup: simPriceValue == null ? null : markupFactor(simPriceValue, simBreakdown.costBase),
      breakdown: simBreakdown,
    },
    breakdown: { base: baseBreakdown, simulated: simBreakdown },
    deltas: {
      mp: delta(baseBreakdown.mp, simBreakdown.mp),
      hh: delta(baseBreakdown.hh, simBreakdown.hh),
      hm: delta(baseBreakdown.hm, simBreakdown.hm),
      process: delta(baseBreakdown.hh + baseBreakdown.hm, simBreakdown.hh + simBreakdown.hm),
      total,
    },
    delta: {
      price: priceDelta,
      pricePct:
        priceDelta != null && basePriceValue != null && basePriceValue > 0
          ? (priceDelta / basePriceValue) * 100
          : null,
      ciu: total.abs,
      ciuPct: total.pct,
    },
    efficiencyApplied: drivers.ok === true ? drivers.efficiencyApplied : false,
    costIssue,
    pricingIssue,
  };
}

export const LEGACY_SCENARIO_NOTE =
  "Cenário legado (anterior à base explícita): calculado sobre a engenharia atual no momento da consulta, com eficiência aplicada sobre HH/HM agregados. Recrie o cenário para congelar a base e usar o cálculo por drivers.";

export function legacyBaselineDescriptor(): ScenarioComparison["baseline"] {
  return {
    source: LEGACY_LIVE_BASELINE,
    label: productCostBaselineLabel(LEGACY_LIVE_BASELINE),
    badge: productCostBaselineBadge(LEGACY_LIVE_BASELINE),
    productionCostVersionId: null,
    productionCostVersionCode: null,
    productionCostRevision: null,
    effectiveDate: null,
    calculatedAt: null,
    capturedAt: null,
    warnings: [],
  };
}

/**
 * Registros sem base gravada: mantém o cálculo histórico (escala de HH/HM agregados) sobre a
 * engenharia atual, agora rotulado como legado e sem divisões por zero / preço 0 silencioso.
 */
export function computeLegacyScenarioComparison(
  live: { name: string | null; sku: string | null; mp: number; hh: number; hm: number; calculatedAt: string },
  pricing: ScenarioPricingPremises,
  adjustments: ScenarioAdjustments
): ScenarioComparison {
  const baseBreakdown = { mp: live.mp, hh: live.hh, hm: live.hm, costBase: live.mp + live.hh + live.hm };
  const efficiencyFactor = 1 + adjustments.efficiencyAdjPct / 100;
  let costIssue: ScenarioIssue | null = null;
  let simBreakdown = baseBreakdown;
  if (!(efficiencyFactor > 0)) {
    costIssue = {
      code: "INVALID_EFFICIENCY",
      message: "Ajuste de eficiência deve manter a eficiência resultante maior que zero.",
    };
  } else {
    const legacy = simulateScenarioFromBreakdown(
      { mp: live.mp, hh: live.hh, hm: live.hm },
      adjustments,
      pricing
    );
    simBreakdown = legacy.simulated;
  }

  const premises = toFormulaPremises(pricing);
  const simMarginRate = pricing.marginRatePct * (1 + adjustments.marginAdjPct / 100);
  const basePrice = priceFromCostAndMargin(baseBreakdown.costBase, premises, pricing.marginRatePct);
  const simPrice = costIssue ? null : priceFromCostAndMargin(simBreakdown.costBase, premises, simMarginRate);
  let pricingIssue: ScenarioIssue | null = null;
  if (basePrice.ok === false) pricingIssue = { code: basePrice.code, message: `Base: ${basePrice.message}` };
  else if (simPrice && simPrice.ok === false) pricingIssue = { code: simPrice.code, message: `Cenário: ${simPrice.message}` };
  const basePriceValue = basePrice.ok === true ? basePrice.price : null;
  const simPriceValue = simPrice && simPrice.ok === true ? simPrice.price : null;
  const priceDelta = basePriceValue != null && simPriceValue != null ? simPriceValue - basePriceValue : null;
  const total = delta(baseBreakdown.costBase, simBreakdown.costBase);

  return {
    simulationMethod: "LEGACY_AGGREGATE_SCALING",
    simulationNote: LEGACY_SCENARIO_NOTE,
    baseline: { ...legacyBaselineDescriptor(), calculatedAt: live.calculatedAt },
    base: {
      product: live.name,
      sku: live.sku,
      ciu: baseBreakdown.costBase,
      premissas: {
        taxRate: pricing.taxRatePct,
        commRate: pricing.commRatePct,
        otherRate: pricing.otherRatePct,
        marginRate: pricing.marginRatePct,
        freight: pricing.freight,
      },
      resultados: { suggestedPrice: basePriceValue },
    },
    simulated: {
      ciu: simBreakdown.costBase,
      suggestedPrice: simPriceValue,
      marginRate: simMarginRate,
      markup: simPriceValue == null ? null : markupFactor(simPriceValue, simBreakdown.costBase),
      breakdown: simBreakdown,
    },
    breakdown: { base: baseBreakdown, simulated: simBreakdown },
    deltas: {
      mp: delta(baseBreakdown.mp, simBreakdown.mp),
      hh: delta(baseBreakdown.hh, simBreakdown.hh),
      hm: delta(baseBreakdown.hm, simBreakdown.hm),
      process: delta(baseBreakdown.hh + baseBreakdown.hm, simBreakdown.hh + simBreakdown.hm),
      total,
    },
    delta: {
      price: priceDelta,
      pricePct:
        priceDelta != null && basePriceValue != null && basePriceValue > 0
          ? (priceDelta / basePriceValue) * 100
          : null,
      ciu: total.abs,
      ciuPct: total.pct,
    },
    efficiencyApplied: !costIssue && adjustments.efficiencyAdjPct !== 0,
    costIssue,
    pricingIssue,
  };
}
