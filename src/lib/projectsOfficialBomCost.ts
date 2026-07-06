import { roundMoney } from "./financeAccountsReceivableDashboard.js";
import { toFiniteNumber } from "./projectsCalculations.js";

/**
 * Converte custo total oficial da linha BOM (motor cost-analysis) para unitCostSnapshot
 * compatível com calculateStructureLineTotalCost do módulo Projetos.
 */
export function projectUnitCostFromOfficialLineTotal(
  officialLineTotal: number,
  quantity: number,
  lossPercent: number
): number {
  const lineTotal = toFiniteNumber(officialLineTotal);
  const q = toFiniteNumber(quantity);
  if (q <= 0) return roundMoney(lineTotal);
  const divisor = q * (1 + toFiniteNumber(lossPercent) / 100);
  if (divisor <= 0) return 0;
  return roundMoney(lineTotal / divisor);
}

/** Custo unitário efetivo de material (landed + perda padrão), paridade com cost-analysis. */
export function resolveOfficialMaterialEffectiveUnitCost(material: {
  currentCost: unknown;
  freight?: unknown;
  standardLoss?: unknown;
}): number {
  const landed =
    toFiniteNumber(material.currentCost) + toFiniteNumber(material.freight ?? 0);
  const stdLoss = toFiniteNumber(material.standardLoss ?? 0) / 100;
  if (stdLoss >= 1) return roundMoney(landed);
  return roundMoney(landed / (1 - stdLoss));
}

/** Total oficial da linha BOM: unitEffective × quantidade requerida (perda BOM). */
export function computeOfficialBomLineTotal(
  quantity: number,
  lossPercent: number,
  unitEffectiveCost: number
): number {
  const q = toFiniteNumber(quantity);
  const loss = toFiniteNumber(lossPercent) / 100;
  const requiredQty = loss >= 1 ? q : q / (1 - loss);
  return roundMoney(unitEffectiveCost * requiredQty);
}
