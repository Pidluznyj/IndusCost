/**
 * Guard de concorrência + auditoria para runners de OP (OP-11).
 */

import type { PrismaClient } from "@prisma/client";
import {
  auditFromBackfillSummary,
  auditFromIncrementalSummary,
  buildBlockedProductionOrdersAudit,
  formatProductionOrdersSyncAuditLog,
  maskProductionOrdersSensitiveText,
  type ProductionOrdersSyncAuditRecord,
} from "@/src/lib/nomusProductionOrdersSyncAudit.js";
import { persistProductionOrdersIntegrationRun } from "@/src/lib/nomusProductionOrdersIntegrationRun.js";
import {
  NOMUS_PRODUCTION_ORDERS_LOG_PREFIX,
  type ProductionOrdersSyncRunMode,
  type ProductionOrdersSyncRunType,
} from "@/src/lib/nomusProductionOrdersSyncConstants.js";
import {
  acquireProductionOrdersSyncLock,
  formatProductionOrdersLockBlockedLog,
  releaseProductionOrdersSyncLock,
} from "@/src/lib/nomusProductionOrdersSyncLock.js";

export type ProductionOrdersSyncGuardResult<T> = {
  blocked: boolean;
  audit: ProductionOrdersSyncAuditRecord;
  result: T | null;
  exitCode: number;
};

export type ProductionOrdersSyncGuardDeps = {
  type: ProductionOrdersSyncRunType;
  mode: ProductionOrdersSyncRunMode;
  lockFile?: string;
  env?: NodeJS.ProcessEnv;
  respectGlobalLock?: boolean;
  probeGlobalLock?: () => boolean;
  skipLock?: boolean;
  prisma?: PrismaClient | null;
  persistAudit?: (audit: ProductionOrdersSyncAuditRecord) => Promise<void> | void;
  logger?: (message: string) => void;
  now?: () => Date;
};

async function recordAudit(
  deps: ProductionOrdersSyncGuardDeps,
  audit: ProductionOrdersSyncAuditRecord
): Promise<void> {
  const log = deps.logger ?? ((m: string) => console.warn(m));
  log(formatProductionOrdersSyncAuditLog(audit));
  if (deps.persistAudit) {
    await deps.persistAudit(audit);
    return;
  }
  if (deps.prisma) {
    await persistProductionOrdersIntegrationRun(deps.prisma, { audit });
  }
}

/**
 * Adquire lock, executa, libera sempre (sucesso ou erro), registra auditoria.
 * Em BLOCKED: não chama `run` (sem API).
 */
export async function withProductionOrdersSyncGuard<T>(
  deps: ProductionOrdersSyncGuardDeps,
  run: () => Promise<T>,
  mapResultToAudit: (result: T, ctx: { startedAt: Date; finishedAt: Date; lockFile: string | null }) => ProductionOrdersSyncAuditRecord
): Promise<ProductionOrdersSyncGuardResult<T>> {
  const startedAt = (deps.now ?? (() => new Date()))();
  const log = deps.logger ?? ((m: string) => console.warn(m));

  if (deps.skipLock) {
    try {
      const result = await run();
      const finishedAt = (deps.now ?? (() => new Date()))();
      const audit = mapResultToAudit(result, { startedAt, finishedAt, lockFile: null });
      await recordAudit(deps, audit);
      return { blocked: false, audit, result, exitCode: audit.exitCode };
    } catch (error) {
      const finishedAt = (deps.now ?? (() => new Date()))();
      const message = error instanceof Error ? error.message : String(error);
      const audit = buildBlockedProductionOrdersAudit({
        type: deps.type,
        mode: deps.mode,
        startedAt,
        finishedAt,
        message: `FAILED: ${message}`,
        lockFile: "",
        blockedCode: "RUN_ERROR",
      });
      // Reclassificar como FAILED
      const failedAudit: ProductionOrdersSyncAuditRecord = {
        ...audit,
        status: "FAILED",
        exitCode: 1,
        blockedCode: null,
        finalMessage: maskProductionOrdersSensitiveText(message).slice(0, 2000),
      };
      await recordAudit(deps, failedAudit);
      throw error;
    }
  }

  const acquired = acquireProductionOrdersSyncLock({
    type: deps.type,
    mode: deps.mode,
    lockFile: deps.lockFile,
    env: deps.env,
    respectGlobalLock: deps.respectGlobalLock,
    probeGlobalLock: deps.probeGlobalLock,
    now: deps.now,
  });

  if (!acquired.ok) {
    const finishedAt = (deps.now ?? (() => new Date()))();
    log(formatProductionOrdersLockBlockedLog(acquired));
    const audit = buildBlockedProductionOrdersAudit({
      type: deps.type,
      mode: deps.mode,
      startedAt,
      finishedAt,
      message: acquired.message,
      lockFile: acquired.lockFile,
      blockedCode: acquired.code,
    });
    await recordAudit(deps, audit);
    return { blocked: true, audit, result: null, exitCode: 0 };
  }

  log(
    `${NOMUS_PRODUCTION_ORDERS_LOG_PREFIX} lock adquirido type=${deps.type} mode=${deps.mode} file=${acquired.lockFile} token=${acquired.token.slice(0, 8)}…`
  );

  try {
    const result = await run();
    const finishedAt = (deps.now ?? (() => new Date()))();
    const audit = mapResultToAudit(result, {
      startedAt,
      finishedAt,
      lockFile: acquired.lockFile,
    });
    await recordAudit(deps, audit);
    return { blocked: false, audit, result, exitCode: audit.exitCode };
  } catch (error) {
    const finishedAt = (deps.now ?? (() => new Date()))();
    const message = error instanceof Error ? error.message : String(error);
    const audit: ProductionOrdersSyncAuditRecord = {
      ...buildBlockedProductionOrdersAudit({
        type: deps.type,
        mode: deps.mode,
        startedAt,
        finishedAt,
        message,
        lockFile: acquired.lockFile,
        blockedCode: "RUN_ERROR",
      }),
      status: "FAILED",
      exitCode: 1,
      blockedCode: null,
      finalMessage: maskProductionOrdersSensitiveText(message).slice(0, 2000),
    };
    await recordAudit(deps, audit);
    throw error;
  } finally {
    releaseProductionOrdersSyncLock({
      lockFile: acquired.lockFile,
      token: acquired.token,
    });
    log(`${NOMUS_PRODUCTION_ORDERS_LOG_PREFIX} lock liberado file=${acquired.lockFile}`);
  }
}

export { auditFromBackfillSummary, auditFromIncrementalSummary };
