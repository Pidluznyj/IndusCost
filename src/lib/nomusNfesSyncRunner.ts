import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  NOMUS_NFE_SYNC_LOCK_FILE,
  NOMUS_NFE_SYNC_MODE,
  NOMUS_NFE_SYNC_SCRIPT_NAME,
} from "./nomusNfesSyncConstants.js";
import {
  buildNfeRecommendedAction,
  computeNfeOverallStatus,
  isNfeRunnerLogFileName,
  parseNfeDurationMs,
  parseNfeRunnerLogContent,
} from "./nomusNfesSyncLogParse.js";
import type { NomusNfesSyncStatusPayload } from "./nomusNfesSyncStatusTypes.js";
import { isGlobalNomusSyncLockHeldFromFlockProbe, isProcessActiveFromPgrepStatus } from "./nomusDailySyncRunnerShared.js";

export {
  NOMUS_NFE_SYNC_CONFIRM_PHRASE,
  NOMUS_NFE_SYNC_MODE,
  NOMUS_NFE_SYNC_SCRIPT_NAME,
} from "./nomusNfesSyncConstants.js";
export type { NomusNfesSyncStatusPayload } from "./nomusNfesSyncStatusTypes.js";
export { parseNfeRunnerLogContent } from "./nomusNfesSyncLogParse.js";

let trackedChild: ChildProcess | null = null;

export class NomusNfesSyncConflictError extends Error {
  constructor(message = "Já existe uma sincronização de NF-e em andamento.") {
    super(message);
    this.name = "NomusNfesSyncConflictError";
  }
}

export type NomusNfesSyncStartResult = {
  started: true;
  message: string;
  startedAt: string;
  logFile: string | null;
  runnerLogFile: string | null;
  pid: number | null;
};

export function resolveNomusNfesSyncScriptPath(projectRoot: string): string {
  return path.join(projectRoot, "scripts", NOMUS_NFE_SYNC_SCRIPT_NAME);
}

export function resolveNomusNfeSyncLogDir(): string {
  return path.resolve(process.env.NOMUS_SYNC_LOG_DIR || "/tmp/induscost-nomus-sync");
}

async function listNfeRunnerLogs(logDir: string): Promise<
  Array<{ fileName: string; absolutePath: string; modifiedAtMs: number }>
> {
  try {
    const names = await fs.readdir(logDir);
    const rows = await Promise.all(
      names
        .filter((n) => isNfeRunnerLogFileName(n))
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

function isNfeSyncProcessActive(): boolean {
  if (trackedChild && trackedChild.exitCode === null && !trackedChild.killed) {
    return true;
  }
  if (process.platform === "win32") {
    return false;
  }
  try {
    const result = spawnSync("pgrep", ["-f", NOMUS_NFE_SYNC_SCRIPT_NAME], { stdio: "ignore" });
    return isProcessActiveFromPgrepStatus(result.status);
  } catch {
    return false;
  }
}

export async function probeNfesSyncLockHeld(
  lockFile: string = NOMUS_NFE_SYNC_LOCK_FILE
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

export async function isNomusNfesSyncRunning(): Promise<boolean> {
  return isNfeSyncProcessActive() || (await probeNfesSyncLockHeld());
}

export async function getNomusNfesSyncStatus(): Promise<NomusNfesSyncStatusPayload> {
  const runnerLogDir = resolveNomusNfeSyncLogDir();
  const logs = await listNfeRunnerLogs(runnerLogDir);
  const hasLiveProcess = isNfeSyncProcessActive();
  const hasActiveLock = await probeNfesSyncLockHeld();

  let lastRun: NomusNfesSyncStatusPayload["lastRun"] = null;
  let lastSuccess: NomusNfesSyncStatusPayload["lastSuccess"] = null;
  let lastFailure: NomusNfesSyncStatusPayload["lastFailure"] = null;

  let latestParsed = parseNfeRunnerLogContent("");
  let latestLogAgeMs: number | null = null;

  for (const entry of logs) {
    let content = "";
    try {
      content = await fs.readFile(entry.absolutePath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseNfeRunnerLogContent(content);
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

  const { overallStatus, isActuallyRunning, staleReason } = computeNfeOverallStatus({
    hasLiveProcess,
    hasActiveLock,
    parsed: latestParsed,
    logAgeMs: latestLogAgeMs,
  });

  const recommendedAction = buildNfeRecommendedAction({ overallStatus, parsed: latestParsed });

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
    durationMs: parseNfeDurationMs(latestParsed.startedAt, latestParsed.finishedAt),
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

export async function startNomusNfesSyncApply(
  projectRoot: string
): Promise<NomusNfesSyncStartResult> {
  if (await isNomusNfesSyncRunning()) {
    throw new NomusNfesSyncConflictError();
  }

  const scriptPath = resolveNomusNfesSyncScriptPath(projectRoot);
  try {
    await fs.access(scriptPath);
  } catch {
    throw new Error("Script da rotina de NF-e Nomus não encontrado no servidor.");
  }

  const logDir = resolveNomusNfeSyncLogDir();
  await fs.mkdir(logDir, { recursive: true });

  const child = spawn("bash", [scriptPath, NOMUS_NFE_SYNC_MODE], {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      NOMUS_SYNC_LOG_DIR: logDir,
      NOMUS_NFE_SYNC_LOCK_FILE: NOMUS_NFE_SYNC_LOCK_FILE,
      INDUSCOST_APP_DIR: process.env.INDUSCOST_APP_DIR || projectRoot,
      NOMUS_NFE_INCREMENTAL: "1",
    },
  });

  child.unref();
  trackedChild = child;
  child.on("exit", () => {
    if (trackedChild === child) trackedChild = null;
  });

  await new Promise((r) => setTimeout(r, 600));
  const logs = await listNfeRunnerLogs(logDir);
  const newest = logs[0];

  return {
    started: true,
    message: "Sincronização de NF-e iniciada. Acompanhe o status nesta tela.",
    startedAt: new Date().toISOString(),
    logFile: newest?.absolutePath ?? null,
    runnerLogFile: newest?.fileName ?? null,
    pid: child.pid ?? null,
  };
}
