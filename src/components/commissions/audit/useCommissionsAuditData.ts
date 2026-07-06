import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import type {
  CommissionsAuditItem,
  CommissionsAuditPayload,
  CommissionsAuditRerunResult,
} from "@/src/components/commissions/commissionsTypes";
import {
  buildCommissionsAuditQueryString,
  type CommissionsAuditFilters,
} from "@/src/components/commissions/audit/commissionsAuditFilters";

export function useCommissionsAuditData(filters: CommissionsAuditFilters) {
  const queryString = useMemo(() => buildCommissionsAuditQueryString(filters), [filters]);
  const url = `/api/commissions/audit?${queryString}`;

  const [data, setData] = useState<CommissionsAuditPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommissionsAuditPayload>(url);
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar auditoria de comissões."
      );
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}

export async function resolveAuditIssueApi(id: string): Promise<CommissionsAuditItem> {
  return fetchJsonOk<CommissionsAuditItem>(
    `/api/commissions/audit/${encodeURIComponent(id)}/resolve`,
    { method: "PATCH" }
  );
}

export async function reopenAuditIssueApi(id: string): Promise<CommissionsAuditItem> {
  return fetchJsonOk<CommissionsAuditItem>(
    `/api/commissions/audit/${encodeURIComponent(id)}/reopen`,
    { method: "PATCH" }
  );
}

export async function rerunAuditApi(input: {
  from: string;
  to: string;
}): Promise<CommissionsAuditRerunResult> {
  return fetchJsonOk<CommissionsAuditRerunResult>("/api/commissions/audit/rerun", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: new Date(`${input.from}T00:00:00`).toISOString(),
      to: new Date(`${input.to}T23:59:59`).toISOString(),
    }),
  });
}
