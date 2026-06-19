/**
 * Classificação canônica de status de auto apply BOM Nomus → ProductBOM.
 * Seguro para frontend e backend (sem Prisma).
 */
import type {
  NomusBomAutoApplyProductResult,
  NomusBomAutoApplyProductStatus,
} from "@/src/lib/nomusBomAutoApplyAfterSyncTypes";

export type NomusBomApplyUiStatus =
  | "unchanged"
  | "ready_to_apply"
  | "applied"
  | "blocked"
  | "ignored"
  | "error";

export const MUTATING_APPLY_ACTION_TYPES = new Set([
  "CREATE_PRODUCT_BOM_LINE",
  "UPDATE_PRODUCT_BOM_QUANTITY",
  "UPDATE_PRODUCT_BOM_NOMUS_METADATA",
  "REMOVE_PRODUCT_BOM_LINE",
  "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES",
]);

export type ApplyActionsSummary = {
  add: number;
  update: number;
  remove: number;
  unchanged: number;
};

export type NomusBomApplyStatusInput = {
  parentCode: string;
  productId: string | null;
  canApply: boolean;
  blockingReasons: string[];
  errorMessage?: string | null;
  status?: NomusBomAutoApplyProductStatus;
  actionsPreview?: NomusBomAutoApplyProductResult["actionsPreview"];
  applyRunId?: string | null;
  resultStatus?: "APPLIED" | "NO_CHANGES";
};

export type NomusBomApplyStatusResult = {
  uiStatus: NomusBomApplyUiStatus;
  status: NomusBomAutoApplyProductStatus;
  readyToApply: boolean;
  hasCurrentBlockers: boolean;
  hasUnappliedBomDiff: boolean;
  appliedToOfficialBom: boolean;
  ignored: boolean;
  blockers: string[];
  errors: string[];
  recommendation: string;
  actionsSummary: ApplyActionsSummary;
};

export function hasMutatingApplyActions(
  actions: NomusBomAutoApplyProductResult["actionsPreview"] | undefined
): boolean {
  if (!actions?.length) return false;
  return actions.some((a) => MUTATING_APPLY_ACTION_TYPES.has(a.actionType));
}

export function summarizeApplyActions(
  actions: NomusBomAutoApplyProductResult["actionsPreview"] | undefined
): ApplyActionsSummary {
  const summary: ApplyActionsSummary = { add: 0, update: 0, remove: 0, unchanged: 0 };
  if (!actions?.length) return summary;

  for (const action of actions) {
    switch (action.actionType) {
      case "CREATE_PRODUCT_BOM_LINE":
        summary.add += 1;
        break;
      case "UPDATE_PRODUCT_BOM_QUANTITY":
      case "UPDATE_PRODUCT_BOM_NOMUS_METADATA":
      case "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES":
        summary.update += 1;
        break;
      case "REMOVE_PRODUCT_BOM_LINE":
        summary.remove += 1;
        break;
      case "KEEP_PRODUCT_BOM_LINE":
        summary.unchanged += 1;
        break;
      default:
        break;
    }
  }
  return summary;
}

export function hasUnappliedBomDiff(input: {
  actionsPreview?: NomusBomAutoApplyProductResult["actionsPreview"];
  canApply?: boolean;
}): boolean {
  return Boolean(input.canApply) && hasMutatingApplyActions(input.actionsPreview);
}

export function isNomusProductReadyToApply(input: NomusBomApplyStatusInput): boolean {
  return classifyNomusBomApplyStatus(input).readyToApply;
}

export function classifyNomusBomApplyStatus(input: NomusBomApplyStatusInput): NomusBomApplyStatusResult {
  const blockers = [...(input.blockingReasons ?? [])];
  const errors = input.errorMessage ? [input.errorMessage] : [];
  const hasCurrentBlockers = blockers.length > 0 || !input.canApply;
  const diff = hasUnappliedBomDiff({
    actionsPreview: input.actionsPreview,
    canApply: input.canApply,
  });
  const appliedToOfficialBom = Boolean(
    input.applyRunId || (input.status === "APPLIED" && input.resultStatus === "APPLIED")
  );
  const ignored =
    !input.productId || input.status === "SKIPPED" || blockers.some((r) => /não cadastrado/i.test(r));

  const actionsSummary = summarizeApplyActions(input.actionsPreview);

  if (input.status === "ERROR" || errors.length > 0) {
    return {
      uiStatus: "error",
      status: "ERROR",
      readyToApply: false,
      hasCurrentBlockers: true,
      hasUnappliedBomDiff: diff,
      appliedToOfficialBom,
      ignored: false,
      blockers,
      errors,
      recommendation: "Abrir Diagnóstico Técnico e revisar o erro registrado.",
      actionsSummary,
    };
  }

  if (ignored) {
    return {
      uiStatus: "ignored",
      status: "SKIPPED",
      readyToApply: false,
      hasCurrentBlockers: false,
      hasUnappliedBomDiff: diff,
      appliedToOfficialBom,
      ignored: true,
      blockers,
      errors,
      recommendation: "Produto fora de escopo ou não cadastrado no IndusCost.",
      actionsSummary,
    };
  }

  if (hasCurrentBlockers || input.status === "BLOCKED") {
    return {
      uiStatus: "blocked",
      status: "BLOCKED",
      readyToApply: false,
      hasCurrentBlockers: true,
      hasUnappliedBomDiff: diff,
      appliedToOfficialBom,
      ignored: false,
      blockers,
      errors,
      recommendation: "Resolver bloqueios antes de aplicar na ProductBOM.",
      actionsSummary,
    };
  }

  if (appliedToOfficialBom) {
    return {
      uiStatus: "applied",
      status: "APPLIED",
      readyToApply: false,
      hasCurrentBlockers: false,
      hasUnappliedBomDiff: false,
      appliedToOfficialBom: true,
      ignored: false,
      blockers,
      errors,
      recommendation: "BOM oficial já atualizada na última aplicação.",
      actionsSummary,
    };
  }

  if (diff) {
    return {
      uiStatus: "ready_to_apply",
      status: "READY_TO_APPLY",
      readyToApply: true,
      hasCurrentBlockers: false,
      hasUnappliedBomDiff: true,
      appliedToOfficialBom: false,
      ignored: false,
      blockers,
      errors,
      recommendation: "Aplicar atualização na ProductBOM",
      actionsSummary,
    };
  }

  return {
    uiStatus: "unchanged",
    status: "NO_CHANGES",
    readyToApply: false,
    hasCurrentBlockers: false,
    hasUnappliedBomDiff: false,
    appliedToOfficialBom: false,
    ignored: false,
    blockers,
    errors,
    recommendation: "Nenhuma ação necessária nesta rotina.",
    actionsSummary,
  };
}

/** Converte snapshot legado (APPLIED sem applyRunId) para READY_TO_APPLY quando aplicável. */
export function reconcileReportProductStatus(
  product: NomusBomAutoApplyProductResult
): NomusBomAutoApplyProductResult {
  const classified = classifyNomusBomApplyStatus({
    parentCode: product.parentCode,
    productId: product.productId,
    canApply: product.canApply,
    blockingReasons: product.blockingReasons ?? [],
    errorMessage: product.errorMessage,
    status: product.status,
    actionsPreview: product.actionsPreview,
    applyRunId: product.applyRunId,
    resultStatus: product.resultStatus,
  });

  return {
    ...product,
    status: classified.status,
    canApply: classified.readyToApply || product.canApply,
  };
}

export function productResultToStatusInput(
  product: NomusBomAutoApplyProductResult
): NomusBomApplyStatusInput {
  return {
    parentCode: product.parentCode,
    productId: product.productId,
    canApply: product.canApply,
    blockingReasons: product.blockingReasons ?? [],
    errorMessage: product.errorMessage,
    status: product.status,
    actionsPreview: product.actionsPreview,
    applyRunId: product.applyRunId,
    resultStatus: product.resultStatus,
  };
}

export function isEligibleForBatchApply(product: NomusBomAutoApplyProductResult): boolean {
  return isNomusProductReadyToApply(productResultToStatusInput(product));
}
