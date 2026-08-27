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
import { mapExecutiveReportCompanyToEmitterCnpj } from "@/src/lib/financeExecutiveReportCompany.js";
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
  /** FENCING: a publicação só acontece se este token ainda for o dono do claim. */
  claimToken: string;
  dirtyGenerationAtStart: number;
};

type PublishOutcome = {
  published: boolean;
  clearedDirty: boolean;
  reason: "ok" | "claim_lost";
};

/**
 * Publica UM snapshot dentro da transação `tx` (curta — o payload já está
 * computado e validado), com FENCING: o WHERE exige `refreshClaimToken` igual
 * ao token deste refresh. Se outro processo assumiu o claim (TTL expirado),
 * este refresh NÃO publica e NÃO toca o claim alheio (`claim_lost`).
 * Limpa dirty apenas se `dirtyGeneration` não avançou desde o início; caso
 * contrário publica o payload mas MANTÉM dirty para um novo ciclo.
 */
async function publishOneInTx(
  tx: FinanceDreSnapshotDb,
  input: PublishInput
): Promise<PublishOutcome> {
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
    // Libera o PRÓPRIO claim (validado no WHERE) ao publicar.
    refreshClaimedAt: null,
    refreshClaimToken: null,
  };

  const cleared = await tx.financeDreAnnualSnapshot.updateMany({
    where: {
      year: input.year,
      company: input.company,
      refreshClaimToken: input.claimToken,
      dirtyGeneration: input.dirtyGenerationAtStart,
    },
    data: { ...baseData, dirtyAt: null, dirtyReason: null },
  });
  if (cleared.count > 0) return { published: true, clearedDirty: true, reason: "ok" };

  const kept = await tx.financeDreAnnualSnapshot.updateMany({
    where: {
      year: input.year,
      company: input.company,
      refreshClaimToken: input.claimToken,
    },
    data: baseData,
  });
  if (kept.count > 0) return { published: true, clearedDirty: false, reason: "ok" };

  // Token não é mais o dono (claim expirou e outro refresh assumiu) ou a linha
  // sumiu: abandonar SEM publicar e SEM limpar claim de terceiros.
  return { published: false, clearedDirty: false, reason: "claim_lost" };
}

export type FinanceDreSnapshotRefreshResult = {
  year: number;
  company: FinanceDreCompany;
  /** claim_lost = outro refresh assumiu o claim durante o cômputo (nada publicado). */
  status: "refreshed" | "already_running" | "claim_lost" | "error";
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
      let outcome: PublishOutcome = { published: false, clearedDirty: false, reason: "claim_lost" };
      await db.$transaction(async (tx) => {
        outcome = await publishOneInTx(tx as unknown as FinanceDreSnapshotDb, publish);
      });
      if (!outcome.published) {
        console.warn(
          `${LOG_PREFIX} refresh ${year}/${company} abandonado: claim assumido por outro processo.`
        );
        return {
          year,
          company,
          status: "claim_lost",
          computedAt: null,
          computeDurationMs: null,
          clearedDirty: false,
          entitiesRefreshed: [],
          error: null,
        };
      }
      return {
        year,
        company,
        status: "refreshed",
        computedAt: computedAt.toISOString(),
        computeDurationMs: publish.computeDurationMs,
        clearedDirty: outcome.clearedDirty,
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

    // PJ FRESH e parseável é reutilizada; PJ a recomputar recebe claim próprio
    // (fencing por chave). Claim negado → recomputa para as bases do all, mas
    // NÃO publica a PJ (o refresh individual dela é o dono).
    const entityPlans = await Promise.all(
      FINANCE_DRE_LEGAL_ENTITY_COMPANIES.map(async (entity) => {
        const row = rowByCompany.get(entity);
        const reusable =
          !input.forceAllEntities && row && row.dirtyAt == null
            ? parseFinanceDreSnapshotSeriesPayload(row.seriesJson)
            : null;
        const entityClaim = reusable
          ? null
          : await claimFinanceDreSnapshotRefresh(db, year, entity, deps);
        return { entity, reusable, entityClaim };
      })
    );

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
    let allOutcome: PublishOutcome = { published: false, clearedDirty: false, reason: "claim_lost" };
    await db.$transaction(async (txRaw) => {
      const tx = txRaw as unknown as FinanceDreSnapshotDb;
      allOutcome = await publishOneInTx(tx, {
        year,
        company: "all",
        raw: consolidatedRaw,
        computedAt,
        computeDurationMs,
        availableThroughMonthAtCompute,
        claimToken: claim.token,
        dirtyGenerationAtStart: claim.dirtyGenerationAtClaim,
      });
      for (let i = 0; i < entityPlans.length; i += 1) {
        const plan = entityPlans[i]!;
        if (plan.reusable) continue; // PJ FRESH reutilizada — não republicar
        if (!plan.entityClaim) continue; // claim negado — refresh individual é o dono
        const outcome = await publishOneInTx(tx, {
          year,
          company: plan.entity,
          raw: entityRaws[i]!,
          computedAt,
          computeDurationMs,
          availableThroughMonthAtCompute,
          claimToken: plan.entityClaim.token,
          dirtyGenerationAtStart: plan.entityClaim.dirtyGenerationAtClaim,
        });
        if (outcome.published) entitiesRefreshed.push(plan.entity);
      }
    });

    if (!allOutcome.published) {
      // Claim do all foi assumido por outro processo: abandonar publicação e
      // liberar apenas os claims de PJ que ESTE refresh obteve e não usou.
      for (const plan of entityPlans) {
        if (plan.entityClaim) {
          await releaseFinanceDreSnapshotClaim(
            db,
            year,
            plan.entity,
            plan.entityClaim.token,
            null,
            deps
          ).catch(() => undefined);
        }
      }
      console.warn(
        `${LOG_PREFIX} refresh ${year}/all abandonado: claim assumido por outro processo.`
      );
      return {
        year,
        company,
        status: "claim_lost",
        computedAt: null,
        computeDurationMs: null,
        clearedDirty: false,
        entitiesRefreshed: [],
        error: null,
      };
    }

    return {
      year,
      company,
      status: "refreshed",
      computedAt: computedAt.toISOString(),
      computeDurationMs,
      clearedDirty: allOutcome.clearedDirty,
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

type NfeInvalidationRow = {
  xmlDhEmi: Date | null;
  dataProcessamento: Date | null;
  cnpjEmitente: string | null;
};

const NFE_INVALIDATION_SELECT = {
  xmlDhEmi: true,
  dataProcessamento: true,
  cnpjEmitente: true,
} as const;

/** CNPJ emitente → escopo DRE (fonte oficial: FINANCE_INTERNAL_GROUP_COMPANIES). */
function nfeCnpjToDreCompany(): Map<string, FinanceDreCompany> {
  const map = new Map<string, FinanceDreCompany>();
  for (const company of FINANCE_DRE_LEGAL_ENTITY_COMPANIES) {
    const cnpj = mapExecutiveReportCompanyToEmitterCnpj(company);
    if (cnpj) map.set(cnpj, company);
  }
  return map;
}

async function markDirtyFromNfeInvalidationRows(
  db: FinanceDreSnapshotDb,
  rows: readonly NfeInvalidationRow[],
  reason: string,
  deps: FinanceDreSnapshotDeps
): Promise<{ count: number; error: string | null }> {
  const years = new Set<number>();
  const companies = new Set<FinanceDreCompany>(["all"]);
  let unknownCompany = false;
  const cnpjToCompany = nfeCnpjToDreCompany();
  for (const row of rows) {
    const competence = row.xmlDhEmi ?? row.dataProcessamento;
    if (competence) years.add(competence.getFullYear());
    const digits = (row.cnpjEmitente ?? "").replace(/\D/g, "");
    const company = cnpjToCompany.get(digits);
    if (company) companies.add(company);
    else unknownCompany = true;
  }
  if (years.size === 0) return { count: 0, error: null };

  return markFinanceDreSnapshotsDirtySafe(
    db,
    {
      reason,
      years: [...years],
      companies: unknownCompany ? undefined : [...companies],
    },
    deps
  );
}

/**
 * Invalidação a partir de NF-e afetadas pelo SYNC, identificadas pelo
 * `NomusNfe.externalId` NUMÉRICO (contrato real de `affectedNfeIds` do
 * nomusNfesSync). NÃO confundir com `NomusNfe.id` (UUID interno) — use
 * `markFinanceDreSnapshotsDirtyForNfeIds` para UUIDs. Soft-fail.
 */
export async function markFinanceDreSnapshotsDirtyForNfeExternalIds(
  db: FinanceDreSnapshotDb & Pick<PrismaClient, "nomusNfe">,
  externalIds: readonly number[],
  reason: string,
  deps: FinanceDreSnapshotDeps = {}
): Promise<{ count: number; error: string | null }> {
  try {
    const ids = [...new Set(externalIds)].filter(
      (id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0
    );
    if (ids.length === 0) return { count: 0, error: null };

    const rows = await db.nomusNfe.findMany({
      where: { externalId: { in: ids } },
      select: NFE_INVALIDATION_SELECT,
    });
    return await markDirtyFromNfeInvalidationRows(db, rows, reason, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} markDirtyForNfeExternalIds falhou (${reason}): ${message}`);
    return { count: 0, error: message };
  }
}

/**
 * Invalidação a partir de NF-e identificadas pelo `NomusNfe.id` (UUID interno)
 * — contrato do backfill fiscal (`persistedNomusNfeIds`). Soft-fail.
 */
export async function markFinanceDreSnapshotsDirtyForNfeIds(
  db: FinanceDreSnapshotDb & Pick<PrismaClient, "nomusNfe">,
  nomusNfeIds: readonly string[],
  reason: string,
  deps: FinanceDreSnapshotDeps = {}
): Promise<{ count: number; error: string | null }> {
  try {
    const ids = [...new Set(nomusNfeIds)].filter(
      (id): id is string => typeof id === "string" && id.length > 0
    );
    if (ids.length === 0) return { count: 0, error: null };

    const rows = await db.nomusNfe.findMany({
      where: { id: { in: ids } },
      select: NFE_INVALIDATION_SELECT,
    });
    return await markDirtyFromNfeInvalidationRows(db, rows, reason, deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} markDirtyForNfeIds falhou (${reason}): ${message}`);
    return { count: 0, error: message };
  }
}

/**
 * Ponto canônico ÚNICO de "Documento de Saída mudou → DRE dirty" — usado pelo
 * sync principal, pelo sync pós-pedidos (by-idNfe) e pelo repair. Mapear
 * idNfe→ano/empresa seria caro; invalidação conservadora dos snapshots
 * existentes quando houve mudança real. Soft-fail.
 */
export async function markFinanceDreSnapshotsDirtyForStockDocumentChanges(
  db: FinanceDreSnapshotDb,
  input: { changedCount: number; reason: string },
  deps: FinanceDreSnapshotDeps = {}
): Promise<{ count: number; error: string | null }> {
  if (!Number.isFinite(input.changedCount) || input.changedCount <= 0) {
    return { count: 0, error: null };
  }
  return markFinanceDreSnapshotsDirtySafe(db, { reason: input.reason }, deps);
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

/**
 * Resumo executivo da DRE para o One Page — EXCLUSIVAMENTE via snapshot.
 *
 * Nunca executa os motores pesados (NF-e/CMV/AP) no request: HIT/STALE montam
 * o report com o motor puro sobre o snapshot; STALE e MISS disparam o MESMO
 * refresh em background da DRE (claim-protegido) e respondem imediatamente
 * (MISS → available=false, "em preparação"). O One Page nunca bloqueia.
 */
export async function getFinanceDreOnePageSummaryFromSnapshot(
  input: { year: number; month: number; periodMode: "ytd" | "month" },
  referenceNow: Date = new Date(),
  depsInput: ResolveFinanceDreReportDeps = {}
): Promise<
  import("@/src/lib/financeDreOnePageSummary.js").FinanceDreOnePageSummaryResult
> {
  const { extractFinanceDreOnePageSummaryValues, FINANCE_DRE_ONE_PAGE_UNAVAILABLE } =
    await import("@/src/lib/financeDreOnePageSummary.js");
  const db = depsInput.db ?? (prisma as FinanceDreSnapshotDb);
  const loadRoleMap = depsInput.loadRoleMap ?? (() => loadDreCostCenterRoleMap(prisma));
  const scheduleBackgroundRefresh =
    depsInput.scheduleBackgroundRefresh ??
    ((year: number, company: FinanceDreCompany) => {
      void refreshFinanceDreSnapshot(db, { year, company }, depsInput)
        .then((r) => {
          if (r.status === "error") {
            console.error(`${LOG_PREFIX} refresh background ${year}/${company}: ${r.error}`);
          }
        })
        .catch((error) => {
          console.error(`${LOG_PREFIX} refresh background ${year}/${company} falhou:`, error);
        });
    });

  // Mesma regra canônica de período da DRE (clamp de mês futuro incluído).
  const filters = parseFinanceDreQuery(
    { year: input.year, month: input.month, company: "all" },
    referenceNow
  );
  const availableThroughMonth = resolveFinanceDreAvailableThroughMonth(
    filters.year,
    referenceNow
  );
  const companies: FinanceDreCompany[] = ["all", ...FINANCE_DRE_LEGAL_ENTITY_COMPANIES];

  const [roleMap, rows] = await Promise.all([
    loadRoleMap(),
    getFinanceDreSnapshotRows(db, filters.year, companies),
  ]);
  const rowByCompany = new Map(rows.map((r) => [r.company, r]));

  const parsedByCompany = new Map<FinanceDreCompany, FinanceDreRawSourceSeries>();
  for (const company of companies) {
    const parsed = parseFinanceDreSnapshotSeriesPayload(
      rowByCompany.get(company)?.seriesJson ?? null
    );
    if (parsed) parsedByCompany.set(company, parsed);
  }

  if (parsedByCompany.size < companies.length) {
    // MISS: nunca computa inline no One Page — aquece em background e informa
    // "em preparação".
    scheduleBackgroundRefresh(filters.year, "all");
    return FINANCE_DRE_ONE_PAGE_UNAVAILABLE;
  }

  const report = buildFinanceDreReportFromRawSources({
    filters,
    availableThroughMonth,
    roleMap,
    consolidated: parsedByCompany.get("all")!,
    perEntity: FINANCE_DRE_LEGAL_ENTITY_COMPANIES.map((c) => parsedByCompany.get(c)!),
  });
  const values = extractFinanceDreOnePageSummaryValues(report, input.periodMode);
  if (!values) {
    return FINANCE_DRE_ONE_PAGE_UNAVAILABLE;
  }

  const anyDirty = companies.some((c) => rowByCompany.get(c)?.dirtyAt != null);
  if (anyDirty) {
    scheduleBackgroundRefresh(filters.year, "all");
  }
  const mainRow = rowByCompany.get("all")!;
  return {
    available: true,
    freshness: anyDirty ? "stale" : "fresh",
    computedAt: mainRow.computedAt?.toISOString() ?? null,
    values,
  };
}

export type ResolveFinanceDreReportDeps = FinanceDreSnapshotDeps & {
  db?: FinanceDreSnapshotDb;
  loadRoleMap?: () => Promise<ReadonlyMap<string, DreCostCenterRole>>;
  /** Dispara o refresh em background (stale-while-revalidate). Default: fire-and-forget real. */
  scheduleBackgroundRefresh?: (year: number, company: FinanceDreCompany) => void;
  /** Espera entre tentativas quando outro processo está computando o MISS. */
  sleep?: (ms: number) => Promise<void>;
  /** Tentativas/intervalo da espera limitada em MISS concorrente. */
  missWaitAttempts?: number;
  missWaitIntervalMs?: number;
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

  const tryServeFromRows = async (): Promise<
    (FinanceDreReport & { snapshot: FinanceDreReportSnapshotMeta }) | null
  > => {
    const freshRows = await getFinanceDreSnapshotRows(db, filters.year, companies);
    const freshByCompany = new Map(freshRows.map((r) => [r.company, r]));
    parsedByCompany.clear();
    for (const company of companies) {
      const parsed = parseFinanceDreSnapshotSeriesPayload(
        freshByCompany.get(company)?.seriesJson ?? null
      );
      if (parsed) parsedByCompany.set(company, parsed);
      else return null;
    }
    const mainRow = freshByCompany.get(filters.company)!;
    return {
      ...buildFromParsed(),
      snapshot: {
        freshness: mainRow.dirtyAt != null ? "stale" : "fresh",
        computedAt: mainRow.computedAt?.toISOString() ?? null,
        computeDurationMs: mainRow.computeDurationMs ?? null,
        refreshPending: mainRow.dirtyAt != null,
        dirtyReason: mainRow.dirtyReason ?? null,
      },
    };
  };

  if (refresh.status === "refreshed") {
    const served = await tryServeFromRows();
    if (served) return served;
  }

  if (refresh.status === "already_running" || refresh.status === "claim_lost") {
    // Outro processo está computando esta chave: espera limitada pela
    // publicação dele (evita segundo compute pesado em stampede de MISS).
    const sleep = depsInput.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const attempts = Math.max(0, depsInput.missWaitAttempts ?? 5);
    const intervalMs = Math.max(250, depsInput.missWaitIntervalMs ?? 2500);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await sleep(intervalMs);
      const served = await tryServeFromRows();
      if (served) return served;
    }
  }

  // Espera esgotada ou publicação indisponível: responde ao vivo SEM persistir
  // — nunca bloqueia indefinidamente nem quebra o contrato da página.
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
