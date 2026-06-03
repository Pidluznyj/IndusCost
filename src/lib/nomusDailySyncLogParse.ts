/**
 * Parser puro dos logs runner-daily-* (sem I/O).
 */

import type {
  NomusDailyFailedStep,
  NomusDailyOverallStatus,
  NomusDailySyncRunStatus,
} from "./nomusDailySyncStatusTypes";

const DAILY_TARGETS = ["customers", "products", "bom-components", "proposals"] as const;

export type ParsedDailyRunnerLog = {
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  skipped: boolean;
  status: NomusDailySyncRunStatus;
  steps: NomusDailyFailedStep[];
  lastStep: string | null;
  terminalFailure: boolean;
  lastErrorLine: string | null;
};

export function parseDailyRunnerLogContent(content: string): ParsedDailyRunnerLog {
  const startedMatch = content.match(/^\s*STARTED_AT=(.+)$/m);
  const finishedMatch = content.match(/^\s*FINISHED_AT=(.+)$/m);
  const exitMatch = content.match(/^\s*EXIT_CODE=(\d+)/m);
  const skipped = /SKIPPED:\s*outra execução diária/i.test(content);
  const startedAt = startedMatch?.[1]?.trim() ?? null;
  const finishedAt = finishedMatch?.[1]?.trim() ?? null;
  const exitCode = exitMatch ? Number(exitMatch[1]) : null;

  const steps = parseDailyRunnerSteps(content);
  const failedSteps = steps.filter((s) => s.exitCode != null && s.exitCode !== 0);
  const erroMatch = content.match(
    /\[nomus-daily-runner\]\s*ERRO:\s*target\s+(\S+)\s+falhou/i
  );
  const terminalFailure =
    failedSteps.length > 0 || !!erroMatch || (finishedAt != null && exitCode !== 0 && exitCode !== null);

  const lastStep =
    steps.length > 0
      ? steps[steps.length - 1]!.target
      : erroMatch?.[1] ?? inferLastStartedTarget(content);

  const errorLines = content
    .split("\n")
    .filter((l) => /erro|error|failed|timeout|UND_ERR_SOCKET|fetch failed/i.test(l));
  const technicalLine = errorLines.find((l) =>
    /UND_ERR_SOCKET|fetch failed|ECONN|timeout/i.test(l)
  );
  const lastErrorLine =
    technicalLine?.trim() ??
    (errorLines.length > 0 ? errorLines[errorLines.length - 1]!.trim() : null);

  let status: NomusDailySyncRunStatus = "idle";
  if (skipped) {
    status = "skipped";
  } else if (finishedAt) {
    status = exitCode !== null && exitCode !== 0 ? "failed" : "success";
  } else if (terminalFailure) {
    status = "failed";
  } else if (startedAt) {
    status = "running";
  }

  return {
    startedAt,
    finishedAt,
    exitCode,
    skipped,
    status,
    steps,
    lastStep,
    terminalFailure,
    lastErrorLine,
  };
}

function inferLastStartedTarget(content: string): string | null {
  const matches = [...content.matchAll(/=== EXECUTANDO TARGET:\s*(\S+)\s*===/gi)];
  return matches.length > 0 ? matches[matches.length - 1]![1]! : null;
}

export function parseDailyRunnerSteps(content: string): NomusDailyFailedStep[] {
  const byTarget = new Map<string, NomusDailyFailedStep>();

  for (const target of DAILY_TARGETS) {
    const blockRe = new RegExp(
      `=== EXECUTANDO TARGET:\\s*${target}\\s*===([\\s\\S]*?)(?==== EXECUTANDO TARGET:|=== PAUSA|=== BOM AUTO|=== RESULTADO|$)`,
      "i"
    );
    const block = content.match(blockRe)?.[1];
    if (!block) continue;

    const exitM = block.match(/^\s*TARGET_EXIT_CODE=(\d+)/m);
    const finM = block.match(/^\s*TARGET_FINISHED_AT=(.+)$/m);
    const exitCode = exitM ? Number(exitM[1]) : null;
    const errM = block.match(/\[nomus-sync[^\]]*\]\s*erro:?\s*(.+)$/im);

    byTarget.set(target, {
      target,
      exitCode,
      message: errM?.[1]?.trim() ?? null,
      finishedAt: finM?.[1]?.trim() ?? null,
    });
  }

  return DAILY_TARGETS.map((t) => byTarget.get(t)).filter((s): s is NomusDailyFailedStep => !!s);
}

export function parseDurationMs(
  startedAt: string | null,
  finishedAt: string | null
): number | null {
  if (!startedAt || !finishedAt) return null;
  const a = new Date(startedAt).getTime();
  const b = new Date(finishedAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

export function isSameCalendarDay(iso: string, reference: Date = new Date()): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === reference.getFullYear() &&
    d.getMonth() === reference.getMonth() &&
    d.getDate() === reference.getDate()
  );
}

export function buildRecommendedAction(input: {
  overallStatus: NomusDailyOverallStatus;
  failedSteps: NomusDailyFailedStep[];
  lastErrorLine: string | null;
}): string | null {
  const failed = input.failedSteps.filter((s) => s.exitCode != null && s.exitCode !== 0);
  const failedTarget = failed[0]?.target;

  if (input.overallStatus === "RUNNING") {
    return "Aguarde a conclusão ou acompanhe o log da execução em andamento.";
  }
  if (input.overallStatus === "STALE") {
    return "Atualize o status. Se não houver processo vivo, é seguro disparar a rotina novamente.";
  }
  if (input.overallStatus === "SUCCESS") {
    return "Rotina concluída. Use «Rodar novamente» apenas se precisar reprocessar o dia.";
  }

  if (failedTarget === "products") {
    const socket = /UND_ERR_SOCKET|fetch failed|timeout|rede/i.test(
      `${input.lastErrorLine ?? ""} ${failed[0]?.message ?? ""}`
    );
    if (socket) {
      return (
        "Falha operacional na integração Nomus (timeout/rede) na etapa Produtos. " +
        "Aguarde alguns minutos e rode somente produtos: npm run sync:nomus:all:apply -- --only=products. " +
        "Se persistir, revise conectividade com o Nomus antes da rotina completa."
      );
    }
    return (
      "Etapa Produtos falhou. Corrija a causa no log e rode somente produtos: " +
      "npm run sync:nomus:all:apply -- --only=products."
    );
  }

  if (failedTarget === "customers") {
    return "Etapa Clientes falhou. Rode somente: npm run sync:nomus:all:apply -- --only=customers.";
  }
  if (failedTarget === "bom-components") {
    return (
      "Etapa BOM/components falhou. Rode somente: npm run sync:nomus:all:apply -- --only=bom-components."
    );
  }
  if (failedTarget === "proposals") {
    return "Etapa Propostas falhou. Rode somente: npm run sync:nomus:all:apply -- --only=proposals.";
  }

  if (input.overallStatus === "PARTIAL_FAILED" || input.overallStatus === "FAILED") {
    return "Revise o log diário e rode a rotina completa ou apenas a etapa que falhou.";
  }
  if (input.overallStatus === "NOT_RUN_TODAY") {
    return "Dispare a rotina diária apply ou aguarde o agendamento da madrugada.";
  }
  return null;
}

export function computeNomusDailyOverallStatus(input: {
  hasLiveProcess: boolean;
  hasActiveLock: boolean;
  parsed: ParsedDailyRunnerLog;
  now?: Date;
}): {
  overallStatus: NomusDailyOverallStatus;
  isActuallyRunning: boolean;
  staleReason: string | null;
  ranToday: boolean;
} {
  const now = input.now ?? new Date();
  const isActuallyRunning = input.hasLiveProcess || input.hasActiveLock;
  const ranToday = input.parsed.startedAt
    ? isSameCalendarDay(input.parsed.startedAt, now)
    : false;

  if (isActuallyRunning) {
    return {
      overallStatus: "RUNNING",
      isActuallyRunning: true,
      staleReason: null,
      ranToday,
    };
  }

  if (input.parsed.skipped) {
    return {
      overallStatus: ranToday ? "SUCCESS" : "NOT_RUN_TODAY",
      isActuallyRunning: false,
      staleReason: null,
      ranToday,
    };
  }

  if (input.parsed.finishedAt) {
    const ok = input.parsed.exitCode === 0 || input.parsed.exitCode === null;
    return {
      overallStatus: ok ? "SUCCESS" : "FAILED",
      isActuallyRunning: false,
      staleReason: null,
      ranToday,
    };
  }

  if (input.parsed.terminalFailure) {
    const anyStepSucceeded = input.parsed.steps.some((s) => s.exitCode === 0);
    return {
      overallStatus: anyStepSucceeded ? "PARTIAL_FAILED" : "FAILED",
      isActuallyRunning: false,
      staleReason: null,
      ranToday,
    };
  }

  if (input.parsed.startedAt && input.parsed.status === "running") {
    return {
      overallStatus: "STALE",
      isActuallyRunning: false,
      staleReason:
        "Registro de execução sem FINISHED_AT e nenhum processo vivo ou lock ativo — provável interrupção ou travamento de status.",
      ranToday,
    };
  }

  if (!ranToday) {
    return {
      overallStatus: "NOT_RUN_TODAY",
      isActuallyRunning: false,
      staleReason: null,
      ranToday: false,
    };
  }

  return {
    overallStatus: "IDLE",
    isActuallyRunning: false,
    staleReason: null,
    ranToday,
  };
}
