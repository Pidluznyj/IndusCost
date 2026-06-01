/**
 * Snapshot atual do NomusBomComponentStage — filtra linhas stale entre syncs.
 * Sem migration: usa runId + syncedAt existentes.
 */
import { normalizeSku } from "@/src/lib/nomusBomComparison";
import { prisma } from "@/src/lib/prisma";

export type StageSnapshotRow = {
  runId: string | null;
  syncedAt: Date;
};

export type ParentStageSnapshotMeta = {
  latestRunId: string | null;
  maxSyncedAt: Date | null;
};

/** Linhas do parent que pertencem ao snapshot atual (último runId / syncedAt do parent). */
export function filterStageRowsToCurrentParentSnapshot<T extends StageSnapshotRow>(
  rows: T[],
  meta: ParentStageSnapshotMeta
): T[] {
  if (rows.length === 0) return rows;

  const { latestRunId, maxSyncedAt } = meta;

  if (latestRunId) {
    const byRun = rows.filter((r) => r.runId === latestRunId);
    if (byRun.length > 0) return byRun;
  }

  if (maxSyncedAt) {
    const anchorMs = maxSyncedAt.getTime();
    const bySync = rows.filter((r) => r.syncedAt.getTime() >= anchorMs);
    if (bySync.length > 0) return bySync;
  }

  // Legado: sem metadados de snapshot — mantém comportamento anterior.
  return rows;
}

export async function getParentStageSnapshotMeta(parentCode: string): Promise<ParentStageSnapshotMeta> {
  const trimmed = parentCode.trim();
  const normalized = normalizeSku(trimmed);

  const agg = await prisma.nomusBomComponentStage.aggregate({
    where: {
      OR: [{ parentCode: trimmed }, { parentCode: normalized }],
    },
    _max: { syncedAt: true },
  });

  const maxSyncedAt = agg._max.syncedAt ?? null;
  if (!maxSyncedAt) {
    return { latestRunId: null, maxSyncedAt: null };
  }

  const anchor = await prisma.nomusBomComponentStage.findFirst({
    where: {
      OR: [{ parentCode: trimmed }, { parentCode: normalized }],
      syncedAt: maxSyncedAt,
    },
    orderBy: { externalLineId: "asc" },
    select: { runId: true },
  });

  return {
    latestRunId: anchor?.runId ?? null,
    maxSyncedAt,
  };
}
