import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  NOMUS_STOCK_DOCUMENTS_SYNC_LOCK_FILE_DEFAULT,
  NOMUS_STOCK_DOCUMENTS_SYNC_MODE,
  NOMUS_STOCK_DOCUMENTS_SYNC_SCRIPT_NAME,
} from "./nomusStockDocumentsSyncConstants.js";
import {
  buildStockDocumentsRecommendedAction,
  computeStockDocumentsOverallStatus,
  isStockDocumentsRunnerLogFileName,
  parseStockDocumentsDurationMs,
  parseStockDocumentsRunnerLogContent,
} from "./nomusStockDocumentsSyncLogParse.js";
import type { NomusStockDocumentsSyncStatusPayload } from "./nomusStockDocumentsSyncStatusTypes.js";
import {
  isGlobalNomusSyncLockHeldFromFlockProbe,
  isProcessActiveFromPgrepStatus,
} from "./nomusDailySyncRunnerShared.js";

export {
  NOMUS_STOCK_DOCUMENTS_SYNC_MODE,
  NOMUS_STOCK_DOCUMENTS_SYNC_SCRIPT_NAME,
} from "./nomusStockDocumentsSyncConstants.js";
export type { NomusStockDocumentsSyncStatusPayload } from "./nomusStockDocumentsSyncStatusTypes.js";
export { parseStockDocumentsRunnerLogContent } from "./nomusStockDocumentsSyncLogParse.js";

let trackedChild: ChildProcess | null = null;

export class NomusStockDocumentsSyncConflictError extends Error {
  constructor(
    message = "Já existe uma sincronização de Documentos de Saída em andamento."
  ) {
    super(message);
    this.name = "NomusStockDocumentsSyncConflictError";
  }
}

export type NomusStockDocumentsSyncStartResult = {
  started: true;
  message: string;
  startedAt: string;
  logFile: string | null;
  runnerLogFile: string | null;
  pid: number | null;
};

export function resolveNomusStockDocumentsSyncScriptPath(projectRoot: string): string {
  return path.join(projectRoot, "scripts", NOMUS_STOCK_DOCUMENTS_SYNC_SCRIPT_NAME);
}

export function resolveNomusStockDocumentsSyncLogDir(): string {
  return path.resolve(process.env.NOMUS_SYNC_LOG_DIR || "/tmp/induscost-nomus-sync");
}

async function listStockDocumentsRunnerLogs(logDir: string): Promise<
  Array<{ fileName: string; absolutePath: string; modifiedAtMs: number }>
> {
  try {
    const names = await fs.readdir(logDir);
    const rows = await Promise.all(
      names
        .filter((n) => isStockDocumentsRunnerLogFileName(n))
        .map(async (fileName) => {
          const absolutePath = path.join(logDir, fileName);
          const stat = await fs.stat(absolutePath);
          return { fileName, absolutePath, modifiedAtMs: stat.mtimeMs };
        })
    );
    return rows.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
  } catch {
    return [];
  }
}

function isStockDocumentsSyncProcessActive(): boolean {
  if (trackedChild && trackedChild.exitCode === null && !trackedChild.killed) {
    return true;
  }
  if (process.platform === "win32") return false;
  try {
    const result = spawnSync(
      "pgrep",
      ["-f", NOMUS_STOCK_DOCUMENTS_SYNC_SCRIPT_NAME],
      { stdio: "ignore" }
    );
    return isProcessActiveFromPgrepStatus(result.status);
  } catch {
    return false;
  }
}

export async function probeStockDocumentsSyncLockHeld(
  lockFile: string = NOMUS_STOCK_DOCUMENTS_SYNC_LOCK_FILE_DEFAULT
): Promise<boolean> {
  if (process.platform === "win32") return false;
  try {
    const probe = spawnSync("flock", ["-n", lockFile, "-c", "true"], {
      stdio: "ignore",
    });
    return isGlobalNomusSyncLockHeldFromFlockProbe(probe.status);
  } catch {
    return false;
  }
}

export async function isNomusStockDocumentsSyncRunning(): Promise<boolean> {
  return (
    isStockDocumentsSyncProcessActive() || (await probeStockDocumentsSyncLockHeld())
  );
}

export async function getNomusStockDocumentsSyncStatus(): Promise<NomusStockDocumentsSyncStatusPayload> {
  const runnerLogDir = resolveNomusStockDocumentsSyncLogDir();
  const logs = await listStockDocumentsRunnerLogs(runnerLogDir);
  const hasLiveProcess = isStockDocumentsSyncProcessActive();
  const hasActiveLock = await probeStockDocumentsSyncLockHeld();

  let lastRun: NomusStockDocumentsSyncStatusPayload["lastRun"] = null;
  let lastSuccess: NomusStockDocumentsSyncStatusPayload["lastSuccess"] = null;
  let lastFailure: NomusStockDocumentsSyncStatusPayload["lastFailure"] = null;

  let latestParsed = parseStockDocumentsRunnerLogContent("");
  let latestLogAgeMs: number | null = null;

  for (const entry of logs) {
    let content = "";
    try {
      content = await fs.readFile(entry.absolutePath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseStockDocumentsRunnerLogContent(content);
    if (!lastRun) {
      latestParsed = parsed;
      latestLogAgeMs = Date.now() - entry.modifiedAtMs;
      const displayStatus =
        hasLiveProcess || hasActiveLock
          ? ("running" as const)
          : parsed.status === "running"
            ? ("failed" as const)
            : parsed.status;
      lastRun = {
        fileName: entry.fileName,
        status: displayStatus,
        startedAt: parsed.startedAt,
        finishedAt: parsed.finishedAt,
        exitCode: parsed.exitCode,
        logFile: entry.absolutePath,
      };
    }
    if (!lastSuccess && parsed.status === "success" && parsed.finishedAt) {
      lastSuccess = { finishedAt: parsed.finishedAt, fileName: entry.fileName };
    }
    if (!lastFailure && parsed.status === "failed" && parsed.finishedAt) {
      lastFailure = {
        finishedAt: parsed.finishedAt,
        fileName: entry.fileName,
        exitCode: parsed.exitCode,
      };
    }
    if (lastRun && lastSuccess && lastFailure) break;
  }

  const { overallStatus, isActuallyRunning, staleReason } =
    computeStockDocumentsOverallStatus({
      hasLiveProcess,
      hasActiveLock,
      parsed: latestParsed,
      logAgeMs: latestLogAgeMs,
    });

  const recommendedAction = buildStockDocumentsRecommendedAction({
    overallStatus,
    parsed: latestParsed,
  });

  if (lastRun && isActuallyRunning) {
    lastRun = { ...lastRun, status: "running" };
  } else if (lastRun && (overallStatus === "FAILED" || overallStatus === "STALE")) {
    lastRun = { ...lastRun, status: "failed" };
  }

  return {
    overallStatus,
    isRunning: isActuallyRunning,
    isActuallyRunning,
    hasLiveProcess,
    hasActiveLock,
    staleReason,
    startedAt: latestParsed.startedAt,
    finishedAt: latestParsed.finishedAt,
    durationMs: parseStockDocumentsDurationMs(
      latestParsed.startedAt,
      latestParsed.finishedAt
    ),
    recommendedAction,
    syncStrategy: latestParsed.syncStrategy,
    lastRun,
    lastSuccess,
    lastFailure,
    metrics: latestParsed.metrics,
    lastLogFile: lastRun?.logFile ?? null,
    lastRunnerLogFile: lastRun?.fileName ?? null,
    runnerLogDir,
  };
}

/**
 * Inicia apply incremental (soft-fail se já houver lock).
 * Não dispara backfill.
 */
export async function startNomusStockDocumentsSyncApply(
  projectRoot: string
): Promise<NomusStockDocumentsSyncStartResult> {
  if (await isNomusStockDocumentsSyncRunning()) {
    throw new NomusStockDocumentsSyncConflictError();
  }

  const scriptPath = resolveNomusStockDocumentsSyncScriptPath(projectRoot);
  try {
    await fs.access(scriptPath);
  } catch {
    throw new Error(
      "Script da rotina de Documentos de Saída Nomus não encontrado no servidor."
    );
  }

  const logDir = resolveNomusStockDocumentsSyncLogDir();
  await fs.mkdir(logDir, { recursive: true });

  const child = spawn("bash", [scriptPath, NOMUS_STOCK_DOCUMENTS_SYNC_MODE], {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      NOMUS_SYNC_LOG_DIR: logDir,
      NOMUS_STOCK_DOCUMENTS_SYNC_LOCK_FILE:
        process.env.NOMUS_STOCK_DOCUMENTS_SYNC_LOCK_FILE ||
        NOMUS_STOCK_DOCUMENTS_SYNC_LOCK_FILE_DEFAULT,
      INDUSCOST_APP_DIR: process.env.INDUSCOST_APP_DIR || projectRoot,
      NOMUS_STOCK_DOCUMENTS_INCREMENTAL: "1",
    },
  });

  child.unref();
  trackedChild = child;
  child.on("exit", () => {
    if (trackedChild === child) trackedChild = null;
  });

  await new Promise((r) => setTimeout(r, 600));
  const logs = await listStockDocumentsRunnerLogs(logDir);
  const newest = logs[0];

  return {
    started: true,
    message:
      "Sincronização incremental de Documentos de Saída iniciada. Acompanhe o status nesta tela.",
    startedAt: new Date().toISOString(),
    logFile: newest?.absolutePath ?? null,
    runnerLogFile: newest?.fileName ?? null,
    pid: child.pid ?? null,
  };
}
