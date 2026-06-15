import {
  calculateStructureLineTotalCost,
  sanitizeFinite,
  toFiniteNumber,
} from "@/src/lib/projectsCalculations.js";
import { buildProjectEngineeringTree, type ProjectEngineeringTreeNode } from "@/src/lib/projectsEngineeringTree.js";
import {
  sumSimulatedRootProductCost,
  type EngineeringRollupLine,
} from "@/src/lib/projectsEngineeringCostRollup.js";
import type { ProjectSimulatedProductRow, ProjectStructureLineRow } from "@/src/types/projects.js";

export type ProjectStructureSnapshotGroupStatus =
  | "HERDADO"
  | "ALTERADO"
  | "SEM_CUSTO"
  | "FICTICIO";

export type ProjectStructureSnapshotGroup = {
  groupKey: string;
  snapshotRootProductId: string | null;
  simulatedProductId: string | null;
  rootCode: string;
  rootDescription: string;
  sourceLabel: string;
  quantity: number;
  officialCost: number;
  simulatedCost: number;
  totalCost: number;
  differenceAmount: number;
  differencePercent: number;
  itemCount: number;
  hasChanges: boolean;
  hasMissingCost: boolean;
  status: ProjectStructureSnapshotGroupStatus;
  lines: ProjectStructureLineRow[];
  tree: ProjectEngineeringTreeNode | null;
};

export type ProjectStructureGroupingResult = {
  snapshotGroups: ProjectStructureSnapshotGroup[];
  simulatedProductGroups: ProjectStructureSnapshotGroup[];
  manualLines: ProjectStructureLineRow[];
};

export type RootProductMeta = { sku: string; name: string };

/** IDs de produtos oficiais importados como raiz de snapshot no projeto. */
export function collectSnapshotRootProductIds(
  lines: ProjectStructureLineRow[]
): string[] {
  const ids = new Set<string>();
  for (const line of lines) {
    if (line.snapshotRootProductId) ids.add(line.snapshotRootProductId);
    const snapshotMatch = line.notes?.match(/snapshot:([0-9a-f-]{36})/i);
    if (snapshotMatch?.[1]) ids.add(snapshotMatch[1]);
  }
  return [...ids];
}

function lineBelongsToSnapshot(line: ProjectStructureLineRow, rootId: string): boolean {
  return (
    line.snapshotRootProductId === rootId ||
    line.notes?.includes(`snapshot:${rootId}`) === true ||
    line.notes?.includes(`routing-snapshot:${rootId}`) === true
  );
}

function belongsToProjectSimulatedProduct(line: ProjectStructureLineRow): boolean {
  return line.simulatedProductId != null && line.snapshotRootProductId == null;
}

function isManualStructureLine(line: ProjectStructureLineRow): boolean {
  if (line.snapshotRootProductId != null) return false;
  if (belongsToProjectSimulatedProduct(line)) return false;
  if (line.notes?.includes("snapshot:")) return false;
  if (line.notes?.includes("routing-snapshot:")) return false;
  return true;
}

function sumProjectSimulatedProductCost(groupLines: ProjectStructureLineRow[]): number {
  let total = 0;
  for (const line of groupLines) {
    if (!line.countsInSimulatedProductCost) continue;
    total += sanitizeFinite(line.totalCost) ?? 0;
  }
  return sanitizeFinite(total) ?? 0;
}

function buildSimulatedProductStructureGroups(
  lines: ProjectStructureLineRow[],
  simulatedProducts?: ProjectSimulatedProductRow[]
): ProjectStructureSnapshotGroup[] {
  const productIds = new Set<string>();
  for (const line of lines) {
    if (belongsToProjectSimulatedProduct(line) && line.simulatedProductId) {
      productIds.add(line.simulatedProductId);
    }
  }
  for (const product of simulatedProducts ?? []) {
    productIds.add(product.id);
  }

  const groups: ProjectStructureSnapshotGroup[] = [];
  for (const productId of productIds) {
    const meta = simulatedProducts?.find((p) => p.id === productId);
    const groupLines = lines.filter((l) => l.simulatedProductId === productId);
    const totalCost = sumProjectSimulatedProductCost(groupLines);
    const hasMissingCost = groupLines.some(
      (l) => l.isMissingCost || l.unitCostSnapshot <= 0 || !Number.isFinite(l.totalCost)
    );

    groups.push({
      groupKey: `sim-product:${productId}`,
      snapshotRootProductId: null,
      simulatedProductId: productId,
      rootCode: meta?.provisionalCode?.trim() || `PRJ-${productId.slice(0, 8)}`,
      rootDescription: meta?.description ?? "Produto do projeto",
      sourceLabel: "Produto do projeto",
      quantity: 1,
      officialCost: 0,
      simulatedCost: totalCost,
      totalCost,
      differenceAmount: totalCost,
      differencePercent: 0,
      itemCount: groupLines.length,
      hasChanges: true,
      hasMissingCost,
      status: hasMissingCost ? "SEM_CUSTO" : "FICTICIO",
      lines: groupLines,
      tree:
        groupLines.length > 0
          ? buildProjectEngineeringTree(
              {
                productId,
                sku: meta?.provisionalCode?.trim() || "PRJ",
                name: meta?.description ?? "Produto do projeto",
              },
              groupLines,
              { kind: "simulated_product", simulatedProductId: productId }
            )
          : null,
    });
  }

  return groups.sort((a, b) => a.rootCode.localeCompare(b.rootCode));
}

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

/** Custo exibível do grupo: rollup oficial+delta, com fallback em folhas e totais persistidos. */
export function resolveSnapshotGroupSimulatedCost(lines: ProjectStructureLineRow[]): number {
  const rollupLines = lines.map(toRollupLine);
  const fromRollup = sumSimulatedRootProductCost(rollupLines);
  if (fromRollup > 0) return fromRollup;

  const fromOfficialOpen = sumOfficialRootCost(lines);
  if (fromOfficialOpen > 0) return fromOfficialOpen;

  const parentIds = new Set(
    lines.map((l) => l.parentLineId).filter((id): id is string => id != null)
  );

  let leafSum = 0;
  for (const line of lines) {
    if (!line.countsInSimulatedProductCost) continue;
    if (parentIds.has(line.id)) continue;

    const persisted = sanitizeFinite(line.totalCost);
    if (persisted != null && persisted > 0) {
      leafSum += persisted;
      continue;
    }

    const qty = toFiniteNumber(line.quantity);
    const unit = toFiniteNumber(line.unitCostSnapshot);
    const loss = toFiniteNumber(line.lossPercent ?? 0);
    leafSum += calculateStructureLineTotalCost(qty, unit, loss);
  }

  return sanitizeFinite(leafSum) ?? 0;
}

function sumOfficialRootCost(lines: ProjectStructureLineRow[]): number {
  let total = 0;
  for (const line of lines) {
    if (line.parentLineId != null) continue;
    if (!line.countsInSimulatedProductCost) continue;
    const qty = toFiniteNumber(line.officialQuantitySnapshot ?? line.quantity);
    const loss = toFiniteNumber(line.officialLossPercentSnapshot ?? line.lossPercent ?? 0);
    const unit = toFiniteNumber(line.officialUnitCostSnapshot ?? line.unitCostSnapshot);
    const lineTotal = calculateStructureLineTotalCost(qty, unit, loss);
    total += sanitizeFinite(lineTotal) ?? 0;
  }
  return sanitizeFinite(total) ?? 0;
}

function resolveGroupStatus(
  lines: ProjectStructureLineRow[],
  hasChanges: boolean,
  hasMissingCost: boolean
): ProjectStructureSnapshotGroupStatus {
  if (hasMissingCost) return "SEM_CUSTO";
  if (hasChanges) return "ALTERADO";
  if (lines.some((l) => l.sourceType === "SIMULATED_ITEM")) return "FICTICIO";
  return "HERDADO";
}

function resolveRootMeta(
  rootId: string,
  groupLines: ProjectStructureLineRow[],
  rootProducts?: Record<string, RootProductMeta>,
  simulatedProducts?: ProjectSimulatedProductRow[]
): { rootCode: string; rootDescription: string; simulatedProductId: string | null } {
  const fromLookup = rootProducts?.[rootId];
  if (fromLookup) {
    return {
      rootCode: fromLookup.sku,
      rootDescription: fromLookup.name,
      simulatedProductId: null,
    };
  }

  return {
    rootCode: rootId.slice(0, 8),
    rootDescription: "Produto importado",
    simulatedProductId: null,
  };
}

/** Agrupa linhas hierárquicas importadas por snapshotRootProductId; separa itens manuais. */
export function buildProjectStructureSnapshotGroups(
  lines: ProjectStructureLineRow[],
  options?: {
    rootProducts?: Record<string, RootProductMeta>;
    simulatedProducts?: ProjectSimulatedProductRow[];
  }
): ProjectStructureGroupingResult {
  const snapshotRootIds = new Set<string>();

  for (const line of lines) {
    if (line.snapshotRootProductId) {
      snapshotRootIds.add(line.snapshotRootProductId);
      continue;
    }
    const snapshotMatch = line.notes?.match(/snapshot:([0-9a-f-]{36})/i);
    if (snapshotMatch?.[1]) snapshotRootIds.add(snapshotMatch[1]);
  }

  const manualLines = lines.filter(isManualStructureLine);

  const snapshotGroups: ProjectStructureSnapshotGroup[] = [...snapshotRootIds].map((rootId) => {
    const groupLines = lines.filter((l) => lineBelongsToSnapshot(l, rootId));
    const officialCost = sumOfficialRootCost(groupLines);
    const simulatedCost = resolveSnapshotGroupSimulatedCost(groupLines);
    const differenceAmount = simulatedCost - officialCost;
    const differencePercent =
      officialCost > 0 ? sanitizeFinite((differenceAmount / officialCost) * 100) ?? 0 : 0;

    const hasChanges = groupLines.some((l) => l.isChangedFromOfficial);
    const hasMissingCost = groupLines.some(
      (l) => l.isMissingCost || l.unitCostSnapshot <= 0 || !Number.isFinite(l.totalCost)
    );

    const { rootCode, rootDescription, simulatedProductId } = resolveRootMeta(
      rootId,
      groupLines,
      options?.rootProducts,
      options?.simulatedProducts
    );

    return {
      groupKey: rootId,
      snapshotRootProductId: rootId,
      simulatedProductId,
      rootCode,
      rootDescription,
      sourceLabel: "Produto oficial",
      quantity: 1,
      officialCost,
      simulatedCost,
      totalCost: simulatedCost,
      differenceAmount,
      differencePercent,
      itemCount: groupLines.length,
      hasChanges,
      hasMissingCost,
      status: resolveGroupStatus(groupLines, hasChanges, hasMissingCost),
      lines: groupLines,
      tree: null,
    };
  });

  snapshotGroups.sort((a, b) => a.rootCode.localeCompare(b.rootCode));

  for (const group of snapshotGroups) {
    if (group.snapshotRootProductId) {
      group.tree = buildProjectEngineeringTree(
        {
          productId: group.snapshotRootProductId,
          sku: group.rootCode,
          name: group.rootDescription,
        },
        group.lines
      );
    }
  }

  const simulatedProductGroups = buildSimulatedProductStructureGroups(
    lines,
    options?.simulatedProducts
  );

  return { snapshotGroups, simulatedProductGroups, manualLines };
}

/** Linhas que entram no grid principal (somente manuais; snapshots ficam no accordion). */
export function filterPrimaryStructureTableLines(lines: ProjectStructureLineRow[]): ProjectStructureLineRow[] {
  return buildProjectStructureSnapshotGroups(lines).manualLines;
}
