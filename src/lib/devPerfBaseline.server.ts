/**
 * PERFORMANCE 02 — instrumentação server-only (flag INDUSCOST_PERF_BASELINE=1).
 * Conta queries Prisma via event "query" + mede duração de handlers/cenários.
 * Não altera respostas JSON funcionais (apenas header X-IndusCost-Perf opcional).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import {
  approxJsonBytes,
  isDevPerfBaselineEnvEnabled,
  roundDevPerfMs,
  type DevPerfEndpointSample,
  type DevPerfRowCounts,
} from "@/src/lib/devPerfBaseline.js";

type PerfStore = {
  queryCount: number;
  dbMs: number;
  labels: string[];
  phases: Record<string, number>;
  accountedPhases: Record<string, number>;
  rowCounts: DevPerfRowCounts;
  serializeMs: number | null;
  profilingSerializeMs: number | null;
};

export type DevPerfPhaseOptions = {
  /**
   * Inclui a fase em accountedWallMs. Só use em passos sequenciais de
   * primeiro nível — nunca aninhe `account: true` dentro de outro `account`.
   */
  account?: boolean;
};

const als = new AsyncLocalStorage<PerfStore>();
let prismaListenerInstalled = false;
const samples: DevPerfEndpointSample[] = [];

/**
 * Teto do buffer de amostras (janela deslizante).
 *
 * A flag agora pode ser ligada em produção, onde o processo vive semanas: sem
 * teto, `samples` cresceria para sempre — uma amostra por request instrumentado,
 * ~150 bytes cada. 500 cobre com folga uma janela de medição (o interesse é
 * sempre o que acabou de acontecer) e custa ~75 KB no pior caso.
 */
export const MAX_PERF_BASELINE_SAMPLES = 500;

/** Guarda a amostra descartando as mais antigas ao estourar o teto. */
function pushSample(sample: DevPerfEndpointSample): void {
  samples.push(sample);
  if (samples.length > MAX_PERF_BASELINE_SAMPLES) {
    samples.splice(0, samples.length - MAX_PERF_BASELINE_SAMPLES);
  }
}

function newStore(): PerfStore {
  return {
    queryCount: 0,
    dbMs: 0,
    labels: [],
    phases: {},
    accountedPhases: {},
    rowCounts: {},
    serializeMs: null,
    profilingSerializeMs: null,
  };
}

function snapshotPhases(store: PerfStore): Record<string, number> | null {
  const keys = Object.keys(store.phases);
  if (keys.length === 0) return null;
  const out: Record<string, number> = {};
  for (const key of keys) {
    out[key] = roundDevPerfMs(store.phases[key] ?? 0);
  }
  return out;
}

function snapshotRowCounts(store: PerfStore): DevPerfRowCounts | null {
  const { ar, ap, orders } = store.rowCounts;
  if (ar == null && ap == null && orders == null) return null;
  return { ...store.rowCounts };
}

function snapshotAccountedPhases(store: PerfStore): Record<string, number> | null {
  const keys = Object.keys(store.accountedPhases);
  if (keys.length === 0) return null;
  const out: Record<string, number> = {};
  for (const key of keys) {
    out[key] = roundDevPerfMs(store.accountedPhases[key] ?? 0);
  }
  return out;
}

function sumAccountedWallMs(
  accountedPhases: Record<string, number> | null,
  serializeMs: number | null
): number {
  let sum = 0;
  if (accountedPhases) {
    for (const ms of Object.values(accountedPhases)) sum += ms;
  }
  if (serializeMs != null && Number.isFinite(serializeMs)) sum += serializeMs;
  return roundDevPerfMs(sum);
}

export function computeUnaccountedWallMs(
  totalMs: number,
  accountedWallMs: number
): number {
  return roundDevPerfMs(totalMs - accountedWallMs);
}

function recordPhase(store: PerfStore, name: string, dt: number, account?: boolean): void {
  store.phases[name] = (store.phases[name] ?? 0) + dt;
  if (account) {
    store.accountedPhases[name] = (store.accountedPhases[name] ?? 0) + dt;
  }
}

/**
 * Fase wall-clock. No-op fora de request/cenário instrumentado (flag off).
 * Fases detalhe podem aninhar-se; só `account: true` entra em accountedWallMs.
 */
export async function measureDevPerfPhase<T>(
  name: string,
  fn: () => Promise<T>,
  options?: DevPerfPhaseOptions
): Promise<T> {
  const store = als.getStore();
  if (!store) return fn();
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    recordPhase(store, name, performance.now() - startedAt, options?.account);
  }
}

export function measureDevPerfPhaseSync<T>(
  name: string,
  fn: () => T,
  options?: DevPerfPhaseOptions
): T {
  const store = als.getStore();
  if (!store) return fn();
  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    recordPhase(store, name, performance.now() - startedAt, options?.account);
  }
}

/** Contagens inteiras — nunca strings de cliente/fornecedor. */
export function noteDevPerfRowCounts(counts: DevPerfRowCounts): void {
  const store = als.getStore();
  if (!store) return;
  if (counts.ar != null) store.rowCounts.ar = counts.ar;
  if (counts.ap != null) store.rowCounts.ap = counts.ap;
  if (counts.orders != null) store.rowCounts.orders = counts.orders;
}

export function isDevPerfBaselineServerEnabled(): boolean {
  return isDevPerfBaselineEnvEnabled();
}

/**
 * Instrumentação Prisma por request (idempotente, só com a flag).
 *
 * POR QUE NÃO É MAIS `$on("query")`: o evento de query do Prisma é emitido
 * pelo engine em um contexto assíncrono PRÓPRIO, que não herda o
 * AsyncLocalStorage de quem disparou a query. `als.getStore()` devolvia
 * undefined dentro do listener, o `if (!store) return` descartava tudo em
 * silêncio, e todo request logava `db=0ms q=0` — inclusive endpoints de 12 s
 * batendo pesado no banco. Foi o defeito observado em homologação em
 * 13/08/2026.
 *
 * `$use` roda no MESMO contexto assíncrono do chamador: o store existe e a
 * contagem fica presa ao request que originou a operação.
 *
 * O que é medido: a operação Prisma inteira (engine + rede + serialização),
 * não apenas o tempo de execução do SQL no Postgres. É um limite superior do
 * custo de banco por operação — ver a nota de `dbMs` em DevPerfEndpointSample.
 *
 * Privacidade: nada de `params` é lido — nem SQL, nem argumentos, nem nome de
 * modelo. Só incrementa contador e soma duração.
 */
export function installDevPerfPrismaInstrumentation(client: PrismaClient): void {
  if (!isDevPerfBaselineEnvEnabled() || prismaListenerInstalled) return;
  prismaListenerInstalled = true;
  client.$use(async (params, next) => {
    const store = als.getStore();
    // Fora de request instrumentado (jobs, cron, boot) não há o que somar.
    if (!store) return next(params);
    const startedAt = performance.now();
    try {
      return await next(params);
    } finally {
      store.queryCount += 1;
      store.dbMs += performance.now() - startedAt;
    }
  });
}

/** Só para teste: permite reinstalar a instrumentação numa nova instância. */
export function resetDevPerfPrismaInstrumentationForTests(): void {
  prismaListenerInstalled = false;
}

function buildAccountedWallFields(store: PerfStore, totalMs?: number) {
  const accountedPhases = snapshotAccountedPhases(store);
  const serializeMs =
    store.serializeMs == null ? null : roundDevPerfMs(store.serializeMs);
  const accountedWallMs = sumAccountedWallMs(accountedPhases, serializeMs);
  return {
    accountedPhases,
    accountedWallMs,
    unaccountedWallMs:
      totalMs == null ? null : computeUnaccountedWallMs(totalMs, accountedWallMs),
  };
}

export async function runWithDevPerfContext<T>(fn: () => Promise<T>): Promise<{
  result: T;
  queryCount: number;
  dbMs: number;
  phases: Record<string, number> | null;
  accountedPhases: Record<string, number> | null;
  accountedWallMs: number;
  rowCounts: DevPerfRowCounts | null;
  serializeMs: number | null;
  profilingSerializeMs: number | null;
}> {
  const store = newStore();
  const result = await als.run(store, fn);
  const accounted = buildAccountedWallFields(store);
  return {
    result,
    queryCount: store.queryCount,
    dbMs: store.dbMs,
    phases: snapshotPhases(store),
    accountedPhases: accounted.accountedPhases,
    accountedWallMs: accounted.accountedWallMs,
    rowCounts: snapshotRowCounts(store),
    serializeMs: store.serializeMs,
    profilingSerializeMs: store.profilingSerializeMs,
  };
}

export async function measureDevPerfScenario<T>(input: {
  scenario: string;
  method?: string;
  path: string;
  run: () => Promise<T>;
  rowCountApprox?: (result: T) => number | null;
  notes?: string;
}): Promise<{ result: T; sample: DevPerfEndpointSample }> {
  const t0 = performance.now();
  const measured = await runWithDevPerfContext(input.run);
  const { result, queryCount, dbMs, phases, rowCounts } = measured;
  const totalMs = roundDevPerfMs(performance.now() - t0);
  const accounted = {
    accountedPhases: measured.accountedPhases,
    accountedWallMs: measured.accountedWallMs,
    unaccountedWallMs: computeUnaccountedWallMs(totalMs, measured.accountedWallMs),
  };
  // Stringify extra SOMENTE para estimar bytes — relógio do cenário já parou.
  const profStarted = performance.now();
  const payloadBytesApprox = approxJsonBytes(result);
  const profilingSerializeMs = performance.now() - profStarted;
  const sample: DevPerfEndpointSample = {
    scenario: input.scenario,
    method: input.method ?? "SERVICE",
    path: input.path,
    status: 200,
    totalMs,
    dbMs: roundDevPerfMs(dbMs),
    queryCount,
    payloadBytesApprox,
    rowCountApprox: input.rowCountApprox?.(result) ?? (rowCounts?.ar ?? null),
    serializeMs: null,
    profilingSerializeMs: roundDevPerfMs(profilingSerializeMs),
    phases,
    accountedPhases: accounted.accountedPhases,
    accountedWallMs: accounted.accountedWallMs,
    unaccountedWallMs: accounted.unaccountedWallMs,
    rowCounts,
    notes:
      input.notes ??
      "profilingSerializeMs=JSON.stringify extra para bytes; excluído de totalMs. unaccountedWallMs=totalMs-accountedWallMs (NÃO usa dbMs). dbMs é soma Prisma (pode > totalMs se queries paralelas). NÃO use totalMs-dbMs como CPU.",
  };
  pushSample(sample);
  if (isDevPerfBaselineEnvEnabled()) {
    const phaseText = formatPhasesForLog(phases);
    console.info(
      `[perf-baseline] ${sample.scenario} ${sample.path} total=${sample.totalMs}ms db=${sample.dbMs}ms queries=${sample.queryCount} bytes≈${sample.payloadBytesApprox} accountedWallMs=${sample.accountedWallMs} unaccountedWallMs=${sample.unaccountedWallMs} profilingSerializeMs=${sample.profilingSerializeMs} (excludedFromTotalMs)${phaseText}`
    );
  }
  return { result, sample };
}

function formatPhasesForLog(phases: Record<string, number> | null | undefined): string {
  if (!phases) return "";
  const parts = Object.entries(phases)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, ms]) => `${name}:${ms}`);
  return parts.length > 0 ? ` phases=${parts.join(",")}` : "";
}

function formatRowCountsForLog(counts: DevPerfRowCounts | null | undefined): string {
  if (!counts) return "";
  const parts: string[] = [];
  if (counts.ar != null) parts.push(`ar:${counts.ar}`);
  if (counts.ap != null) parts.push(`ap:${counts.ap}`);
  if (counts.orders != null) parts.push(`orders:${counts.orders}`);
  return parts.length > 0 ? ` rows=${parts.join(",")}` : "";
}

export function getDevPerfSamples(): DevPerfEndpointSample[] {
  return [...samples];
}

export function clearDevPerfSamples(): void {
  samples.length = 0;
}

const PERF_PATH_PREFIXES = ["/api/sales-orders", "/api/finance/", "/api/commercial/sales-order-flow"];

function shouldInstrumentPath(path: string): boolean {
  return PERF_PATH_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * Middleware Express: mede duração + queries do request.
 * Adiciona header `X-IndusCost-Perf` (métricas agregadas, sem payload).
 */
export function createDevPerfBaselineMiddleware() {
  return function devPerfBaselineMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (!isDevPerfBaselineEnvEnabled()) {
      next();
      return;
    }
    if (!shouldInstrumentPath(req.path)) {
      next();
      return;
    }

    const store = newStore();
    const t0 = performance.now();
    let payloadBytes: number | null = null;
    let headerSet = false;

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      // Bytes: stringify extra só com profiling. Relógio de totalMs desconta isto.
      const profStarted = performance.now();
      try {
        payloadBytes = approxJsonBytes(body);
      } catch {
        payloadBytes = null;
      }
      store.profilingSerializeMs = performance.now() - profStarted;

      if (!headerSet) {
        headerSet = true;
        const totalMs = roundDevPerfMs(
          performance.now() - t0 - (store.profilingSerializeMs ?? 0)
        );
        try {
          res.setHeader(
            "X-IndusCost-Perf",
            `totalMs=${totalMs};dbMs=${roundDevPerfMs(store.dbMs)};queries=${store.queryCount};bytes=${payloadBytes ?? 0}`
          );
        } catch {
          /* ignore */
        }
      }

      const serializeStarted = performance.now();
      const result = originalJson(body);
      store.serializeMs = performance.now() - serializeStarted;
      return result;
    }) as typeof res.json;

    res.on("finish", () => {
      const wallMs = performance.now() - t0;
      const totalMs = roundDevPerfMs(wallMs - (store.profilingSerializeMs ?? 0));
      const phases = snapshotPhases(store);
      const rowCounts = snapshotRowCounts(store);
      const accounted = buildAccountedWallFields(store, totalMs);
      const sample: DevPerfEndpointSample = {
        scenario: `http:${req.method}:${req.path}`,
        method: req.method,
        path: req.originalUrl.split("?")[0] ?? req.path,
        status: res.statusCode,
        totalMs,
        dbMs: roundDevPerfMs(store.dbMs),
        queryCount: store.queryCount,
        payloadBytesApprox: payloadBytes,
        rowCountApprox: rowCounts?.ar ?? null,
        serializeMs:
          store.serializeMs == null ? null : roundDevPerfMs(store.serializeMs),
        profilingSerializeMs:
          store.profilingSerializeMs == null
            ? null
            : roundDevPerfMs(store.profilingSerializeMs),
        phases,
        accountedPhases: accounted.accountedPhases,
        accountedWallMs: accounted.accountedWallMs,
        unaccountedWallMs: accounted.unaccountedWallMs,
        rowCounts,
        notes:
          "totalMs exclui profilingSerializeMs (JSON.stringify extra para bytes). serializeMs=res.json real entra em accountedWallMs. unaccountedWallMs=totalMs-accountedWallMs (NÃO usa dbMs). dbMs=soma Prisma (pode > totalMs). NÃO use totalMs-dbMs como CPU.",
      };
      pushSample(sample);
      console.info(
        `[perf-baseline:http] ${sample.method} ${sample.path} status=${sample.status} total=${sample.totalMs}ms db=${sample.dbMs}ms q=${sample.queryCount} bytes≈${sample.payloadBytesApprox ?? 0} accountedWallMs=${sample.accountedWallMs} unaccountedWallMs=${sample.unaccountedWallMs} serializeMs=${sample.serializeMs ?? "n/a"} profilingSerializeMs=${sample.profilingSerializeMs ?? 0} (excludedFromTotalMs)${formatPhasesForLog(phases)}${formatRowCountsForLog(rowCounts)}`
      );
    });

    als.run(store, () => next());
  };
}
