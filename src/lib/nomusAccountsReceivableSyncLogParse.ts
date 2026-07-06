import {
  NOMUS_AR_LOG_STALE_RUNNING_MS,
  NOMUS_AR_RUNNER_LOG_RE,
} from "./nomusAccountsReceivableSyncConstants.js";

export type ParsedArRunnerLog = {
  status: "running" | "success" | "failed" | "skipped";
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  skipped: boolean;
  terminalFailure: boolean;
  syncStrategy: string | null;
  metrics: {
    pagesRead: number | null;
    recordsRead: number | null;
    mapped: number | null;
    created: number | null;
    updated: number | null;
    unchanged: number | null;
    errors: number | null;
  };
  lastErrorLine: string | null;
};

function safeNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractFirstJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return safeObject(JSON.parse(raw.slice(start, i + 1)));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function isArRunnerLogFileName(fileName: string): boolean {
  return NOMUS_AR_RUNNER_LOG_RE.test(fileName);
}

export function parseArRunnerLogContent(content: string): ParsedArRunnerLog {
  const startedMatch = content.match(/^\s*STARTED_AT=(.+)$/m);
  const finishedMatch = content.match(/^\s*FINISHED_AT=(.+)$/m);
  const exitCodeMatch = content.match(/^\s*EXIT_CODE=(-?\d+)/m);
  const skipped = /SKIPPED:\s*outra execução/i.test(content);

  const jsonObj = extractFirstJsonObject(content);
  const summaryObj = safeObject(jsonObj?.summary) ?? {};
  const appliedObj = safeObject(jsonObj?.applied) ?? {};

  const startedAt = startedMatch?.[1]?.trim() ?? null;
  const finishedAt = finishedMatch?.[1]?.trim() ?? null;
  const exitCode = exitCodeMatch ? Number(exitCodeMatch[1]) : null;

  const errorLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /ERRO|falha|error|exception/i.test(line) && !/redigidos/i.test(line));
  const lastErrorLine = errorLines.length > 0 ? errorLines[errorLines.length - 1] : null;

  const metrics = {
    pagesRead: safeNumber(summaryObj.pagesRead),
    recordsRead: safeNumber(summaryObj.recordsRead),
    mapped: safeNumber(summaryObj.mapped),
    created: safeNumber(appliedObj.created ?? summaryObj.created),
    updated: safeNumber(appliedObj.updated ?? summaryObj.updated),
    unchanged: safeNumber(appliedObj.unchanged ?? summaryObj.unchanged),
    errors: safeNumber(appliedObj.errors ?? summaryObj.mapErrors ?? summaryObj.errors),
  };

  const syncStrategy =
    typeof summaryObj.syncStrategy === "string" ? summaryObj.syncStrategy : null;

  if (skipped) {
    return {
      status: "skipped",
      startedAt,
      finishedAt,
      exitCode: exitCode ?? 0,
      skipped: true,
      terminalFailure: false,
      syncStrategy,
      metrics,
      lastErrorLine,
    };
  }

  if (!finishedAt) {
    return {
      status: "running",
      startedAt,
      finishedAt: null,
      exitCode,
      skipped: false,
      terminalFailure: Boolean(lastErrorLine),
      syncStrategy,
      metrics,
      lastErrorLine,
    };
  }

  const failed = exitCode != null && exitCode !== 0;
  return {
    status: failed ? "failed" : "success",
    startedAt,
    finishedAt,
    exitCode,
    skipped: false,
    terminalFailure: failed,
    syncStrategy,
    metrics,
    lastErrorLine,
  };
}

export function computeArOverallStatus(input: {
  hasLiveProcess: boolean;
  hasActiveLock: boolean;
  parsed: ParsedArRunnerLog;
  logAgeMs: number | null;
}): {
  overallStatus: "RUNNING" | "SUCCESS" | "FAILED" | "STALE" | "SKIPPED" | "NOT_RUN_RECENTLY" | "IDLE";
  isActuallyRunning: boolean;
  staleReason: string | null;
} {
  const { hasLiveProcess, hasActiveLock, parsed, logAgeMs } = input;
  const isActuallyRunning = hasLiveProcess || hasActiveLock;

  if (isActuallyRunning) {
    return {
      overallStatus: "RUNNING",
      isActuallyRunning: true,
      staleReason: null,
    };
  }

  if (parsed.skipped) {
    return {
      overallStatus: "SKIPPED",
      isActuallyRunning: false,
      staleReason: "Última tentativa ignorada porque outra execução já estava ativa.",
    };
  }

  if (parsed.status === "running") {
    const staleByAge =
      logAgeMs != null && logAgeMs > NOMUS_AR_LOG_STALE_RUNNING_MS;
    if (staleByAge || parsed.terminalFailure) {
      return {
        overallStatus: "STALE",
        isActuallyRunning: false,
        staleReason:
          "Log sem FINISHED_AT e sem processo/lock ativo — execução provavelmente interrompida.",
      };
    }
    return {
      overallStatus: "STALE",
      isActuallyRunning: false,
      staleReason: "Log incompleto sem evidência de processo ativo.",
    };
  }

  if (parsed.status === "failed") {
    return {
      overallStatus: "FAILED",
      isActuallyRunning: false,
      staleReason: null,
    };
  }

  if (parsed.status === "success") {
    if (logAgeMs != null && logAgeMs > NOMUS_AR_LOG_STALE_RUNNING_MS * 4) {
      return {
        overallStatus: "NOT_RUN_RECENTLY",
        isActuallyRunning: false,
        staleReason: "Última execução bem-sucedida há mais de 8 horas.",
      };
    }
    return {
      overallStatus: "SUCCESS",
      isActuallyRunning: false,
      staleReason: null,
    };
  }

  return {
    overallStatus: "IDLE",
    isActuallyRunning: false,
    staleReason: null,
  };
}

export function buildArRecommendedAction(input: {
  overallStatus: string;
  parsed: ParsedArRunnerLog;
}): string | null {
  switch (input.overallStatus) {
    case "RUNNING":
      return "Aguarde a conclusão ou acompanhe o log do runner.";
    case "SUCCESS":
      return "Rotina concluída. Próxima execução automática a cada 2 horas.";
    case "FAILED":
      return "Revise o log do runner e tente novamente. Verifique conectividade Nomus e banco.";
    case "STALE":
      return "Confirme se não há processo órfão; em seguida execute manualmente novamente.";
    case "SKIPPED":
      return "Outra execução estava ativa. Aguarde ou verifique lock/processo.";
    case "NOT_RUN_RECENTLY":
      return "Verifique o cron de 2 em 2 horas ou execute manualmente.";
    default:
      return input.parsed.lastErrorLine;
  }
}

export function parseDurationMs(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}
