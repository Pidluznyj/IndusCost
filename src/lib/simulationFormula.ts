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

export function priceFromCostAndMargin(
  costBase: number,
  premissas: Omit<PricingPremissas, "marginRatePct">,
  marginRatePct: number
): { price: number; divisor: number } {
  const taxRate = Number(premissas.taxRatePct) / 100;
  const commRate = Number(premissas.commRatePct) / 100;
  const otherRate = Number(premissas.otherRatePct) / 100;
  const marginRate = Number(marginRatePct) / 100;
  const freight = Number(premissas.freight);
  const divisor = 1 - taxRate - commRate - otherRate - marginRate;
  const price = divisor > 0 ? (Number(costBase) + freight) / divisor : 0;
  return { price, divisor };
}

export function marginFromCostAndTargetPrice(
  costBase: number,
  premissas: Omit<PricingPremissas, "marginRatePct">,
  targetPrice: number
): { marginRatePct: number; feasible: boolean } {
  const taxRate = Number(premissas.taxRatePct) / 100;
  const commRate = Number(premissas.commRatePct) / 100;
  const otherRate = Number(premissas.otherRatePct) / 100;
  const freight = Number(premissas.freight);
  const p = Number(targetPrice);
  if (!Number.isFinite(p) || p <= 0) {
    return { marginRatePct: 0, feasible: false };
  }
  const marginRate = 1 - taxRate - commRate - otherRate - (Number(costBase) + freight) / p;
  return { marginRatePct: marginRate * 100, feasible: Number.isFinite(marginRate) };
}

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

  const marginRatePct = Number(premissas.marginRatePct) * marginFactor;
  const basePriceCalc = priceFromCostAndMargin(
    baseCost,
    {
      taxRatePct: Number(premissas.taxRatePct),
      commRatePct: Number(premissas.commRatePct),
      otherRatePct: Number(premissas.otherRatePct),
      freight: Number(premissas.freight),
    },
    marginRatePct
  );
  const simPriceCalc = priceFromCostAndMargin(
    simCost,
    {
      taxRatePct: Number(premissas.taxRatePct),
      commRatePct: Number(premissas.commRatePct),
      otherRatePct: Number(premissas.otherRatePct),
      freight: Number(premissas.freight),
    },
    marginRatePct
  );

  return {
    base: { mp: Number(base.mp), hh: Number(base.hh), hm: Number(base.hm), costBase: baseCost },
    simulated: { mp: simMp, hh: simHh, hm: simHm, costBase: simCost },
    pricing: {
      divisor: simPriceCalc.divisor,
      taxRatePct: Number(premissas.taxRatePct),
      commRatePct: Number(premissas.commRatePct),
      otherRatePct: Number(premissas.otherRatePct),
      marginRatePct,
      freight: Number(premissas.freight),
      baseSuggestedPrice: basePriceCalc.price,
      simSuggestedPrice: simPriceCalc.price,
    },
  };
}

// ---------------------------------------------------------------------------
// Simulação por drivers (governança de baseline) — substitui a escala cega de
// HH/HM agregados usada em `simulateScenarioFromBreakdown` (mantida só para
// registros legados, sem baseline gravado).
// ---------------------------------------------------------------------------

export type ScenarioOwnProcess = {
  transformHh: number;
  transformHm: number;
  setupHh: number;
  setupHm: number;
};

export type ScenarioDriverBase = SimulationBaseBreakdown & {
  /** Processo próprio do produto (sem filhos). Necessário apenas para ajuste de eficiência. */
  ownProcess: ScenarioOwnProcess | null;
};

export type ScenarioDriverAdjustments = Omit<SimulationAdjustments, "marginAdjPct">;

export type ScenarioDriverResult =
  | {
      ok: true;
      base: SimulationBaseBreakdown & { costBase: number };
      simulated: SimulationBaseBreakdown & { costBase: number };
      /** true quando a eficiência foi aplicada sobre a transformação do processo próprio. */
      efficiencyApplied: boolean;
    }
  | {
      ok: false;
      code: "INVALID_INPUT" | "INVALID_EFFICIENCY" | "EFFICIENCY_DECOMPOSITION_UNAVAILABLE";
      message: string;
    };

/**
 * Aplica drivers sobre a base escolhida (PUBLISHED ou LIVE):
 *  - MP × (1 + materialAdj)            — linear no preço de MP;
 *  - HH × (1 + laborAdj), HM × (1 + hmAdj) — lineares na taxa-hora (inclui setup e filhos);
 *  - eficiência: SOMENTE a transformação do processo próprio é dividida pelo fator
 *    (netPph ∝ eficiência). Setup e custo herdado de filhos NÃO mudam — igual ao motor
 *    físico (`computeStandardProcessUnitCosts`).
 *
 * Sem decomposição do processo próprio e com eficiência ≠ 0, não inventa número: erro explícito.
 */
export function simulateScenarioDrivers(
  base: ScenarioDriverBase,
  adj: ScenarioDriverAdjustments
): ScenarioDriverResult {
  const mp = Number(base.mp);
  const hh = Number(base.hh);
  const hm = Number(base.hm);
  const materialAdj = Number(adj.materialAdjPct);
  const laborAdj = Number(adj.laborAdjPct);
  const hmAdj = Number(adj.hmAdjPct);
  const efficiencyAdj = Number(adj.efficiencyAdjPct);
  if (![mp, hh, hm, materialAdj, laborAdj, hmAdj, efficiencyAdj].every(Number.isFinite)) {
    return { ok: false, code: "INVALID_INPUT", message: "Valores não numéricos na simulação." };
  }
  if (mp < 0 || hh < 0 || hm < 0) {
    return { ok: false, code: "INVALID_INPUT", message: "Custo base negativo não é simulável." };
  }
  const materialFactor = 1 + materialAdj / 100;
  const laborFactor = 1 + laborAdj / 100;
  const hmFactor = 1 + hmAdj / 100;
  const efficiencyFactor = 1 + efficiencyAdj / 100;
  if (materialFactor < 0 || laborFactor < 0 || hmFactor < 0) {
    return { ok: false, code: "INVALID_INPUT", message: "Ajuste abaixo de −100% não é simulável." };
  }
  if (!(efficiencyFactor > 0)) {
    return {
      ok: false,
      code: "INVALID_EFFICIENCY",
      message: "Ajuste de eficiência deve manter a eficiência resultante maior que zero.",
    };
  }

  let hhAfterEfficiency = hh;
  let hmAfterEfficiency = hm;
  let efficiencyApplied = false;
  if (efficiencyAdj !== 0) {
    const own = base.ownProcess;
    const valid =
      own != null &&
      [own.transformHh, own.transformHm, own.setupHh, own.setupHm].every(
        (v) => Number.isFinite(v) && v >= 0
      ) &&
      own.transformHh + own.setupHh <= hh + 1e-6 &&
      own.transformHm + own.setupHm <= hm + 1e-6;
    if (!valid || own == null) {
      return {
        ok: false,
        code: "EFFICIENCY_DECOMPOSITION_UNAVAILABLE",
        message:
          "Não há dados de processo (transformação × setup) para simular eficiência nesta base. Use a engenharia atual ou publique o custo vigente.",
      };
    }
    hhAfterEfficiency = hh - own.transformHh + own.transformHh / efficiencyFactor;
    hmAfterEfficiency = hm - own.transformHm + own.transformHm / efficiencyFactor;
    efficiencyApplied = true;
  }

  const simMp = mp * materialFactor;
  const simHh = hhAfterEfficiency * laborFactor;
  const simHm = hmAfterEfficiency * hmFactor;
  return {
    ok: true,
    base: { mp, hh, hm, costBase: mp + hh + hm },
    simulated: { mp: simMp, hh: simHh, hm: simHm, costBase: simMp + simHh + simHm },
    efficiencyApplied,
  };
}
