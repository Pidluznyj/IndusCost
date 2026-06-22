import type { AutoApplyBomDashboardResult } from "@/src/lib/nomusAutoApplyBomDashboardTypes";

export type NomusAutoApplyDashboardRevalidationJobStatus =
  | "IDLE"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED";

export type NomusAutoApplyDashboardRevalidationStatus = {
  jobId: string | null;
  status: NomusAutoApplyDashboardRevalidationJobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  totalProducts: number;
  eligibleProducts: number;
  processedProducts: number;
  revalidatedProductCount: number;
  revalidationErrorCount: number;
  currentParentCode: string | null;
  progressPercent: number;
  errorMessage: string | null;
  snapshotGeneratedAt: string | null;
  lastSuccessfulSnapshotAt: string | null;
};

export type NomusAutoApplyDashboardRevalidationStartResult = {
  job: NomusAutoApplyDashboardRevalidationStatus;
  alreadyRunning: boolean;
};

export type StoredAutoApplyDashboardSnapshot = {
  id: string;
  status: string;
  generatedAt: string | null;
  result: AutoApplyBomDashboardResult;
};
