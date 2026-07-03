import { useCallback, useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import type { CustomerExclusionRulesPayload } from "@/src/components/commissions/commissionsTypes";
import type { CustomerExclusionRuleItem } from "@/src/components/commissions/commissionsTypes";
import type { CustomerExclusionFormInput } from "@/src/components/commissions/customerExclusions/commissionsCustomerExclusionLabels";
import {
  buildCustomerExclusionCreateBody,
  buildCustomerExclusionUpdateBody,
} from "@/src/components/commissions/customerExclusions/commissionsCustomerExclusionLabels";

export function useCommissionsCustomerExclusionsData(search: string | null) {
  const query = new URLSearchParams({ page: "1", pageSize: "100" });
  if (search?.trim()) query.set("search", search.trim());
  const url = `/api/commissions/customer-exclusions?${query.toString()}`;

  const [data, setData] = useState<CustomerExclusionRulesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CustomerExclusionRulesPayload>(url);
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar exclusões de cliente."
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

export async function createCustomerExclusionApi(
  form: CustomerExclusionFormInput
): Promise<CustomerExclusionRuleItem> {
  return fetchJsonOk<CustomerExclusionRuleItem>("/api/commissions/customer-exclusions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCustomerExclusionCreateBody(form)),
  });
}

export async function updateCustomerExclusionApi(
  id: string,
  form: CustomerExclusionFormInput
): Promise<CustomerExclusionRuleItem> {
  return fetchJsonOk<CustomerExclusionRuleItem>(`/api/commissions/customer-exclusions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCustomerExclusionUpdateBody(form)),
  });
}

export async function inactivateCustomerExclusionApi(id: string): Promise<CustomerExclusionRuleItem> {
  return fetchJsonOk<CustomerExclusionRuleItem>(
    `/api/commissions/customer-exclusions/${id}/inactivate`,
    { method: "POST" }
  );
}
