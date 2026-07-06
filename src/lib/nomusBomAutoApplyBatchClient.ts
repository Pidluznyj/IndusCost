import { fetchJsonOk } from "@/src/lib/http";
import type { BomAutoApplyBatchResult, BomAutoApplyItemResult } from "@/src/lib/nomusBomAutoApplyBatch";
import type { ApplyActionsSummary } from "@/src/lib/nomusBomApplyStatus";

export type BomApplyReadinessPreview = {
  parentCode: string;
  readyToApply: boolean;
  planHash: string | null;
  confirmationRequiredText: string | null;
  actionsSummary: ApplyActionsSummary;
  recommendation: string;
  blockingReasons: string[];
};

export async function fetchNomusBomApplyReadiness(
  parentCode: string
): Promise<BomApplyReadinessPreview> {
  const params = new URLSearchParams({ parentCode: parentCode.trim() });
  return fetchJsonOk<BomApplyReadinessPreview>(
    `/api/nomus/bom-auto-apply/products/apply-readiness?${params.toString()}`
  );
}

export async function applyNomusBomProduct(parentCode: string): Promise<BomAutoApplyItemResult> {
  return fetchJsonOk<BomAutoApplyItemResult>(
    `/api/nomus/bom-auto-apply/products/${encodeURIComponent(parentCode.trim())}/apply`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
  );
}

export async function applyNomusBomProductBatch(
  parentCodes: string[]
): Promise<BomAutoApplyBatchResult> {
  return fetchJsonOk<BomAutoApplyBatchResult>(
    "/api/nomus/bom-auto-apply/products/apply-batch",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentCodes }),
    }
  );
}
