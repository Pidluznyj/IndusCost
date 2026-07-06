import { useCallback, useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCommissionsApiError } from "@/src/components/commissions/commissionsUi";
import type { CommissionsArViewPayload } from "@/src/components/commissions/commissionsTypes";
import {
  buildCommissionsReleasesQueryString,
  type CommissionsReleasesFilters,
} from "@/src/components/commissions/releases/commissionsReleasesFilters";

export type CommissionsArViewMode = "payable" | "future" | "overdue";

const API_BY_MODE: Record<CommissionsArViewMode, string> = {
  payable: "/api/commissions/payable",
  future: "/api/commissions/future",
  overdue: "/api/commissions/overdue",
};

export function useCommissionsArViewData(
  mode: CommissionsArViewMode,
  filters: CommissionsReleasesFilters
) {
  const [data, setData] = useState<CommissionsArViewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildCommissionsReleasesQueryString(filters);
      const payload = await fetchJsonOk<CommissionsArViewPayload>(
        `${API_BY_MODE[mode]}?${qs}`
      );
      setData(payload);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, "Não foi possível carregar os dados."));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [mode, filters]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}
