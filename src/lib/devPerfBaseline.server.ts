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
  type DevPerfEndpointSample,
} from "@/src/lib/devPerfBaseline.js";

type PerfStore = {
  queryCount: number;
  dbMs: number;
  labels: string[];
};

const als = new AsyncLocalStorage<PerfStore>();
let prismaListenerInstalled = false;
const samples: DevPerfEndpointSample[] = [];

function newStore(): PerfStore {
  return { queryCount: 0, dbMs: 0, labels: [] };
}

export function isDevPerfBaselineServerEnabled(): boolean {
  return isDevPerfBaselineEnvEnabled();
}

/** Anexa listener de query ao Prisma (idempotente). Só com flag. */
export function installDevPerfPrismaQueryListener(client: PrismaClient): void {
  if (!isDevPerfBaselineEnvEnabled() || prismaListenerInstalled) return;
  prismaListenerInstalled = true;
  client.$on("query" as never, (e: { duration: number; query?: string }) => {
    const store = als.getStore();
    if (!store) return;
    store.queryCount += 1;
    store.dbMs += Number(e.duration) || 0;
  });
}

export async function runWithDevPerfContext<T>(fn: () => Promise<T>): Promise<{
  result: T;
  queryCount: number;
  dbMs: number;
}> {
  const store = newStore();
  const result = await als.run(store, fn);
  return { result, queryCount: store.queryCount, dbMs: store.dbMs };
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
  const { result, queryCount, dbMs } = await runWithDevPerfContext(input.run);
  const totalMs = performance.now() - t0;
  const payloadBytesApprox = approxJsonBytes(result);
  const sample: DevPerfEndpointSample = {
    scenario: input.scenario,
    method: input.method ?? "SERVICE",
    path: input.path,
    status: 200,
    totalMs: Math.round(totalMs * 100) / 100,
    dbMs: Math.round(dbMs * 100) / 100,
    queryCount,
    payloadBytesApprox,
    rowCountApprox: input.rowCountApprox?.(result) ?? null,
    notes: input.notes,
  };
  samples.push(sample);
  if (isDevPerfBaselineEnvEnabled()) {
    console.info(
      `[perf-baseline] ${sample.scenario} ${sample.path} total=${sample.totalMs}ms db=${sample.dbMs}ms queries=${sample.queryCount} bytes≈${sample.payloadBytesApprox}`
    );
  }
  return { result, sample };
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
      try {
        payloadBytes = approxJsonBytes(body);
      } catch {
        payloadBytes = null;
      }
      if (!headerSet) {
        headerSet = true;
        const totalMs = Math.round((performance.now() - t0) * 100) / 100;
        try {
          res.setHeader(
            "X-IndusCost-Perf",
            `totalMs=${totalMs};dbMs=${Math.round(store.dbMs * 100) / 100};queries=${store.queryCount};bytes=${payloadBytes ?? 0}`
          );
        } catch {
          /* ignore */
        }
      }
      return originalJson(body);
    }) as typeof res.json;

    res.on("finish", () => {
      const totalMs = Math.round((performance.now() - t0) * 100) / 100;
      const sample: DevPerfEndpointSample = {
        scenario: `http:${req.method}:${req.path}`,
        method: req.method,
        path: req.originalUrl.split("?")[0] ?? req.path,
        status: res.statusCode,
        totalMs,
        dbMs: Math.round(store.dbMs * 100) / 100,
        queryCount: store.queryCount,
        payloadBytesApprox: payloadBytes,
        rowCountApprox: null,
      };
      samples.push(sample);
      console.info(
        `[perf-baseline:http] ${sample.method} ${sample.path} status=${sample.status} total=${sample.totalMs}ms db=${sample.dbMs}ms q=${sample.queryCount} bytes≈${sample.payloadBytesApprox ?? 0}`
      );
    });

    als.run(store, () => next());
  };
}
