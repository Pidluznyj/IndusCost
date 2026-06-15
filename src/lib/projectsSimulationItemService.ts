import { prisma } from "@/src/lib/prisma";
import {
  buildSimulationRefNotes,
  GUIDED_SIMULATION_ID_PREFIX,
  isGuidedSimulationItem,
  parseSimulationIdFromNotes,
  resolveSimulationSnapshotUnitCost,
} from "@/src/lib/projectsSimulationRefs";
import { recalculateAndPersistVersionCosts, serializeSimulatedItem } from "@/src/lib/projectsService";

export type ProjectSimulationLookupRow = {
  id: string;
  name: string;
  productName: string;
  productSku: string | null;
  status: string;
  savedAt: string | null;
  unitCost: number | null;
};

export async function lookupProjectSimulations(query: string): Promise<ProjectSimulationLookupRow[]> {
  const q = query.trim();
  const rows = await prisma.newProductSimulation.findMany({
    where: {
      status: "SAVED",
      ...(q.length >= 2
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { productName: { contains: q, mode: "insensitive" } },
              { productSku: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { savedAt: "desc" },
    take: 30,
    select: {
      id: true,
      name: true,
      productName: true,
      productSku: true,
      status: true,
      savedAt: true,
      snapshot: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    productName: row.productName,
    productSku: row.productSku,
    status: row.status,
    savedAt: row.savedAt?.toISOString() ?? null,
    unitCost: resolveSimulationSnapshotUnitCost(row.snapshot),
  }));
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
  if (!simulation || simulation.status !== "SAVED") {
    throw new Error("Simulação não encontrada ou não está salva.");
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
