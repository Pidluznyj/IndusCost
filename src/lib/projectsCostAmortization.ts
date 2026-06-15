import { parseMoldNotes, sumMoldCostLines } from "./projectsMoldCostLines.js";
import {
  buildProjectGuidedItems,
  type ProjectGuidedItemRow,
} from "./projectsGuidedFlow.js";
import { isGuidedOtherCostItem, parseOtherCostMeta, resolveOtherCostItemLineTotal } from "./projectsOtherCostGroups.js";
import { sanitizeFinite } from "./projectsCalculations.js";
import type { ProjectDetail, ProjectMoldRow } from "@/src/types/projects";

export type ProjectCostAmortizationSourceType = "MOLD" | "OTHER_COST";

export type ProjectCostAmortizationTargetType =
  | "OFFICIAL_PRODUCT"
  | "OFFICIAL_COMPONENT"
  | "SIMULATION"
  | "LEGACY";

export type ProjectCostAmortizationStatus =
  | "NOT_CONFIGURED"
  | "INCOMPLETE"
  | "EXCESS"
  | "DISTRIBUTED"
  | "NO_ELIGIBLE_ITEMS";

export type ProjectAmortizationTarget = {
  targetItemId: string;
  targetItemType: ProjectCostAmortizationTargetType;
  displayName: string;
  displayCode: string | null;
  baseUnitCost: number;
  suggestedQuantity: number;
  entityKind: ProjectGuidedItemRow["entityKind"];
  snapshotRootProductId?: string;
};

export type ProjectCostAmortizationAllocationInput = {
  targetItemId: string;
  targetItemType: ProjectCostAmortizationTargetType;
  targetSnapshotRootProductId?: string | null;
  targetDescriptionSnapshot: string;
  targetBaseUnitCostSnapshot: number;
  allocationPercent: number;
  amortizationQuantity: number;
};

export type ProjectCostAmortizationAllocationComputed = ProjectCostAmortizationAllocationInput & {
  allocatedAmount: number;
  unitAmortizedCost: number;
  finalUnitCost: number;
};

export type ProjectCostAmortizationConfigInput = {
  sourceType: ProjectCostAmortizationSourceType;
  sourceId: string;
  sourceDescriptionSnapshot: string;
  sourceTotalCostSnapshot: number;
  passThroughPercent: number;
  allocations: ProjectCostAmortizationAllocationInput[];
};

export type ProjectCostAmortizationComputed = {
  sourceType: ProjectCostAmortizationSourceType;
  sourceId: string;
  sourceDescriptionSnapshot: string;
  sourceTotalCostSnapshot: number;
  passThroughPercent: number;
  passThroughAmount: number;
  absorbedAmount: number;
  status: ProjectCostAmortizationStatus;
  allocations: ProjectCostAmortizationAllocationComputed[];
  distributionPercentTotal: number;
  distributionBalancePercent: number;
  allocatedAmountTotal: number;
  unallocatedAmount: number;
};

export type ProjectCostAmortizationRow = ProjectCostAmortizationComputed & {
  id: string;
  projectId: string;
};

export type ProjectItemAmortizationRollup = {
  targetItemId: string;
  displayName: string;
  baseUnitCost: number;
  unitAmortizedCost: number;
  finalUnitCost: number;
  totalAllocated: number;
  sourceLabels: string[];
};

export type ProjectCostAmortizationSummary = {
  baseItemsUnitCost: number;
  totalMoldsCost: number;
  totalOtherCosts: number;
  totalPassThroughAmount: number;
  totalAbsorbedAmount: number;
  totalAmortizationAllocated: number;
  finalItemsUnitCostWithAmortization: number;
  itemRollups: ProjectItemAmortizationRollup[];
  amortizations: ProjectCostAmortizationComputed[];
  alerts: string[];
};

export const AMORTIZATION_PERCENT_TOLERANCE = 0.0001;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAmortizationUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export type AmortizableCostSource = {
  sourceType: ProjectCostAmortizationSourceType;
  sourceId: string;
  sourceBatchId?: string | null;
  description: string;
  totalCost: number;
};

export function validateAmortizationSourceRef(
  detail: ProjectDetail,
  sourceType: ProjectCostAmortizationSourceType,
  sourceId: string
): { ok: true; source: AmortizableCostSource } | { ok: false; error: string } {
  const trimmed = sourceId?.trim();
  if (!trimmed) {
    return { ok: false, error: "sourceId inválido." };
  }

  if (sourceType === "MOLD" && !isAmortizationUuid(trimmed)) {
    return { ok: false, error: "sourceId inválido." };
  }

  const source = listAmortizableCostSources(detail).find(
    (row) => row.sourceType === sourceType && row.sourceId === trimmed
  );
  if (!source) {
    return {
      ok: false,
      error:
        sourceType === "MOLD"
          ? "Molde não encontrado no projeto."
          : "Outro custo não encontrado no projeto.",
    };
  }

  return { ok: true, source };
}

export function roundProjectMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Custo unitário amortizado — 3 casas para peças de alto volume. */
export function roundProjectUnitCost(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function calculatePassThroughAmounts(
  totalCost: number,
  passThroughPercent: number
): { passThroughAmount: number; absorbedAmount: number } {
  const total = roundProjectMoney(Math.max(0, totalCost));
  const pct = clampPercent(passThroughPercent);
  const passThroughAmount = roundProjectMoney((total * pct) / 100);
  const absorbedAmount = roundProjectMoney(total - passThroughAmount);
  return { passThroughAmount, absorbedAmount };
}

export function calculateAmortizationAllocation(
  passThroughAmount: number,
  allocationPercent: number,
  amortizationQuantity: number,
  baseUnitCost: number
): {
  allocatedAmount: number;
  unitAmortizedCost: number;
  finalUnitCost: number;
  quantityError?: "ZERO" | "MISSING";
} {
  const pct = clampPercent(allocationPercent);
  const allocatedAmount = roundProjectMoney((passThroughAmount * pct) / 100);
  const qty = amortizationQuantity;
  if (!Number.isFinite(qty) || qty <= 0) {
    return {
      allocatedAmount,
      unitAmortizedCost: 0,
      finalUnitCost: roundProjectMoney(baseUnitCost),
      quantityError: pct > 0 ? "ZERO" : undefined,
    };
  }
  const unitAmortizedCost = roundProjectUnitCost(allocatedAmount / qty);
  const finalUnitCost = roundProjectUnitCost(baseUnitCost + unitAmortizedCost);
  return { allocatedAmount, unitAmortizedCost, finalUnitCost };
}

export function resolveAmortizationDistributionStatus(
  allocationPercents: number[],
  hasEligibleItems: boolean,
  configured: boolean
): ProjectCostAmortizationStatus {
  if (!hasEligibleItems) return "NO_ELIGIBLE_ITEMS";
  if (!configured) return "NOT_CONFIGURED";
  const total = allocationPercents.reduce((acc, p) => acc + p, 0);
  if (total > 100 + AMORTIZATION_PERCENT_TOLERANCE) return "EXCESS";
  if (total < 100 - AMORTIZATION_PERCENT_TOLERANCE) return "INCOMPLETE";
  return "DISTRIBUTED";
}

export function resolveAmortizationTargetType(
  row: ProjectGuidedItemRow
): ProjectCostAmortizationTargetType {
  if (row.entityKind === "simulation_ref") return "SIMULATION";
  if (row.entityKind === "engineering_clone") {
    return row.itemType === "COMPONENT" ? "OFFICIAL_COMPONENT" : "OFFICIAL_PRODUCT";
  }
  if (row.origin === "OFFICIAL_REFERENCE" || row.origin === "CLONED_FROM_OFFICIAL") {
    return row.itemType === "COMPONENT" ? "OFFICIAL_COMPONENT" : "OFFICIAL_PRODUCT";
  }
  return "LEGACY";
}

export function buildProjectAmortizationTargets(detail: ProjectDetail): ProjectAmortizationTarget[] {
  const items = buildProjectGuidedItems(detail).filter(
    (i) =>
      i.entityKind === "product" ||
      i.entityKind === "engineering_clone" ||
      i.entityKind === "simulation_ref"
  );

  return items.map((row) => {
    const baseUnitCost = sanitizeFinite(row.estimatedCost) ?? 0;
    const suggestedQuantity =
      detail.simulatedProducts.find((p) => p.id === row.productId)?.expectedVolume ??
      detail.simulatedProducts.find((p) => p.id === row.productId)?.batchSize ??
      1;
    return {
      targetItemId: row.id,
      targetItemType: resolveAmortizationTargetType(row),
      displayName: row.name,
      displayCode: row.code,
      baseUnitCost,
      suggestedQuantity: Math.max(1, suggestedQuantity ?? 1),
      entityKind: row.entityKind,
      snapshotRootProductId: row.snapshotRootProductId,
    };
  });
}

export function resolveMoldTotalCost(mold: ProjectMoldRow): number {
  const { lines } = parseMoldNotes(mold.notes);
  if (lines.length > 0) return roundProjectMoney(sumMoldCostLines(lines));
  return roundProjectMoney(mold.constructionCost);
}

export function resolveOtherCostBatchTotal(detail: ProjectDetail, batchId: string): number {
  let total = 0;
  for (const item of detail.simulatedItems) {
    if (!isGuidedOtherCostItem(item.notes)) continue;
    const meta = parseOtherCostMeta(item.notes);
    const key = meta.batchId ?? item.id;
    if (key !== batchId) continue;
    total += resolveOtherCostItemLineTotal(item);
  }
  return roundProjectMoney(total);
}

export function listAmortizableCostSources(detail: ProjectDetail): AmortizableCostSource[] {
  const sources: AmortizableCostSource[] = [];

  for (const mold of detail.molds) {
    sources.push({
      sourceType: "MOLD",
      sourceId: mold.id,
      description: mold.name,
      totalCost: resolveMoldTotalCost(mold),
    });
  }

  const batches = new Map<string, { description: string; total: number }>();
  for (const item of detail.simulatedItems) {
    if (!isGuidedOtherCostItem(item.notes)) continue;
    const meta = parseOtherCostMeta(item.notes);
    const batchId = meta.batchId ?? item.id;
    const current = batches.get(batchId) ?? { description: item.description, total: 0 };
    current.total += resolveOtherCostItemLineTotal(item);
    batches.set(batchId, current);
  }
  for (const [batchId, batch] of batches) {
    sources.push({
      sourceType: "OTHER_COST",
      sourceId: batchId,
      sourceBatchId: batchId,
      description: batch.description,
      totalCost: roundProjectMoney(batch.total),
    });
  }

  return sources;
}

export function computeAmortizationConfig(
  input: ProjectCostAmortizationConfigInput,
  eligibleTargets: ProjectAmortizationTarget[]
): ProjectCostAmortizationComputed {
  const { passThroughAmount, absorbedAmount } = calculatePassThroughAmounts(
    input.sourceTotalCostSnapshot,
    input.passThroughPercent
  );

  const allocations: ProjectCostAmortizationAllocationComputed[] = input.allocations.map(
    (row) => {
      const computed = calculateAmortizationAllocation(
        passThroughAmount,
        row.allocationPercent,
        row.amortizationQuantity,
        row.targetBaseUnitCostSnapshot
      );
      return {
        ...row,
        allocatedAmount: computed.allocatedAmount,
        unitAmortizedCost: computed.unitAmortizedCost,
        finalUnitCost: computed.finalUnitCost,
      };
    }
  );

  const distributionPercentTotal = roundProjectMoney(
    allocations.reduce((acc, a) => acc + a.allocationPercent, 0)
  );
  const allocatedAmountTotal = roundProjectMoney(
    allocations.reduce((acc, a) => acc + a.allocatedAmount, 0)
  );
  const unallocatedAmount = roundProjectMoney(passThroughAmount - allocatedAmountTotal);

  const status = resolveAmortizationDistributionStatus(
    allocations.map((a) => a.allocationPercent),
    eligibleTargets.length > 0,
    true
  );

  return {
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceDescriptionSnapshot: input.sourceDescriptionSnapshot,
    sourceTotalCostSnapshot: roundProjectMoney(input.sourceTotalCostSnapshot),
    passThroughPercent: clampPercent(input.passThroughPercent),
    passThroughAmount,
    absorbedAmount,
    status,
    allocations,
    distributionPercentTotal,
    distributionBalancePercent: roundProjectMoney(100 - distributionPercentTotal),
    allocatedAmountTotal,
    unallocatedAmount,
  };
}

export function buildDefaultAmortizationDraft(
  sourceType: ProjectCostAmortizationSourceType,
  sourceId: string,
  description: string,
  totalCost: number,
  targets: ProjectAmortizationTarget[],
  passThroughPercent = 100
): ProjectCostAmortizationConfigInput {
  const equalShare = targets.length > 0 ? roundProjectMoney(100 / targets.length) : 0;
  let remainder = 100;
  const allocations = targets.map((target, index) => {
    const pct =
      index === targets.length - 1
        ? roundProjectMoney(remainder)
        : roundProjectMoney(equalShare);
    remainder = roundProjectMoney(remainder - pct);
    return {
      targetItemId: target.targetItemId,
      targetItemType: target.targetItemType,
      targetSnapshotRootProductId: target.snapshotRootProductId ?? null,
      targetDescriptionSnapshot: target.displayName,
      targetBaseUnitCostSnapshot: target.baseUnitCost,
      allocationPercent: pct,
      amortizationQuantity: target.suggestedQuantity,
    };
  });

  return {
    sourceType,
    sourceId,
    sourceDescriptionSnapshot: description,
    sourceTotalCostSnapshot: totalCost,
    passThroughPercent,
    allocations,
  };
}

export function buildProjectCostAmortizationSummary(
  detail: ProjectDetail,
  saved: ProjectCostAmortizationRow[] = []
): ProjectCostAmortizationSummary {
  const targets = buildProjectAmortizationTargets(detail);
  const sources = listAmortizableCostSources(detail);
  const targetById = new Map(targets.map((t) => [t.targetItemId, t]));

  const amortizations: ProjectCostAmortizationComputed[] = sources.map((source) => {
    const existing = saved.find(
      (a) => a.sourceType === source.sourceType && a.sourceId === source.sourceId
    );
    if (existing) {
      return computeAmortizationConfig(
        {
          sourceType: existing.sourceType,
          sourceId: existing.sourceId,
          sourceDescriptionSnapshot: existing.sourceDescriptionSnapshot,
          sourceTotalCostSnapshot: source.totalCost,
          passThroughPercent: existing.passThroughPercent,
          allocations: existing.allocations
            .filter((row) => targetById.has(row.targetItemId))
            .map((row) => ({
              ...row,
              targetBaseUnitCostSnapshot:
                targetById.get(row.targetItemId)?.baseUnitCost ?? row.targetBaseUnitCostSnapshot,
            })),
        },
        targets
      );
    }
    return {
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceDescriptionSnapshot: source.description,
      sourceTotalCostSnapshot: source.totalCost,
      passThroughPercent: 100,
      passThroughAmount: source.totalCost,
      absorbedAmount: 0,
      status: resolveAmortizationDistributionStatus([], targets.length > 0, false),
      allocations: [],
      distributionPercentTotal: 0,
      distributionBalancePercent: 100,
      allocatedAmountTotal: 0,
      unallocatedAmount: source.totalCost,
    };
  });

  const itemRollupMap = new Map<string, ProjectItemAmortizationRollup>();
  for (const target of targets) {
    itemRollupMap.set(target.targetItemId, {
      targetItemId: target.targetItemId,
      displayName: target.displayName,
      baseUnitCost: target.baseUnitCost,
      unitAmortizedCost: 0,
      finalUnitCost: target.baseUnitCost,
      totalAllocated: 0,
      sourceLabels: [],
    });
  }

  for (const amort of amortizations) {
    const label = amort.sourceDescriptionSnapshot;
    for (const row of amort.allocations) {
      const rollup = itemRollupMap.get(row.targetItemId);
      if (!rollup) continue;
      rollup.unitAmortizedCost = roundProjectUnitCost(rollup.unitAmortizedCost + row.unitAmortizedCost);
      rollup.finalUnitCost = roundProjectUnitCost(rollup.baseUnitCost + rollup.unitAmortizedCost);
      rollup.totalAllocated = roundProjectMoney(rollup.totalAllocated + row.allocatedAmount);
      if (!rollup.sourceLabels.includes(label)) rollup.sourceLabels.push(label);
    }
  }

  const baseItemsUnitCost = roundProjectMoney(
    targets.reduce((acc, t) => acc + t.baseUnitCost, 0)
  );
  const totalMoldsCost = roundProjectMoney(
    sources.filter((s) => s.sourceType === "MOLD").reduce((acc, s) => acc + s.totalCost, 0)
  );
  const totalOtherCosts = roundProjectMoney(
    sources.filter((s) => s.sourceType === "OTHER_COST").reduce((acc, s) => acc + s.totalCost, 0)
  );
  const totalPassThroughAmount = roundProjectMoney(
    amortizations.reduce((acc, a) => acc + a.passThroughAmount, 0)
  );
  const totalAbsorbedAmount = roundProjectMoney(
    amortizations.reduce((acc, a) => acc + a.absorbedAmount, 0)
  );
  const totalAmortizationAllocated = roundProjectMoney(
    amortizations.reduce((acc, a) => acc + a.allocatedAmountTotal, 0)
  );
  const finalItemsUnitCostWithAmortization = roundProjectMoney(
    Array.from(itemRollupMap.values()).reduce((acc, row) => acc + row.finalUnitCost, 0)
  );

  const alerts: string[] = [];
  for (const amort of amortizations) {
    if (amort.status === "NOT_CONFIGURED") {
      alerts.push(`${amort.sourceDescriptionSnapshot}: amortização não configurada.`);
    } else if (amort.status === "INCOMPLETE") {
      alerts.push(`${amort.sourceDescriptionSnapshot}: distribuição incompleta.`);
    } else if (amort.status === "EXCESS") {
      alerts.push(`${amort.sourceDescriptionSnapshot}: distribuição excedente.`);
    } else if (amort.status === "NO_ELIGIBLE_ITEMS") {
      alerts.push(`${amort.sourceDescriptionSnapshot}: sem itens elegíveis no projeto.`);
    }
  }

  return {
    baseItemsUnitCost,
    totalMoldsCost,
    totalOtherCosts,
    totalPassThroughAmount,
    totalAbsorbedAmount,
    totalAmortizationAllocated,
    finalItemsUnitCostWithAmortization,
    itemRollups: Array.from(itemRollupMap.values()),
    amortizations,
    alerts,
  };
}

export function amortizationStatusLabel(status: ProjectCostAmortizationStatus): string {
  switch (status) {
    case "NOT_CONFIGURED":
      return "Não configurado";
    case "INCOMPLETE":
      return "Distribuição incompleta";
    case "EXCESS":
      return "Distribuição excedente";
    case "DISTRIBUTED":
      return "Distribuído 100%";
    case "NO_ELIGIBLE_ITEMS":
      return "Sem itens elegíveis";
    default:
      return status;
  }
}

export function amortizationMetricsAreFinite(summary: ProjectCostAmortizationSummary): boolean {
  const nums = [
    summary.baseItemsUnitCost,
    summary.totalMoldsCost,
    summary.totalOtherCosts,
    summary.totalPassThroughAmount,
    summary.totalAbsorbedAmount,
    summary.totalAmortizationAllocated,
    summary.finalItemsUnitCostWithAmortization,
  ];
  if (!nums.every((n) => Number.isFinite(n))) return false;
  for (const amort of summary.amortizations) {
    for (const v of [
      amort.passThroughAmount,
      amort.absorbedAmount,
      amort.allocatedAmountTotal,
      amort.unallocatedAmount,
    ]) {
      if (!Number.isFinite(v)) return false;
    }
    for (const row of amort.allocations) {
      for (const v of [row.allocatedAmount, row.unitAmortizedCost, row.finalUnitCost]) {
        if (!Number.isFinite(v)) return false;
      }
    }
  }
  return true;
}
