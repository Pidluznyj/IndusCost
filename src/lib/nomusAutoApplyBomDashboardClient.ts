import { fetchJsonOk } from "@/src/lib/http";
import type { AutoApplyBomDashboardResult, AutoApplyDashboardFilter } from "@/src/lib/nomusAutoApplyBomDashboardTypes";

export async function fetchNomusAutoApplyBomDashboard(
  input: {
    filter?: AutoApplyDashboardFilter;
    search?: string;
    /** Revalida bloqueados com preview read-only (padrão: true). */
    revalidate?: boolean;
  } = {},
  init?: { signal?: AbortSignal }
): Promise<AutoApplyBomDashboardResult> {
  const params = new URLSearchParams();
  if (input.filter && input.filter !== "ALL") params.set("filter", input.filter);
  if (input.search?.trim()) params.set("search", input.search.trim());
  if (input.revalidate === false) params.set("revalidate", "0");
  const qs = params.toString();
  return fetchJsonOk<AutoApplyBomDashboardResult>(
    `/api/nomus/auto-apply-bom-dashboard${qs ? `?${qs}` : ""}`,
    { signal: init?.signal }
  );
}
