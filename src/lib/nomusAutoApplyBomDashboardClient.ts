import { fetchJsonOk } from "@/src/lib/http";
import type { AutoApplyBomDashboardResult, AutoApplyDashboardFilter } from "@/src/lib/nomusAutoApplyBomDashboardTypes";
import type {
  NomusAutoApplyDashboardRevalidationStartResult,
  NomusAutoApplyDashboardRevalidationStatus,
} from "@/src/lib/nomusAutoApplyDashboardRevalidationJobTypes";

export async function fetchNomusAutoApplyBomDashboard(
  input: {
    filter?: AutoApplyDashboardFilter;
    search?: string;
    /**
     * Revalidação síncrona pesada (legado/scripts). Padrão: false — usa snapshot ou relatório batch.
     * Use revalidate: false explicitamente para forçar relatório sem snapshot.
     */
    revalidate?: boolean;
    preferSnapshot?: boolean;
  } = {},
  init?: { signal?: AbortSignal }
): Promise<AutoApplyBomDashboardResult> {
  const params = new URLSearchParams();
  if (input.filter && input.filter !== "ALL") params.set("filter", input.filter);
  if (input.search?.trim()) params.set("search", input.search.trim());
  if (input.revalidate === true) params.set("revalidate", "1");
  if (input.preferSnapshot === false) params.set("preferSnapshot", "0");
  const qs = params.toString();
  return fetchJsonOk<AutoApplyBomDashboardResult>(
    `/api/nomus/auto-apply-bom-dashboard${qs ? `?${qs}` : ""}`,
    { signal: init?.signal }
  );
}

export async function startNomusAutoApplyBomDashboardRevalidation(): Promise<NomusAutoApplyDashboardRevalidationStartResult> {
  return fetchJsonOk<NomusAutoApplyDashboardRevalidationStartResult>(
    "/api/nomus/auto-apply-bom-dashboard/revalidation/start",
    { method: "POST" }
  );
}

export async function fetchNomusAutoApplyBomDashboardRevalidationStatus(
  init?: { signal?: AbortSignal }
): Promise<NomusAutoApplyDashboardRevalidationStatus> {
  return fetchJsonOk<NomusAutoApplyDashboardRevalidationStatus>(
    "/api/nomus/auto-apply-bom-dashboard/revalidation/status",
    { signal: init?.signal }
  );
}
