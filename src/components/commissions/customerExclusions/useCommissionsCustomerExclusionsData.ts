import { useCallback, useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import type {
  CustomerExclusionClosingReconciliationPayload,
  CustomerExclusionRulesPayload,
} from "@/src/components/commissions/commissionsTypes";
import type { CustomerExclusionRuleItem } from "@/src/components/commissions/commissionsTypes";
import type { CustomerExclusionFormInput } from "@/src/components/commissions/customerExclusions/commissionsCustomerExclusionLabels";
import {
  buildCustomerExclusionCreateBody,
  buildCustomerExclusionUpdateBody,
} from "@/src/components/commissions/customerExclusions/commissionsCustomerExclusionLabels";

export function useCommissionsCustomerExclusionsData(
  search: string | null,
  year: string,
  month: string
) {
  const query = new URLSearchParams({ page: "1", pageSize: "100" });
  if (search?.trim()) query.set("search", search.trim());
  const listUrl = `/api/commissions/customer-exclusions?${query.toString()}`;
  const reconciliationUrl =
    year.trim() && month.trim()
      ? `/api/commissions/customer-exclusions/closing-reconciliation?year=${encodeURIComponent(year.trim())}&month=${encodeURIComponent(month.trim())}`
      : null;

  const [data, setData] = useState<CustomerExclusionRulesPayload | null>(null);
  const [reconciliation, setReconciliation] =
    useState<CustomerExclusionClosingReconciliationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listPromise = fetchJsonOk<CustomerExclusionRulesPayload>(listUrl);
      const reconciliationPromise = reconciliationUrl
        ? fetchJsonOk<CustomerExclusionClosingReconciliationPayload>(reconciliationUrl)
        : Promise.resolve(null);
      const [listPayload, reconciliationPayload] = await Promise.all([
        listPromise,
        reconciliationPromise,
      ]);
      setData(listPayload);
      setReconciliation(reconciliationPayload);
    } catch (e: unknown) {
      setData(null);
      setReconciliation(null);
      setError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar exclusões de cliente."
      );
    } finally {
      setLoading(false);
    }
  }, [listUrl, reconciliationUrl]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, reconciliation, loading, error, reload };
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

export function mapRuleImpactById(
  reconciliation: CustomerExclusionClosingReconciliationPayload | null
): Map<string, { receivableCount: number; receivedAmount: number; usedInClosing: boolean }> {
  const map = new Map<
    string,
    { receivableCount: number; receivedAmount: number; usedInClosing: boolean }
  >();
  if (!reconciliation) return map;
  for (const item of reconciliation.registeredRulesImpact) {
    map.set(item.ruleId, {
      receivableCount: item.receivableCount,
      receivedAmount: item.receivedAmount,
      usedInClosing: item.usedInClosing,
    });
  }
  return map;
}
