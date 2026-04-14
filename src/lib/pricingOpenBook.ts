import { simulateIndustrialCost } from "./openBookMaterialExplosion";

export type PricingOpenBookExecutive = {
  totalIndustrialCost: number;
  totalMaterialCost: number;
  totalHH: number;
  totalHM: number;
  pctMp: number;
  pctHh: number;
  pctHm: number;
};

export type PricingOpenBookPayload = {
  executive?: PricingOpenBookExecutive;
  consolidatedMaterials?: Array<{
    materialId: string;
    code: string;
    description: string;
    unit: string;
    quantity: number;
    totalCost: number;
    unitCostEffective: number;
    pctOfIndustrial: number;
    pctOfMp: number;
  }>;
  cifOpexInformational?: {
    totalCIF_Unit: number;
    totalOPEX_Unit: number;
  };
  explosionReconcilesMaterialTotal?: boolean;
  explosionMaterialSum?: number;
  error?: string;
  message?: string | null;
};

export type PricingPremissas = {
  taxRate: number;
  commRate: number;
  marginRate: number;
  freight: number;
};

export function priceDivisorFromPremissas(p: PricingPremissas): number {
  return 1 - Number(p.taxRate) / 100 - Number(p.commRate) / 100 - Number(p.marginRate) / 100;
}

export function projectSuggestedPrice(industrialCost: number, p: PricingPremissas): number {
  const divisor = priceDivisorFromPremissas(p);
  if (divisor <= 0) return 0;
  return (Number(industrialCost) + Number(p.freight)) / divisor;
}

export function simulatePricingOpenBookSensitivity(
  exec: PricingOpenBookExecutive,
  premissas: PricingPremissas,
  incMpPct: number,
  incHhPct: number,
  incHmPct: number
) {
  const sim = simulateIndustrialCost(
    exec.totalMaterialCost,
    exec.totalHH,
    exec.totalHM,
    incMpPct,
    incHhPct,
    incHmPct
  );
  const suggestedPriceProjected = projectSuggestedPrice(sim.newTotal, premissas);
  const suggestedPriceBase = projectSuggestedPrice(sim.baseTotal, premissas);
  const suggestedDeltaAbs = suggestedPriceProjected - suggestedPriceBase;
  const suggestedDeltaPct = suggestedPriceBase > 0 ? (suggestedDeltaAbs / suggestedPriceBase) * 100 : 0;
  return {
    ...sim,
    suggestedPriceBase,
    suggestedPriceProjected,
    suggestedDeltaAbs,
    suggestedDeltaPct,
  };
}
