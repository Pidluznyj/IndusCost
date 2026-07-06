import { createHash } from "node:crypto";
import { normalizeSku } from "@/src/lib/nomusBomComparison";
import { loadProductMaterialRegistrySnapshots } from "@/src/lib/nomusProductMaterialAmbiguityEvidence";
import {
  classifyProductMaterialAmbiguity,
  type AmbiguitySuggestedDecision,
  type ProductMaterialAmbiguityStatus,
} from "@/src/lib/nomusProductMaterialAmbiguityClassify";
import {
  applyAmbiguityResolutionPlan,
  buildAmbiguityResolutionPlan,
  type AmbiguityPrefer,
} from "@/src/lib/nomusRegistryAmbiguityResolution";
import { buildNomusMasterDataImportDiagnostic } from "@/src/lib/nomusMasterDataImport";

export const AMBIGUITY_BATCH_CONFIRMATION_TEXT =
  "RESOLVER AMBIGUIDADES NOMUS LOTE";

export type AmbiguityBatchPreviewItem = {
  code: string;
  description: string | null;
  ambiguityStatus: ProductMaterialAmbiguityStatus;
  suggestedDecision: AmbiguitySuggestedDecision;
  justification: string;
  risks: string[];
  plannedActions: string[];
  product: {
    id: string;
    active: boolean;
    ownBomLineCount: number;
    routingCount: number;
  } | null;
  material: {
    id: string;
    active: boolean;
    currentCost: number | null;
    standardCost: number | null;
  } | null;
  nomusControlledBomAsProductCount: number;
  nomusControlledBomAsMaterialCount: number;
  perCodePlanHash: string | null;
  canApplyThisCode: boolean;
  applyBlockedReason: string | null;
};

export type AmbiguityBatchPreviewResult = {
  generatedAt: string;
  planHash: string;
  confirmationRequiredText: string;
  totals: {
    scannedBothRegistry: number;
    realBlocked: number;
    resolvedDisplay: number;
    autoApplicable: number;
    keepBlocked: number;
  };
  items: AmbiguityBatchPreviewItem[];
};

export type ApplyAmbiguityBatchInput = {
  planHash: string;
  confirmationText: string;
  backupFilePath?: string;
  approvedBy?: string;
  codes?: string[];
};

export type ApplyAmbiguityBatchResult = {
  resultStatus: "APPLIED" | "BLOCKED" | "PARTIAL" | "FAILED";
  planHash: string;
  appliedCodes: string[];
  skippedCodes: string[];
  failedCodes: Array<{ code: string; message: string }>;
  message: string;
};

export function buildAmbiguityBatchPlanHash(codes: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ codes: [...codes].map(normalizeSku).sort() }))
    .digest("hex");
}

function decisionToPrefer(decision: AmbiguitySuggestedDecision): AmbiguityPrefer | null {
  if (decision === "PREFER_MATERIAL") return "MATERIAL";
  if (decision === "PREFER_PRODUCT") return "PRODUCT";
  return null;
}

export async function buildAmbiguityBatchPreview(): Promise<AmbiguityBatchPreviewResult> {
  const diag = await buildNomusMasterDataImportDiagnostic({
    limit: 10000,
    offset: 0,
    includeExisting: true,
  });

  const candidateCodes = diag.rows
    .filter(
      (r) =>
        r.classification === "EXISTING_BOTH_AMBIGUOUS" ||
        r.classification === "RESOLVED_AS_MATERIAL" ||
        r.classification === "RESOLVED_AS_PRODUCT"
    )
    .map((r) => r.code);

  const snapshots = await loadProductMaterialRegistrySnapshots(candidateCodes);
  const items: AmbiguityBatchPreviewItem[] = [];

  for (const code of candidateCodes) {
    const snap = snapshots.get(normalizeSku(code));
    if (!snap?.product || !snap.material) continue;

    const amb = classifyProductMaterialAmbiguity(snap);
    const prefer = decisionToPrefer(amb.suggestedDecision);
    let perCodePlanHash: string | null = null;
    let canApplyThisCode = false;
    let applyBlockedReason: string | null = null;

    if (prefer) {
      const plan = await buildAmbiguityResolutionPlan({ code, prefer });
      perCodePlanHash = plan.planHash;
      canApplyThisCode = plan.canApply;
      if (!plan.canApply) {
        applyBlockedReason = plan.risks[0] ?? "Plano individual bloqueado.";
      }
    } else {
      applyBlockedReason = "Sem decisão automática (MANTER_BLOQUEADO).";
    }

    const row = diag.rows.find((r) => normalizeSku(r.code) === normalizeSku(code));

    items.push({
      code,
      description: row?.description ?? null,
      ambiguityStatus: amb.status,
      suggestedDecision: amb.suggestedDecision,
      justification: amb.reason,
      risks: amb.risks,
      plannedActions: amb.plannedActions,
      product: snap.product
        ? {
            id: snap.product.id,
            active: snap.product.active,
            ownBomLineCount: snap.product.ownBomLineCount,
            routingCount: snap.product.routingCount,
          }
        : null,
      material: snap.material
        ? {
            id: snap.material.id,
            active: snap.material.active,
            currentCost: snap.material.currentCost,
            standardCost: snap.material.standardCost,
          }
        : null,
      nomusControlledBomAsProductCount: snap.nomusControlledBomAsProductCount,
      nomusControlledBomAsMaterialCount: snap.nomusControlledBomAsMaterialCount,
      perCodePlanHash,
      canApplyThisCode,
      applyBlockedReason,
    });
  }

  const autoApplicableCodes = items
    .filter((i) => i.canApplyThisCode && i.suggestedDecision === "PREFER_MATERIAL")
    .map((i) => i.code);

  const planHash = buildAmbiguityBatchPlanHash(autoApplicableCodes);

  return {
    generatedAt: new Date().toISOString(),
    planHash,
    confirmationRequiredText: AMBIGUITY_BATCH_CONFIRMATION_TEXT,
    totals: {
      scannedBothRegistry: items.length,
      realBlocked: items.filter((i) => i.ambiguityStatus === "AMBIGUO_BLOQUEADO").length,
      resolvedDisplay: items.filter(
        (i) =>
          i.ambiguityStatus === "RESOLVIDO_COMO_MATERIAL" ||
          i.ambiguityStatus === "RESOLVIDO_COMO_PRODUCT"
      ).length,
      autoApplicable: autoApplicableCodes.length,
      keepBlocked: items.filter((i) => i.suggestedDecision === "MANTER_BLOQUEADO").length,
    },
    items,
  };
}

export async function applyAmbiguityBatch(
  input: ApplyAmbiguityBatchInput
): Promise<ApplyAmbiguityBatchResult> {
  const preview = await buildAmbiguityBatchPreview();
  const applicable = preview.items.filter(
    (i) =>
      i.canApplyThisCode &&
      i.suggestedDecision === "PREFER_MATERIAL" &&
      i.perCodePlanHash &&
      (!input.codes?.length ||
        input.codes.map(normalizeSku).includes(normalizeSku(i.code)))
  );

  const expectedHash = buildAmbiguityBatchPlanHash(applicable.map((i) => i.code));
  if (input.planHash.trim() !== expectedHash) {
    return {
      resultStatus: "BLOCKED",
      planHash: expectedHash,
      appliedCodes: [],
      skippedCodes: applicable.map((i) => i.code),
      failedCodes: [{ code: "*", message: "planHash do lote divergente — regenere o preview." }],
      message: "planHash divergente.",
    };
  }

  if (input.confirmationText.trim() !== AMBIGUITY_BATCH_CONFIRMATION_TEXT) {
    return {
      resultStatus: "BLOCKED",
      planHash: expectedHash,
      appliedCodes: [],
      skippedCodes: [],
      failedCodes: [],
      message: `Confirmação inválida. Esperado: "${AMBIGUITY_BATCH_CONFIRMATION_TEXT}"`,
    };
  }

  const appliedCodes: string[] = [];
  const failedCodes: ApplyAmbiguityBatchResult["failedCodes"] = [];

  for (const item of applicable) {
    const result = await applyAmbiguityResolutionPlan({
      code: item.code,
      prefer: "MATERIAL",
      planHash: item.perCodePlanHash!,
      confirmationText: `RESOLVER AMBIGUIDADE ${normalizeSku(item.code)} MATERIAL`,
      backupFilePath: input.backupFilePath
        ? `${input.backupFilePath.replace(/\.sql$/i, "")}_${normalizeSku(item.code)}.sql`
        : undefined,
      approvedBy: input.approvedBy ?? "ambiguity-batch-api",
    });
    if (result.resultStatus === "APPLIED") {
      appliedCodes.push(item.code);
    } else {
      failedCodes.push({ code: item.code, message: result.message });
    }
  }

  const skippedCodes = preview.items
    .filter((i) => !appliedCodes.includes(i.code))
    .map((i) => i.code);

  const resultStatus =
    appliedCodes.length === 0
      ? "FAILED"
      : failedCodes.length > 0
        ? "PARTIAL"
        : "APPLIED";

  return {
    resultStatus,
    planHash: expectedHash,
    appliedCodes,
    skippedCodes,
    failedCodes,
    message: `${appliedCodes.length} código(s) aplicado(s), ${failedCodes.length} falha(s), ${skippedCodes.length} ignorado(s).`,
  };
}
