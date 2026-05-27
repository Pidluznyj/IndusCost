import type {
  NomusBomAutoApplyProductResult,
  NomusBomAutoApplyReport,
  NomusBomAutoApplyTotals,
} from "@/src/lib/nomusBomAutoApplyAfterSyncTypes";
import type { NomusMaintenanceTab } from "@/src/lib/nomusMaintenanceWorkspaceTypes";

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
  pendingTypeLabel: string;
  recommendedAction: string;
  recommendedTab: NomusMaintenanceTab;
  severity: number;
  actionsCount: number;
  actionsSummaryLines: string[];
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
  hasProductList: boolean;
  needsReportRegeneration: boolean;
  regenerateReportCommand: string | null;
  productListSource: string | null;
  checklistMdPath: string | null;
  partialReportWarning: string | null;
  emptyMessage: string | null;
  lastRun: AutoApplyBomDashboardLastRun | null;
  totals: NomusBomAutoApplyTotals | null;
  blockingReasonBuckets: AutoApplyBlockingReasonBucket[];
  /** Lista completa enriquecida — filtragem principal no cliente. */
  products: AutoApplyBomDashboardProductRow[];
  filterCounts: Record<AutoApplyDashboardFilter, number>;
  totalProducts: number;
  /** @deprecated Preferir filtragem no cliente; mantido para compatibilidade. */
  filter: AutoApplyDashboardFilter;
  /** @deprecated Preferir filtragem no cliente; mantido para compatibilidade. */
  search: string | null;
  /** @deprecated Igual a totalProducts quando sem filtro server-side. */
  matchedCount: number;
};
