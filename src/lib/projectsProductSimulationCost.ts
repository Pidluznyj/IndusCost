/**
 * Análise de custo da simulação de produto no projeto.
 *
 * Fontes por card:
 * - Custo industrial oficial: motor getProductCostAnalysis (engineering-snapshot API)
 * - Custo industrial simulado: sumSimulatedRootProductCost após recalculateEngineeringCostRollup
 * - Matéria-prima / Componentes / Serviços: buildCostBreakdown só nas linhas 1º nível do snapshot
 * - Custo unitário total (produto): industrial simulado + extras do snapshot (sem outros produtos do projeto)
 */
import { buildCostBreakdown } from "@/src/lib/projectsCalculations.js";
import {
  recalculateEngineeringCostRollup,
  sumSimulatedRootProductCost,
  type EngineeringRollupLine,
} from "@/src/lib/projectsEngineeringCostRollup.js";
import type { ProjectStructureLineRow } from "@/src/types/projects.js";

export type ProductSimulationCostBreakdown = {
  /** Motor oficial (totalIndustrialCost). */
  officialIndustrialCost: number | null;
  /** Σ linhas 1º nível do snapshot após rollup bottom-up. */
  simulatedIndustrialCost: number;
  difference: number | null;
  rawMaterialCost: number;
  componentCost: number;
  serviceCost: number;
  packagingCost: number;
  /** Soma industrial + HH/componentes/MP do snapshot deste produto. */
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
  const rolled = recalculateEngineeringCostRollup(scoped.map(toRollupLine));
  const simulatedIndustrialCost = sumSimulatedRootProductCost(rolled);

  const level0Lines = rolled.filter(
    (l) => l.parentLineId == null && l.countsInSimulatedProductCost
  );

  const breakdown = buildCostBreakdown({
    structureLines: level0Lines.map((l) => ({
      lineType: l.lineType as ProjectStructureLineRow["lineType"],
      quantity: l.quantity,
      lossPercent: l.lossPercent,
      unitCostSnapshot: l.unitCostSnapshot,
      countsInSimulatedProductCost: true,
    })),
    molds: [],
    targetMarginPercent: options.targetMarginPercent,
    targetPrice: options.targetPrice,
  });

  const official = options.officialIndustrialCost;
  const difference =
    official != null && Number.isFinite(official)
      ? simulatedIndustrialCost - official
      : null;

  const other =
    breakdown.unitCost -
    (breakdown.rawMaterialCost +
      breakdown.componentCost +
      breakdown.serviceCost +
      breakdown.packagingCost);

  return {
    officialIndustrialCost: official,
    simulatedIndustrialCost,
    difference,
    rawMaterialCost: breakdown.rawMaterialCost,
    componentCost: breakdown.componentCost,
    serviceCost: breakdown.serviceCost,
    packagingCost: breakdown.packagingCost,
    unitCostTotal: breakdown.unitCost,
    suggestedPrice: breakdown.suggestedPrice,
    targetMarginPercent: breakdown.targetMarginPercent,
    parts: {
      industrial: simulatedIndustrialCost,
      rawMaterial: breakdown.rawMaterialCost,
      components: breakdown.componentCost,
      services: breakdown.serviceCost,
      packaging: breakdown.packagingCost,
      other: other > 0.000001 ? other : 0,
    },
  };
}

/** Após import/rollup, alinha snapshots oficiais à linha para baseline isChangedFromOfficial=false. */
export function engineeringRollupBaselinePatch(
  line: EngineeringRollupLine
): Pick<
  EngineeringRollupLine,
  "officialQuantitySnapshot" | "officialLossPercentSnapshot" | "officialUnitCostSnapshot" | "isChangedFromOfficial"
> {
  return {
    officialQuantitySnapshot: line.quantity,
    officialLossPercentSnapshot: line.lossPercent,
    officialUnitCostSnapshot: line.unitCostSnapshot,
    isChangedFromOfficial: false,
  };
}
