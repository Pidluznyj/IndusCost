import {
  marginFromCostAndTargetPrice,
  priceFromCostAndMargin,
} from "./simulationFormula";

export type NewProductMaterialLine = {
  code: string;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
};

export function materialLineTotal(line: NewProductMaterialLine): number {
  return Number(line.quantity) * Number(line.unitCost);
}

export function sumMaterialTotal(lines: NewProductMaterialLine[]): number {
  return lines.reduce((acc, line) => acc + materialLineTotal(line), 0);
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
