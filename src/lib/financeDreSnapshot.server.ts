/**
 * Snapshot anual materializado da DRE Gerencial — lado servidor.
 *
 * A DRE ao vivo roda motores caros (todas as NF-e do ano com payload bruto p/
 * CMV, dashboard AP completo) a cada GET — e 4× quando company=all. Aqui as
 * SÉRIES BRUTAS por (year, company) são materializadas em
 * `FinanceDreAnnualSnapshot` e o relatório é remontado pelo MESMO motor puro
 * (`financeDreReportBuilder`) em milissegundos, para qualquer mês/YTD.
 *
 * Invariantes:
 * - snapshot é projeção/cache — nunca fonte da verdade;
 * - publicação atômica em transação CURTA (todo cômputo pesado fora dela);
 * - erro de refresh preserva o snapshot anterior e registra lastRefreshError;
 * - `dirtyGeneration`: markDirty durante um refresh nunca é perdido — o
 *   refresh só limpa dirty se a geração não avançou desde o início;
 * - claim otimista por linha evita dois refreshs concorrentes da mesma chave;
 * - `availableThroughMonth` e o roleMap de CC são SEMPRE read-time.
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import {
  buildFinanceDreReportFromRawSources,
  FINANCE_DRE_LEGAL_ENTITY_COMPANIES,
  type FinanceDreRawSourceSeries,
} from "@/src/lib/financeDreReportBuilder.js";
import {
  loadFinanceDreRawSourceSeries,
  parseFinanceDreQuery,
} from "@/src/lib/financeDreService.server.js";
import { loadDreCostCenterRoleMap } from "@/src/lib/financeDreCostCenterMapping.server.js";
import { resolveFinanceDreAvailableThroughMonth } from "@/src/lib/financeDreMath.js";
import {
  FINANCE_DRE_SNAPSHOT_SCHEMA_VERSION,
  parseFinanceDreSnapshotSeriesPayload,
  serializeFinanceDreSnapshotSeriesPayload,
  type FinanceDreReportSnapshotMeta,
} from "@/src/lib/financeDreSnapshotTypes.js";
import type { DreCostCenterRole } from "@/src/lib/financeDreCostCenterRoles.js";
import type { FinanceDreCompany, FinanceDreReport } from "@/src/lib/financeDreTypes.js";

const LOG_PREFIX = "[dre-snapshot]";
/** Claim expira após 10 min — refresh interrompido nunca deixa a chave presa. */
export const FINANCE_DRE_SNAPSHOT_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

export type FinanceDreSnapshotDb = Pick<PrismaClient, "financeDreAnnualSnapshot" | "$transaction">;

type SnapshotRow = {
  year: number;
  company: string;
  schemaVersion: number;
  seriesJson: Prisma.JsonValue | null;
  computedAt: Date | null;
  computeDurationMs: number | null;
  dirtyAt: Date | null;
  dirtyReason: string | null;
  dirtyGeneration: number;
  refreshClaimedAt: Date | null;
  refreshClaimToken: string | null;
  lastRefreshError: string | null;
};

export type FinanceDreSnapshotComputeRaw = (
  year: number,
  company: FinanceDreCompany,
  referenceNow: Date
) => Promise<FinanceDreRawSourceSeries>;

export type FinanceDreSnapshotDeps = {
  computeRaw?: FinanceDreSnapshotComputeRaw;
  now?: () => Date;
  newToken?: () => string;
};

function resolveDeps(deps: FinanceDreSnapshotDeps) {
  return {
    computeRaw: deps.computeRaw ?? loadFinanceDreRawSourceSeries,
    now: deps.now ?? (() => new Date()),
    newToken: deps.newToken ?? (() => randomUUID()),
  };
}

export async function getFinanceDreSnapshotRows(
  db: FinanceDreSnapshotDb,
  year: number,
  companies: readonly FinanceDreCompany[]
): Promise<SnapshotRow[]> {
  return (await db.financeDreAnnualSnapshot.findMany({
    where: { year, company: { in: [...companies] } },
  })) as SnapshotRow[];
}

/**
 * Claim otimista da chave (year, company). Cria a linha "shell" quando ainda
 * não existe. Retorna o token quando obtido; null = outro refresh em curso.
 */
export async function claimFinanceDreSnapshotRefresh(
  db: FinanceDreSnapshotDb,
  year: number,
  company: FinanceDreCompany,
  deps: FinanceDreSnapshotDeps = {}
): Promise<{ token: string; dirtyGenerationAtClaim: number } | null> {
  const { now, newToken } = resolveDeps(deps);
  const token = newToken();
  const at = now();
  const expiredBefore = new Date(at.getTime() - FINANCE_DRE_SNAPSHOT_CLAIM_TIMEOUT_MS);

  const claimed = await db.financeDreAnnualSnapshot.updateMany({
    where: {
      year,
      company,
      OR: [{ refreshClaimedAt: null }, { refreshClaimedAt: { lt: expiredBefore } }],
    },
    data: { refreshClaimedAt: at, refreshClaimToken: token },
  });

  if (claimed.count === 0) {
    const existing = await db.financeDreAnnualSnapshot.findMany({
      where: { year, company },
      select: { year: true },
    });
    if (existing.length > 0) return null; // linha existe e está reivindicada

    try {
      await db.financeDreAnnualSnapshot.create({
        data: {
          year,
          company,
          schemaVersion: FINANCE_DRE_SNAPSHOT_SCHEMA_VERSION,
          seriesJson: Prisma.JsonNull as never,
          refreshClaimedAt: at,
          refreshClaimToken: token,
        },
      });
    } catch {
      // Corrida de criação: outro processo criou/reivindicou primeiro.
      return null;
    }
  }

  const rows = await getFinanceDreSnapshotRows(db, year, [company]);
  const row = rows.find((r) => r.company === company);
  if (!row || row.refreshClaimToken !== token) return null;
  return { token, dirtyGenerationAtClaim: row.dirtyGeneration };
}

/** Libera o claim (com erro opcional) sem tocar no payload publicado. */
export async function releaseFinanceDreSnapshotClaim(
  db: FinanceDreSnapshotDb,
  year: number,
  company: FinanceDreCompany,
  token: string,
  error: string | null,
  deps: FinanceDreSnapshotDeps = {}
): Promise<void> {
  const { now } = resolveDeps(deps);
  await db.financeDreAnnualSnapshot.updateMany({
    where: { year, company, refreshClaimToken: token },
    data: {
      refreshClaimedAt: null,
      refreshClaimToken: null,
      ...(error != null
        ? { lastRefreshError: error.slice(0, 2000), lastRefreshErrorAt: now() }
        : {}),
    },
  });
}

type PublishInput = {
  year: number;
  company: FinanceDreCompany;
  raw: FinanceDreRawSourceSeries;
  computedAt: Date;
  computeDurationMs: number;
  availableThroughMonthAtCompute: number;
  claimToken: string | null;
  dirtyGenerationAtStart: number;
};

/**
 * Publica UM snapshot dentro da transação `tx` (curta — o payload já está
 * computado e validado). Limpa dirty apenas se `dirtyGeneration` não avançou
 * desde o início do refresh; caso contrário publica o payload (mais novo que o
 * anterior) mas MANTÉM dirty para um novo ciclo.
 */
async function publishOneInTx(
  tx: FinanceDreSnapshotDb,
  input: PublishInput
): Promise<{ clearedDirty: boolean }> {
  const payload = serializeFinanceDreSnapshotSeriesPayload(input.raw);
  const baseData = {
    schemaVersion: FINANCE_DRE_SNAPSHOT_SCHEMA_VERSION,
    seriesJson: payload as never,
    computedAt: input.computedAt,
    computeDurationMs: input.computeDurationMs,
    availableThroughMonthAtCompute: input.availableThroughMonthAtCompute,
    lastSuccessfulRefreshAt: input.computedAt,
    lastRefreshError: null,
    lastRefreshErrorAt: null,
    refreshClaimedAt: null,
    refreshClaimToken: null,
  };

  const cleared = await tx.financeDreAnnualSnapshot.updateMany({
    where: {
      year: input.year,
      company: input.company,
      dirtyGeneration: input.dirtyGenerationAtStart,
    },
    data: { ...baseData, dirtyAt: null, dirtyReason: null },
  });
  if (cleared.count > 0) return { clearedDirty: true };

  const kept = await tx.financeDreAnnualSnapshot.updateMany({
    where: { year: input.year, company: input.company },
    data: baseData,
  });
  if (kept.count > 0) return { clearedDirty: false };

  await tx.financeDreAnnualSnapshot.create({
    data: {
      year: input.year,
      company: input.company,
      ...baseData,
      dirtyAt: null,
      dirtyReason: null,
    },
  });
  return { clearedDirty: true };
}

export type FinanceDreSnapshotRefreshResult = {
  year: number;
  company: FinanceDreCompany;
  status: "refreshed" | "already_running" | "error";
  computedAt: string | null;
  computeDurationMs: number | null;
  clearedDirty: boolean;
  /** PJs recomputadas junto (company=all). */
  entitiesRefreshed: FinanceDreCompany[];
  error: string | null;
};

/**
 * Recomputa e publica o snapshot de (year, company).
 *
 * company=all: computa o bundle consolidado e reutiliza snapshots FRESH e
 * parseáveis das PJs para as bases de IRPJ/CSLL; PJs dirty/ausentes/inválidas
 * são recomputadas (e publicadas junto). `forceAllEntities` recomputa as 3 PJs
 * (refresh administrativo).
 *
 * Todo o cômputo pesado ocorre FORA da transação; a publicação é uma transação
 * curta por chave.
 */
export async function refreshFinanceDreSnapshot(
  db: FinanceDreSnapshotDb,
  input: { year: number; company: FinanceDreCompany; forceAllEntities?: boolean },
  deps: FinanceDreSnapshotDeps = {}
): Promise<FinanceDreSnapshotRefreshResult> {
  const { computeRaw, now } = resolveDeps(deps);
  const { year, company } = input;

  const claim = await claimFinanceDreSnapshotRefresh(db, year, company, deps);
  if (!claim) {
    return {
      year,
      company,
      status: "already_running",
      computedAt: null,
      computeDurationMs: null,
      clearedDirty: false,
      entitiesRefreshed: [],
      error: null,
    };
  }

  const startedAt = now();
  try {
    if (company !== "all") {
      const raw = await computeRaw(year, company, startedAt);
      assertRoundTrips(raw);
      const computedAt = now();
      const publish: PublishInput = {
        year,
        company,
        raw,
        computedAt,
        computeDurationMs: computedAt.getTime() - startedAt.getTime(),
        availableThroughMonthAtCompute: resolveFinanceDreAvailableThroughMonth(year, computedAt),
        claimToken: claim.token,
        dirtyGenerationAtStart: claim.dirtyGenerationAtClaim,
      };
      let clearedDirty = false;
      await db.$transaction(async (tx) => {
        ({ clearedDirty } = await publishOneInTx(tx as FinanceDreSnapshotDb, publish));
      });
      return {
        year,
        company,
        status: "refreshed",
        computedAt: computedAt.toISOString(),
        computeDurationMs: publish.computeDurationMs,
        clearedDirty,
        entitiesRefreshed: [],
        error: null,
      };
    }

    // company === "all"
    const entityRows = await getFinanceDreSnapshotRows(
      db,
      year,
      FINANCE_DRE_LEGAL_ENTITY_COMPANIES
    );
    const rowByCompany = new Map(entityRows.map((r) => [r.company, r]));

    const entityPlans = FINANCE_DRE_LEGAL_ENTITY_COMPANIES.map((entity) => {
      const row = rowByCompany.get(entity);
      const reusable =
        !input.forceAllEntities && row && row.dirtyAt == null
          ? parseFinanceDreSnapshotSeriesPayload(row.seriesJson)
          : null;
      return { entity, reusable, dirtyGenerationAtStart: row?.dirtyGeneration ?? 0 };
    });

    const [consolidatedRaw, ...entityRaws] = await Promise.all([
      computeRaw(year, "all", startedAt),
      ...entityPlans.map((plan) =>
        plan.reusable
          ? Promise.resolve(plan.reusable)
          : computeRaw(year, plan.entity, startedAt)
      ),
    ]);
    assertRoundTrips(consolidatedRaw);
    for (const raw of entityRaws) assertRoundTrips(raw);

    const computedAt = now();
    const computeDurationMs = computedAt.getTime() - startedAt.getTime();
    const availableThroughMonthAtCompute = resolveFinanceDreAvailableThroughMonth(
      year,
      computedAt
    );

    const entitiesRefreshed: FinanceDreCompany[] = [];
    let clearedDirty = false;
    await db.$transaction(async (txRaw) => {
      const tx = txRaw as FinanceDreSnapshotDb;
      ({ clearedDirty } = await publishOneInTx(tx, {
        year,
        company: "all",
        raw: consolidatedRaw,
        computedAt,
        computeDurationMs,
        availableThroughMonthAtCompute,
        claimToken: claim.token,
        dirtyGenerationAtStart: claim.dirtyGenerationAtClaim,
      }));
      for (let i = 0; i < entityPlans.length; i += 1) {
        const plan = entityPlans[i]!;
        if (plan.reusable) continue; // PJ FRESH reutilizada — não republicar
        await publishOneInTx(tx, {
          year,
          company: plan.entity,
          raw: entityRaws[i]!,
          computedAt,
          computeDurationMs,
          availableThroughMonthAtCompute,
          claimToken: null,
          dirtyGenerationAtStart: plan.dirtyGenerationAtStart,
        });
        entitiesRefreshed.push(plan.entity);
      }
    });

    return {
      year,
      company,
      status: "refreshed",
      computedAt: computedAt.toISOString(),
      computeDurationMs,
      clearedDirty,
      entitiesRefreshed,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await releaseFinanceDreSnapshotClaim(db, year, company, claim.token, message, deps).catch(
      () => undefined
    );
    return {
      year,
      company,
      status: "error",
      computedAt: null,
      computeDurationMs: null,
      clearedDirty: false,
      entitiesRefreshed: [],
      error: message,
    };
  }
}

/** Garante que o payload sobrevive a serialize→parse antes de publicar. */
function assertRoundTrips(raw: FinanceDreRawSourceSeries): void {
  const parsed = parseFinanceDreSnapshotSeriesPayload(
    JSON.parse(JSON.stringify(serializeFinanceDreSnapshotSeriesPayload(raw)))
  );
  if (!parsed) {
    throw new Error(
      `Snapshot DRE inválido após serialização (${raw.year}/${raw.company}) — publicação abortada.`
    );
  }
}

export type MarkFinanceDreSnapshotsDirtyInput = {
  reason: string;
  /** Anos específicos; combinável com minYear. */
  years?: readonly number[];
  /** Marca todos os anos existentes >= minYear (alterações retroativas). */
  minYear?: number;
  /** Empresas afetadas; default = todas (sempre inclui "all"). */
  companies?: readonly FinanceDreCompany[];
};

/**
 * Marca snapshots EXISTENTES como dirty (invalidação conservadora — nunca cria
 * linhas novas). Incrementa dirtyGeneration para o protocolo anti-race.
 */
export async function markFinanceDreSnapshotsDirty(
  db: FinanceDreSnapshotDb,
  input: MarkFinanceDreSnapshotsDirtyInput,
  deps: FinanceDreSnapshotDeps = {}
): Promise<number> {
  const { now } = resolveDeps(deps);
  const companies = new Set<FinanceDreCompany>(
    input.companies && input.companies.length > 0
      ? input.companies
      : ["all", ...FINANCE_DRE_LEGAL_ENTITY_COMPANIES]
  );
  // Qualquer PJ afetada afeta o consolidado.
  companies.add("all");

  const yearFilters: Prisma.FinanceDreAnnualSnapshotWhereInput[] = [];
  if (input.years && input.years.length > 0) {
    yearFilters.push({ year: { in: [...new Set(input.years)] } });
  }
  if (input.minYear != null && Number.isFinite(input.minYear)) {
    yearFilters.push({ year: { gte: input.minYear } });
  }

  const result = await db.financeDreAnnualSnapshot.updateMany({
    where: {
      company: { in: [...companies] },
      ...(yearFilters.length > 0 ? { OR: yearFilters } : {}),
    },
    data: {
      dirtyAt: now(),
      dirtyReason: input.reason.slice(0, 500),
      dirtyGeneration: { increment: 1 },
    },
  });
  return result.count;
}

/** Versão soft-fail para hooks pós-sync: nunca propaga erro ao chamador. */
export async function markFinanceDreSnapshotsDirtySafe(
  db: FinanceDreSnapshotDb,
  input: MarkFinanceDreSnapshotsDirtyInput,
  deps: FinanceDreSnapshotDeps = {}
): Promise<{ count: number; error: string | null }> {
  try {
    const count = await markFinanceDreSnapshotsDirty(db, input, deps);
    if (count > 0) {
      console.warn(`${LOG_PREFIX} markDirty (${input.reason}): ${count} snapshot(s).`);
    }
    return { count, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} markDirty falhou (${input.reason}): ${message}`);
    return { count: 0, error: message };
  }
}

/**
 * Invalidação a partir de NF-e afetadas: resolve anos (competência emissão) e
 * empresas (cnpjEmitente) das notas e marca os snapshots correspondentes.
 * Soft-fail — pensado para o fim dos scripts de sync.
 */
export async function markFinanceDreSnapshotsDirtyForNfes(
  db: FinanceDreSnapshotDb & Pick<PrismaClient, "nomusNfe">,
  nfeIds: readonly string[],
  reason: string,
  deps: FinanceDreSnapshotDeps = {}
): Promise<{ count: number; error: string | null }> {
  try {
    const ids = [...new Set(nfeIds)].filter((id) => typeof id === "string" && id.length > 0);
    if (ids.length === 0) return { count: 0, error: null };

    const rows = await db.nomusNfe.findMany({
      where: { id: { in: ids } },
      select: { xmlDhEmi: true, dataProcessamento: true, cnpjEmitente: true },
    });

    const years = new Set<number>();
    const companies = new Set<FinanceDreCompany>(["all"]);
    let unknownCompany = false;
    const cnpjToCompany = new Map<string, FinanceDreCompany>([
      ["72569510000195", "lazarios"],
      ["14055501000180", "koppetel"],
      ["55717719000130", "sm"],
    ]);
    for (const row of rows) {
      const competence = row.xmlDhEmi ?? row.dataProcessamento;
      if (competence) years.add(competence.getFullYear());
      const digits = (row.cnpjEmitente ?? "").replace(/\D/g, "");
      const company = cnpjToCompany.get(digits);
      if (company) companies.add(company);
      else unknownCompany = true;
    }
    if (years.size === 0) return { count: 0, error: null };

    return await markFinanceDreSnapshotsDirtySafe(
      db,
      {
        reason,
        years: [...years],
        companies: unknownCompany ? undefined : [...companies],
      },
      deps
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} markDirtyForNfes falhou (${reason}): ${message}`);
    return { count: 0, error: message };
  }
}

export type RefreshDirtyFinanceDreSnapshotsResult = {
  refreshed: Array<{ year: number; company: FinanceDreCompany; computeDurationMs: number | null }>;
  errors: Array<{ year: number; company: FinanceDreCompany; message: string }>;
  skipped: number;
  durationMs: number;
};

/**
 * Recalcula snapshots DIRTY (PJs antes de "all", para maximizar reuso).
 * Soft-fail por chave; nunca propaga erro. O estado dirty persistido é a
 * garantia durável — falha aqui deixa o dirty para a próxima oportunidade.
 */
export async function refreshDirtyFinanceDreSnapshots(
  db: FinanceDreSnapshotDb,
  options: { limit?: number } = {},
  deps: FinanceDreSnapshotDeps = {}
): Promise<RefreshDirtyFinanceDreSnapshotsResult> {
  const { now } = resolveDeps(deps);
  const startedAt = now();
  const limit = Math.max(1, options.limit ?? 8);
  const result: RefreshDirtyFinanceDreSnapshotsResult = {
    refreshed: [],
    errors: [],
    skipped: 0,
    durationMs: 0,
  };
  try {
    const dirtyRows = (await db.financeDreAnnualSnapshot.findMany({
      where: { dirtyAt: { not: null } },
      orderBy: { updatedAt: "asc" },
      take: limit * 2,
    })) as SnapshotRow[];

    const ordered = [...dirtyRows].sort((a, b) => {
      const aAll = a.company === "all" ? 1 : 0;
      const bAll = b.company === "all" ? 1 : 0;
      return aAll - bAll; // PJs primeiro
    });

    let processed = 0;
    for (const row of ordered) {
      if (processed >= limit) {
        result.skipped += 1;
        continue;
      }
      processed += 1;
      const refresh = await refreshFinanceDreSnapshot(
        db,
        { year: row.year, company: row.company as FinanceDreCompany },
        deps
      );
      if (refresh.status === "refreshed") {
        result.refreshed.push({
          year: row.year,
          company: row.company as FinanceDreCompany,
          computeDurationMs: refresh.computeDurationMs,
        });
      } else if (refresh.status === "error") {
        result.errors.push({
          year: row.year,
          company: row.company as FinanceDreCompany,
          message: refresh.error ?? "erro desconhecido",
        });
      } else {
        result.skipped += 1;
      }
    }
    return result;
  } catch (error) {
    result.errors.push({
      year: -1,
      company: "all",
      message: error instanceof Error ? error.message : String(error),
    });
    return result;
  } finally {
    result.durationMs = now().getTime() - startedAt.getTime();
  }
}

export type ResolveFinanceDreReportDeps = FinanceDreSnapshotDeps & {
  db?: FinanceDreSnapshotDb;
  loadRoleMap?: () => Promise<ReadonlyMap<string, DreCostCenterRole>>;
  /** Dispara o refresh em background (stale-while-revalidate). Default: fire-and-forget real. */
  scheduleBackgroundRefresh?: (year: number, company: FinanceDreCompany) => void;
};

/**
 * FAST PATH do GET /api/finance/dre:
 * - FRESH  → snapshot + motor puro (nenhum motor pesado);
 * - DIRTY  → responde imediatamente com o último snapshot válido
 *            (freshness=stale) e agenda refresh em background;
 * - MISS   → computa UMA vez sob claim, persiste e responde; se outro refresh
 *            está em curso, computa ao vivo SEM persistir (freshness=live).
 */
export async function resolveFinanceDreReportWithSnapshot(
  query: Record<string, unknown> = {},
  referenceNow: Date = new Date(),
  depsInput: ResolveFinanceDreReportDeps = {}
): Promise<FinanceDreReport & { snapshot: FinanceDreReportSnapshotMeta }> {
  const db = depsInput.db ?? (prisma as FinanceDreSnapshotDb);
  const loadRoleMap = depsInput.loadRoleMap ?? (() => loadDreCostCenterRoleMap(prisma));
  const { computeRaw } = resolveDeps(depsInput);
  const scheduleBackgroundRefresh =
    depsInput.scheduleBackgroundRefresh ??
    ((year: number, company: FinanceDreCompany) => {
      void refreshFinanceDreSnapshot(db, { year, company }, depsInput)
        .then((r) => {
          if (r.status === "error") {
            console.error(`${LOG_PREFIX} refresh background ${year}/${company}: ${r.error}`);
          } else if (r.status === "refreshed") {
            console.warn(
              `${LOG_PREFIX} refresh background ${year}/${company} concluído em ${r.computeDurationMs}ms`
            );
          }
        })
        .catch((error) => {
          console.error(`${LOG_PREFIX} refresh background ${year}/${company} falhou:`, error);
        });
    });

  const filters = parseFinanceDreQuery(query, referenceNow);
  // Regra temporal canônica SEMPRE em read-time — nunca a persistida no snapshot.
  const availableThroughMonth = resolveFinanceDreAvailableThroughMonth(
    filters.year,
    referenceNow
  );

  const companies: FinanceDreCompany[] =
    filters.company === "all"
      ? ["all", ...FINANCE_DRE_LEGAL_ENTITY_COMPANIES]
      : [filters.company];

  const [roleMap, rows] = await Promise.all([
    loadRoleMap(),
    getFinanceDreSnapshotRows(db, filters.year, companies),
  ]);
  const rowByCompany = new Map(rows.map((r) => [r.company, r]));

  const parsedByCompany = new Map<FinanceDreCompany, FinanceDreRawSourceSeries>();
  let anyMissing = false;
  for (const company of companies) {
    const row = rowByCompany.get(company);
    const parsed = row ? parseFinanceDreSnapshotSeriesPayload(row.seriesJson) : null;
    if (parsed) parsedByCompany.set(company, parsed);
    else anyMissing = true;
  }

  const buildFromParsed = (): FinanceDreReport => {
    const consolidated = parsedByCompany.get(filters.company)!;
    const perEntity =
      filters.company === "all"
        ? FINANCE_DRE_LEGAL_ENTITY_COMPANIES.map((c) => parsedByCompany.get(c)!)
        : null;
    return buildFinanceDreReportFromRawSources({
      filters,
      availableThroughMonth,
      roleMap,
      consolidated,
      perEntity,
    });
  };

  if (!anyMissing) {
    const mainRow = rowByCompany.get(filters.company)!;
    const anyDirty = companies.some((c) => rowByCompany.get(c)?.dirtyAt != null);
    if (anyDirty) {
      scheduleBackgroundRefresh(filters.year, filters.company);
    }
    return {
      ...buildFromParsed(),
      snapshot: {
        freshness: anyDirty ? "stale" : "fresh",
        computedAt: mainRow.computedAt?.toISOString() ?? null,
        computeDurationMs: mainRow.computeDurationMs ?? null,
        refreshPending: anyDirty,
        dirtyReason: anyDirty
          ? (companies
              .map((c) => rowByCompany.get(c)?.dirtyReason)
              .find((r) => r != null) ?? null)
          : null,
      },
    };
  }

  // MISS (sem snapshot utilizável): computa uma vez sob claim e persiste.
  const refresh = await refreshFinanceDreSnapshot(
    db,
    { year: filters.year, company: filters.company },
    depsInput
  );

  if (refresh.status === "refreshed") {
    const freshRows = await getFinanceDreSnapshotRows(db, filters.year, companies);
    const freshByCompany = new Map(freshRows.map((r) => [r.company, r]));
    parsedByCompany.clear();
    let stillMissing = false;
    for (const company of companies) {
      const parsed = parseFinanceDreSnapshotSeriesPayload(
        freshByCompany.get(company)?.seriesJson ?? null
      );
      if (parsed) parsedByCompany.set(company, parsed);
      else stillMissing = true;
    }
    if (!stillMissing) {
      const mainRow = freshByCompany.get(filters.company)!;
      return {
        ...buildFromParsed(),
        snapshot: {
          freshness: "fresh",
          computedAt: mainRow.computedAt?.toISOString() ?? null,
          computeDurationMs: mainRow.computeDurationMs ?? null,
          refreshPending: mainRow.dirtyAt != null,
          dirtyReason: mainRow.dirtyReason ?? null,
        },
      };
    }
  }

  // Claim ocupado (outro refresh em curso) ou publicação indisponível:
  // responde ao vivo SEM persistir — nunca bloqueia nem duplica o refresh.
  const consolidated = await computeRaw(filters.year, filters.company, referenceNow);
  const perEntity =
    filters.company === "all"
      ? await Promise.all(
          FINANCE_DRE_LEGAL_ENTITY_COMPANIES.map((c) =>
            computeRaw(filters.year, c, referenceNow)
          )
        )
      : null;
  return {
    ...buildFinanceDreReportFromRawSources({
      filters,
      availableThroughMonth,
      roleMap,
      consolidated,
      perEntity,
    }),
    snapshot: {
      freshness: "live",
      computedAt: null,
      computeDurationMs: null,
      refreshPending: true,
      dirtyReason: null,
    },
  };
}
