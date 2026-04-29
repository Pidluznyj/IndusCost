import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type SyncMode = "dry" | "apply";
type SyncTarget = "products" | "customers" | "proposals" | "sales-orders";

type StepResult = {
  target: SyncTarget;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  command: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  logFile: string | null;
  reason?: string;
};

const ALL_TARGETS: SyncTarget[] = ["products", "customers", "proposals", "sales-orders"];

function parseArgs(): { mode: SyncMode; only: SyncTarget[] } {
  const args = process.argv.slice(2);

  const mode: SyncMode = args.includes("--apply") ? "apply" : "dry";

  const onlyArg = args.find((arg) => arg.startsWith("--only="));
  if (!onlyArg) return { mode, only: ALL_TARGETS };

  const values = onlyArg
    .replace("--only=", "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean) as SyncTarget[];

  const invalid = values.filter((v) => !ALL_TARGETS.includes(v));
  if (invalid.length > 0) {
    throw new Error(`Targets inválidos em --only: ${invalid.join(", ")}`);
  }

  return { mode, only: values };
}

function nowStamp(): string {
  return new Date().toISOString();
}

function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function scriptFor(target: SyncTarget, mode: SyncMode): string | null {
  if (target === "proposals") {
    return mode === "apply" ? "sync:nomus:proposals:apply" : "sync:nomus:proposals:dry";
  }

  if (target === "sales-orders") {
    return mode === "apply" ? "sync:nomus:sales-orders:apply" : "sync:nomus:sales-orders:dry";
  }

  return null;
}

function runStep(target: SyncTarget, mode: SyncMode, logDir: string): StepResult {
  const startedAt = nowStamp();
  const started = Date.now();

  const npmScript = scriptFor(target, mode);

  if (!npmScript) {
    const finishedAt = nowStamp();
    return {
      target,
      status: "SKIPPED",
      command: null,
      startedAt,
      finishedAt,
      durationMs: Date.now() - started,
      exitCode: null,
      logFile: null,
      reason: "Script oficial ainda não existe/foi validado para este target.",
    };
  }

  const logFile = join(logDir, `${target}_${mode}_${fileStamp()}.log`);
  const command = `npm run ${npmScript}`;

  const result = spawnSync("npm", ["run", npmScript], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50,
  });

  const output = [
    `COMMAND=${command}`,
    `STARTED_AT=${startedAt}`,
    `FINISHED_AT=${nowStamp()}`,
    `EXIT_CODE=${result.status ?? "null"}`,
    "",
    "=== STDOUT ===",
    result.stdout ?? "",
    "",
    "=== STDERR ===",
    result.stderr ?? "",
    "",
    result.error ? `ERROR=${result.error.message}` : "",
  ].join("\n");

  writeFileSync(logFile, output, "utf8");

  const finishedAt = nowStamp();
  const exitCode = result.status ?? null;

  return {
    target,
    status: exitCode === 0 ? "SUCCESS" : "FAILED",
    command,
    startedAt,
    finishedAt,
    durationMs: Date.now() - started,
    exitCode,
    logFile,
    reason: result.error?.message,
  };
}

async function main() {
  const { mode, only } = parseArgs();

  const logDir = process.env.NOMUS_SYNC_LOG_DIR || "/tmp/induscost-nomus-sync";
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  const startedAt = nowStamp();
  const results: StepResult[] = [];

  for (const target of ALL_TARGETS) {
    if (!only.includes(target)) {
      results.push({
        target,
        status: "SKIPPED",
        command: null,
        startedAt: nowStamp(),
        finishedAt: nowStamp(),
        durationMs: 0,
        exitCode: null,
        logFile: null,
        reason: "Target fora do filtro --only.",
      });
      continue;
    }

    const step = runStep(target, mode, logDir);
    results.push(step);

    if (step.status === "FAILED") {
      break;
    }
  }

  const summary = {
    mode,
    only,
    startedAt,
    finishedAt: nowStamp(),
    logDir,
    results,
    success: results.every((r) => r.status === "SUCCESS" || r.status === "SKIPPED"),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!summary.success) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[nomus-sync-orchestrator] erro:", err);
  process.exitCode = 1;
});
