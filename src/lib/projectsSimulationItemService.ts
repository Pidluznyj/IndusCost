import { prisma } from "@/src/lib/prisma";
import { persistedStatusFromApiRecord } from "@/src/lib/newProductSimulationSnapshot";
import {
  buildSimulationLookupPrismaWhere,
  filterAndSerializeSimulationLookupRows,
  type ProjectSimulationLookupRow,
} from "@/src/lib/projectsSimulationLookup";
import {
  buildSimulationRefNotes,
  GUIDED_SIMULATION_ID_PREFIX,
  isGuidedSimulationItem,
  parseSimulationIdFromNotes,
  resolveSimulationSnapshotUnitCost,
} from "@/src/lib/projectsSimulationRefs";
import { recalculateAndPersistVersionCosts, serializeSimulatedItem } from "@/src/lib/projectsService";

export type { ProjectSimulationLookupRow };

const SIMULATION_LOOKUP_TAKE = 100;

export async function lookupProjectSimulations(query: string): Promise<ProjectSimulationLookupRow[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const rows = await prisma.newProductSimulation.findMany({
    where: buildSimulationLookupPrismaWhere(q),
    orderBy: [{ savedAt: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
    take: SIMULATION_LOOKUP_TAKE,
    select: {
      id: true,
      name: true,
      productName: true,
      productSku: true,
      status: true,
      notes: true,
      savedAt: true,
      createdAt: true,
      updatedAt: true,
      snapshot: true,
    },
  });

  return filterAndSerializeSimulationLookupRows(rows, q);
}

export async function addSimulationReferenceToProject(input: {
  projectId: string;
  versionId: string;
  simulationId: string;
  quantity?: number;
}): Promise<ReturnType<typeof serializeSimulatedItem>> {
  const simulation = await prisma.newProductSimulation.findUnique({
    where: { id: input.simulationId },
  });
  if (!simulation) {
    throw new Error("Simulação não encontrada.");
  }

  const effectiveStatus = persistedStatusFromApiRecord(simulation);
  if (effectiveStatus !== "SAVED") {
    throw new Error(
      "Somente simulações salvas podem ser adicionadas ao projeto. Salve o snapshot em Simulações antes de continuar."
    );
  }

  const unitCost = resolveSimulationSnapshotUnitCost(simulation.snapshot);
  if (unitCost == null) {
    throw new Error("Simulação sem custo industrial calculado.");
  }

  const existing = await prisma.projectSimulatedItem.findFirst({
    where: {
      projectId: input.projectId,
      versionId: input.versionId,
      notes: { contains: `${GUIDED_SIMULATION_ID_PREFIX}${input.simulationId}` },
    },
  });
  if (existing) {
    throw new Error("Esta simulação já foi adicionada ao projeto.");
  }

  const row = await prisma.projectSimulatedItem.create({
    data: {
      projectId: input.projectId,
      versionId: input.versionId,
      provisionalCode: simulation.productSku,
      description: simulation.productName,
      itemType: "FINISHED_PRODUCT",
      unit: "UN",
      estimatedUnitCost: unitCost,
      quotedUnitCost: unitCost,
      requiresQuotation: false,
      requiresEngineeringReview: false,
      canBecomeOfficial: false,
      notes: buildSimulationRefNotes(simulation.id),
    },
  });

  await recalculateAndPersistVersionCosts(input.versionId);
  return serializeSimulatedItem(row);
}

export {
  isGuidedSimulationItem,
  parseSimulationIdFromNotes,
  resolveSimulationSnapshotUnitCost,
};
