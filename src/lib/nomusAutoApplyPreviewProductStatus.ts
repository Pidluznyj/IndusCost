import type { ControlledApplyPreview } from "@/src/lib/nomusBomControlledApplyTypes";
import type {
  NomusBomAutoApplyProductResult,
  NomusBomAutoApplyProductStatus,
} from "@/src/lib/nomusBomAutoApplyAfterSyncTypes";

const MUTATING_ACTION_TYPES = new Set([
  "CREATE_PRODUCT_BOM_LINE",
  "UPDATE_PRODUCT_BOM_QUANTITY",
  "UPDATE_PRODUCT_BOM_NOMUS_METADATA",
  "REMOVE_PRODUCT_BOM_LINE",
  "CONSOLIDATE_DUPLICATE_PRODUCT_BOM_LINES",
]);

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

  const hasMutations = preview.actions.some((a) => MUTATING_ACTION_TYPES.has(a.actionType));
  const status: NomusBomAutoApplyProductStatus = hasMutations ? "APPLIED" : "NO_CHANGES";

  return {
    ...base,
    status,
    resultStatus: hasMutations ? "APPLIED" : "NO_CHANGES",
  };
}

export function shouldRevalidateAutoApplyProductStatus(
  product: NomusBomAutoApplyProductResult
): boolean {
  return product.status === "BLOCKED" || product.status === "SKIPPED" || product.status === "ERROR";
}
