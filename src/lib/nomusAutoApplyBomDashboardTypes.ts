import type {
  NomusBomAutoApplyProductResult,
  NomusBomAutoApplyReport,
  NomusBomAutoApplyTotals,
} from "@/src/lib/nomusBomAutoApplyAfterSyncTypes";

export type AutoApplyDashboardFilter =
  | "ALL"
  | "BLOCKED"
  | "DIVERGENT"
  | "OPTIONAL_PENDING"
  | "LOCAL_PENDING"
  | "SKIPPED"
  | "NO_CHANGES"
  | "APPLIED"
  | "ERROR";

export type AutoApplyProductCategory =
  | "APPLIED"
  | "NO_CHANGES"
  | "BLOCKED"
  | "SKIPPED"
  | "ERROR"
  | "QUANTITY_DIVERGENT"
  | "METADATA_PENDING"
  | "LOCAL_ITEM_PENDING"
  | "OPTIONAL_PENDING"
  | "NOT_IN_INDUS";

export type AutoApplyBlockingReasonBucket = {
  key: string;
  label: string;
  count: number;
};

export type AutoApplyBomDashboardProductRow = {
  parentCode: string;
  productId: string | null;
  status: NomusBomAutoApplyProductResult["status"];
  canApply: boolean;
  primaryReason: string;
  blockingReasons: string[];
  categories: AutoApplyProductCategory[];
  filterBuckets: AutoApplyDashboardFilter[];
  quantityDiffCount: number;
  metadataOnlyCount: number;
  localOnlyLineCodes: string[];
  actionsPreview: NomusBomAutoApplyProductResult["actionsPreview"];
  errorMessage?: string;
};

export type AutoApplyBomDashboardLastRun = {
  startedAt: string;
  finishedAt: string;
  approvedBy: string;
  batchRunId: string | null;
  mode: NomusBomAutoApplyReport["mode"];
  reportJsonPath: string | null;
  reportMdPath: string | null;
};

export type AutoApplyBomDashboardResult = {
  generatedAt: string;
  mode: "READ_ONLY";
  source: "REPORT_FILE" | "ENGINEERING_SYNC_RUN" | "NONE";
  hasReport: boolean;
  emptyMessage: string | null;
  lastRun: AutoApplyBomDashboardLastRun | null;
  totals: NomusBomAutoApplyTotals | null;
  blockingReasonBuckets: AutoApplyBlockingReasonBucket[];
  products: AutoApplyBomDashboardProductRow[];
  filter: AutoApplyDashboardFilter;
  search: string | null;
  matchedCount: number;
};
