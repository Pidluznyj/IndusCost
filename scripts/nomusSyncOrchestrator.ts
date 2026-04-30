import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

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

type StepExecution = {
  step: StepResult;
  stdout: string;
  stderr: string;
};

const ALL_TARGETS: SyncTarget[] = ["customers", "products", "proposals", "sales-orders"];
const prisma = new PrismaClient();

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
  if (target === "customers") {
    return mode === "apply" ? "sync:nomus:customers:apply" : "sync:nomus:customers:dry";
  }

  if (target === "products") {
    return mode === "apply" ? "sync:nomus:products:apply" : "sync:nomus:products:dry";
  }

  if (target === "proposals") {
    return mode === "apply" ? "sync:nomus:proposals:apply" : "sync:nomus:proposals:dry";
  }

  if (target === "sales-orders") {
    return mode === "apply" ? "sync:nomus:sales-orders:apply" : "sync:nomus:sales-orders:dry";
  }

  return null;
}

function maskSensitive(value: string): string {
  if (!value) return "";
  const masks: Array<[RegExp, string]> = [
    [/(authorization\s*[:=]\s*)([^\s]+)/gi, "$1***"],
    [/(token\s*[:=]\s*)([^\s]+)/gi, "$1***"],
    [/(password\s*[:=]\s*)([^\s]+)/gi, "$1***"],
    [/(nomus_auth_header_value\s*[:=]\s*)([^\s]+)/gi, "$1***"],
    [/(\b(?:Bearer|Basic)\s+)([A-Za-z0-9\-._~+/]+=*)/gi, "$1***"],
  ];
  return masks.reduce((acc, [re, replacement]) => acc.replace(re, replacement), value);
}

function parseJsonObjectFromStdout(stdout: string): Record<string, unknown> | null {
  const source = String(stdout || "").trim();
  if (!source) return null;
  const start = source.indexOf("{");
  if (start < 0) return null;
  for (let i = source.length - 1; i > start; i -= 1) {
    if (source[i] !== "}") continue;
    const candidate = source.slice(start, i + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // continue tentando blocos menores
    }
  }
  return null;
}

function safeNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractPagedMetrics(stderr: string): {
  pageRead: number | null;
  ordersReadFromStderr: number | null;
  startPage: number | null;
  maxPages: number | null;
  lastPage: number | null;
} {
  const pageReadMatch = stderr.match(/página\s+(\d+)\s+lida\s+com\s+(\d+)\s+pedidos/i);
  const blockMatch = stderr.match(/limite\s+de\s+bloco\s+atingido:\s*startPage=(\d+),\s*maxPages=(\d+),\s*lastPage=(\d+)/i);
  return {
    pageRead: pageReadMatch ? Number(pageReadMatch[1]) : null,
    ordersReadFromStderr: pageReadMatch ? Number(pageReadMatch[2]) : null,
    startPage: blockMatch ? Number(blockMatch[1]) : null,
    maxPages: blockMatch ? Number(blockMatch[2]) : null,
    lastPage: blockMatch ? Number(blockMatch[3]) : null,
  };
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function sanitizeErrorMessage(step: StepResult, safeStdout: string, safeStderr: string): string | undefined {
  const failed = step.status === "FAILED" || (step.exitCode != null && step.exitCode !== 0);
  if (!failed) return undefined;

  const reasonMessage = step.reason ? maskSensitive(step.reason).trim() : "";
  if (reasonMessage) {
    return reasonMessage.slice(0, 2000);
  }

  const keywordRegex =
    /(erro|error|failed|fail|exception|timeout|econn|etimedout|eai|401|403|404|429|500|502|503|504|prisma|typeerror|referenceerror|syntaxerror|und_err)/i;

  const stderrLines = safeStderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const relevantStderr = stderrLines.filter((line) => keywordRegex.test(line));
  if (relevantStderr.length > 0) {
    return relevantStderr.slice(-12).join(" | ").slice(0, 2000);
  }
  if (stderrLines.length > 0) {
    return stderrLines.slice(-12).join(" | ").slice(0, 2000);
  }

  const stdoutLines = safeStdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const relevantStdout = stdoutLines.filter((line) => keywordRegex.test(line));
  if (relevantStdout.length > 0) {
    return relevantStdout.slice(-12).join(" | ").slice(0, 2000);
  }
  if (stdoutLines.length > 0) {
    return stdoutLines.slice(-12).join(" | ").slice(0, 2000);
  }

  return undefined;
}

async function persistIntegrationRunBestEffort(step: StepResult, stdout: string, stderr: string): Promise<void> {
  if (!step.command || !step.logFile) return;

  const safeStdout = maskSensitive(stdout);
  const safeStderr = maskSensitive(stderr);
  const parsed = parseJsonObjectFromStdout(safeStdout);
  const summary = safeObject(parsed?.summary);
  const applied = safeObject(parsed?.applied);
  const parsedModeRaw = typeof parsed?.mode === "string" ? parsed.mode.toLowerCase() : "";
  const parsedMode: SyncMode = parsedModeRaw.includes("dry") ? "dry" : "apply";
  const metricsFromStderr = extractPagedMetrics(safeStderr);

  const blockedReasonsObj = safeObject(summary?.blockedReasons);
  const blockedPreview = Array.isArray(summary?.blockedPreview) ? summary.blockedPreview : null;
  const ordersReadFromSummary = safeNumber(summary?.totalRead);
  const ordersRead = ordersReadFromSummary ?? metricsFromStderr.ordersReadFromStderr;
  const errorMessage = sanitizeErrorMessage(step, safeStdout, safeStderr);

  const integrationRunData: Prisma.IntegrationRunUncheckedCreateInput = {
    sourceSystem: "NOMUS",
    kind: "sync",
    target: step.target,
    mode: parsed ? parsedMode : step.command.includes(":dry") ? "dry" : "apply",
    status: step.status,
    success: step.status === "SUCCESS" ? true : step.status === "FAILED" ? false : null,
    command: step.command,
    startedAt: new Date(step.startedAt),
    finishedAt: new Date(step.finishedAt),
    durationMs: step.durationMs,
    exitCode: step.exitCode,
    logFile: step.logFile,
    ordersRead,
    pageRead: metricsFromStderr.pageRead,
    startPage: metricsFromStderr.startPage,
    maxPages: metricsFromStderr.maxPages,
    lastPage: metricsFromStderr.lastPage,
    eligibleCount: safeNumber(summary?.eligibleCount),
    blockedCount: safeNumber(summary?.blockedCount),
    blockedReasons: toPrismaJson(blockedReasonsObj),
    blockedPreview: toPrismaJson(blockedPreview),
    createdCount: safeNumber(applied?.created),
    updatedCount: safeNumber(applied?.updated),
    itemsCreated: safeNumber(applied?.itemsCreated),
    summaryJson: toPrismaJson(
      parsed
        ? {
            mode: parsed.mode ?? null,
            summary: summary ?? null,
            applied: applied ?? null,
          }
        : null
    ),
    errorMessage,
  };
  const updateData: Prisma.IntegrationRunUncheckedUpdateInput = {
    ...integrationRunData,
  };

  try {
    const existing = await prisma.integrationRun.findFirst({
      where: { logFile: step.logFile },
    });
    if (existing) {
      await prisma.integrationRun.update({
        where: { id: existing.id },
        data: updateData,
      });
      return;
    }
    await prisma.integrationRun.create({
      data: integrationRunData,
    });
  } catch (err) {
    console.error("[nomus-sync-orchestrator] falha ao registrar IntegrationRun:", err);
  }
}

function runStep(target: SyncTarget, mode: SyncMode, logDir: string): StepExecution {
  const startedAt = nowStamp();
  const started = Date.now();

  const npmScript = scriptFor(target, mode);

  if (!npmScript) {
    const finishedAt = nowStamp();
    return {
      step: {
        target,
        status: "SKIPPED",
        command: null,
        startedAt,
        finishedAt,
        durationMs: Date.now() - started,
        exitCode: null,
        logFile: null,
        reason: "Script oficial ainda não existe/foi validado para este target.",
      },
      stdout: "",
      stderr: "",
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

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const output = [
    `COMMAND=${command}`,
    `STARTED_AT=${startedAt}`,
    `FINISHED_AT=${nowStamp()}`,
    `EXIT_CODE=${result.status ?? "null"}`,
    "",
    "=== STDOUT ===",
    stdout,
    "",
    "=== STDERR ===",
    stderr,
    "",
    result.error ? `ERROR=${result.error.message}` : "",
  ].join("\n");

  writeFileSync(logFile, output, "utf8");

  const finishedAt = nowStamp();
  const exitCode = result.status ?? null;

  return {
    step: {
      target,
      status: exitCode === 0 ? "SUCCESS" : "FAILED",
      command,
      startedAt,
      finishedAt,
      durationMs: Date.now() - started,
      exitCode,
      logFile,
      reason: result.error?.message,
    },
    stdout,
    stderr,
  };
}

async function main() {
  try {
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

      const execution = runStep(target, mode, logDir);
      results.push(execution.step);
      await persistIntegrationRunBestEffort(execution.step, execution.stdout, execution.stderr);

      if (execution.step.status === "FAILED") {
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
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[nomus-sync-orchestrator] erro:", err);
  process.exitCode = 1;
});
