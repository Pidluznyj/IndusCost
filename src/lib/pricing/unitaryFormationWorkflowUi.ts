/**
 * Helpers puros da UI do workflow unitário (ações, revisão, erros).
 * Sem Prisma / sem React — testável offline.
 */

import {
  PRODUCTION_COST_TABLE_MANAGE_PERMISSIONS,
  PRODUCTION_COST_TABLE_PUBLISH_PERMISSIONS,
} from "../productionCostTablesUi.js";
import { UNITARY_FORMATION_PRODUCT_DETAIL_ENDPOINT_PREFIX } from "./unitaryFormationDetail.js";
import type {
  UnitaryFormationDraftCost,
  UnitaryFormationLiveCost,
  UnitaryFormationProductDetailResponse,
  UnitaryFormationPublishedCost,
  UnitaryFormationWorkflowState,
} from "./unitaryFormationDetail.js";
import { HttpError } from "../http.js";

export type UnitaryFormationPermissionCheck = {
  hasPermission: (permission: string) => boolean;
};

export function canGenerateUnitaryProductionCostDraft(
  auth: UnitaryFormationPermissionCheck
): boolean {
  return PRODUCTION_COST_TABLE_MANAGE_PERMISSIONS.some((p) => auth.hasPermission(p));
}

export function canPublishUnitaryProductionCostDraft(
  auth: UnitaryFormationPermissionCheck
): boolean {
  return PRODUCTION_COST_TABLE_PUBLISH_PERMISSIONS.some((p) => auth.hasPermission(p));
}

export function buildUnitaryProductionCostDraftUrl(productId: string): string {
  return `${UNITARY_FORMATION_PRODUCT_DETAIL_ENDPOINT_PREFIX}/${encodeURIComponent(productId)}/production-cost/draft`;
}

export function buildUnitaryProductionCostPublishUrl(productId: string): string {
  return `${UNITARY_FORMATION_PRODUCT_DETAIL_ENDPOINT_PREFIX}/${encodeURIComponent(productId)}/production-cost/publish`;
}

/** Body oficial de publicação — nunca inclui custo. */
export function buildUnitaryProductionCostPublishBody(draftVersionId: string): {
  draftVersionId: string;
} {
  return { draftVersionId: String(draftVersionId).trim() };
}

export function shouldShowGenerateUnitaryDraftAction(input: {
  canGenerate: boolean;
  detail: UnitaryFormationProductDetailResponse | null;
  mutating?: boolean;
}): boolean {
  if (!input.canGenerate || !input.detail || input.mutating) return false;
  const live = input.detail.liveCost;
  if (live.status === "ERROR" || live.totalIndustrialCost == null) return false;
  return true;
}

export function shouldShowReviewPublishUnitaryDraftAction(input: {
  canPublish: boolean;
  detail: UnitaryFormationProductDetailResponse | null;
  mutating?: boolean;
}): boolean {
  if (!input.canPublish || !input.detail || input.mutating) return false;
  const draft = input.detail.draftCost;
  if (!draft.exists || !draft.versionId) return false;
  if (draft.staleRelativeToLive === true) return false;
  const state = input.detail.workflow.state;
  return state === "DRAFT_READY";
}

export function shouldShowUnitaryStaleDraftBanner(
  detail: UnitaryFormationProductDetailResponse | null
): boolean {
  if (!detail?.draftCost.exists) return false;
  return (
    detail.draftCost.staleRelativeToLive === true ||
    detail.workflow.state === "DRAFT_STALE"
  );
}

export function shouldShowMultipleUnitaryDraftsHint(
  detail: UnitaryFormationProductDetailResponse | null
): boolean {
  return Boolean(detail?.draftCost.exists && (detail.draftCost.draftCount ?? 0) > 1);
}

export const UNITARY_STALE_DRAFT_CODES = new Set([
  "STALE_DRAFT",
  "CONFLICT_NEWER_DRAFT",
  "CONFLICT_STATUS_CHANGED",
]);

export function isUnitaryStaleOrConflictCode(code: string | null | undefined): boolean {
  return Boolean(code && UNITARY_STALE_DRAFT_CODES.has(code));
}

export function formatUnitaryDraftMutationError(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 403) return "Sem permissão para gerar rascunho de custo.";
    if (err.code === "INACTIVE_PRODUCT") return "Produto inativo — geração bloqueada.";
    if (err.code === "LIVE_COST_ERROR" || err.code === "LIVE_COST_INVALID") {
      return err.message || "Custo LIVE indisponível para gerar rascunho.";
    }
    return err.message || `Erro HTTP ${err.status}`;
  }
  if (err instanceof Error && err.message) return err.message;
  return "Não foi possível gerar o rascunho de custo.";
}

export function formatUnitaryPublishMutationError(err: unknown): {
  message: string;
  code: string | null;
  stale: boolean;
} {
  if (err instanceof HttpError) {
    const code = err.code ?? null;
    if (err.status === 403) {
      return { message: "Sem permissão para publicar custo de produção.", code, stale: false };
    }
    if (isUnitaryStaleOrConflictCode(code)) {
      return {
        message:
          "Este rascunho não representa mais o custo LIVE atual.",
        code,
        stale: true,
      };
    }
    return {
      message: err.message || `Erro HTTP ${err.status}`,
      code,
      stale: false,
    };
  }
  if (err instanceof Error && err.message) {
    return { message: err.message, code: null, stale: false };
  }
  return { message: "Não foi possível publicar o rascunho.", code: null, stale: false };
}

export type UnitaryPublishReviewLine = {
  key: string;
  label: string;
  official: number | null;
  draft: number | null;
  diff: number | null;
  indent?: boolean;
};

export type UnitaryPublishReviewModel = {
  draftVersionId: string;
  officialTotal: number | null;
  draftTotal: number | null;
  diffValue: number | null;
  diffPercent: number | null;
  lines: UnitaryPublishReviewLine[];
};

function roundMoney(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}

function lineDiff(left: number | null, right: number | null): number | null {
  if (left == null || right == null) return null;
  return roundMoney(right - left);
}

function compositionOfPublished(p: UnitaryFormationPublishedCost) {
  return {
    material: p.materialCost,
    processTotal: p.processTotal ?? p.processCost,
    hh: p.laborCost,
    hm: p.machineCost,
    overhead: p.overheadCost,
    others: p.otherCost,
    total: p.unitProductionCost,
  };
}

function compositionOfDraft(d: UnitaryFormationDraftCost) {
  return {
    material: d.materialCost,
    processTotal: d.processTotal ?? d.processCost,
    hh: d.laborCost,
    hm: d.machineCost,
    overhead: d.overheadCost,
    others: d.otherCost,
    total: d.unitProductionCost,
  };
}

export function buildUnitaryPublishReviewModel(
  detail: UnitaryFormationProductDetailResponse
): UnitaryPublishReviewModel | null {
  const draft = detail.draftCost;
  if (!draft.exists || !draft.versionId) return null;
  const official = compositionOfPublished(detail.publishedCost);
  const next = compositionOfDraft(draft);
  const officialTotal = official.total;
  const draftTotal = next.total;
  const diffValue =
    officialTotal != null && draftTotal != null
      ? roundMoney(draftTotal - officialTotal)
      : null;
  const diffPercent =
    officialTotal != null && officialTotal !== 0 && diffValue != null
      ? roundMoney((diffValue / officialTotal) * 100)
      : null;

  const mk = (
    key: string,
    label: string,
    o: number | null,
    d: number | null,
    indent?: boolean
  ): UnitaryPublishReviewLine => ({
    key,
    label,
    official: o,
    draft: d,
    diff: lineDiff(o, d),
    indent,
  });

  return {
    draftVersionId: draft.versionId,
    officialTotal,
    draftTotal,
    diffValue,
    diffPercent,
    lines: [
      mk("material", "Material", official.material, next.material),
      mk("processTotal", "Processo total", official.processTotal, next.processTotal),
      mk("hh", "HH", official.hh, next.hh, true),
      mk("hm", "HM", official.hm, next.hm, true),
      mk("overhead", "Overhead", official.overhead, next.overhead),
      mk("others", "Outros", official.others, next.others),
      mk("total", "Total", officialTotal, draftTotal),
    ],
  };
}

export function buildUnitaryStaleCompareModel(detail: UnitaryFormationProductDetailResponse): {
  draftTotal: number | null;
  liveTotal: number | null;
  diffValue: number | null;
  diffPercent: number | null;
} {
  const draftTotal = detail.draftCost.unitProductionCost;
  const liveTotal = detail.liveCost.totalIndustrialCost;
  const diffValue =
    draftTotal != null && liveTotal != null ? roundMoney(liveTotal - draftTotal) : null;
  const diffPercent =
    draftTotal != null && draftTotal !== 0 && diffValue != null
      ? roundMoney((diffValue / draftTotal) * 100)
      : null;
  return { draftTotal, liveTotal, diffValue, diffPercent };
}

export function unitaryWorkflowActionLabels(state: UnitaryFormationWorkflowState): {
  generateLabel: string;
  reviewLabel: string;
} {
  if (state === "DRAFT_STALE" || state === "LIVE_CHANGED") {
    return {
      generateLabel: "Gerar novo rascunho",
      reviewLabel: "Revisar e publicar",
    };
  }
  return {
    generateLabel: "Gerar rascunho de custo",
    reviewLabel: "Revisar e publicar",
  };
}

/** Snapshot leve pós-publicação para banner. */
export function resolvePostPublishStatus(input: {
  live: UnitaryFormationLiveCost;
  published: UnitaryFormationPublishedCost;
}): "ATUALIZADO" | "DIVERGENTE" | "SEM_COMPARACAO" {
  if (input.live.status === "ERROR" || input.published.status !== "OK") {
    return "SEM_COMPARACAO";
  }
  const live = input.live.totalIndustrialCost;
  const pub = input.published.unitProductionCost;
  if (live == null || pub == null) return "SEM_COMPARACAO";
  return Math.abs(live - pub) <= 1e-6 ? "ATUALIZADO" : "DIVERGENTE";
}
