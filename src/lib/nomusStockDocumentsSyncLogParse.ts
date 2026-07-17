import {
  NOMUS_STOCK_DOCUMENTS_LOG_STALE_RUNNING_MS,
  NOMUS_STOCK_DOCUMENTS_RUNNER_LOG_RE,
} from "./nomusStockDocumentsSyncConstants.js";

export type ParsedStockDocumentsRunnerLog = {
  status: "running" | "success" | "failed" | "skipped";
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  skipped: boolean;
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
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
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

export function isStockDocumentsRunnerLogFileName(fileName: string): boolean {
  return NOMUS_STOCK_DOCUMENTS_RUNNER_LOG_RE.test(fileName);
}

export function parseStockDocumentsRunnerLogContent(
  content: string
): ParsedStockDocumentsRunnerLog {
  const startedMatch = content.match(/^\s*STARTED_AT=(.+)$/m);
  const finishedMatch = content.match(/^\s*FINISHED_AT=(.+)$/m);
  const exitCodeMatch = content.match(/^\s*EXIT_CODE=(-?\d+)/m);
  const skipped = /SKIPPED:\s*outra execução/i.test(content);
  const strategyMatch = content.match(/^\s*SYNC_STRATEGY=(.+)$/m);

  const jsonObj = extractFirstJsonObject(content);
  const summaryObj = safeObject(jsonObj?.summary) ?? {};
  const countersObj =
    safeObject(summaryObj.counters) ??
    safeObject(jsonObj?.counters) ??
    {};

  const exitCode = exitCodeMatch ? Number.parseInt(exitCodeMatch[1]!, 10) : null;
  let status: ParsedStockDocumentsRunnerLog["status"] = "running";
  if (skipped || exitCode === 0 && /SKIPPED/i.test(content)) {
    status = "skipped";
  } else if (exitCode != null && exitCode !== 0) {
    status = "failed";
  } else if (exitCode === 0) {
    status = "success";
  }

  const errorLines = content
    .split(/\r?\n/)
    .filter((line) => /error|erro|failed|falha/i.test(line));

  return {
    status,
    startedAt: startedMatch?.[1]?.trim() || null,
    finishedAt: finishedMatch?.[1]?.trim() || null,
    exitCode: Number.isFinite(exitCode) ? exitCode : null,
    skipped,
    syncStrategy: strategyMatch?.[1]?.trim() || null,
    metrics: {
      pagesRead: safeNumber(countersObj.pagesRead ?? summaryObj.pagesRead),
      recordsRead: safeNumber(
        countersObj.documentsReceived ?? summaryObj.documentsReceived
      ),
      mapped: safeNumber(countersObj.documentsMapped ?? summaryObj.mapped),
      created: safeNumber(countersObj.documentsCreated ?? summaryObj.created),
      updated: safeNumber(countersObj.documentsUpdated ?? summaryObj.updated),
      unchanged: safeNumber(
        countersObj.documentsUnchanged ?? summaryObj.unchanged
      ),
      errors: safeNumber(countersObj.errors ?? summaryObj.errors),
    },
    lastErrorLine: errorLines.length > 0 ? errorLines[errorLines.length - 1]! : null,
  };
}

export function parseStockDocumentsDurationMs(
  startedAt: string | null,
  finishedAt: string | null
): number | null {
  if (!startedAt || !finishedAt) return null;
  const a = Date.parse(startedAt);
  const b = Date.parse(finishedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

export function computeStockDocumentsOverallStatus(input: {
  hasLiveProcess: boolean;
  hasActiveLock: boolean;
  parsed: ParsedStockDocumentsRunnerLog;
  logAgeMs: number | null;
}): {
  overallStatus: "IDLE" | "RUNNING" | "SUCCESS" | "FAILED" | "STALE" | "SKIPPED";
  isActuallyRunning: boolean;
  staleReason: string | null;
} {
  const isActuallyRunning = input.hasLiveProcess || input.hasActiveLock;
  if (isActuallyRunning) {
    if (
      input.logAgeMs != null &&
      input.logAgeMs > NOMUS_STOCK_DOCUMENTS_LOG_STALE_RUNNING_MS &&
      input.parsed.status === "running"
    ) {
      return {
        overallStatus: "STALE",
        isActuallyRunning: true,
        staleReason: "Log em running além do limiar de 2h.",
      };
    }
    return { overallStatus: "RUNNING", isActuallyRunning: true, staleReason: null };
  }
  if (input.parsed.status === "skipped") {
    return { overallStatus: "SKIPPED", isActuallyRunning: false, staleReason: null };
  }
  if (input.parsed.status === "failed") {
    return { overallStatus: "FAILED", isActuallyRunning: false, staleReason: null };
  }
  if (input.parsed.status === "success") {
    return { overallStatus: "SUCCESS", isActuallyRunning: false, staleReason: null };
  }
  return { overallStatus: "IDLE", isActuallyRunning: false, staleReason: null };
}

export function buildStockDocumentsRecommendedAction(input: {
  overallStatus: string;
  parsed: ParsedStockDocumentsRunnerLog;
}): string | null {
  if (input.overallStatus === "RUNNING") {
    return "Aguarde a execução atual de Documentos de Saída.";
  }
  if (input.overallStatus === "FAILED") {
    return "Revise o log do runner e rode preview/apply manual se necessário.";
  }
  if (input.overallStatus === "STALE") {
    return "Verifique lock órfão e processos travados no servidor.";
  }
  if (input.overallStatus === "SKIPPED") {
    return "Sobreposição evitada (soft-fail). Nenhuma ação obrigatória.";
  }
  return null;
}
