import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  NOMUS_AR_SYNC_LOCK_FILE,
  NOMUS_AR_SYNC_MODE,
  NOMUS_AR_SYNC_SCRIPT_NAME,
} from "./nomusAccountsReceivableSyncConstants.js";
import {
  buildArRecommendedAction,
  computeArOverallStatus,
  isArRunnerLogFileName,
  parseArRunnerLogContent,
  parseDurationMs,
} from "./nomusAccountsReceivableSyncLogParse.js";
import type { NomusAccountsReceivableSyncStatusPayload } from "./nomusAccountsReceivableSyncStatusTypes.js";
import { isGlobalNomusSyncLockHeldFromFlockProbe, isProcessActiveFromPgrepStatus } from "./nomusDailySyncRunnerShared.js";

export {
  NOMUS_AR_SYNC_CONFIRM_PHRASE,
  NOMUS_AR_SYNC_MODE,
  NOMUS_AR_SYNC_SCRIPT_NAME,
} from "./nomusAccountsReceivableSyncConstants.js";
export type { NomusAccountsReceivableSyncStatusPayload } from "./nomusAccountsReceivableSyncStatusTypes.js";
export { parseArRunnerLogContent } from "./nomusAccountsReceivableSyncLogParse.js";

let trackedChild: ChildProcess | null = null;

export class NomusAccountsReceivableSyncConflictError extends Error {
  constructor(message = "Já existe uma sincronização de Contas a Receber em andamento.") {
    super(message);
    this.name = "NomusAccountsReceivableSyncConflictError";
  }
}

export type NomusAccountsReceivableSyncStartResult = {
  started: true;
  message: string;
  startedAt: string;
  logFile: string | null;
  runnerLogFile: string | null;
  pid: number | null;
};

export function resolveNomusAccountsReceivableSyncScriptPath(projectRoot: string): string {
  return path.join(projectRoot, "scripts", NOMUS_AR_SYNC_SCRIPT_NAME);
}

export function resolveNomusSyncLogDir(): string {
  return path.resolve(process.env.NOMUS_SYNC_LOG_DIR || "/tmp/induscost-nomus-sync");
}

async function listArRunnerLogs(logDir: string): Promise<
  Array<{ fileName: string; absolutePath: string; modifiedAtMs: number }>
> {
  try {
    const names = await fs.readdir(logDir);
    const rows = await Promise.all(
      names
        .filter((n) => isArRunnerLogFileName(n))
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

function isArSyncProcessActive(): boolean {
  if (trackedChild && trackedChild.exitCode === null && !trackedChild.killed) {
    return true;
  }
  if (process.platform === "win32") {
    return false;
  }
  try {
    const result = spawnSync("pgrep", ["-f", NOMUS_AR_SYNC_SCRIPT_NAME], { stdio: "ignore" });
    return isProcessActiveFromPgrepStatus(result.status);
  } catch {
    return false;
  }
}

export async function probeAccountsReceivableSyncLockHeld(
  lockFile: string = NOMUS_AR_SYNC_LOCK_FILE
): Promise<boolean> {
  if (process.platform === "win32") {
    return false;
  }
  try {
    const probe = spawnSync("flock", ["-n", lockFile, "-c", "true"], { stdio: "ignore" });
    return isGlobalNomusSyncLockHeldFromFlockProbe(probe.status);
  } catch {
    return false;
  }
}

export async function isNomusAccountsReceivableSyncRunning(): Promise<boolean> {
  return isArSyncProcessActive() || (await probeAccountsReceivableSyncLockHeld());
}

export async function getNomusAccountsReceivableSyncStatus(): Promise<NomusAccountsReceivableSyncStatusPayload> {
  const runnerLogDir = resolveNomusSyncLogDir();
  const logs = await listArRunnerLogs(runnerLogDir);
  const hasLiveProcess = isArSyncProcessActive();
  const hasActiveLock = await probeAccountsReceivableSyncLockHeld();

  let lastRun: NomusAccountsReceivableSyncStatusPayload["lastRun"] = null;
  let lastSuccess: NomusAccountsReceivableSyncStatusPayload["lastSuccess"] = null;
  let lastFailure: NomusAccountsReceivableSyncStatusPayload["lastFailure"] = null;

  let latestParsed = parseArRunnerLogContent("");
  let latestLogAgeMs: number | null = null;

  for (const entry of logs) {
    let content = "";
    try {
      content = await fs.readFile(entry.absolutePath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseArRunnerLogContent(content);
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

  const { overallStatus, isActuallyRunning, staleReason } = computeArOverallStatus({
    hasLiveProcess,
    hasActiveLock,
    parsed: latestParsed,
    logAgeMs: latestLogAgeMs,
  });

  const recommendedAction = buildArRecommendedAction({ overallStatus, parsed: latestParsed });

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
    durationMs: parseDurationMs(latestParsed.startedAt, latestParsed.finishedAt),
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

export async function startNomusAccountsReceivableSyncApply(
  projectRoot: string
): Promise<NomusAccountsReceivableSyncStartResult> {
  if (await isNomusAccountsReceivableSyncRunning()) {
    throw new NomusAccountsReceivableSyncConflictError();
  }

  const scriptPath = resolveNomusAccountsReceivableSyncScriptPath(projectRoot);
  try {
    await fs.access(scriptPath);
  } catch {
    throw new Error("Script da rotina de Contas a Receber Nomus não encontrado no servidor.");
  }

  const logDir = resolveNomusSyncLogDir();
  await fs.mkdir(logDir, { recursive: true });

  const child = spawn("bash", [scriptPath, NOMUS_AR_SYNC_MODE], {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      NOMUS_SYNC_LOG_DIR: logDir,
      NOMUS_AR_SYNC_LOCK_FILE: NOMUS_AR_SYNC_LOCK_FILE,
      INDUSCOST_APP_DIR: process.env.INDUSCOST_APP_DIR || projectRoot,
      NOMUS_AR_INCREMENTAL: "1",
      NOMUS_CANONICAL_SOURCE_TRIGGER: "ADMIN_PANEL",
      NOMUS_CANONICAL_STRATEGY: "FULL_RECONCILIATION",
      NOMUS_CANONICAL_ALLOW_MISSING_DETECTION: "0",
      NOMUS_CANONICAL_ALLOW_MISSING_CONFIRMATION: "0",
    },
  });

  child.unref();
  trackedChild = child;
  child.on("exit", () => {
    if (trackedChild === child) trackedChild = null;
  });

  await new Promise((r) => setTimeout(r, 600));
  const logs = await listArRunnerLogs(logDir);
  const newest = logs[0];

  return {
    started: true,
    message:
      "Sincronização de Contas a Receber iniciada. Acompanhe o status e os logs nesta tela.",
    startedAt: new Date().toISOString(),
    logFile: newest?.absolutePath ?? null,
    runnerLogFile: newest?.fileName ?? null,
    pid: child.pid ?? null,
  };
}
