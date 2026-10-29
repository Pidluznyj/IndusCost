/**
 * Worker em processo da Inteligência Fiscal 360° — DESLIGADO por padrão.
 * Liga somente com FISCAL360_WORKER_ENABLED=1 (decisão operacional, sujeita a autorização).
 * Nunca executa reconstrução histórica no startup: o primeiro ciclo só ocorre após o intervalo.
 * Alternativa recomendada em servidor: cron chamando `npm run fiscal360:process`.
 */
import type { PrismaClient } from "@prisma/client";
import { runFiscal360Processing } from "./fiscal360Processor.server.js";

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

export function isFiscal360WorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FISCAL360_WORKER_ENABLED === "1";
}

export function fiscal360WorkerIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.FISCAL360_WORKER_INTERVAL_MS ?? "", 10);
  return Number.isFinite(n) && n >= 60_000 ? n : 10 * 60_000;
}

export function startFiscal360WorkerIfEnabled(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isFiscal360WorkerEnabled(env) || timer) return false;
  const interval = fiscal360WorkerIntervalMs(env);
  timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    // Orçamento menor que o intervalo; falha não derruba o processo nem afeta outras rotas.
    runFiscal360Processing(prisma, { trigger: "WORKER", maxJobs: 2000, timeBudgetMs: Math.min(interval - 10_000, 8 * 60_000) })
      .catch((error) => console.error("[fiscal-360] worker falhou:", error instanceof Error ? error.message : error))
      .finally(() => {
        inFlight = false;
      });
  }, interval);
  timer.unref?.();
  console.log(`[fiscal-360] worker incremental ligado (intervalo ${Math.round(interval / 1000)} s).`);
  return true;
}

export function stopFiscal360Worker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
