import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  NOMUS_DAILY_SYNC_MODE,
  NOMUS_DAILY_SYNC_SCRIPT_NAME,
} from "./nomusDailySyncConstants.js";
import {
  buildRecommendedAction,
  computeNomusDailyOverallStatus,
  parseDailyRunnerLogContent,
  parseDurationMs,
} from "./nomusDailySyncLogParse.js";
import type { NomusDailySyncStatusPayload } from "./nomusDailySyncStatusTypes.js";

export { NOMUS_DAILY_SYNC_CONFIRM_PHRASE, NOMUS_DAILY_SYNC_MODE, NOMUS_DAILY_SYNC_SCRIPT_NAME } from "./nomusDailySyncConstants.js";
export type {
  NomusDailyOverallStatus,
  NomusDailySyncStatusPayload,
} from "./nomusDailySyncStatusTypes.js";
export { parseDailyRunnerLogContent, parseDailyRunnerSteps } from "./nomusDailySyncLogParse.js";
export {
  DAILY_LOG_STALE_RUNNING_MS,
  isDailyRunnerLogFileName,
  isGlobalNomusSyncLockHeldFromFlockProbe,
  isProcessActiveFromPgrepStatus,
  shouldInferDailyRunningFromLog,
} from "./nomusDailySyncRunnerShared.js";

import {
  isDailyRunnerLogFileName,
  isGlobalNomusSyncLockHeldFromFlockProbe,
  isProcessActiveFromPgrepStatus,
} from "./nomusDailySyncRunnerShared.js";

const LOCK_FILE = process.env.NOMUS_SYNC_LOCK_FILE || "/tmp/induscost-nomus-sync-global.lock";

let trackedChild: ChildProcess | null = null;

export class NomusDailySyncConflictError extends Error {
  constructor(message = "Já existe uma rotina Nomus em andamento.") {
    super(message);
    this.name = "NomusDailySyncConflictError";
  }
}

export type NomusDailySyncStartResult = {
  started: true;
  message: string;
  startedAt: string;
  logFile: string | null;
  runnerLogFile: string | null;
  pid: number | null;
};

export function resolveNomusDailySyncScriptPath(projectRoot: string): string {
  return path.join(projectRoot, "scripts", NOMUS_DAILY_SYNC_SCRIPT_NAME);
}

export function resolveNomusSyncLogDir(): string {
  return path.resolve(process.env.NOMUS_SYNC_LOG_DIR || "/tmp/induscost-nomus-sync");
}

async function listDailyRunnerLogs(logDir: string): Promise<
  Array<{ fileName: string; absolutePath: string; modifiedAtMs: number }>
> {
  try {
    const names = await fs.readdir(logDir);
    const rows = await Promise.all(
      names
        .filter((n) => isDailyRunnerLogFileName(n))
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

function isNomusDailySyncProcessActive(): boolean {
  if (trackedChild && trackedChild.exitCode === null && !trackedChild.killed) {
    return true;
  }
  if (process.platform === "win32") {
    return false;
  }
  try {
    const result = spawnSync("pgrep", ["-f", NOMUS_DAILY_SYNC_SCRIPT_NAME], { stdio: "ignore" });
    return isProcessActiveFromPgrepStatus(result.status);
  } catch {
    return false;
  }
}

export async function probeGlobalNomusSyncLockHeld(
  lockFile: string = LOCK_FILE
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

export async function isNomusDailySyncRunning(): Promise<boolean> {
  return isNomusDailySyncProcessActive() || (await probeGlobalNomusSyncLockHeld(LOCK_FILE));
}

export async function getNomusDailySyncStatus(): Promise<NomusDailySyncStatusPayload> {
  const runnerLogDir = resolveNomusSyncLogDir();
  const logs = await listDailyRunnerLogs(runnerLogDir);
  const hasLiveProcess = isNomusDailySyncProcessActive();
  const hasActiveLock = await probeGlobalNomusSyncLockHeld(LOCK_FILE);

  let lastRun: NomusDailySyncStatusPayload["lastRun"] = null;
  let lastSuccess: NomusDailySyncStatusPayload["lastSuccess"] = null;
  let lastFailure: NomusDailySyncStatusPayload["lastFailure"] = null;

  let latestParsed = parseDailyRunnerLogContent("");
  let latestContent = "";

  for (const entry of logs) {
    let content = "";
    try {
      content = await fs.readFile(entry.absolutePath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseDailyRunnerLogContent(content);
    if (!lastRun) {
      latestParsed = parsed;
      latestContent = content;
      const displayStatus =
        hasLiveProcess || hasActiveLock
          ? ("running" as const)
          : parsed.status === "running" && parsed.terminalFailure
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
    if (!lastFailure && parsed.status === "failed" && (parsed.finishedAt || parsed.terminalFailure)) {
      lastFailure = {
        finishedAt: parsed.finishedAt ?? parsed.steps.find((s) => s.finishedAt)?.finishedAt ?? parsed.startedAt ?? "",
        fileName: entry.fileName,
        exitCode: parsed.exitCode ?? parsed.steps.find((s) => s.exitCode != null && s.exitCode !== 0)?.exitCode ?? null,
      };
    }
    if (lastRun && lastSuccess && lastFailure) break;
  }

  const { overallStatus, isActuallyRunning, staleReason, ranToday } =
    computeNomusDailyOverallStatus({
      hasLiveProcess,
      hasActiveLock,
      parsed: latestParsed,
    });

  const failedSteps = latestParsed.steps.filter(
    (s) => s.exitCode != null && s.exitCode !== 0
  );

  const recommendedAction = buildRecommendedAction({
    overallStatus,
    failedSteps,
    lastErrorLine: latestParsed.lastErrorLine,
    runnerLogSnippet: latestContent,
  });

  if (lastRun && isActuallyRunning) {
    lastRun = { ...lastRun, status: "running" };
  } else if (lastRun && overallStatus === "PARTIAL_FAILED") {
    lastRun = { ...lastRun, status: "failed", finishedAt: lastRun.finishedAt ?? latestParsed.steps.find((s) => s.finishedAt)?.finishedAt ?? null };
  } else if (lastRun && overallStatus === "STALE") {
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
    currentOrLastStep: latestParsed.lastStep,
    failedSteps,
    recommendedAction,
    lastRun,
    lastSuccess,
    lastFailure,
    lastLogFile: lastRun?.logFile ?? null,
    lastRunnerLogFile: lastRun?.fileName ?? null,
    runnerLogDir,
    ranToday,
  };
}

export async function startNomusDailySyncApply(projectRoot: string): Promise<NomusDailySyncStartResult> {
  if (await isNomusDailySyncRunning()) {
    throw new NomusDailySyncConflictError(
      "Já existe uma sincronização Nomus em andamento."
    );
  }

  const scriptPath = resolveNomusDailySyncScriptPath(projectRoot);
  try {
    await fs.access(scriptPath);
  } catch {
    throw new Error("Script da rotina diária Nomus não encontrado no servidor.");
  }

  const logDir = resolveNomusSyncLogDir();
  await fs.mkdir(logDir, { recursive: true });

  const child = spawn("bash", [scriptPath, NOMUS_DAILY_SYNC_MODE], {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      NOMUS_SYNC_LOG_DIR: logDir,
      INDUSCOST_APP_DIR: process.env.INDUSCOST_APP_DIR || projectRoot,
    },
  });

  child.unref();
  trackedChild = child;
  child.on("exit", () => {
    if (trackedChild === child) trackedChild = null;
  });

  await new Promise((r) => setTimeout(r, 600));
  const logs = await listDailyRunnerLogs(logDir);
  const newest = logs[0];

  const startedAt = new Date().toISOString();
  return {
    started: true,
    message: "Rotina diária Nomus iniciada com sucesso. Acompanhe pelos logs.",
    startedAt,
    logFile: newest?.absolutePath ?? null,
    runnerLogFile: newest?.fileName ?? null,
    pid: child.pid ?? null,
  };
}
