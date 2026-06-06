export type NomusApOverallStatus =
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "STALE"
  | "SKIPPED"
  | "NOT_RUN_RECENTLY"
  | "IDLE";

export type NomusAccountsPayableSyncStatusPayload = {
  overallStatus: NomusApOverallStatus;
  isRunning: boolean;
  isActuallyRunning: boolean;
  hasLiveProcess: boolean;
  hasActiveLock: boolean;
  staleReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  recommendedAction: string | null;
  syncStrategy: string | null;
  lastRun: {
    fileName: string;
    status: "running" | "success" | "failed" | "skipped";
    startedAt: string | null;
    finishedAt: string | null;
    exitCode: number | null;
    logFile: string | null;
  } | null;
  lastSuccess: { finishedAt: string; fileName: string } | null;
  lastFailure: { finishedAt: string; fileName: string; exitCode: number | null } | null;
  metrics: {
    pagesRead: number | null;
    recordsRead: number | null;
    mapped: number | null;
    created: number | null;
    updated: number | null;
    unchanged: number | null;
    errors: number | null;
  };
  lastLogFile: string | null;
  lastRunnerLogFile: string | null;
  runnerLogDir: string;
};

export function apOverallStatusLabel(status: NomusApOverallStatus): string {
  switch (status) {
    case "RUNNING":
      return "Em execução";
    case "SUCCESS":
      return "Sucesso";
    case "FAILED":
      return "Falha";
    case "STALE":
      return "Interrompida / log incompleto";
    case "SKIPPED":
      return "Ignorada (lock)";
    case "NOT_RUN_RECENTLY":
      return "Sem execução recente";
    default:
      return "Aguardando";
  }
}

export function apOverallStatusBadgeClass(status: NomusApOverallStatus): string {
  switch (status) {
    case "RUNNING":
      return "border-blue-200 bg-blue-50/80 text-blue-950";
    case "SUCCESS":
      return "border-green-200 bg-green-50/80 text-green-950";
    case "FAILED":
    case "STALE":
      return "border-red-200 bg-red-50/80 text-red-950";
    case "SKIPPED":
      return "border-amber-200 bg-amber-50/80 text-amber-950";
    case "NOT_RUN_RECENTLY":
      return "border-orange-200 bg-orange-50/80 text-orange-950";
    default:
      return "border-border bg-card/60 text-foreground";
  }
}

export function apPrimaryButtonLabel(overall: NomusApOverallStatus, isRunning: boolean): string {
  if (isRunning || overall === "RUNNING") return "Sincronizando…";
  return "Rodar Contas a Pagar agora";
}
