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
  | "READY_TO_APPLY"
  | "APPLIED"
  | "ERROR";

export type AutoApplyProductCategory =
  | "APPLIED"
  | "READY_TO_APPLY"
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
  readyToApply: boolean;
  hasUnappliedBomDiff: boolean;
  appliedToOfficialBom: boolean;
  planHash: string | null;
  confirmationRequiredText: string | null;
  diffSummary: string;
  applyRunId?: string | null;
  resultStatus?: "APPLIED" | "NO_CHANGES";
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
  /** Totais exibidos nos cards — lista atual (revalidada quando statusRevalidatedAt). */
  totals: NomusBomAutoApplyTotals | null;
  /** Snapshot da última execução batch APPLY (somente quando difere de totals após revalidação). */
  batchTotals: NomusBomAutoApplyTotals | null;
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
  /** ISO — preview read-only dos produtos bloqueados/ignorados após carregar o relatório batch. */
  statusRevalidatedAt: string | null;
  /** Quantos produtos tiveram status reavaliado via preview (read-only). */
  revalidatedProductCount: number;
  /** Produtos cuja revalidação falhou e permanecem com snapshot batch. */
  revalidationErrorCount: number;
  /** Nota de UX sobre origem dos totais (batch vs revalidação). */
  batchTotalsNote: string | null;
};
