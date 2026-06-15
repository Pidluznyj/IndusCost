import type {
  ProjectCostAmortizationAllocation,
  ProjectCostAmortization as PrismaAmortization,
  ProjectCostAmortizationSourceType as PrismaSourceType,
  ProjectCostAmortizationStatus as PrismaStatus,
  ProjectCostAmortizationTargetType as PrismaTargetType,
} from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { ProjectDetail } from "@/src/types/projects.js";
import {
  buildProjectAmortizationTargets,
  buildProjectCostAmortizationSummary,
  computeAmortizationConfig,
  resolveAmortizationDistributionStatus,
  validateAmortizationSourceRef,
  type ProjectCostAmortizationAllocationInput,
  type ProjectCostAmortizationConfigInput,
  type ProjectCostAmortizationRow,
  type ProjectCostAmortizationSourceType,
  type ProjectCostAmortizationStatus,
  type ProjectCostAmortizationTargetType,
} from "./projectsCostAmortization.js";

function dec(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "object" && value !== null && "toNumber" in value
    ? (value as { toNumber: () => number }).toNumber()
    : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export type UpsertProjectCostAmortizationPayload = {
  sourceType: ProjectCostAmortizationSourceType;
  sourceId: string;
  sourceBatchId?: string | null;
  passThroughPercent: number;
  allocations: Array<{
    targetItemType: ProjectCostAmortizationTargetType;
    targetItemId: string;
    targetSnapshotRootProductId?: string | null;
    allocationPercent: number;
    amortizationQuantity: number;
  }>;
};

export function serializeCostAmortizationRow(
  row: PrismaAmortization & { allocations: ProjectCostAmortizationAllocation[] }
): ProjectCostAmortizationRow {
  const allocations = row.allocations.map((a) => ({
    targetItemId: a.targetItemId,
    targetItemType: a.targetItemType as ProjectCostAmortizationTargetType,
    targetSnapshotRootProductId: a.targetSnapshotRootProductId,
    targetDescriptionSnapshot: a.targetDescriptionSnapshot,
    targetBaseUnitCostSnapshot: dec(a.targetBaseUnitCostSnapshot),
    allocationPercent: dec(a.allocationPercent),
    amortizationQuantity: dec(a.amortizationQuantity),
    allocatedAmount: dec(a.allocatedAmount),
    unitAmortizedCost: dec(a.unitAmortizedCost),
    finalUnitCost: dec(a.finalUnitCostSnapshot),
  }));
  const distributionPercentTotal = allocations.reduce((acc, a) => acc + a.allocationPercent, 0);
  const allocatedAmountTotal = allocations.reduce((acc, a) => acc + a.allocatedAmount, 0);
  const passThroughAmount = dec(row.passThroughAmount);
  return {
    id: row.id,
    projectId: row.projectId,
    sourceType: row.sourceType as ProjectCostAmortizationSourceType,
    sourceId: row.sourceId,
    sourceDescriptionSnapshot: row.sourceDescriptionSnapshot,
    sourceTotalCostSnapshot: dec(row.sourceTotalCostSnapshot),
    passThroughPercent: dec(row.passThroughPercent),
    passThroughAmount,
    absorbedAmount: dec(row.absorbedAmount),
    status: row.status as ProjectCostAmortizationStatus,
    allocations,
    distributionPercentTotal,
    distributionBalancePercent: 100 - distributionPercentTotal,
    allocatedAmountTotal,
    unallocatedAmount: passThroughAmount - allocatedAmountTotal,
  };
}

export async function loadProjectCostAmortizations(
  projectId: string
): Promise<ProjectCostAmortizationRow[]> {
  const rows = await prisma.projectCostAmortization.findMany({
    where: { projectId },
    include: { allocations: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(serializeCostAmortizationRow);
}

export function validateUpsertAmortizationPayload(
  detail: ProjectDetail,
  payload: UpsertProjectCostAmortizationPayload
): { ok: true; config: ProjectCostAmortizationConfigInput } | { ok: false; error: string } {
  const sourceRef = validateAmortizationSourceRef(detail, payload.sourceType, payload.sourceId);
  if (sourceRef.ok === false) {
    return { ok: false, error: sourceRef.error };
  }
  const source = sourceRef.source;

  if (payload.passThroughPercent < 0 || payload.passThroughPercent > 100) {
    return { ok: false, error: "Percentual repassado deve estar entre 0% e 100%." };
  }

  const targets = buildProjectAmortizationTargets(detail);
  const targetById = new Map(targets.map((t) => [t.targetItemId, t]));
  if (targets.length === 0) {
    return { ok: false, error: "Projeto não possui itens elegíveis para amortização." };
  }

  const totalPercent = payload.allocations.reduce((acc, a) => acc + a.allocationPercent, 0);
  if (totalPercent > 100.0001) {
    return { ok: false, error: "Distribuição excede 100%." };
  }

  const allocations: ProjectCostAmortizationAllocationInput[] = [];
  for (const row of payload.allocations) {
    if (row.allocationPercent <= 0) continue;
    const target = targetById.get(row.targetItemId);
    if (!target) {
      return { ok: false, error: `Item "${row.targetItemId}" não é elegível para amortização.` };
    }
    if (!Number.isFinite(row.amortizationQuantity) || row.amortizationQuantity <= 0) {
      return {
        ok: false,
        error: `Quantidade de amortização inválida para "${target.displayName}".`,
      };
    }
    allocations.push({
      targetItemId: row.targetItemId,
      targetItemType: row.targetItemType,
      targetSnapshotRootProductId: row.targetSnapshotRootProductId ?? target.snapshotRootProductId ?? null,
      targetDescriptionSnapshot: target.displayName,
      targetBaseUnitCostSnapshot: target.baseUnitCost,
      allocationPercent: row.allocationPercent,
      amortizationQuantity: row.amortizationQuantity,
    });
  }

  return {
    ok: true,
    config: {
      sourceType: payload.sourceType,
      sourceId: payload.sourceId,
      sourceDescriptionSnapshot: source.description,
      sourceTotalCostSnapshot: source.totalCost,
      passThroughPercent: payload.passThroughPercent,
      allocations,
    },
  };
}

export async function upsertProjectCostAmortization(
  projectId: string,
  detail: ProjectDetail,
  payload: UpsertProjectCostAmortizationPayload
) {
  const validated = validateUpsertAmortizationPayload(detail, payload);
  if (validated.ok === false) {
    throw new Error(validated.error);
  }

  const targets = buildProjectAmortizationTargets(detail);
  const computed = computeAmortizationConfig(validated.config, targets);

  const status = resolveAmortizationDistributionStatus(
    computed.allocations.map((a) => a.allocationPercent),
    targets.length > 0,
    true
  ) as PrismaStatus;

  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.projectCostAmortization.findUnique({
      where: {
        projectId_sourceType_sourceId: {
          projectId,
          sourceType: payload.sourceType as PrismaSourceType,
          sourceId: payload.sourceId,
        },
      },
    });

    const baseData = {
      sourceBatchId:
        payload.sourceBatchId ??
        (payload.sourceType === "OTHER_COST" ? payload.sourceId : null),
      sourceDescriptionSnapshot: computed.sourceDescriptionSnapshot,
      sourceTotalCostSnapshot: computed.sourceTotalCostSnapshot,
      passThroughPercent: computed.passThroughPercent,
      passThroughAmount: computed.passThroughAmount,
      absorbedAmount: computed.absorbedAmount,
      status,
    };

    const amortization = existing
      ? await tx.projectCostAmortization.update({
          where: { id: existing.id },
          data: baseData,
        })
      : await tx.projectCostAmortization.create({
          data: {
            projectId,
            sourceType: payload.sourceType as PrismaSourceType,
            sourceId: payload.sourceId,
            ...baseData,
          },
        });

    await tx.projectCostAmortizationAllocation.deleteMany({
      where: { amortizationId: amortization.id },
    });

    if (computed.allocations.length > 0) {
      await tx.projectCostAmortizationAllocation.createMany({
        data: computed.allocations.map((a) => ({
          amortizationId: amortization.id,
          projectId,
          targetItemType: a.targetItemType as PrismaTargetType,
          targetItemId: a.targetItemId,
          targetSnapshotRootProductId: a.targetSnapshotRootProductId ?? null,
          targetDescriptionSnapshot: a.targetDescriptionSnapshot,
          targetBaseUnitCostSnapshot: a.targetBaseUnitCostSnapshot,
          allocationPercent: a.allocationPercent,
          allocatedAmount: a.allocatedAmount,
          amortizationQuantity: a.amortizationQuantity,
          unitAmortizedCost: a.unitAmortizedCost,
          finalUnitCostSnapshot: a.finalUnitCost,
        })),
      });
    }

    return tx.projectCostAmortization.findUniqueOrThrow({
      where: { id: amortization.id },
      include: { allocations: { orderBy: { createdAt: "asc" } } },
    });
  });

  const saved = serializeCostAmortizationRow(row);
  const allSaved = await loadProjectCostAmortizations(projectId);
  const summary = buildProjectCostAmortizationSummary(detail, allSaved);

  return { amortization: saved, summary, projectCostSummary: summary };
}

export async function deleteProjectCostAmortizationBySource(
  projectId: string,
  sourceType: ProjectCostAmortizationSourceType,
  sourceId: string
) {
  await prisma.projectCostAmortization.deleteMany({
    where: { projectId, sourceType: sourceType as PrismaSourceType, sourceId },
  });
}

export async function removeAmortizationAllocationsForTargetItem(
  projectId: string,
  targetItemId: string
) {
  const amortizations = await prisma.projectCostAmortization.findMany({
    where: { projectId },
    include: { allocations: true },
  });

  for (const amort of amortizations) {
    const remaining = amort.allocations.filter((a) => a.targetItemId !== targetItemId);
    if (remaining.length === amort.allocations.length) continue;

    await prisma.projectCostAmortizationAllocation.deleteMany({
      where: { amortizationId: amort.id, targetItemId },
    });

    const totalPercent = remaining.reduce((acc, a) => acc + dec(a.allocationPercent), 0);
    const status = resolveAmortizationDistributionStatus(
      remaining.map((a) => dec(a.allocationPercent)),
      true,
      true
    ) as PrismaStatus;

    await prisma.projectCostAmortization.update({
      where: { id: amort.id },
      data: { status },
    });
  }
}

export function enrichProjectDetailWithAmortization(
  detail: ProjectDetail,
  saved: ProjectCostAmortizationRow[]
): ProjectDetail {
  const costAmortizationSummary = buildProjectCostAmortizationSummary(detail, saved);
  return {
    ...detail,
    costAmortizations: saved,
    costAmortizationSummary,
  };
}
