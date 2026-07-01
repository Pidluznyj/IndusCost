import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import type {
  CommissionsConfirmedDetailPayload,
  CommissionsConfirmedPayload,
} from "@/src/components/commissions/commissionsTypes";
import {
  buildCommissionsConfirmedQueryString,
  type CommissionsConfirmedFilters,
} from "@/src/components/commissions/confirmed/commissionsConfirmedFilters";

export function useCommissionsConfirmedData(filters: CommissionsConfirmedFilters) {
  const queryString = useMemo(
    () => buildCommissionsConfirmedQueryString(filters),
    [filters]
  );
  const url = `/api/commissions/confirmed?${queryString}`;

  const [data, setData] = useState<CommissionsConfirmedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommissionsConfirmedPayload>(url);
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar comissões confirmadas."
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

export function useCommissionsConfirmedDetail(
  confirmKey: string | null,
  filters: CommissionsConfirmedFilters
) {
  const baseQuery = useMemo(
    () => buildCommissionsConfirmedQueryString({ ...filters, page: 1, pageSize: 100 }),
    [filters]
  );

  const [data, setData] = useState<CommissionsConfirmedDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!confirmKey) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommissionsConfirmedDetailPayload>(
        `/api/commissions/confirmed/detail?confirmKey=${encodeURIComponent(confirmKey)}&${baseQuery}`
      );
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar o detalhe da comissão confirmada."
      );
    } finally {
      setLoading(false);
    }
  }, [confirmKey, baseQuery]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}
