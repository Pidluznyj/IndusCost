import {
  calculateStructureLineTotalCost,
  sanitizeFinite,
  toFiniteNumber,
} from "@/src/lib/projectsCalculations.js";

export type EngineeringRollupLine = {
  id: string;
  parentLineId: string | null;
  snapshotRootProductId: string | null;
  lineType: string;
  quantity: number;
  lossPercent: number;
  unitCostSnapshot: number;
  totalCost: number;
  officialQuantitySnapshot: number | null;
  officialLossPercentSnapshot: number | null;
  officialUnitCostSnapshot: number | null;
  countsInSimulatedProductCost: boolean;
  isChangedFromOfficial: boolean;
};

export type BaselineDeltaLineState = {
  officialTotal: number;
  delta: number;
  simulatedTotal: number;
};

export type BaselineDeltaRollupResult = {
  lines: EngineeringRollupLine[];
  lineStates: Map<string, BaselineDeltaLineState>;
  /** Soma dos deltas das linhas de 1º nível (countsInSimulatedProductCost). */
  totalProjectDelta: number;
  /** Soma dos totais oficiais das linhas de 1º nível visíveis na árvore. */
  sumLevel0OfficialOpen: number;
  /** Soma dos totais simulados das linhas de 1º nível (oficial aberto + delta). */
  sumLevel0Simulated: number;
};

export function lineTotalFromParts(
  quantity: number,
  unitCost: number,
  lossPercent: number
): number {
  const total = calculateStructureLineTotalCost(quantity, unitCost, lossPercent);
  return sanitizeFinite(total) ?? 0;
}

export function officialLineTotal(line: EngineeringRollupLine): number {
  return lineTotalFromParts(
    line.officialQuantitySnapshot ?? line.quantity,
    line.officialUnitCostSnapshot ?? line.unitCostSnapshot,
    line.officialLossPercentSnapshot ?? line.lossPercent
  );
}

export function currentLineTotal(line: EngineeringRollupLine): number {
  return lineTotalFromParts(line.quantity, line.unitCostSnapshot, line.lossPercent);
}

/** unitCost que reproduz o total agregado dos filhos na quantidade/perda do pai. */
export function deriveUnitCostFromChildrenTotal(
  childrenTotal: number,
  parentQuantity: number,
  parentLossPercent: number
): number {
  const qty = toFiniteNumber(parentQuantity);
  const loss = toFiniteNumber(parentLossPercent);
  const divisor = qty * (1 + loss / 100);
  if (divisor <= 0) return sanitizeFinite(childrenTotal) ?? 0;
  const unit = childrenTotal / divisor;
  return sanitizeFinite(unit) ?? 0;
}

function isHierarchicalSnapshotLine(line: EngineeringRollupLine): boolean {
  return line.snapshotRootProductId != null;
}

/**
 * Custo simulado = baseline oficial da linha + deltas de alterações manuais propagadas.
 * Pais com filhos preservam custo oficial completo (inclui residual não aberto na árvore).
 */
export function applyBaselineDeltaRollup(
  lines: EngineeringRollupLine[]
): BaselineDeltaRollupResult {
  const byId = new Map(lines.map((l) => [l.id, { ...l }]));
  const childrenByParent = new Map<string, string[]>();
  const lineStates = new Map<string, BaselineDeltaLineState>();

  for (const line of byId.values()) {
    if (!isHierarchicalSnapshotLine(line)) continue;
    if (!line.parentLineId) continue;
    const bucket = childrenByParent.get(line.parentLineId) ?? [];
    bucket.push(line.id);
    childrenByParent.set(line.parentLineId, bucket);
  }

  const snapshotRoots = new Set<string>();
  for (const line of byId.values()) {
    if (line.snapshotRootProductId) snapshotRoots.add(line.snapshotRootProductId);
  }

  const processSubtree = (id: string): BaselineDeltaLineState => {
    const line = byId.get(id)!;
    const childIds = childrenByParent.get(id) ?? [];
    const officialTotal = officialLineTotal(line);

    if (childIds.length === 0) {
      const delta = line.isChangedFromOfficial ? currentLineTotal(line) - officialTotal : 0;
      const simulatedTotal = officialTotal + delta;
      line.totalCost = simulatedTotal;
      const state = { officialTotal, delta: sanitizeFinite(delta) ?? 0, simulatedTotal };
      lineStates.set(id, state);
      return state;
    }

    let childDeltaSum = 0;
    for (const cid of childIds) {
      childDeltaSum += processSubtree(cid).delta;
    }
    childDeltaSum = sanitizeFinite(childDeltaSum) ?? 0;

    let delta: number;
    let simulatedTotal: number;

    if (line.isChangedFromOfficial) {
      simulatedTotal = currentLineTotal(line);
      delta = simulatedTotal - officialTotal;
    } else {
      delta = childDeltaSum;
      simulatedTotal = officialTotal + childDeltaSum;
    }

    line.totalCost = simulatedTotal;
    const state = {
      officialTotal,
      delta: sanitizeFinite(delta) ?? 0,
      simulatedTotal: sanitizeFinite(simulatedTotal) ?? 0,
    };
    lineStates.set(id, state);
    return state;
  };

  for (const rootId of snapshotRoots) {
    const scopedIds = [...byId.values()]
      .filter((l) => l.snapshotRootProductId === rootId)
      .map((l) => l.id);

    for (const id of scopedIds) {
      const line = byId.get(id)!;
      if (!line.parentLineId || !scopedIds.includes(line.parentLineId)) {
        processSubtree(id);
      }
    }
  }

  let totalProjectDelta = 0;
  let sumLevel0OfficialOpen = 0;
  let sumLevel0Simulated = 0;

  for (const line of byId.values()) {
    if (!line.countsInSimulatedProductCost || line.parentLineId != null) continue;
    const state = lineStates.get(line.id);
    if (!state) continue;
    totalProjectDelta += state.delta;
    sumLevel0OfficialOpen += state.officialTotal;
    sumLevel0Simulated += state.simulatedTotal;
  }

  return {
    lines: [...byId.values()],
    lineStates,
    totalProjectDelta: sanitizeFinite(totalProjectDelta) ?? 0,
    sumLevel0OfficialOpen: sanitizeFinite(sumLevel0OfficialOpen) ?? 0,
    sumLevel0Simulated: sanitizeFinite(sumLevel0Simulated) ?? 0,
  };
}

/** Atualiza totalCost por baseline+delta; não sobrescreve unitCostSnapshot de pais. */
export function recalculateEngineeringCostRollup(
  lines: EngineeringRollupLine[]
): EngineeringRollupLine[] {
  return applyBaselineDeltaRollup(lines).lines;
}

export type EngineeringSnapshotRollupNode = {
  quantity: number;
  lossPercent: number;
  officialUnitCost: number;
  simulatedUnitCost: number;
  totalCost: number;
  children: EngineeringSnapshotRollupNode[];
};

/** Propaga apenas totalCost dos filhos folha; não substitui custo oficial do pai. */
export function rollupEngineeringSnapshotNode(node: EngineeringSnapshotRollupNode): void {
  for (const child of node.children) {
    rollupEngineeringSnapshotNode(child);
  }
  node.totalCost = lineTotalFromParts(node.quantity, node.simulatedUnitCost, node.lossPercent);
}

/** Soma custo simulado de 1º nível (baseline aberto + deltas). */
export function sumSimulatedRootProductCost(lines: EngineeringRollupLine[]): number {
  return applyBaselineDeltaRollup(lines).sumLevel0Simulated;
}

/** Custo de projeto considerando rollup — ignora linhas hierárquicas profundas. */
export function sumProjectRollupStructureCost(lines: EngineeringRollupLine[]): number {
  return applyBaselineDeltaRollup(lines).sumLevel0Simulated;
}

/** Custo simulado do produto = motor oficial + deltas manuais do snapshot. */
export function computeSimulatedProductIndustrialCost(
  lines: EngineeringRollupLine[],
  officialIndustrialCost: number | null
): {
  simulatedIndustrialCost: number;
  totalProjectDelta: number;
  sumLevel0OfficialOpen: number;
  preservedOfficialResidual: number;
} {
  const rollup = applyBaselineDeltaRollup(lines);
  const totalProjectDelta = rollup.totalProjectDelta;
  const sumLevel0OfficialOpen = rollup.sumLevel0OfficialOpen;

  const preservedOfficialResidual =
    officialIndustrialCost != null && Number.isFinite(officialIndustrialCost)
      ? Math.max(0, officialIndustrialCost - sumLevel0OfficialOpen)
      : 0;

  const simulatedIndustrialCost =
    officialIndustrialCost != null && Number.isFinite(officialIndustrialCost)
      ? officialIndustrialCost + totalProjectDelta
      : rollup.sumLevel0Simulated;

  return {
    simulatedIndustrialCost: sanitizeFinite(simulatedIndustrialCost) ?? 0,
    totalProjectDelta,
    sumLevel0OfficialOpen,
    preservedOfficialResidual: sanitizeFinite(preservedOfficialResidual) ?? 0,
  };
}
