/**
 * Cliente REST frontend-safe da lista de runs recentes da engenharia Nomus.
 * NÃO importa Prisma nem libs server-side.
 */

import { fetchJsonOk } from "@/src/lib/http";

export type EngineeringRunRecentOrigin =
  | "MASTER_DATA_EQUALIZE"
  | "BOM_APPLY_AFTER_MASTER_DATA"
  | "MASTER_DATA_HISTORY_BACKFILL"
  | null;

export type EngineeringRunRecentItem = {
  id: string;
  mode: string;
  status: string;
  origin: EngineeringRunRecentOrigin;
  label: string;
  parentCode: string | null;
  planHash: string | null;
  approvedBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  summary: Record<string, unknown> | null;
};

export type EngineeringRunsRecentResult = {
  mode: "READ_ONLY";
  generatedAt: string;
  items: EngineeringRunRecentItem[];
};

export async function fetchEngineeringRunsRecent(
  limit = 10,
  init?: { signal?: AbortSignal }
): Promise<EngineeringRunsRecentResult> {
  const params = new URLSearchParams({ limit: String(limit) });
  return fetchJsonOk<EngineeringRunsRecentResult>(
    `/api/nomus/engineering-runs/recent?${params.toString()}`,
    { signal: init?.signal }
  );
}
