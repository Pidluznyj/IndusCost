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
      return "border-blue-200 bg-blue-50/80 text-blue-950";
    case "SUCCESS":
      return "border-green-200 bg-green-50/80 text-green-950";
    case "PARTIAL_FAILED":
      return "border-orange-200 bg-orange-50/80 text-orange-950";
    case "FAILED":
      return "border-red-200 bg-red-50/80 text-red-950";
    case "STALE":
      return "border-amber-200 bg-amber-50/80 text-amber-950";
    case "NOT_RUN_TODAY":
      return "border-slate-200 bg-slate-50/80 text-slate-800";
    default:
      return "border-border bg-card/60 text-foreground";
  }
}
