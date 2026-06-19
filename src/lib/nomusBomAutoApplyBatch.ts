/**
 * Aplicação individual/lote de BOM efetiva → ProductBOM com revalidação prévia.
 */
import {
  applyEffectiveBomToProductBom,
  buildControlledApplyPreview,
} from "@/src/lib/nomusBomControlledApply";
import {
  classifyNomusBomApplyStatus,
  isNomusProductReadyToApply,
  summarizeApplyActions,
  type ApplyActionsSummary,
} from "@/src/lib/nomusBomApplyStatus";
import { mapControlledApplyPreviewToAutoApplyProduct } from "@/src/lib/nomusAutoApplyPreviewProductStatus";
import { buildNomusUniverseCodeSet } from "@/src/lib/nomusBomUniverse";
import { isOperationalAutoApplyBlockMessage } from "@/src/lib/nomusBomAutoApplyOutcome";

export const NOMUS_DASHBOARD_BOM_APPLY_AUDIT_ORIGIN = "NOMUS_DASHBOARD_BOM_APPLY";

export type BomAutoApplyItemResult = {
  parentCode: string;
  productCode: string;
  productId: string | null;
  status: "applied" | "skipped" | "blocked" | "error";
  message: string;
  actionsSummary?: ApplyActionsSummary;
  auditId?: string;
};

export type BomAutoApplyBatchResult = {
  summary: {
    selected: number;
    applied: number;
    skipped: number;
    blocked: number;
    errors: number;
  };
  results: BomAutoApplyItemResult[];
};

async function revalidateAndApplyOne(input: {
  parentCode: string;
  approvedBy: string;
  auditOrigin: string;
  batchOrigin: boolean;
}): Promise<BomAutoApplyItemResult> {
  const parentCode = input.parentCode.trim();
  const productCode = parentCode;

  try {
    const nomusUniverse = await buildNomusUniverseCodeSet();
    const preview = await buildControlledApplyPreview(parentCode, { nomusUniverse });
    const mapped = mapControlledApplyPreviewToAutoApplyProduct(preview);

    const ready = isNomusProductReadyToApply({
      parentCode: mapped.parentCode,
      productId: mapped.productId,
      canApply: mapped.canApply,
      blockingReasons: mapped.blockingReasons,
      actionsPreview: mapped.actionsPreview,
    });

    if (!ready) {
      const classified = classifyNomusBomApplyStatus({
        parentCode: mapped.parentCode,
        productId: mapped.productId,
        canApply: mapped.canApply,
        blockingReasons: mapped.blockingReasons,
        actionsPreview: mapped.actionsPreview,
      });

      if (classified.uiStatus === "unchanged") {
        return {
          parentCode,
          productCode,
          productId: mapped.productId,
          status: "skipped",
          message: "Sem alteração no momento da aplicação — ProductBOM já alinhada.",
          actionsSummary: classified.actionsSummary,
        };
      }

      if (classified.uiStatus === "blocked") {
        return {
          parentCode,
          productCode,
          productId: mapped.productId,
          status: "blocked",
          message:
            mapped.blockingReasons[0] ??
            "Produto bloqueado no momento da aplicação — revalidação cancelou o apply.",
          actionsSummary: classified.actionsSummary,
        };
      }

      if (classified.uiStatus === "ignored") {
        return {
          parentCode,
          productCode,
          productId: mapped.productId,
          status: "skipped",
          message: "Produto ignorado ou fora de escopo.",
          actionsSummary: classified.actionsSummary,
        };
      }

      return {
        parentCode,
        productCode,
        productId: mapped.productId,
        status: "skipped",
        message: "Produto não elegível para apply neste momento.",
        actionsSummary: classified.actionsSummary,
      };
    }

    const result = await applyEffectiveBomToProductBom({
      parentCode: preview.parentCode,
      planHash: preview.planHash,
      confirmationText: preview.confirmationRequiredText,
      approvedBy: input.approvedBy,
      auditOrigin: input.auditOrigin,
    });

    const actionsSummary = summarizeApplyActions(mapped.actionsPreview);
    const applied = result.resultStatus === "APPLIED";

    return {
      parentCode,
      productCode,
      productId: preview.productId,
      status: applied ? "applied" : "skipped",
      message: applied
        ? `BOM oficial atualizada (${input.batchOrigin ? "lote" : "individual"}).`
        : "Nenhuma alteração necessária no momento da aplicação.",
      actionsSummary,
      auditId: result.applyRunId,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (isOperationalAutoApplyBlockMessage(errorMessage)) {
      return {
        parentCode,
        productCode,
        productId: null,
        status: "blocked",
        message: errorMessage,
      };
    }
    return {
      parentCode,
      productCode,
      productId: null,
      status: "error",
      message: errorMessage,
    };
  }
}

export async function applyNomusBomFromDashboard(input: {
  parentCode: string;
  approvedBy: string;
}): Promise<BomAutoApplyItemResult> {
  return revalidateAndApplyOne({
    parentCode: input.parentCode,
    approvedBy: input.approvedBy,
    auditOrigin: NOMUS_DASHBOARD_BOM_APPLY_AUDIT_ORIGIN,
    batchOrigin: false,
  });
}

export async function applyNomusBomBatchFromDashboard(input: {
  parentCodes: string[];
  approvedBy: string;
}): Promise<BomAutoApplyBatchResult> {
  const unique = [...new Set(input.parentCodes.map((c) => c.trim()).filter(Boolean))];
  const results: BomAutoApplyItemResult[] = [];

  for (const parentCode of unique) {
    results.push(
      await revalidateAndApplyOne({
        parentCode,
        approvedBy: input.approvedBy,
        auditOrigin: NOMUS_DASHBOARD_BOM_APPLY_AUDIT_ORIGIN,
        batchOrigin: true,
      })
    );
  }

  const summary = {
    selected: unique.length,
    applied: results.filter((r) => r.status === "applied").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    blocked: results.filter((r) => r.status === "blocked").length,
    errors: results.filter((r) => r.status === "error").length,
  };

  return { summary, results };
}

export async function previewNomusBomApplyReadiness(parentCode: string): Promise<{
  parentCode: string;
  readyToApply: boolean;
  planHash: string | null;
  confirmationRequiredText: string | null;
  actionsSummary: ApplyActionsSummary;
  recommendation: string;
  blockingReasons: string[];
}> {
  const preview = await buildControlledApplyPreview(parentCode.trim());
  const mapped = mapControlledApplyPreviewToAutoApplyProduct(preview);
  const classified = classifyNomusBomApplyStatus({
    parentCode: mapped.parentCode,
    productId: mapped.productId,
    canApply: mapped.canApply,
    blockingReasons: mapped.blockingReasons,
    actionsPreview: mapped.actionsPreview,
  });

  return {
    parentCode: mapped.parentCode,
    readyToApply: classified.readyToApply,
    planHash: preview.planHash,
    confirmationRequiredText: preview.confirmationRequiredText,
    actionsSummary: classified.actionsSummary,
    recommendation: classified.recommendation,
    blockingReasons: mapped.blockingReasons,
  };
}
