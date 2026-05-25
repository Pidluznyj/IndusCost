/**
 * Cliente REST frontend-safe do fluxo Igualar Bases Nomus.
 * NÃO importa Prisma ou libs server-side.
 */

import { parseApiErrorMessage } from "@/src/lib/http";
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
  const res = await fetch(
    `/api/nomus/master-data-equalize/preview${qs ? `?${qs}` : ""}`,
    { signal: init?.signal }
  );
  if (!res.ok) {
    throw new Error(await parseApiErrorMessage(res));
  }
  return (await res.json()) as EqualizePreviewResult;
}

export type ApplyEqualizeClientInput = {
  confirmationText: string;
  codes?: string[];
};

function isEqualizeApplyResult(data: unknown): data is EqualizeApplyResult {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  return o.mode === "APPLY_SAFE" && typeof o.status === "string";
}

/**
 * Apply com parsing do corpo JSON mesmo em HTTP 500 quando o backend
 * retorna EqualizeApplyResult estruturado (status FAILED).
 */
export async function applyMasterDataEqualize(
  input: ApplyEqualizeClientInput
): Promise<EqualizeApplyResult> {
  const res = await fetch("/api/nomus/master-data-equalize/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope: "SAFE_ONLY",
      codes: input.codes,
      confirmationText: input.confirmationText,
    }),
  });

  const ct = res.headers.get("content-type");
  if (ct?.includes("application/json")) {
    const data: unknown = await res.json();
    if (isEqualizeApplyResult(data)) {
      if (!res.ok && data.status !== "FAILED" && data.status !== "PARTIAL") {
        throw new Error(
          typeof data.message === "string" && data.message.trim()
            ? data.message
            : await parseApiErrorMessage(res)
        );
      }
      return data;
    }
    if (!res.ok) {
      const errObj = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
      const msg =
        typeof errObj.message === "string" && errObj.message.trim()
          ? errObj.message
          : await parseApiErrorMessage(res);
      throw new Error(msg);
    }
    return data as EqualizeApplyResult;
  }

  if (!res.ok) {
    throw new Error(await parseApiErrorMessage(res));
  }

  return (await res.json()) as EqualizeApplyResult;
}

export { EQUALIZE_CONFIRMATION_TEXT };
