export type NomusStockDocumentsSyncStatusPayload = {
  overallStatus: "IDLE" | "RUNNING" | "SUCCESS" | "FAILED" | "STALE" | "SKIPPED";
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
    logFile: string;
  } | null;
  lastSuccess: { finishedAt: string; fileName: string } | null;
  lastFailure: {
    finishedAt: string;
    fileName: string;
    exitCode: number | null;
  } | null;
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
