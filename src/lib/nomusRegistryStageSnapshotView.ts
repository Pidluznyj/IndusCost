import { prisma } from "@/src/lib/prisma";
import { normalizeSku } from "@/src/lib/nomusBomComparison";
import {
  filterStageRowsToCurrentParentSnapshot,
  getParentStageSnapshotMeta,
  type ParentStageSnapshotMeta,
  type StageSnapshotRow,
} from "@/src/lib/nomusBomComponentStageSnapshot";
import { componentCodeMatchesBasePrefix } from "@/src/lib/nomusComponentRegistryConflictShared";

export type NomusStageLineView = {
  componentCode: string;
  componentDescription: string | null;
  quantity: number | null;
};

export type HistoricalNomusStageLineView = NomusStageLineView & {
  syncedAt: string;
  runId: string | null;
  note: string;
};

export type ParentNomusStageSnapshotView = {
  parentCode: string;
  latestSyncedAt: string | null;
  latestRunId: string | null;
  /** Linhas do snapshot efetivo atual (mesmo critério do apply / loadNomusStageLinesForParent). */
  effectiveLines: NomusStageLineView[];
  /** Linhas do mesmo código em syncs anteriores — apenas diagnóstico. */
  historicalLines: HistoricalNomusStageLineView[];
};

export const HISTORICAL_NOMUS_STAGE_NOTE =
  "Existiu em snapshot Nomus antigo; não faz parte da BOM Nomus efetiva atual deste produto.";

type StageRowInput = StageSnapshotRow & {
  externalLineId: number;
  componentCode: string;
  componentDescription: string | null;
  qtdeNecessaria: unknown;
};

function toQuantity(qtde: unknown): number | null {
  if (qtde == null) return null;
  const n = Number(qtde.toString());
  return Number.isFinite(n) ? n : null;
}

function toLineView(row: {
  componentCode: string;
  componentDescription: string | null;
  qtdeNecessaria: unknown;
}): NomusStageLineView {
  return {
    componentCode: row.componentCode,
    componentDescription: row.componentDescription,
    quantity: toQuantity(row.qtdeNecessaria),
  };
}

/**
 * Separa linhas do stage em efetivas (snapshot atual) vs históricas.
 * Mesma ordem do apply: filtra snapshot do pai inteiro, depois restringe por prefixo de código.
 */
export function splitParentStageRowsByEffectiveSnapshot(
  allRows: StageRowInput[],
  meta: ParentStageSnapshotMeta,
  codeBase: string
): { effective: StageRowInput[]; historical: StageRowInput[] } {
  const currentSnapshot = filterStageRowsToCurrentParentSnapshot(allRows, meta);
  const currentIds = new Set(currentSnapshot.map((r) => r.externalLineId));
  const effective = currentSnapshot.filter((r) =>
    componentCodeMatchesBasePrefix(codeBase, r.componentCode)
  );
  const historical = allRows.filter(
    (r) =>
      componentCodeMatchesBasePrefix(codeBase, r.componentCode) &&
      !currentIds.has(r.externalLineId)
  );
  return { effective, historical };
}

export async function loadParentNomusStageSnapshotForCode(input: {
  parentCode: string;
  codeBase: string;
}): Promise<ParentNomusStageSnapshotView> {
  const trimmed = input.parentCode.trim();
  const normalized = normalizeSku(trimmed);

  const [allRows, meta] = await Promise.all([
    prisma.nomusBomComponentStage.findMany({
      where: {
        OR: [{ parentCode: trimmed }, { parentCode: normalized }],
      },
      select: {
        externalLineId: true,
        componentCode: true,
        componentDescription: true,
        qtdeNecessaria: true,
        runId: true,
        syncedAt: true,
      },
      orderBy: [{ syncedAt: "desc" }, { componentCode: "asc" }],
    }),
    getParentStageSnapshotMeta(trimmed),
  ]);

  const { effective, historical } = splitParentStageRowsByEffectiveSnapshot(
    allRows,
    meta,
    input.codeBase
  );

  const historicalByCode = new Map<string, StageRowInput>();
  for (const row of historical) {
    const key = `${row.componentCode}::${row.syncedAt.toISOString()}`;
    if (!historicalByCode.has(key)) historicalByCode.set(key, row);
  }

  return {
    parentCode: normalized,
    latestSyncedAt: meta.maxSyncedAt?.toISOString() ?? null,
    latestRunId: meta.latestRunId,
    effectiveLines: effective.map(toLineView),
    historicalLines: [...historicalByCode.values()].map((row) => ({
      ...toLineView(row),
      syncedAt: row.syncedAt.toISOString(),
      runId: row.runId,
      note: HISTORICAL_NOMUS_STAGE_NOTE,
    })),
  };
}

/** Códigos Nomus efetivos (snapshot atual) para um pai — base de recriação pós-limpeza. */
export async function loadEffectiveNomusComponentCodesForParent(
  parentCode: string,
  codeBase: string
): Promise<string[]> {
  const view = await loadParentNomusStageSnapshotForCode({ parentCode, codeBase });
  return [...new Set(view.effectiveLines.map((l) => l.componentCode))];
}

export type EffectiveNomusStageSummaryRow = {
  parentCode: string;
  componentCode: string;
  componentDescription: string | null;
  quantity: number | null;
  latestSyncedAt: string | null;
  latestRunId: string | null;
};

/** Linhas do snapshot efetivo atual, agrupadas por pai (diagnóstico global ou filtrado). */
export async function loadEffectiveNomusStageSummaryByCode(
  codeBase: string,
  options?: { parentCode?: string | null }
): Promise<EffectiveNomusStageSummaryRow[]> {
  const likeCore = codeBase.trim().replace(/%+$/g, "");
  const parentFilter = options?.parentCode?.trim();
  const rows = await prisma.nomusBomComponentStage.findMany({
    where: {
      componentCode: { startsWith: likeCore, mode: "insensitive" },
      ...(parentFilter
        ? {
            parentCode: {
              in: [parentFilter, normalizeSku(parentFilter)],
            },
          }
        : {}),
    },
    select: {
      parentCode: true,
      externalLineId: true,
      componentCode: true,
      componentDescription: true,
      qtdeNecessaria: true,
      runId: true,
      syncedAt: true,
    },
  });

  const byParent = new Map<string, StageRowInput[]>();
  for (const row of rows) {
    const pKey = normalizeSku(row.parentCode);
    const list = byParent.get(pKey) ?? [];
    list.push(row);
    byParent.set(pKey, list);
  }

  const out: EffectiveNomusStageSummaryRow[] = [];
  for (const [pKey, pRows] of byParent) {
    const meta = await getParentStageSnapshotMeta(pKey);
    const { effective } = splitParentStageRowsByEffectiveSnapshot(pRows, meta, codeBase);
    const latestSyncedAt = meta.maxSyncedAt?.toISOString() ?? null;
    for (const row of effective) {
      out.push({
        parentCode: pKey,
        componentCode: row.componentCode,
        componentDescription: row.componentDescription,
        quantity: toQuantity(row.qtdeNecessaria),
        latestSyncedAt,
        latestRunId: meta.latestRunId,
      });
    }
  }
  return out.sort((a, b) =>
    a.parentCode.localeCompare(b.parentCode, "pt-BR") ||
    a.componentCode.localeCompare(b.componentCode, "pt-BR")
  );
}

/** Mapa pai → códigos efetivos (snapshot atual por pai). */
export async function loadEffectiveNomusCodesByParent(
  codeBase: string,
  parentCodes: string[]
): Promise<Map<string, string[]>> {
  const byParent = new Map<string, string[]>();
  const unique = [...new Set(parentCodes.map((p) => normalizeSku(p)).filter(Boolean))];
  for (const parentKey of unique) {
    const codes = await loadEffectiveNomusComponentCodesForParent(parentKey, codeBase);
    if (codes.length > 0) byParent.set(parentKey, codes);
  }
  return byParent;
}
