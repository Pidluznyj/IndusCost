import {
  calculateStructureLineTotalCost,
  sanitizeFinite,
  toFiniteNumber,
} from "@/src/lib/projectsCalculations.js";

const ROLLUP_EPSILON = 0.000001;

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

export function lineTotalFromParts(
  quantity: number,
  unitCost: number,
  lossPercent: number
): number {
  const total = calculateStructureLineTotalCost(quantity, unitCost, lossPercent);
  return sanitizeFinite(total) ?? 0;
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

function differsFromOfficial(
  line: EngineeringRollupLine,
  quantity: number,
  lossPercent: number,
  unitCost: number
): boolean {
  const oq = line.officialQuantitySnapshot;
  const ol = line.officialLossPercentSnapshot;
  const ou = line.officialUnitCostSnapshot;
  if (oq != null && Math.abs(oq - quantity) > ROLLUP_EPSILON) return true;
  if (ol != null && Math.abs(ol - lossPercent) > ROLLUP_EPSILON) return true;
  if (ou != null && Math.abs(ou - unitCost) > ROLLUP_EPSILON) return true;
  if (ou == null && unitCost > ROLLUP_EPSILON) return true;
  return false;
}

function isHierarchicalSnapshotLine(line: EngineeringRollupLine): boolean {
  return line.snapshotRootProductId != null;
}

/**
 * Recalcula totais bottom-up para snapshots hierárquicos importados.
 * Pais com filhos passam a ter unitCost/total derivados da soma dos filhos.
 */
export function recalculateEngineeringCostRollup(
  lines: EngineeringRollupLine[]
): EngineeringRollupLine[] {
  const byId = new Map(lines.map((l) => [l.id, { ...l }]));
  const childrenByParent = new Map<string, string[]>();

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

  for (const rootId of snapshotRoots) {
    const scopedIds = [...byId.values()]
      .filter((l) => l.snapshotRootProductId === rootId)
      .map((l) => l.id);

    const rollupSubtree = (id: string) => {
      const line = byId.get(id)!;
      const childIds = (childrenByParent.get(id) ?? []).filter((cid) => scopedIds.includes(cid));

      for (const cid of childIds) {
        rollupSubtree(cid);
      }

      if (childIds.length === 0) {
        line.totalCost = lineTotalFromParts(line.quantity, line.unitCostSnapshot, line.lossPercent);
        line.isChangedFromOfficial = differsFromOfficial(
          line,
          line.quantity,
          line.lossPercent,
          line.unitCostSnapshot
        );
        return;
      }

      let childrenTotal = 0;
      let childChanged = false;
      for (const cid of childIds) {
        const child = byId.get(cid)!;
        childrenTotal += child.totalCost;
        if (child.isChangedFromOfficial) childChanged = true;
      }
      childrenTotal = sanitizeFinite(childrenTotal) ?? 0;

      const derivedUnit = deriveUnitCostFromChildrenTotal(
        childrenTotal,
        line.quantity,
        line.lossPercent
      );
      line.unitCostSnapshot = derivedUnit;
      line.totalCost = lineTotalFromParts(line.quantity, derivedUnit, line.lossPercent);
      line.isChangedFromOfficial =
        differsFromOfficial(line, line.quantity, line.lossPercent, derivedUnit) || childChanged;
    };

    for (const id of scopedIds) {
      const line = byId.get(id)!;
      if (!line.parentLineId || !scopedIds.includes(line.parentLineId)) {
        rollupSubtree(id);
      }
    }
  }

  return [...byId.values()];
}

export type EngineeringSnapshotRollupNode = {
  quantity: number;
  lossPercent: number;
  officialUnitCost: number;
  simulatedUnitCost: number;
  totalCost: number;
  children: EngineeringSnapshotRollupNode[];
};

/** Rollup bottom-up em nó de snapshot antes de persistir (pais derivam custo dos filhos). */
export function rollupEngineeringSnapshotNode(node: EngineeringSnapshotRollupNode): void {
  for (const child of node.children) {
    rollupEngineeringSnapshotNode(child);
  }
  if (node.children.length === 0) return;

  let childrenTotal = 0;
  for (const child of node.children) {
    childrenTotal += child.totalCost;
  }
  childrenTotal = sanitizeFinite(childrenTotal) ?? 0;

  const derivedUnit = deriveUnitCostFromChildrenTotal(
    childrenTotal,
    node.quantity,
    node.lossPercent
  );
  node.simulatedUnitCost = derivedUnit;
  node.officialUnitCost = derivedUnit;
  node.totalCost = lineTotalFromParts(node.quantity, derivedUnit, node.lossPercent);
}

/** Soma custo simulado do produto raiz (1º nível, sem dupla contagem de netos). */
export function sumSimulatedRootProductCost(lines: EngineeringRollupLine[]): number {
  let total = 0;
  for (const line of lines) {
    if (!line.countsInSimulatedProductCost) continue;
    if (line.parentLineId != null) continue;
    total += line.totalCost;
  }
  return sanitizeFinite(total) ?? 0;
}

/** Custo de projeto considerando rollup — ignora linhas hierárquicas profundas. */
export function sumProjectRollupStructureCost(lines: EngineeringRollupLine[]): number {
  let total = 0;
  for (const line of lines) {
    if (line.snapshotRootProductId != null) {
      if (!line.countsInSimulatedProductCost || line.parentLineId != null) continue;
    }
    total += line.totalCost;
  }
  return sanitizeFinite(total) ?? 0;
}
