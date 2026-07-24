/**
 * Tipos e helpers puros — publicação em lote de custos de produção DRAFT.
 * Sem Prisma / I/O. A publicação real reutiliza publishProductionCostVersionFromDraft.
 */

import { computeProductionCostPublicationDifference } from "./productProductionCostPublicationStatus.js";
import {
  PRODUCTION_COST_ENGINEERING_SNAPSHOT_SOURCE,
  type FrozenCostTraceStatus,
} from "./productEngineeringCostSnapshot.js";
import { hasProductionCostDifference } from "./productEngineeringCostWarning.js";

export const PRODUCTION_COST_BULK_PUBLISH_SOURCE = "BULK_PUBLISH_ENGINEERING" as const;

export const PRODUCTION_COST_BULK_PUBLISH_DEFAULT_CHUNK_SIZE = 25;

export const PRODUCTION_COST_BULK_PUBLISH_ITEM_STATUSES = [
  "ELIGIBLE",
  "PUBLISHED",
  "ALREADY_PUBLISHED",
  "SKIPPED",
  "BLOCKED",
  "CONFLICT",
  "ERROR",
] as const;

export type ProductionCostBulkPublishItemStatus =
  (typeof PRODUCTION_COST_BULK_PUBLISH_ITEM_STATUSES)[number];

export type ProductionCostBulkPublishBlockReason =
  | "NO_DRAFT"
  | "STALE_DRAFT"
  | "TECHNICAL_ONLY"
  | "ALREADY_PUBLISHED"
  | "NOT_PENDING"
  | "MULTIPLE_DRAFTS_USES_LATEST"
  | "INACTIVE_PRODUCT"
  | "INVALID_COST"
  | "WRONG_PRODUCT"
  | "CONFLICT_NEWER_DRAFT"
  | "CONFLICT_STATUS_CHANGED"
  | "PERMISSION"
  | "ERROR"
  | null;

export type ProductionCostBulkPublishPreviewRow = {
  productId: string;
  sku: string;
  name: string;
  productStatus: string | null;
  productVersion: string | null;
  draftVersionId: string | null;
  draftCode: string | null;
  draftRevision: number | null;
  draftCreatedAt: string | null;
  draftSource: string | null;
  draftCreatedBy: string | null;
  draftUnitCost: number | null;
  publishedVersionId: string | null;
  publishedUnitCost: number | null;
  differenceAmount: number | null;
  differencePercent: number | null;
  draftCount: number;
  traceStatus: FrozenCostTraceStatus | null;
  eligible: boolean;
  status: ProductionCostBulkPublishItemStatus;
  blockReason: ProductionCostBulkPublishBlockReason;
  message: string;
};

export type ProductionCostBulkPublishPreviewSummary = {
  selected: number;
  eligible: number;
  withoutDraft: number;
  staleDraft: number;
  multipleDrafts: number;
  blocked: number;
  alreadyPublished: number;
  technicalOnly: number;
};

export type ProductionCostBulkPublishPreview = {
  batchRunId: string;
  generatedAt: string;
  readOnly: true;
  summary: ProductionCostBulkPublishPreviewSummary;
  rows: ProductionCostBulkPublishPreviewRow[];
};

export type ProductionCostBulkPublishResultRow = {
  productId: string;
  sku: string;
  name: string;
  productVersion: string | null;
  draftVersionId: string | null;
  previousPublishedVersionId: string | null;
  previousUnitCost: number | null;
  publishedUnitCost: number | null;
  differenceAmount: number | null;
  differencePercent: number | null;
  status: ProductionCostBulkPublishItemStatus;
  message: string;
  processedAt: string;
};

export type ProductionCostBulkPublishResultSummary = {
  selected: number;
  processed: number;
  published: number;
  alreadyPublished: number;
  skipped: number;
  blocked: number;
  conflict: number;
  error: number;
};

export type ProductionCostBulkPublishResult = {
  batchRunId: string;
  finishedAt: string;
  chunkSize: number;
  summary: ProductionCostBulkPublishResultSummary;
  rows: ProductionCostBulkPublishResultRow[];
};

export function readProductionCostBulkPublishChunkSize(
  envValue?: string | null
): number {
  const raw = envValue ?? process.env.PRODUCTION_COST_BULK_PUBLISH_CHUNK_SIZE;
  const n = raw != null && String(raw).trim() ? Number.parseInt(String(raw), 10) : NaN;
  if (!Number.isFinite(n)) return PRODUCTION_COST_BULK_PUBLISH_DEFAULT_CHUNK_SIZE;
  return Math.min(100, Math.max(1, n));
}

export function chunkIds<T>(items: readonly T[], chunkSize: number): T[][] {
  const size = Math.max(1, chunkSize);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function isEngineeringAutoDraftCode(code: string | null | undefined): boolean {
  return Boolean(code?.trim().startsWith("AUTO-"));
}

export function isEngineeringSnapshotSource(source: string | null | undefined): boolean {
  return source === PRODUCTION_COST_ENGINEERING_SNAPSHOT_SOURCE;
}

export function draftMatchesCurrentCalculation(input: {
  draftHash: string | null | undefined;
  liveHash: string | null | undefined;
  draftUnitCost: number | null | undefined;
  liveCiu: number | null | undefined;
}): boolean {
  const draftHash = input.draftHash?.trim() ?? "";
  const liveHash = input.liveHash?.trim() ?? "";
  if (draftHash && liveHash && draftHash === liveHash) return true;
  if (
    input.draftUnitCost != null &&
    input.liveCiu != null &&
    !hasProductionCostDifference(input.draftUnitCost, input.liveCiu)
  ) {
    return true;
  }
  return false;
}

export function classifyBulkPublishEligibility(input: {
  productStatus: string | null | undefined;
  draftVersionId: string | null | undefined;
  draftStatus: string | null | undefined;
  draftUnitCost: number | null | undefined;
  draftMatchesCurrent: boolean;
  draftCount: number;
  traceStatus: FrozenCostTraceStatus | null | undefined;
}): {
  eligible: boolean;
  status: ProductionCostBulkPublishItemStatus;
  blockReason: ProductionCostBulkPublishBlockReason;
  message: string;
} {
  if (input.productStatus && input.productStatus !== "ACTIVE") {
    return {
      eligible: false,
      status: "BLOCKED",
      blockReason: "INACTIVE_PRODUCT",
      message: "Produto inativo — publicação bloqueada.",
    };
  }
  if (!input.draftVersionId || input.draftStatus !== "DRAFT") {
    if (input.draftStatus === "PUBLISHED") {
      return {
        eligible: false,
        status: "ALREADY_PUBLISHED",
        blockReason: "ALREADY_PUBLISHED",
        message: "Versão já publicada.",
      };
    }
    return {
      eligible: false,
      status: "SKIPPED",
      blockReason: "NO_DRAFT",
      message: "Sem DRAFT de custo de produção.",
    };
  }
  if (input.draftUnitCost == null || !(input.draftUnitCost > 0)) {
    return {
      eligible: false,
      status: "BLOCKED",
      blockReason: "INVALID_COST",
      message: "DRAFT sem custo unitário válido (> 0).",
    };
  }
  if (input.traceStatus === "SNAPSHOT_TECNICO_SEM_IMPACTO") {
    return {
      eligible: false,
      status: "SKIPPED",
      blockReason: "TECHNICAL_ONLY",
      message: "Snapshot técnico sem impacto de custo — publicação de custo não necessária.",
    };
  }
  if (!input.draftMatchesCurrent) {
    return {
      eligible: false,
      status: "BLOCKED",
      blockReason: "STALE_DRAFT",
      message: "DRAFT desatualizado em relação ao CIU atual — gere novo rascunho.",
    };
  }
  if (input.traceStatus !== "PENDENTE_PUBLICACAO") {
    if (input.traceStatus === "ATUALIZADO") {
      return {
        eligible: false,
        status: "SKIPPED",
        blockReason: "NOT_PENDING",
        message: "Custo já compatível com o publicado.",
      };
    }
    return {
      eligible: false,
      status: "BLOCKED",
      blockReason: "NOT_PENDING",
      message: "Item não está Pendente de publicação.",
    };
  }

  const multipleNote =
    input.draftCount > 1
      ? " Há múltiplos DRAFTs; será usado o mais recente."
      : "";
  return {
    eligible: true,
    status: "ELIGIBLE",
    blockReason: input.draftCount > 1 ? "MULTIPLE_DRAFTS_USES_LATEST" : null,
    message: `Apto para publicação.${multipleNote}`,
  };
}

export function summarizeBulkPublishPreview(
  rows: readonly ProductionCostBulkPublishPreviewRow[]
): ProductionCostBulkPublishPreviewSummary {
  return {
    selected: rows.length,
    eligible: rows.filter((r) => r.eligible).length,
    withoutDraft: rows.filter((r) => r.blockReason === "NO_DRAFT").length,
    staleDraft: rows.filter((r) => r.blockReason === "STALE_DRAFT").length,
    multipleDrafts: rows.filter((r) => r.draftCount > 1).length,
    blocked: rows.filter((r) => r.status === "BLOCKED").length,
    alreadyPublished: rows.filter((r) => r.status === "ALREADY_PUBLISHED").length,
    technicalOnly: rows.filter((r) => r.blockReason === "TECHNICAL_ONLY").length,
  };
}

export function summarizeBulkPublishResult(
  rows: readonly ProductionCostBulkPublishResultRow[]
): ProductionCostBulkPublishResultSummary {
  return {
    selected: rows.length,
    processed: rows.length,
    published: rows.filter((r) => r.status === "PUBLISHED").length,
    alreadyPublished: rows.filter((r) => r.status === "ALREADY_PUBLISHED").length,
    skipped: rows.filter((r) => r.status === "SKIPPED").length,
    blocked: rows.filter((r) => r.status === "BLOCKED").length,
    conflict: rows.filter((r) => r.status === "CONFLICT").length,
    error: rows.filter((r) => r.status === "ERROR").length,
  };
}

export function buildDifferenceLabels(
  published: number | null,
  draft: number | null
): { amount: number | null; percent: number | null } {
  if (draft == null || !Number.isFinite(draft)) {
    return { amount: null, percent: null };
  }
  const diff = computeProductionCostPublicationDifference(published, draft);
  return { amount: diff.amount, percent: diff.percent };
}
