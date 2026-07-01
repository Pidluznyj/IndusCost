import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import type {
  CommissionsForecastDetailPayload,
  CommissionsForecastPayload,
} from "@/src/components/commissions/commissionsTypes";
import {
  buildCommissionsForecastQueryString,
  type CommissionsForecastFilters,
} from "@/src/components/commissions/forecast/commissionsForecastFilters";

export function useCommissionsForecastData(filters: CommissionsForecastFilters) {
  const queryString = useMemo(
    () => buildCommissionsForecastQueryString(filters),
    [filters]
  );
  const url = `/api/commissions/forecast?${queryString}`;

  const [data, setData] = useState<CommissionsForecastPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommissionsForecastPayload>(url);
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar comissões previstas."
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

export function useCommissionsForecastDetail(
  orderKey: string | null,
  filters: CommissionsForecastFilters
) {
  const baseQuery = useMemo(
    () => buildCommissionsForecastQueryString({ ...filters, page: 1, pageSize: 100 }),
    [filters]
  );

  const [data, setData] = useState<CommissionsForecastDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!orderKey) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommissionsForecastDetailPayload>(
        `/api/commissions/forecast/detail?orderKey=${encodeURIComponent(orderKey)}&${baseQuery}`
      );
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar o detalhe da previsão."
      );
    } finally {
      setLoading(false);
    }
  }, [orderKey, baseQuery]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}
