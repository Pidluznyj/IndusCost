import type { PrismaClient } from "@prisma/client";
import { readCnpjWeeklyRefreshConfig } from "./config.js";
import { CNPJ_WEEKLY_REFRESH_REGISTERED_JOB } from "./schedule.js";
import { createCnpjRefreshRunner, type CnpjRefreshRunnerDeps } from "./refreshRun.js";
import { createPrismaCnpjRefreshStore } from "./store.server.js";

export const CNPJ_WEEKLY_REFRESH_LOG_PREFIX = "[cnpj-weekly-refresh]" as const;
const TICK_MS = 60_000;

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerStarted = false;
let sharedRunner: ReturnType<typeof createCnpjRefreshRunner> | null = null;

export function getCnpjRefreshRunner(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env) {
  if (!sharedRunner) {
    sharedRunner = createCnpjRefreshRunner({
      store: createPrismaCnpjRefreshStore(prisma),
      config: readCnpjWeeklyRefreshConfig(env),
    });
  }
  return sharedRunner;
}

export function startCnpjWeeklyRefreshScheduledJob(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env): void {
  if (schedulerStarted) return;
  const config = readCnpjWeeklyRefreshConfig(env);
  if (!config.enabled) {
    console.info(`${CNPJ_WEEKLY_REFRESH_LOG_PREFIX} scheduler desligado. Defina CNPJ_WEEKLY_REFRESH_ENABLED=true para o domingo às 08:00.`);
    return;
  }
  schedulerStarted = true;
  const runner = getCnpjRefreshRunner(prisma, env);
  console.info(
    `${CNPJ_WEEKLY_REFRESH_LOG_PREFIX} job=${CNPJ_WEEKLY_REFRESH_REGISTERED_JOB.id} cron=${CNPJ_WEEKLY_REFRESH_REGISTERED_JOB.cronExpression} tz=${CNPJ_WEEKLY_REFRESH_REGISTERED_JOB.timezone}`
  );
  const tick = () => {
    void runner.startScheduled().catch((error) => {
      console.error(`${CNPJ_WEEKLY_REFRESH_LOG_PREFIX} falha no agendamento`, error instanceof Error ? error.name : "error");
    });
  };
  tick();
  schedulerTimer = setInterval(tick, TICK_MS);
  schedulerTimer.unref?.();
}

export function resetCnpjWeeklyRefreshSchedulerForTests(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  schedulerStarted = false;
  sharedRunner = null;
}

export function cnpjRefreshDepsFor(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env): CnpjRefreshRunnerDeps {
  return { store: createPrismaCnpjRefreshStore(prisma), config: readCnpjWeeklyRefreshConfig(env) };
}
