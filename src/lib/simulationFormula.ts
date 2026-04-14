export type SimulationBaseBreakdown = {
  mp: number;
  hh: number;
  hm: number;
};

export type SimulationAdjustments = {
  materialAdjPct: number;
  laborAdjPct: number;
  hmAdjPct: number;
  efficiencyAdjPct: number;
  marginAdjPct: number;
};

export type PricingPremissas = {
  taxRatePct: number;
  commRatePct: number;
  otherRatePct: number;
  marginRatePct: number;
  freight: number;
};

export function simulateScenarioFromBreakdown(
  base: SimulationBaseBreakdown,
  adj: SimulationAdjustments,
  premissas: PricingPremissas
) {
  const materialFactor = 1 + Number(adj.materialAdjPct) / 100;
  const laborFactor = 1 + Number(adj.laborAdjPct) / 100;
  const hmFactor = 1 + Number(adj.hmAdjPct) / 100;
  const efficiencyFactorRaw = 1 + Number(adj.efficiencyAdjPct) / 100;
  const efficiencyFactor = efficiencyFactorRaw > 0 ? efficiencyFactorRaw : 0.000001;
  const marginFactor = 1 + Number(adj.marginAdjPct) / 100;

  const baseCost = Number(base.mp) + Number(base.hh) + Number(base.hm);
  const simMp = Number(base.mp) * materialFactor;
  const simHh = (Number(base.hh) * laborFactor) / efficiencyFactor;
  const simHm = (Number(base.hm) * hmFactor) / efficiencyFactor;
  const simCost = simMp + simHh + simHm;

  const taxRate = Number(premissas.taxRatePct) / 100;
  const commRate = Number(premissas.commRatePct) / 100;
  const otherRate = Number(premissas.otherRatePct) / 100;
  const marginRate = (Number(premissas.marginRatePct) * marginFactor) / 100;
  const freight = Number(premissas.freight);
  const divisor = 1 - taxRate - commRate - otherRate - marginRate;

  const baseSuggestedPrice = divisor > 0 ? (baseCost + freight) / divisor : 0;
  const simSuggestedPrice = divisor > 0 ? (simCost + freight) / divisor : 0;

  return {
    base: { mp: Number(base.mp), hh: Number(base.hh), hm: Number(base.hm), costBase: baseCost },
    simulated: { mp: simMp, hh: simHh, hm: simHm, costBase: simCost },
    pricing: {
      divisor,
      taxRatePct: Number(premissas.taxRatePct),
      commRatePct: Number(premissas.commRatePct),
      otherRatePct: Number(premissas.otherRatePct),
      marginRatePct: marginRate * 100,
      freight,
      baseSuggestedPrice,
      simSuggestedPrice,
    },
  };
}
