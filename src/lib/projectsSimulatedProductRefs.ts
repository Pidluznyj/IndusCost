import { calculateStructureLineTotalCost, toFiniteNumber } from "@/src/lib/projectsCalculations.js";
import {
  GUIDED_REF_SIMULATED_PRODUCT_PREFIX,
  parseSimulatedProductRefFromNotes,
} from "@/src/lib/projectsGuidedFlow.js";

export type SimulatedStructureLineRef = {
  id?: string;
  simulatedProductId: string | null;
  snapshotRootProductId: string | null;
  sourceType?: string;
  quantity?: number;
  lossPercent?: number | null;
  unitCostSnapshot?: number;
  totalCost?: number;
  notes?: string | null;
};

export function sumNativeSimulatedProductStructureCost(
  lines: SimulatedStructureLineRef[],
  simulatedProductId: string
): number {
  return lines
    .filter((l) => l.simulatedProductId === simulatedProductId && l.snapshotRootProductId == null)
    .reduce((acc, l) => acc + (Number.isFinite(l.totalCost) ? (l.totalCost as number) : 0), 0);
}

/** Custo unitário de referência = roll-up total da estrutura do produto/componente filho. */
export function resolveReferencedSimulatedProductUnitCost(
  lines: SimulatedStructureLineRef[],
  refProductId: string
): number {
  return sumNativeSimulatedProductStructureCost(lines, refProductId);
}

export function computeSimulatedProductRefLineUpdate(
  line: SimulatedStructureLineRef,
  allLines: SimulatedStructureLineRef[]
): { unitCostSnapshot: number; totalCost: number; isMissingCost: boolean } | null {
  const refId = parseSimulatedProductRefFromNotes(line.notes);
  if (!refId || line.sourceType !== "MANUAL") return null;
  if (!line.notes?.includes(GUIDED_REF_SIMULATED_PRODUCT_PREFIX)) return null;

  const unitCostSnapshot = resolveReferencedSimulatedProductUnitCost(allLines, refId);
  const qty = toFiniteNumber(line.quantity ?? 1);
  const loss = toFiniteNumber(line.lossPercent ?? 0);
  const totalCost = calculateStructureLineTotalCost(qty, unitCostSnapshot, loss);
  return {
    unitCostSnapshot,
    totalCost,
    isMissingCost: unitCostSnapshot <= 0,
  };
}
