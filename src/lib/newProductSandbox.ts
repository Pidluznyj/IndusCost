import {
  marginFromCostAndTargetPrice,
  priceFromCostAndMargin,
} from "./simulationFormula";

import type { SimulatedComponentProcessInputs } from "./componentStandardProcessCost.js";
export type { SimulatedComponentProcessInputs };

/** origem: cadastro Suprimentos (recomendado) ou linha digitada manualmente no sandbox */
export type NewProductMaterialSource = "CATALOG" | "MANUAL";

export type NewProductMaterialLine = {
  code: string;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  /** ID do Material (Suprimentos) quando a linha está vinculada ao cadastro */
  materialId?: string | null;
  source?: NewProductMaterialSource;
};

export type CostBreakdown = {
  mp: number;
  hh: number;
  hm: number;
  costBase: number;
  mpPct: number;
  hhPct: number;
  hmPct: number;
};

export type SimulatedComponent = {
  id: string;
  name: string;
  sku?: string;
  materials: NewProductMaterialLine[];
  hh: number;
  hm: number;
  breakdown: CostBreakdown;
  processInputs?: SimulatedComponentProcessInputs;
};

export type ExistingComponentCost = {
  id: string;
  sku: string;
  name: string;
  mp: number;
  hh: number;
  hm: number;
};

export type FinalCompositionLine =
  | {
      id: string;
      type: "EXISTING_COMPONENT";
      refId: string;
      quantity: number;
    }
  | {
      id: string;
      type: "SIMULATED_COMPONENT";
      refId: string;
      quantity: number;
    }
  | {
      id: string;
      type: "DIRECT_MATERIAL";
      description: string;
      quantity: number;
      unitCost: number;
    };

/** Alinhado à lógica de GET /api/materials (efetivo com frete e perda). */
export function effectiveUnitCostFromMaterialPayload(m: {
  currentCost: number;
  freight?: number;
  standardLoss?: number;
  calculations?: { landedCost?: number; effectiveCost?: number };
}): number {
  const fromApi = m.calculations?.effectiveCost;
  if (typeof fromApi === "number" && Number.isFinite(fromApi) && fromApi >= 0) return fromApi;
  const currentCost = Number(m.currentCost);
  const freight = Number(m.freight ?? 0);
  const lossPct = Number(m.standardLoss ?? 0) / 100;
  const landed = (Number.isFinite(currentCost) ? currentCost : 0) + (Number.isFinite(freight) ? freight : 0);
  if (!Number.isFinite(landed) || landed < 0) return 0;
  const denom = 1 - (Number.isFinite(lossPct) ? lossPct : 0);
  if (denom <= 0 || !Number.isFinite(denom)) return landed;
  return landed / denom;
}

export function materialLineTotal(line: NewProductMaterialLine): number {
  return Number(line.quantity) * Number(line.unitCost);
}

export function sumMaterialTotal(lines: NewProductMaterialLine[]): number {
  return lines.reduce((acc, line) => acc + materialLineTotal(line), 0);
}

export function computeCostBreakdown(mp: number, hh: number, hm: number): CostBreakdown {
  const m = Number(mp) || 0;
  const h = Number(hh) || 0;
  const k = Number(hm) || 0;
  const costBase = m + h + k;
  const mpPct = costBase > 0 ? (m / costBase) * 100 : 0;
  const hhPct = costBase > 0 ? (h / costBase) * 100 : 0;
  const hmPct = costBase > 0 ? (k / costBase) * 100 : 0;
  return { mp: m, hh: h, hm: k, costBase, mpPct, hhPct, hmPct };
}

export function computeSimulatedComponent(input: {
  id: string;
  name: string;
  sku?: string;
  materials: NewProductMaterialLine[];
  hh: number;
  hm: number;
  processInputs?: SimulatedComponentProcessInputs;
}): SimulatedComponent {
  const mp = sumMaterialTotal(input.materials);
  const breakdown = computeCostBreakdown(mp, input.hh, input.hm);
  return {
    id: input.id,
    name: input.name,
    sku: input.sku,
    materials: input.materials,
    hh: Number(input.hh) || 0,
    hm: Number(input.hm) || 0,
    breakdown,
    processInputs: input.processInputs,
  };
}

function getLineBreakdown(
  line: FinalCompositionLine,
  existingMap: Map<string, ExistingComponentCost>,
  simulatedMap: Map<string, SimulatedComponent>
): CostBreakdown {
  const qty = Number(line.quantity) || 0;
  if (line.type === "DIRECT_MATERIAL") {
    return computeCostBreakdown((Number(line.unitCost) || 0) * qty, 0, 0);
  }
  if (line.type === "EXISTING_COMPONENT") {
    const ref = existingMap.get(line.refId);
    if (!ref) return computeCostBreakdown(0, 0, 0);
    return computeCostBreakdown(ref.mp * qty, ref.hh * qty, ref.hm * qty);
  }
  const sim = simulatedMap.get(line.refId);
  if (!sim) return computeCostBreakdown(0, 0, 0);
  return computeCostBreakdown(
    sim.breakdown.mp * qty,
    sim.breakdown.hh * qty,
    sim.breakdown.hm * qty
  );
}

export function computeFinalProductFromComposition(input: {
  lines: FinalCompositionLine[];
  existingComponents: ExistingComponentCost[];
  simulatedComponents: SimulatedComponent[];
  mode: "MARGIN" | "TARGET_PRICE";
  desiredMarginPct: number;
  targetPrice: number;
}) {
  const existingMap = new Map(input.existingComponents.map((x) => [x.id, x]));
  const simMap = new Map(input.simulatedComponents.map((x) => [x.id, x]));
  const totals = input.lines.reduce(
    (acc, line) => {
      const b = getLineBreakdown(line, existingMap, simMap);
      acc.mp += b.mp;
      acc.hh += b.hh;
      acc.hm += b.hm;
      return acc;
    },
    { mp: 0, hh: 0, hm: 0 }
  );
  const breakdown = computeCostBreakdown(totals.mp, totals.hh, totals.hm);

  let price = 0;
  let marginPct = 0;
  if (input.mode === "MARGIN") {
    const m = Number(input.desiredMarginPct) || 0;
    price = priceFromCostAndMargin(
      breakdown.costBase,
      { taxRatePct: 0, commRatePct: 0, otherRatePct: 0, freight: 0 },
      m
    ).price;
    marginPct = m;
  } else {
    const p = Number(input.targetPrice) || 0;
    price = p;
    marginPct = marginFromCostAndTargetPrice(
      breakdown.costBase,
      { taxRatePct: 0, commRatePct: 0, otherRatePct: 0, freight: 0 },
      p
    ).marginRatePct;
  }

  let viability: "VIAVEL" | "ATENCAO" | "INVIAVEL" = "INVIAVEL";
  if (price > breakdown.costBase && marginPct > 8) viability = "VIAVEL";
  else if (price > breakdown.costBase && marginPct > 0) viability = "ATENCAO";

  return {
    ...breakdown,
    price,
    marginPct,
    viability,
  };
}

export function computeNewProductSandboxResult(input: {
  lines: NewProductMaterialLine[];
  hh: number;
  hm: number;
  mode: "MARGIN" | "TARGET_PRICE";
  desiredMarginPct: number;
  targetPrice: number;
}) {
  const mp = sumMaterialTotal(input.lines);
  const hh = Number(input.hh) || 0;
  const hm = Number(input.hm) || 0;
  const costBase = mp + hh + hm;
  const mpPct = costBase > 0 ? (mp / costBase) * 100 : 0;
  const hhPct = costBase > 0 ? (hh / costBase) * 100 : 0;
  const hmPct = costBase > 0 ? (hm / costBase) * 100 : 0;

  let price = 0;
  let marginPct = 0;

  if (input.mode === "MARGIN") {
    const calc = priceFromCostAndMargin(
      costBase,
      { taxRatePct: 0, commRatePct: 0, otherRatePct: 0, freight: 0 },
      Number(input.desiredMarginPct) || 0
    );
    price = calc.price;
    marginPct = Number(input.desiredMarginPct) || 0;
  } else {
    const target = Number(input.targetPrice) || 0;
    price = target;
    const calc = marginFromCostAndTargetPrice(
      costBase,
      { taxRatePct: 0, commRatePct: 0, otherRatePct: 0, freight: 0 },
      target
    );
    marginPct = calc.marginRatePct;
  }

  let viability: "VIAVEL" | "ATENCAO" | "INVIAVEL" = "INVIAVEL";
  if (price > costBase && marginPct > 8) viability = "VIAVEL";
  else if (price > costBase && marginPct > 0) viability = "ATENCAO";
  else viability = "INVIAVEL";

  return {
    mp,
    hh,
    hm,
    costBase,
    mpPct,
    hhPct,
    hmPct,
    price,
    marginPct,
    viability,
  };
}
