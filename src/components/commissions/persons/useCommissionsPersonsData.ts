import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import type {
  CommissionsPersonItem,
  CommissionsPersonsPayload,
} from "@/src/components/commissions/commissionsTypes";
import {
  buildCommissionsPersonsQueryString,
  type CommissionsPersonsFilters,
} from "@/src/components/commissions/persons/commissionsPersonsFilters";

export function useCommissionsPersonsData(filters: CommissionsPersonsFilters) {
  const queryString = useMemo(
    () => buildCommissionsPersonsQueryString(filters),
    [filters]
  );
  const url = `/api/commissions/persons?${queryString}`;

  const [data, setData] = useState<CommissionsPersonsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommissionsPersonsPayload>(url);
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar pessoas comissionadas."
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

export async function saveCommissionPerson(
  mode: "create" | "edit",
  personId: string | null,
  body: Record<string, unknown>
): Promise<CommissionsPersonItem> {
  if (mode === "create") {
    return fetchJsonOk<CommissionsPersonItem>("/api/commissions/persons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  return fetchJsonOk<CommissionsPersonItem>(`/api/commissions/persons/${personId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function toggleCommissionPersonActiveApi(
  personId: string
): Promise<CommissionsPersonItem> {
  return fetchJsonOk<CommissionsPersonItem>(
    `/api/commissions/persons/${personId}/toggle-active`,
    { method: "PATCH" }
  );
}

export async function importCommissionPersonsFromOrdersApi() {
  return fetchJsonOk<{
    ordersScanned: number;
    created: number;
    updated: number;
    skippedNoName: number;
    skippedNoNomusId: number;
    unchanged: number;
  }>("/api/commissions/persons/import-from-orders", { method: "POST" });
}
