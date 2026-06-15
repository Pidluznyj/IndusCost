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
