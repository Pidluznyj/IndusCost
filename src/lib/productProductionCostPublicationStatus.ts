/**
 * Tipos e helpers puros — status de publicação de custo por produto (sem Prisma).
 */

import type { ProductEngineeringCostWarningResult } from "./productEngineeringCostWarning.js";
import { hasProductionCostDifference } from "./productEngineeringCostWarning.js";

export type ProductionCostPublicationCostSlice = {
  versionId: string;
  versionCode: string;
  revision: number;
  status: string;
  effectiveDate: string;
  unitProductionCost: number;
  materialCost: number;
  laborCost: number;
  machineCost: number;
  overheadCost: number;
  otherCost: number;
  calculationHash: string | null;
};

export type ProductProductionCostPublicationStatus = {
  productId: string;
  sku: string;
  officialCost: ProductionCostPublicationCostSlice | null;
  pendingDraft: ProductionCostPublicationCostSlice | null;
  difference: { amount: number; percent: number } | null;
  warning: ProductEngineeringCostWarningResult;
};

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function computeProductionCostPublicationDifference(
  officialUnitCost: number | null | undefined,
  draftUnitCost: number
): { amount: number; percent: number } {
  if (!hasProductionCostDifference(officialUnitCost, draftUnitCost)) {
    return { amount: 0, percent: 0 };
  }
  const official = officialUnitCost ?? 0;
  const amount = round6(draftUnitCost - official);
  const percent =
    official > 0 ? round6((amount / official) * 100) : draftUnitCost > 0 ? 100 : 0;
  return { amount, percent };
}

export function formatProductionCostPublicationDelta(
  difference: { amount: number; percent: number } | null
): { amountLabel: string; percentLabel: string } {
  if (!difference) {
    return { amountLabel: "—", percentLabel: "—" };
  }
  const sign = difference.amount > 0 ? "+" : difference.amount < 0 ? "" : "";
  const pctSign = difference.percent > 0 ? "+" : difference.percent < 0 ? "" : "";
  return {
    amountLabel: `${sign}${difference.amount.toFixed(6)}`,
    percentLabel: `${pctSign}${difference.percent.toFixed(2)}%`,
  };
}
