/**
 * Cliente REST frontend-safe da Carga Mestre Nomus.
 *
 * NÃO importa Prisma, @prisma/client ou libs server-side.
 */

import { fetchJsonOk } from "@/src/lib/http";
import type {
  MasterDataImportApplyResult,
  MasterDataImportDiagnosticResult,
  MasterDataImportPreviewResult,
} from "@/src/lib/nomusMasterDataImportTypes";
import { MASTER_DATA_CONFIRMATION_TEXT } from "@/src/lib/nomusMasterDataImportTypes";

export type FetchMasterDataDiagnosticInput = {
  limit?: number;
  offset?: number;
  search?: string;
  classification?: string;
  includeExisting?: boolean;
};

export async function fetchMasterDataImportDiagnostic(
  input: FetchMasterDataDiagnosticInput = {},
  init?: { signal?: AbortSignal }
): Promise<MasterDataImportDiagnosticResult> {
  const params = new URLSearchParams();
  if (input.limit != null) params.set("limit", String(input.limit));
  if (input.offset != null) params.set("offset", String(input.offset));
  if (input.search) params.set("search", input.search);
  if (input.classification) params.set("classification", input.classification);
  if (input.includeExisting) params.set("includeExisting", "true");
  const qs = params.toString();
  return fetchJsonOk<MasterDataImportDiagnosticResult>(
    `/api/nomus/master-data-import/diagnostic${qs ? `?${qs}` : ""}`,
    { signal: init?.signal }
  );
}

export type FetchMasterDataPreviewInput = {
  classification?: "SAFE_PRODUCT_CANDIDATE" | "SAFE_MATERIAL_CANDIDATE" | "ALL_SAFE";
  codes?: string[];
};

export async function fetchMasterDataImportPreview(
  input: FetchMasterDataPreviewInput = {},
  init?: { signal?: AbortSignal }
): Promise<MasterDataImportPreviewResult> {
  const params = new URLSearchParams();
  if (input.classification) params.set("classification", input.classification);
  if (input.codes && input.codes.length > 0) {
    params.set("codes", input.codes.join(","));
  }
  const qs = params.toString();
  return fetchJsonOk<MasterDataImportPreviewResult>(
    `/api/nomus/master-data-import/preview${qs ? `?${qs}` : ""}`,
    { signal: init?.signal }
  );
}

export type ApplyMasterDataInput = {
  codes?: string[];
  confirmationText: string;
};

export async function applyMasterDataImportSafe(
  input: ApplyMasterDataInput
): Promise<MasterDataImportApplyResult> {
  return fetchJsonOk<MasterDataImportApplyResult>(
    "/api/nomus/master-data-import/apply-safe",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "SAFE_ONLY",
        codes: input.codes,
        confirmationText: input.confirmationText,
      }),
    }
  );
}

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
  items: Array<{
    code: string;
    description: string | null;
    ambiguityStatus: string;
    suggestedDecision: string;
    justification: string;
    risks: string[];
    plannedActions: string[];
    nomusControlledBomAsProductCount: number;
    nomusControlledBomAsMaterialCount: number;
    canApplyThisCode: boolean;
    applyBlockedReason: string | null;
  }>;
};

export type AmbiguityBatchApplyResult = {
  resultStatus: string;
  planHash: string;
  appliedCodes: string[];
  skippedCodes: string[];
  failedCodes: Array<{ code: string; message: string }>;
  message: string;
};

export async function fetchAmbiguityBatchPreview(
  init?: { signal?: AbortSignal }
): Promise<AmbiguityBatchPreviewResult> {
  return fetchJsonOk<AmbiguityBatchPreviewResult>(
    "/api/nomus/master-data-import/ambiguity-batch/preview",
    { signal: init?.signal }
  );
}

export async function applyAmbiguityBatch(input: {
  planHash: string;
  confirmationText: string;
  codes?: string[];
}): Promise<AmbiguityBatchApplyResult> {
  return fetchJsonOk<AmbiguityBatchApplyResult>(
    "/api/nomus/master-data-import/ambiguity-batch/apply",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
}

export { MASTER_DATA_CONFIRMATION_TEXT };
