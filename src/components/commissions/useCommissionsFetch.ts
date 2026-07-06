import { useCallback, useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatCommissionsApiError } from "@/src/components/commissions/commissionsUi";

export function useCommissionsFetch<T>(url: string, errorMessage: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<T>(url);
      setData(payload);
    } catch (e: unknown) {
      setError(formatCommissionsApiError(e, errorMessage));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [url, errorMessage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}
