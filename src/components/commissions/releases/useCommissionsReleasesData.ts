import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import type {
  CommissionsReleaseDetailPayload,
  CommissionsReleasesPayload,
} from "@/src/components/commissions/commissionsTypes";
import {
  buildCommissionsReleasesQueryString,
  type CommissionsReleasesFilters,
} from "@/src/components/commissions/releases/commissionsReleasesFilters";

export function useCommissionsReleasesData(filters: CommissionsReleasesFilters) {
  const queryString = useMemo(
    () => buildCommissionsReleasesQueryString(filters),
    [filters]
  );
  const url = `/api/commissions/releases?${queryString}`;

  const [data, setData] = useState<CommissionsReleasesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommissionsReleasesPayload>(url);
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar liberações por recebimento."
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

export function useCommissionsReleaseDetail(
  scheduleId: string | null,
  filters: CommissionsReleasesFilters
) {
  const baseQuery = useMemo(
    () => buildCommissionsReleasesQueryString({ ...filters, page: 1, pageSize: 100 }),
    [filters]
  );

  const [data, setData] = useState<CommissionsReleaseDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!scheduleId) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommissionsReleaseDetailPayload>(
        `/api/commissions/releases/detail?scheduleId=${encodeURIComponent(scheduleId)}&${baseQuery}`
      );
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar o detalhe da liberação."
      );
    } finally {
      setLoading(false);
    }
  }, [scheduleId, baseQuery]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}
