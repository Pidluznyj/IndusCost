/**
 * Cálculos de conferência física — motor puro (sem Prisma).
 */
import { roundInventoryQuantity } from "./inventoryTypes.js";

export function computeCountDifference(
  systemQuantity: number,
  countedQuantity: number
): { differenceQuantity: number; differencePercent: number } {
  const system = roundInventoryQuantity(systemQuantity);
  const counted = roundInventoryQuantity(countedQuantity);
  const differenceQuantity = roundInventoryQuantity(counted - system);
  let differencePercent = 0;
  if (system !== 0) {
    differencePercent = roundInventoryQuantity((differenceQuantity / system) * 100);
  } else if (counted !== 0) {
    differencePercent = 100;
  }
  return { differenceQuantity, differencePercent };
}

export function hasCountDivergence(differenceQuantity: number): boolean {
  return roundInventoryQuantity(differenceQuantity) !== 0;
}
