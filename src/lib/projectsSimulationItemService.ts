import { prisma } from "@/src/lib/prisma";
import { persistedStatusFromApiRecord } from "@/src/lib/newProductSimulationSnapshot";
import {
  buildSimulationLookupPrismaWhere,
  filterAndSerializeSimulationLookupRows,
  type ProjectSimulationLookupRow,
} from "@/src/lib/projectsSimulationLookup";
import {
  buildProjectSimulationProvenance,
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

export type AddSimulationReferenceDeps = {
  /** Injetável em testes; default = cliente Prisma do processo. */
  db?: Pick<typeof prisma, "newProductSimulation" | "projectSimulatedItem">;
  recalculateVersionCosts?: (versionId: string) => Promise<unknown>;
  now?: () => Date;
};

/**
 * Simulação congelada → item do projeto. O projeto COPIA `snapshot.result.costBase` e a
 * origem (id, nome, hash, data); não há referência viva nem recálculo posterior, e o item
 * nunca vira oficial sozinho (`canBecomeOfficial: false`).
 */
export async function addSimulationReferenceToProject(
  input: {
    projectId: string;
    versionId: string;
    simulationId: string;
    quantity?: number;
  },
  deps: AddSimulationReferenceDeps = {}
): Promise<ReturnType<typeof serializeSimulatedItem>> {
  const db = deps.db ?? prisma;
  const recalculate = deps.recalculateVersionCosts ?? recalculateAndPersistVersionCosts;
  const simulation = await db.newProductSimulation.findUnique({
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

  const existing = await db.projectSimulatedItem.findFirst({
    where: {
      projectId: input.projectId,
      versionId: input.versionId,
      OR: [
        { sourceSimulationId: input.simulationId },
        { notes: { contains: `${GUIDED_SIMULATION_ID_PREFIX}${input.simulationId}` } },
      ],
    },
  });
  if (existing) {
    throw new Error("Esta simulação já foi adicionada ao projeto.");
  }

  const row = await db.projectSimulatedItem.create({
    data: {
      ...buildProjectSimulationProvenance(simulation, unitCost, deps.now ? deps.now() : new Date()),
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

  await recalculate(input.versionId);
  return serializeSimulatedItem(row);
}

export {
  isGuidedSimulationItem,
  parseSimulationIdFromNotes,
  resolveSimulationSnapshotUnitCost,
};
