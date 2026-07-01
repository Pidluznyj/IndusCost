import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import type {
  CommissionsRuleItem,
  CommissionsRuleUsagePayload,
  CommissionsRulesPayload,
} from "@/src/components/commissions/commissionsTypes";
import {
  buildCommissionsRulesQueryString,
  type CommissionsRulesFilters,
} from "@/src/components/commissions/rules/commissionsRulesFilters";

export function useCommissionsRulesData(filters: CommissionsRulesFilters) {
  const queryString = useMemo(
    () => buildCommissionsRulesQueryString(filters),
    [filters]
  );
  const url = `/api/commissions/rules?${queryString}`;

  const [data, setData] = useState<CommissionsRulesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommissionsRulesPayload>(url);
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar regras de comissão."
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

export function useCommissionRuleUsage(ruleId: string | null) {
  const [data, setData] = useState<CommissionsRuleUsagePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!ruleId) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommissionsRuleUsagePayload>(
        `/api/commissions/rules/${encodeURIComponent(ruleId)}/usage`
      );
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar o uso da regra."
      );
    } finally {
      setLoading(false);
    }
  }, [ruleId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}

export async function saveCommissionRule(
  mode: "create" | "edit",
  ruleId: string | null,
  body: Record<string, unknown>
): Promise<CommissionsRuleItem> {
  if (mode === "create") {
    return fetchJsonOk<CommissionsRuleItem>("/api/commissions/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  return fetchJsonOk<CommissionsRuleItem>(`/api/commissions/rules/${ruleId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function toggleCommissionRuleActiveApi(
  ruleId: string
): Promise<CommissionsRuleItem> {
  return fetchJsonOk<CommissionsRuleItem>(
    `/api/commissions/rules/${ruleId}/toggle-active`,
    { method: "PATCH" }
  );
}

export async function duplicateCommissionRuleApi(
  ruleId: string
): Promise<CommissionsRuleItem> {
  return fetchJsonOk<CommissionsRuleItem>(
    `/api/commissions/rules/${ruleId}/duplicate`,
    { method: "POST" }
  );
}
