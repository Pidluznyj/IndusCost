/**
 * Análise de custo da simulação de produto no projeto.
 *
 * Regra: custo simulado = custo oficial do motor + deltas de alterações manuais.
 * Pais com filhos preservam custo oficial completo (residual não aberto na árvore).
 */
import { buildCostBreakdown, sanitizeFinite } from "@/src/lib/projectsCalculations.js";
import {
  applyBaselineDeltaRollup,
  computeSimulatedProductIndustrialCost,
  type EngineeringRollupLine,
} from "@/src/lib/projectsEngineeringCostRollup.js";
import type { ProjectStructureLineRow } from "@/src/types/projects.js";

export type ProductSimulationCostBreakdown = {
  /** Motor oficial (totalIndustrialCost). */
  officialIndustrialCost: number | null;
  /** officialIndustrialCost + totalProjectDelta. */
  simulatedIndustrialCost: number;
  difference: number | null;
  /** Soma dos deltas manuais propagados (1º nível). */
  totalProjectDelta: number;
  /** Soma dos totais oficiais das linhas de 1º nível na árvore. */
  openTreeOfficialCost: number;
  /** Parcela do motor oficial não representada como linha de 1º nível. */
  preservedOfficialResidual: number;
  rawMaterialCost: number;
  componentCost: number;
  serviceCost: number;
  packagingCost: number;
  unitCostTotal: number;
  suggestedPrice: number | null;
  targetMarginPercent: number | null;
  parts: {
    industrial: number;
    rawMaterial: number;
    components: number;
    services: number;
    packaging: number;
    other: number;
  };
};

function toRollupLine(line: ProjectStructureLineRow): EngineeringRollupLine {
  return {
    id: line.id,
    parentLineId: line.parentLineId,
    snapshotRootProductId: line.snapshotRootProductId,
    lineType: line.lineType,
    quantity: line.quantity,
    lossPercent: line.lossPercent ?? 0,
    unitCostSnapshot: line.unitCostSnapshot,
    totalCost: line.totalCost,
    officialQuantitySnapshot: line.officialQuantitySnapshot,
    officialLossPercentSnapshot: line.officialLossPercentSnapshot,
    officialUnitCostSnapshot: line.officialUnitCostSnapshot,
    countsInSimulatedProductCost: line.countsInSimulatedProductCost,
    isChangedFromOfficial: line.isChangedFromOfficial,
  };
}

function scopeLinesToSnapshot(
  lines: ProjectStructureLineRow[],
  snapshotRootProductId?: string
): ProjectStructureLineRow[] {
  if (!snapshotRootProductId) return lines;
  return lines.filter(
    (l) =>
      l.snapshotRootProductId === snapshotRootProductId ||
      l.notes?.includes(`snapshot:${snapshotRootProductId}`) ||
      l.notes?.includes(`routing-snapshot:${snapshotRootProductId}`)
  );
}

export function computeProductSimulationCostAnalysis(
  productLines: ProjectStructureLineRow[],
  options: {
    officialIndustrialCost: number | null;
    snapshotRootProductId?: string;
    targetMarginPercent?: number | null;
    targetPrice?: number | null;
  }
): ProductSimulationCostBreakdown {
  const scoped = scopeLinesToSnapshot(productLines, options.snapshotRootProductId);
  const rollupLines = scoped.map(toRollupLine);
  const rolled = applyBaselineDeltaRollup(rollupLines);

  const official = options.officialIndustrialCost;
  const industrial = computeSimulatedProductIndustrialCost(rollupLines, official);

  const level0Lines = rolled.lines.filter(
    (l) => l.parentLineId == null && l.countsInSimulatedProductCost
  );

  const breakdown = buildCostBreakdown({
    structureLines: level0Lines.map((l) => {
      const state = rolled.lineStates.get(l.id);
      return {
        lineType: l.lineType as ProjectStructureLineRow["lineType"],
        quantity: l.quantity,
        lossPercent: l.lossPercent,
        unitCostSnapshot: state
          ? state.simulatedTotal /
            (l.quantity * (1 + (l.lossPercent ?? 0) / 100) || 1)
          : l.unitCostSnapshot,
        countsInSimulatedProductCost: true,
      };
    }),
    molds: [],
    targetMarginPercent: options.targetMarginPercent,
    targetPrice: options.targetPrice,
  });

  const difference =
    official != null && Number.isFinite(official)
      ? sanitizeFinite(industrial.totalProjectDelta)
      : null;

  const other =
    breakdown.unitCost -
    (breakdown.rawMaterialCost +
      breakdown.componentCost +
      breakdown.serviceCost +
      breakdown.packagingCost);

  return {
    officialIndustrialCost: official,
    simulatedIndustrialCost: industrial.simulatedIndustrialCost,
    difference,
    totalProjectDelta: industrial.totalProjectDelta,
    openTreeOfficialCost: industrial.sumLevel0OfficialOpen,
    preservedOfficialResidual: industrial.preservedOfficialResidual,
    rawMaterialCost: breakdown.rawMaterialCost,
    componentCost: breakdown.componentCost,
    serviceCost: breakdown.serviceCost,
    packagingCost: breakdown.packagingCost,
    unitCostTotal: industrial.simulatedIndustrialCost,
    suggestedPrice: breakdown.suggestedPrice,
    targetMarginPercent: breakdown.targetMarginPercent,
    parts: {
      industrial: industrial.simulatedIndustrialCost,
      rawMaterial: breakdown.rawMaterialCost,
      components: breakdown.componentCost,
      services: breakdown.serviceCost,
      packaging: breakdown.packagingCost,
      other: other > 0.000001 ? other : 0,
    },
  };
}
