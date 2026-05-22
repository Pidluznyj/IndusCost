/**
 * Cliente REST frontend-safe do fluxo Igualar Bases Nomus.
 * NÃO importa Prisma ou libs server-side.
 */

import { fetchJsonOk } from "@/src/lib/http";
import type {
  EqualizeApplyResult,
  EqualizePreviewResult,
} from "@/src/lib/nomusMasterDataEqualizeTypes";
import { EQUALIZE_CONFIRMATION_TEXT } from "@/src/lib/nomusMasterDataEqualizeTypes";

export type FetchEqualizePreviewInput = {
  limit?: number;
  offset?: number;
  search?: string;
  scope?: "ALL" | "ACTIONABLE";
  includeUnmatchedIndusCost?: boolean;
};

export async function fetchMasterDataEqualizePreview(
  input: FetchEqualizePreviewInput = {},
  init?: { signal?: AbortSignal }
): Promise<EqualizePreviewResult> {
  const params = new URLSearchParams();
  if (input.limit != null) params.set("limit", String(input.limit));
  if (input.offset != null) params.set("offset", String(input.offset));
  if (input.search) params.set("search", input.search);
  if (input.scope) params.set("scope", input.scope);
  if (input.includeUnmatchedIndusCost === false) {
    params.set("includeUnmatchedIndusCost", "false");
  }
  const qs = params.toString();
  return fetchJsonOk<EqualizePreviewResult>(
    `/api/nomus/master-data-equalize/preview${qs ? `?${qs}` : ""}`,
    { signal: init?.signal }
  );
}

export type ApplyEqualizeClientInput = {
  confirmationText: string;
  codes?: string[];
};

export async function applyMasterDataEqualize(
  input: ApplyEqualizeClientInput
): Promise<EqualizeApplyResult> {
  return fetchJsonOk<EqualizeApplyResult>(
    "/api/nomus/master-data-equalize/apply",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "SAFE_ONLY",
        codes: input.codes,
        confirmationText: input.confirmationText,
      }),
    }
  );
}

export { EQUALIZE_CONFIRMATION_TEXT };
