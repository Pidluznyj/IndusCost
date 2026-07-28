/**
 * Scheduler in-process do espelho planilha (padrão PTAX setInterval).
 */
import type { PrismaClient } from "@prisma/client";
import { readMaterialStockSpreadsheetMirrorConfig } from "./config.js";
import { createMaterialStockSpreadsheetOutboxRepository } from "./repository.server.js";
import { runMaterialStockSpreadsheetMirrorWorker } from "./worker.server.js";

export const MATERIAL_STOCK_SPREADSHEET_MIRROR_JOB_ID =
  "material-stock-spreadsheet-mirror" as const;

const LOG_PREFIX = "[material-stock-spreadsheet-mirror]";

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerStarted = false;
let running = false;
let prismaRef: PrismaClient | null = null;

export async function runMaterialStockSpreadsheetMirrorScheduledTick(
  prisma: PrismaClient = prismaRef!
): Promise<void> {
  if (!prisma) return;
  if (running) return;
  const config = readMaterialStockSpreadsheetMirrorConfig();
  if (!config.enabled) return;

  running = true;
  try {
    const repository = createMaterialStockSpreadsheetOutboxRepository(prisma);
    await runMaterialStockSpreadsheetMirrorWorker({
      repository,
      workerId: `${MATERIAL_STOCK_SPREADSHEET_MIRROR_JOB_ID}:${process.pid}`,
      maxJobs: config.workerBatchSize,
    });
  } catch (error) {
    console.error(
      `${LOG_PREFIX} worker tick crashed:`,
      error instanceof Error ? error.message : "erro"
    );
  } finally {
    running = false;
  }
}

export function startMaterialStockSpreadsheetMirrorScheduledJob(
  prisma: PrismaClient
): void {
  if (schedulerStarted) return;
  prismaRef = prisma;
  const config = readMaterialStockSpreadsheetMirrorConfig();
  if (!config.enabled) {
    console.info(
      `${LOG_PREFIX} scheduler idle (MATERIAL_STOCK_SPREADSHEET_MIRROR_ENABLED off)`
    );
    schedulerStarted = true;
    // Ainda registra timer leve para ativar se env mudar em runtime? Não —
    // exige restart. Mantemos started para idempotência.
    return;
  }

  schedulerStarted = true;
  console.info(
    `${LOG_PREFIX} registered job=${MATERIAL_STOCK_SPREADSHEET_MIRROR_JOB_ID} intervalMs=${config.workerIntervalMs}`
  );
  void runMaterialStockSpreadsheetMirrorScheduledTick(prisma);
  schedulerTimer = setInterval(() => {
    void runMaterialStockSpreadsheetMirrorScheduledTick(prisma);
  }, config.workerIntervalMs);
  schedulerTimer.unref?.();
}

export function resetMaterialStockSpreadsheetMirrorSchedulerForTests(): void {
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
  schedulerStarted = false;
  running = false;
  prismaRef = null;
}
