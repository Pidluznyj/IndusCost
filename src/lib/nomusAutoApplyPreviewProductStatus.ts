import type { ControlledApplyPreview } from "@/src/lib/nomusBomControlledApplyTypes";
import type {
  NomusBomAutoApplyProductResult,
  NomusBomAutoApplyProductStatus,
} from "@/src/lib/nomusBomAutoApplyAfterSyncTypes";
import {
  classifyNomusBomApplyStatus,
  hasMutatingApplyActions,
} from "@/src/lib/nomusBomApplyStatus";

export function previewActionsSummary(
  preview: ControlledApplyPreview
): NomusBomAutoApplyProductResult["actionsPreview"] {
  return preview.actions.map((a) => ({
    actionType: a.actionType,
    componentCode: a.componentCode,
    currentQuantity: a.currentQuantity ?? null,
    effectiveQuantity: a.effectiveQuantity ?? null,
  }));
}

export function mapControlledApplyPreviewToAutoApplyProduct(
  preview: ControlledApplyPreview
): NomusBomAutoApplyProductResult {
  const base: NomusBomAutoApplyProductResult = {
    parentCode: preview.parentCode,
    productId: preview.productId,
    status: "SKIPPED",
    canApply: preview.canApply,
    blockingReasons: [...preview.blockingReasons],
    actionsPreview: previewActionsSummary(preview),
  };

  if (!preview.productId) {
    return {
      ...base,
      status: "SKIPPED",
      blockingReasons: preview.blockingReasons.length
        ? preview.blockingReasons
        : ["Produto não cadastrado no IndusCost."],
    };
  }

  if (!preview.canApply) {
    return {
      ...base,
      status: "BLOCKED",
    };
  }

  const hasMutations = hasMutatingApplyActions(previewActionsSummary(preview));
  const classified = classifyNomusBomApplyStatus({
    parentCode: preview.parentCode,
    productId: preview.productId,
    canApply: preview.canApply,
    blockingReasons: preview.blockingReasons,
    actionsPreview: previewActionsSummary(preview),
  });
  const status: NomusBomAutoApplyProductStatus = hasMutations
    ? classified.status === "NO_CHANGES"
      ? "NO_CHANGES"
      : "READY_TO_APPLY"
    : "NO_CHANGES";

  return {
    ...base,
    status,
    planHash: preview.planHash,
    effectiveBomHash: preview.effectiveBomHash,
    confirmationRequiredText: preview.confirmationRequiredText,
  };
}

export function shouldRevalidateAutoApplyProductStatus(
  product: NomusBomAutoApplyProductResult
): boolean {
  if (product.status === "BLOCKED" || product.status === "SKIPPED" || product.status === "ERROR") {
    return true;
  }
  if (product.status === "READY_TO_APPLY") return true;
  // Relatórios DRY/legados marcavam preview com mutações como APPLIED sem applyRunId.
  if (product.status === "APPLIED" && !product.applyRunId) return true;
  return false;
}
