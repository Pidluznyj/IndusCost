/** Tipos e rótulos da rotina diária Nomus — sem dependências server-side. */

export type NomusDailyOverallStatus =
  | "RUNNING"
  | "SUCCESS"
  | "PARTIAL_FAILED"
  | "FAILED"
  | "STALE"
  | "NOT_RUN_TODAY"
  | "IDLE";

export type NomusDailySyncRunStatus = "idle" | "running" | "success" | "failed" | "skipped";

export type NomusDailyFailedStep = {
  target: string;
  exitCode: number | null;
  message: string | null;
  finishedAt: string | null;
};

export type NomusDailySyncStatusPayload = {
  overallStatus: NomusDailyOverallStatus;
  /** @deprecated Use isActuallyRunning — mantido por compatibilidade. */
  isRunning: boolean;
  isActuallyRunning: boolean;
  hasLiveProcess: boolean;
  hasActiveLock: boolean;
  staleReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  currentOrLastStep: string | null;
  failedSteps: NomusDailyFailedStep[];
  recommendedAction: string | null;
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
  ranToday: boolean;
};

export function overallStatusLabel(status: NomusDailyOverallStatus): string {
  switch (status) {
    case "RUNNING":
      return "Em execução";
    case "SUCCESS":
      return "Concluída com sucesso";
    case "PARTIAL_FAILED":
      return "Finalizada com falha parcial";
    case "FAILED":
      return "Finalizada com falha";
    case "STALE":
      return "Status travado (stale)";
    case "NOT_RUN_TODAY":
      return "Não executada hoje";
    default:
      return "Parada";
  }
}

export function primaryButtonLabel(
  status: NomusDailyOverallStatus,
  isActuallyRunning: boolean
): string {
  if (isActuallyRunning || status === "RUNNING") {
    return "Rotina em execução";
  }
  if (status === "STALE") {
    return "Rodar novamente com segurança";
  }
  if (status === "PARTIAL_FAILED" || status === "FAILED") {
    return "Rodar novamente";
  }
  if (status === "SUCCESS") {
    return "Rodar rotina diária novamente";
  }
  return "Rodar rotina diária Nomus agora";
}

export function overallStatusBadgeClass(status: NomusDailyOverallStatus): string {
  switch (status) {
    case "RUNNING":
      return "bg-sky-100 text-sky-900 border-sky-200";
    case "SUCCESS":
      return "bg-green-100 text-green-900 border-green-200";
    case "PARTIAL_FAILED":
      return "bg-orange-100 text-orange-900 border-orange-200";
    case "FAILED":
      return "bg-red-100 text-red-900 border-red-200";
    case "STALE":
      return "bg-amber-100 text-amber-950 border-amber-300";
    case "NOT_RUN_TODAY":
      return "bg-slate-100 text-slate-800 border-slate-200";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}
