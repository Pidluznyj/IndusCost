/**
 * Cliente REST frontend-safe do Plano de Ação de Equalização.
 *
 * NÃO importa Prisma, @prisma/client ou libs server-side.
 * Apenas usa fetch + tipos puros.
 */

import { fetchJsonOk } from "@/src/lib/http";
import type { EngineeringEqualizationActionPlanResult } from "@/src/lib/nomusEngineeringEqualizationActionPlanTypes";

export type FetchActionPlanInput = {
  parentCode: string;
  includeCostImpact?: boolean;
  includeApplyPreview?: boolean;
  includeImportPreview?: boolean;
};

export async function fetchEngineeringEqualizationActionPlan(
  input: FetchActionPlanInput,
  init?: { signal?: AbortSignal }
): Promise<EngineeringEqualizationActionPlanResult> {
  const params = new URLSearchParams();
  params.set("parentCode", input.parentCode);
  if (input.includeCostImpact !== undefined) {
    params.set("includeCostImpact", String(input.includeCostImpact));
  }
  if (input.includeApplyPreview !== undefined) {
    params.set("includeApplyPreview", String(input.includeApplyPreview));
  }
  if (input.includeImportPreview !== undefined) {
    params.set("includeImportPreview", String(input.includeImportPreview));
  }
  return fetchJsonOk<EngineeringEqualizationActionPlanResult>(
    `/api/nomus/engineering-equalization-action-plan?${params.toString()}`,
    { signal: init?.signal }
  );
}
