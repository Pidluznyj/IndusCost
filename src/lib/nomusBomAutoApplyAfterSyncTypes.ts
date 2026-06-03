export type NomusBomAutoApplyMode = "DRY" | "APPLY";

export type NomusBomAutoApplyProductStatus =
  | "APPLIED"
  | "NO_CHANGES"
  | "BLOCKED"
  | "SKIPPED"
  | "ERROR";

export type NomusBomAutoApplyProductResult = {
  parentCode: string;
  productId: string | null;
  status: NomusBomAutoApplyProductStatus;
  canApply: boolean;
  resultStatus?: "APPLIED" | "NO_CHANGES";
  blockingReasons: string[];
  summary?: {
    created: number;
    updated: number;
    removed: number;
    kept: number;
    skipped: number;
    blocked: number;
  };
  applyRunId?: string;
  errorMessage?: string;
  actionsPreview?: Array<{
    actionType: string;
    componentCode: string;
    currentQuantity?: number | null;
    effectiveQuantity?: number | null;
  }>;
};

export type NomusBomAutoApplyTotals = {
  parentsInNomusStage: number;
  parentsEvaluated: number;
  parentsApplied: number;
  parentsNoChanges: number;
  parentsBlocked: number;
  parentsSkipped: number;
  parentsErrored: number;
  linesCreated: number;
  linesUpdated: number;
  linesRemoved: number;
  linesKept: number;
};

export type NomusBomAutoApplyReport = {
  generatedAt: string;
  mode: NomusBomAutoApplyMode;
  startedAt: string;
  finishedAt: string;
  approvedBy: string;
  batchRunId: string | null;
  reportMdPath: string | null;
  reportJsonPath: string | null;
  /** SUCCESS | SUCCESS_WITH_BLOCKED | FAILED — severidade do lote. */
  batchOutcome?: "SUCCESS" | "SUCCESS_WITH_BLOCKED" | "FAILED";
  totals: NomusBomAutoApplyTotals;
  products: NomusBomAutoApplyProductResult[];
};
