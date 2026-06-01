import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  NOMUS_DAILY_SYNC_MODE,
  NOMUS_DAILY_SYNC_SCRIPT_NAME,
} from "./nomusDailySyncConstants.js";

export { NOMUS_DAILY_SYNC_CONFIRM_PHRASE, NOMUS_DAILY_SYNC_MODE, NOMUS_DAILY_SYNC_SCRIPT_NAME } from "./nomusDailySyncConstants.js";

const DAILY_LOG_RE = /^runner-daily-(apply|dry)_.+\.log$/i;
const LOCK_FILE = process.env.NOMUS_SYNC_LOCK_FILE || "/tmp/induscost-nomus-sync-global.lock";

let trackedChild: ChildProcess | null = null;

export class NomusDailySyncConflictError extends Error {
  constructor(message = "Já existe uma rotina Nomus em andamento.") {
    super(message);
    this.name = "NomusDailySyncConflictError";
  }
}

export type NomusDailySyncRunStatus = "idle" | "running" | "success" | "failed" | "skipped";

export type NomusDailySyncStatusPayload = {
  isRunning: boolean;
  lastRun: {
    fileName: string;
    status: NomusDailySyncRunStatus;
    startedAt: string | null;
    finishedAt: string | null;
    exitCode: number | null;
    logFile: string;
  } | null;
  lastSuccess: { finishedAt: string; fileName: string } | null;
  lastFailure: { finishedAt: string; fileName: string; exitCode: number | null } | null;
  lastLogFile: string | null;
  lastRunnerLogFile: string | null;
  runnerLogDir: string;
};

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

export function isDailyRunnerLogFileName(fileName: string): boolean {
  return DAILY_LOG_RE.test(fileName);
}

export function parseDailyRunnerLogContent(content: string): {
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  skipped: boolean;
  status: NomusDailySyncRunStatus;
} {
  const startedMatch = content.match(/^\s*STARTED_AT=(.+)$/m);
  const finishedMatch = content.match(/^\s*FINISHED_AT=(.+)$/m);
  const exitMatch = content.match(/^\s*EXIT_CODE=(\d+)/m);
  const skipped = /SKIPPED:\s*outra execução diária/i.test(content);
  const startedAt = startedMatch?.[1]?.trim() ?? null;
  const finishedAt = finishedMatch?.[1]?.trim() ?? null;
  const exitCode = exitMatch ? Number(exitMatch[1]) : null;

  if (skipped) {
    return { startedAt, finishedAt, exitCode: 0, skipped: true, status: "skipped" };
  }
  if (finishedAt) {
    const failed = exitCode !== null && exitCode !== 0;
    return {
      startedAt,
      finishedAt,
      exitCode,
      skipped: false,
      status: failed ? "failed" : "success",
    };
  }
  if (startedAt) {
    return { startedAt, finishedAt, exitCode, skipped: false, status: "running" };
  }
  return { startedAt, finishedAt, exitCode, skipped: false, status: "idle" };
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
    spawnSync("pgrep", ["-f", NOMUS_DAILY_SYNC_SCRIPT_NAME], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function isLockHeld(): Promise<boolean> {
  try {
    await fs.access(LOCK_FILE);
  } catch {
    return false;
  }
  if (process.platform === "win32") {
    return false;
  }
  try {
    const probe = spawnSync(
      "bash",
      ["-c", `exec 9>"${LOCK_FILE.replace(/"/g, '\\"')}"; flock -n 9`],
      { stdio: "ignore" }
    );
    return probe.status !== 0;
  } catch {
    return false;
  }
}

async function inferRunningFromLatestLog(
  logs: Array<{ fileName: string; absolutePath: string; modifiedAtMs: number }>
): Promise<boolean> {
  const latest = logs[0];
  if (!latest) return false;
  const ageMs = Date.now() - latest.modifiedAtMs;
  if (ageMs > 12 * 60 * 60 * 1000) return false;
  try {
    const content = await fs.readFile(latest.absolutePath, "utf8");
    const parsed = parseDailyRunnerLogContent(content);
    return parsed.status === "running";
  } catch {
    return false;
  }
}

export async function isNomusDailySyncRunning(): Promise<boolean> {
  if (isNomusDailySyncProcessActive()) return true;
  if (await isLockHeld()) return true;
  const logs = await listDailyRunnerLogs(resolveNomusSyncLogDir());
  return inferRunningFromLatestLog(logs);
}

export async function getNomusDailySyncStatus(): Promise<NomusDailySyncStatusPayload> {
  const runnerLogDir = resolveNomusSyncLogDir();
  const logs = await listDailyRunnerLogs(runnerLogDir);
  const isRunning =
    (await isNomusDailySyncProcessActive()) ||
    (await isLockHeld()) ||
    (await inferRunningFromLatestLog(logs));

  let lastRun: NomusDailySyncStatusPayload["lastRun"] = null;
  let lastSuccess: NomusDailySyncStatusPayload["lastSuccess"] = null;
  let lastFailure: NomusDailySyncStatusPayload["lastFailure"] = null;

  for (const entry of logs) {
    let content = "";
    try {
      content = await fs.readFile(entry.absolutePath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseDailyRunnerLogContent(content);
    if (!lastRun) {
      lastRun = {
        fileName: entry.fileName,
        status: isRunning && parsed.status === "running" ? "running" : parsed.status,
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

  if (lastRun && isRunning) {
    lastRun = { ...lastRun, status: "running" };
  }

  return {
    isRunning,
    lastRun,
    lastSuccess,
    lastFailure,
    lastLogFile: lastRun?.logFile ?? null,
    lastRunnerLogFile: lastRun?.fileName ?? null,
    runnerLogDir,
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
