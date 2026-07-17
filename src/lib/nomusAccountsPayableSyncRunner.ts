import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  NOMUS_AP_SYNC_LOCK_FILE,
  NOMUS_AP_SYNC_MODE,
  NOMUS_AP_SYNC_SCRIPT_NAME,
} from "./nomusAccountsPayableSyncConstants.js";
import {
  buildApRecommendedAction,
  computeApOverallStatus,
  isApRunnerLogFileName,
  parseApDurationMs,
  parseApRunnerLogContent,
} from "./nomusAccountsPayableSyncLogParse.js";
import type { NomusAccountsPayableSyncStatusPayload } from "./nomusAccountsPayableSyncStatusTypes.js";
import { isGlobalNomusSyncLockHeldFromFlockProbe, isProcessActiveFromPgrepStatus } from "./nomusDailySyncRunnerShared.js";

export {
  NOMUS_AP_SYNC_CONFIRM_PHRASE,
  NOMUS_AP_SYNC_MODE,
  NOMUS_AP_SYNC_SCRIPT_NAME,
} from "./nomusAccountsPayableSyncConstants.js";
export type { NomusAccountsPayableSyncStatusPayload } from "./nomusAccountsPayableSyncStatusTypes.js";
export { parseApRunnerLogContent } from "./nomusAccountsPayableSyncLogParse.js";

let trackedChild: ChildProcess | null = null;

export class NomusAccountsPayableSyncConflictError extends Error {
  constructor(message = "Já existe uma sincronização de Contas a Pagar em andamento.") {
    super(message);
    this.name = "NomusAccountsPayableSyncConflictError";
  }
}

export type NomusAccountsPayableSyncStartResult = {
  started: true;
  message: string;
  startedAt: string;
  logFile: string | null;
  runnerLogFile: string | null;
  pid: number | null;
};

export function resolveNomusAccountsPayableSyncScriptPath(projectRoot: string): string {
  return path.join(projectRoot, "scripts", NOMUS_AP_SYNC_SCRIPT_NAME);
}

export function resolveNomusSyncLogDir(): string {
  return path.resolve(process.env.NOMUS_SYNC_LOG_DIR || "/tmp/induscost-nomus-sync");
}

async function listApRunnerLogs(logDir: string): Promise<
  Array<{ fileName: string; absolutePath: string; modifiedAtMs: number }>
> {
  try {
    const names = await fs.readdir(logDir);
    const rows = await Promise.all(
      names
        .filter((n) => isApRunnerLogFileName(n))
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

function isApSyncProcessActive(): boolean {
  if (trackedChild && trackedChild.exitCode === null && !trackedChild.killed) {
    return true;
  }
  if (process.platform === "win32") {
    return false;
  }
  try {
    const result = spawnSync("pgrep", ["-f", NOMUS_AP_SYNC_SCRIPT_NAME], { stdio: "ignore" });
    return isProcessActiveFromPgrepStatus(result.status);
  } catch {
    return false;
  }
}

export async function probeAccountsPayableSyncLockHeld(
  lockFile: string = NOMUS_AP_SYNC_LOCK_FILE
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

export async function isNomusAccountsPayableSyncRunning(): Promise<boolean> {
  return isApSyncProcessActive() || (await probeAccountsPayableSyncLockHeld());
}

export async function getNomusAccountsPayableSyncStatus(): Promise<NomusAccountsPayableSyncStatusPayload> {
  const runnerLogDir = resolveNomusSyncLogDir();
  const logs = await listApRunnerLogs(runnerLogDir);
  const hasLiveProcess = isApSyncProcessActive();
  const hasActiveLock = await probeAccountsPayableSyncLockHeld();

  let lastRun: NomusAccountsPayableSyncStatusPayload["lastRun"] = null;
  let lastSuccess: NomusAccountsPayableSyncStatusPayload["lastSuccess"] = null;
  let lastFailure: NomusAccountsPayableSyncStatusPayload["lastFailure"] = null;

  let latestParsed = parseApRunnerLogContent("");
  let latestLogAgeMs: number | null = null;

  for (const entry of logs) {
    let content = "";
    try {
      content = await fs.readFile(entry.absolutePath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseApRunnerLogContent(content);
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

  const { overallStatus, isActuallyRunning, staleReason } = computeApOverallStatus({
    hasLiveProcess,
    hasActiveLock,
    parsed: latestParsed,
    logAgeMs: latestLogAgeMs,
  });

  const recommendedAction = buildApRecommendedAction({ overallStatus, parsed: latestParsed });

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
    durationMs: parseApDurationMs(latestParsed.startedAt, latestParsed.finishedAt),
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

export async function startNomusAccountsPayableSyncApply(
  projectRoot: string
): Promise<NomusAccountsPayableSyncStartResult> {
  if (await isNomusAccountsPayableSyncRunning()) {
    throw new NomusAccountsPayableSyncConflictError();
  }

  const scriptPath = resolveNomusAccountsPayableSyncScriptPath(projectRoot);
  try {
    await fs.access(scriptPath);
  } catch {
    throw new Error("Script da rotina de Contas a Pagar Nomus não encontrado no servidor.");
  }

  const logDir = resolveNomusSyncLogDir();
  await fs.mkdir(logDir, { recursive: true });

  const child = spawn("bash", [scriptPath, NOMUS_AP_SYNC_MODE], {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      NOMUS_SYNC_LOG_DIR: logDir,
      NOMUS_AP_SYNC_LOCK_FILE: NOMUS_AP_SYNC_LOCK_FILE,
      INDUSCOST_APP_DIR: process.env.INDUSCOST_APP_DIR || projectRoot,
      NOMUS_AP_INCREMENTAL: "1",
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
  const logs = await listApRunnerLogs(logDir);
  const newest = logs[0];

  return {
    started: true,
    message:
      "Sincronização de Contas a Pagar iniciada. Acompanhe o status e os logs nesta tela.",
    startedAt: new Date().toISOString(),
    logFile: newest?.absolutePath ?? null,
    runnerLogFile: newest?.fileName ?? null,
    pid: child.pid ?? null,
  };
}
