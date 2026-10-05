import type { NewProductSimulationSnapshot } from "@/src/lib/newProductSimulationSnapshot";

export const GUIDED_ORIGIN_SIMULATION_MARKER = "guided-origin:SIMULATION";
export const GUIDED_SIMULATION_ID_PREFIX = "guided-simulation-id:";

export function buildSimulationRefNotes(simulationId: string, existingNotes?: string | null): string {
  const idMarker = `${GUIDED_SIMULATION_ID_PREFIX}${simulationId}`;
  const parts = [GUIDED_ORIGIN_SIMULATION_MARKER, idMarker];
  const base = existingNotes?.trim();
  if (base && !base.includes(idMarker)) {
    return `${base}\n${parts.join("\n")}`;
  }
  if (base?.includes(idMarker)) return base;
  return parts.join("\n");
}

export function parseSimulationIdFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const idx = notes.indexOf(GUIDED_SIMULATION_ID_PREFIX);
  if (idx < 0) return null;
  const id = notes.slice(idx + GUIDED_SIMULATION_ID_PREFIX.length, idx + GUIDED_SIMULATION_ID_PREFIX.length + 36);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export function isGuidedSimulationItem(notes: string | null | undefined): boolean {
  return notes?.includes(GUIDED_ORIGIN_SIMULATION_MARKER) === true;
}

/** Custo industrial da simulação salva (não recalcula no projeto). */
export function resolveSimulationSnapshotUnitCost(snapshot: unknown): number | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const result = (snapshot as NewProductSimulationSnapshot).result;
  const costBase = result?.costBase;
  if (typeof costBase !== "number" || !Number.isFinite(costBase)) return null;
  return costBase;
}

/** Hash do snapshot congelado: o gravado pelo servidor (v2) ou null em snapshots legados. */
export function resolveSimulationSnapshotHash(simulation: { snapshotHash?: string | null }): string | null {
  const hash = simulation.snapshotHash;
  return typeof hash === "string" && hash.trim() ? hash.trim() : null;
}

export type ProjectSimulationProvenance = {
  sourceSimulationId: string;
  sourceSimulationName: string;
  sourceSimulationSnapshotHash: string | null;
  sourceSimulationCostBase: number;
  sourceSimulationCopiedAt: Date;
};

/**
 * Origem do custo copiado de uma simulação congelada. É CÓPIA: mudanças posteriores na
 * simulação (clone, arquivamento) não alteram o item do projeto.
 */
export function buildProjectSimulationProvenance(
  simulation: { id: string; name: string; snapshotHash?: string | null },
  costBase: number,
  copiedAt: Date
): ProjectSimulationProvenance {
  return {
    sourceSimulationId: simulation.id,
    sourceSimulationName: simulation.name,
    sourceSimulationSnapshotHash: resolveSimulationSnapshotHash(simulation),
    sourceSimulationCostBase: costBase,
    sourceSimulationCopiedAt: copiedAt,
  };
}

/** Item veio de simulação? Coluna de origem (novo) ou marcador em notes (legado). */
export function isSimulationOriginItem(item: {
  sourceSimulationId?: string | null;
  notes?: string | null;
}): boolean {
  return Boolean(item.sourceSimulationId) || isGuidedSimulationItem(item.notes);
}

/** Edição de notes não pode apagar o marcador de origem de um item vindo de simulação. */
export function preserveSimulationRefNotes(
  previousNotes: string | null | undefined,
  nextNotes: string | null | undefined,
  sourceSimulationId?: string | null
): string | null {
  const simulationId = sourceSimulationId ?? parseSimulationIdFromNotes(previousNotes);
  if (!simulationId) return nextNotes ?? null;
  return buildSimulationRefNotes(simulationId, nextNotes);
}

/** Texto curto de origem para a lista de itens do projeto. */
export function describeSimulationOrigin(item: {
  sourceSimulationName?: string | null;
  sourceSimulationCopiedAt?: string | Date | null;
}): string | null {
  const name = item.sourceSimulationName?.trim();
  if (!name) return null;
  const copiedAt = item.sourceSimulationCopiedAt ? new Date(item.sourceSimulationCopiedAt) : null;
  const date =
    copiedAt && !Number.isNaN(copiedAt.getTime()) ? copiedAt.toISOString().slice(0, 10) : null;
  return date ? `${name} · snapshot ${date}` : name;
}
