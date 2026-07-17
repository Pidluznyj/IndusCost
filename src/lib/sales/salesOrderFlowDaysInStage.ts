/**
 * OP-55 — daysInCurrentStage em leitura (sem regravar snapshots diariamente).
 */

/**
 * Dias corridos na etapa atual a partir de `stageEnteredAt`.
 * Retorna null se não houver entrada registrada.
 * Usa floor de milissegundos / 86400000 (dia civil UTC aproximado).
 */
export function calculateDaysInCurrentStage(
  stageEnteredAt: Date | string | null | undefined,
  now: Date | string = new Date()
): number | null {
  if (stageEnteredAt == null || stageEnteredAt === "") return null;
  const entered =
    stageEnteredAt instanceof Date ? stageEnteredAt : new Date(stageEnteredAt);
  const reference = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(entered.getTime()) || Number.isNaN(reference.getTime())) {
    return null;
  }
  const ms = reference.getTime() - entered.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}

export type DaysInCurrentStageSnapshot = {
  stageEnteredAt: Date | string | null;
  currentStage: string;
};

/**
 * Anexa `daysInCurrentStage` a um snapshot (item ou pedido) sem persistir.
 */
export function withDaysInCurrentStage<T extends DaysInCurrentStageSnapshot>(
  snapshot: T,
  now: Date | string = new Date()
): T & { daysInCurrentStage: number | null } {
  return {
    ...snapshot,
    daysInCurrentStage: calculateDaysInCurrentStage(snapshot.stageEnteredAt, now),
  };
}
