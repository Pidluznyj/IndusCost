import type {
  ProjectMoldChargeMode,
  ProjectStructureLineType,
} from "@/src/types/projects.js";

export function toFiniteNumber(value: unknown, fallback = 0): number {
  if (value == null || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function sanitizeFinite(value: number | null | undefined): number | null {
  if (value == null) return null;
  return Number.isFinite(value) ? value : null;
}

/** Custo linha = quantidade * custo unitário * (1 + perda% / 100) */
export function calculateStructureLineTotalCost(
  quantity: number,
  unitCost: number,
  lossPercent = 0
): number {
  const q = toFiniteNumber(quantity);
  const u = toFiniteNumber(unitCost);
  const loss = toFiniteNumber(lossPercent);
  return q * u * (1 + loss / 100);
}

/** custo amortizado por unidade = custo de construção / quantidade para amortização */
export function calculateAmortizedMoldCostPerUnit(
  constructionCost: number,
  amortizationQuantity: number | null | undefined
): number | null {
  const cost = toFiniteNumber(constructionCost);
  const qty = toFiniteNumber(amortizationQuantity);
  if (qty <= 0) return null;
  const perUnit = cost / qty;
  return Number.isFinite(perUnit) ? perUnit : null;
}

/** Preço sugerido = custo unitário / (1 - margem% / 100) */
export function calculateSuggestedPrice(unitCost: number, marginPercent: number): number | null {
  const cost = toFiniteNumber(unitCost);
  const margin = toFiniteNumber(marginPercent);
  const divisor = 1 - margin / 100;
  if (divisor <= 0) return null;
  const price = cost / divisor;
  return Number.isFinite(price) ? price : null;
}

/** Margem percentual = ((preço - custo) / preço) * 100 */
export function calculateMarginPercent(price: number, unitCost: number): number | null {
  const p = toFiniteNumber(price);
  const c = toFiniteNumber(unitCost);
  if (p <= 0) return null;
  const margin = ((p - c) / p) * 100;
  return Number.isFinite(margin) ? margin : null;
}

/** Markup = preço / custo */
export function calculateMarkupPercent(price: number, unitCost: number): number | null {
  const p = toFiniteNumber(price);
  const c = toFiniteNumber(unitCost);
  if (c <= 0) return null;
  const markup = (p / c - 1) * 100;
  return Number.isFinite(markup) ? markup : null;
}

export type StructureLineInput = {
  lineType: ProjectStructureLineType;
  quantity: number;
  lossPercent?: number | null;
  unitCostSnapshot: number;
  /** Quando false, linha existe só para exibição hierárquica (evita dupla contagem). */
  countsInSimulatedProductCost?: boolean;
};

export type MoldCostInput = {
  chargeMode: ProjectMoldChargeMode;
  constructionCost: number;
  amortizationQuantity?: number | null;
  amortizedCostPerUnit?: number | null;
};

export type CostBreakdownInput = {
  structureLines: StructureLineInput[];
  molds: MoldCostInput[];
  targetMarginPercent?: number | null;
  targetPrice?: number | null;
};

export function buildCostBreakdown(input: CostBreakdownInput) {
  let rawMaterialCost = 0;
  let componentCost = 0;
  let serviceCost = 0;
  let packagingCost = 0;
  let separateMoldCost = 0;
  let amortizedMoldCostPerUnit = 0;

  for (const line of input.structureLines) {
    if (line.countsInSimulatedProductCost === false) continue;
    const total = calculateStructureLineTotalCost(
      line.quantity,
      line.unitCostSnapshot,
      line.lossPercent ?? 0
    );
    switch (line.lineType) {
      case "RAW_MATERIAL":
        rawMaterialCost += total;
        break;
      case "COMPONENT":
        componentCost += total;
        break;
      case "SERVICE":
      case "PROCESS":
        serviceCost += total;
        break;
      case "PACKAGING":
        packagingCost += total;
        break;
      case "MOLD_AMORTIZATION":
        amortizedMoldCostPerUnit += total;
        break;
      default:
        componentCost += total;
        break;
    }
  }

  for (const mold of input.molds) {
    const construction = toFiniteNumber(mold.constructionCost);
    if (mold.chargeMode === "CHARGED_SEPARATELY") {
      separateMoldCost += construction;
    } else if (mold.chargeMode === "AMORTIZED_IN_PRODUCT") {
      const perUnit =
        mold.amortizedCostPerUnit ??
        calculateAmortizedMoldCostPerUnit(construction, mold.amortizationQuantity);
      if (perUnit != null) amortizedMoldCostPerUnit += perUnit;
    }
  }

  const unitCost =
    rawMaterialCost +
    componentCost +
    serviceCost +
    packagingCost +
    amortizedMoldCostPerUnit;

  const targetMargin = sanitizeFinite(
    input.targetMarginPercent != null ? toFiniteNumber(input.targetMarginPercent) : null
  );
  const suggestedPrice =
    targetMargin != null ? calculateSuggestedPrice(unitCost, targetMargin) : null;
  const markupPercent =
    suggestedPrice != null ? calculateMarkupPercent(suggestedPrice, unitCost) : null;

  const targetPrice = sanitizeFinite(
    input.targetPrice != null ? toFiniteNumber(input.targetPrice) : null
  );
  const priceGap =
    suggestedPrice != null && targetPrice != null ? suggestedPrice - targetPrice : null;

  return {
    rawMaterialCost: sanitizeFinite(rawMaterialCost) ?? 0,
    componentCost: sanitizeFinite(componentCost) ?? 0,
    serviceCost: sanitizeFinite(serviceCost) ?? 0,
    packagingCost: sanitizeFinite(packagingCost) ?? 0,
    separateMoldCost: sanitizeFinite(separateMoldCost) ?? 0,
    amortizedMoldCostPerUnit: sanitizeFinite(amortizedMoldCostPerUnit) ?? 0,
    unitCost: sanitizeFinite(unitCost) ?? 0,
    targetMarginPercent: targetMargin,
    suggestedPrice: sanitizeFinite(suggestedPrice),
    markupPercent: sanitizeFinite(markupPercent),
    targetPrice,
    priceGap: sanitizeFinite(priceGap),
  };
}

export function formatProjectCode(number: number): string {
  return `PRJ-${String(number).padStart(5, "0")}`;
}
