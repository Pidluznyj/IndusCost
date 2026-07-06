import { useCallback, useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import type { CommissionsSettingsPayload } from "@/src/components/commissions/commissionsTypes";

export function useCommissionsSettingsData() {
  const [data, setData] = useState<CommissionsSettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommissionsSettingsPayload>("/api/commissions/settings");
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar configurações de comissões."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload, setData };
}

export async function saveCommissionSettingsApi(
  body: CommissionsSettingsPayload
): Promise<CommissionsSettingsPayload> {
  return fetchJsonOk<CommissionsSettingsPayload>("/api/commissions/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function restoreCommissionSettingsApi(): Promise<CommissionsSettingsPayload> {
  return fetchJsonOk<CommissionsSettingsPayload>("/api/commissions/settings/restore", {
    method: "POST",
  });
}
