import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import type {
  CommissionsPaymentBatchDetail,
  CommissionsPaymentsPayload,
  UnpaidReleasedCommissionsPayload,
} from "@/src/components/commissions/commissionsTypes";
import {
  buildCommissionsPaymentsQueryString,
  type CommissionsPaymentsFilters,
} from "@/src/components/commissions/payments/commissionsPaymentsFilters";

export function useCommissionsPaymentsData(filters: CommissionsPaymentsFilters) {
  const queryString = useMemo(
    () => buildCommissionsPaymentsQueryString(filters),
    [filters]
  );
  const url = `/api/commissions/payment-batches?${queryString}`;

  const [data, setData] = useState<CommissionsPaymentsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommissionsPaymentsPayload>(url);
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar lotes de pagamento."
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

export function useCommissionPaymentBatchDetail(batchId: string | null) {
  const [data, setData] = useState<CommissionsPaymentBatchDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!batchId) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CommissionsPaymentBatchDetail>(
        `/api/commissions/payment-batches/${encodeURIComponent(batchId)}`
      );
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error && e.message.trim()
          ? e.message
          : "Não foi possível carregar o lote de pagamento."
      );
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}

export async function fetchUnpaidReleasedCommissions(queryString: string) {
  return fetchJsonOk<UnpaidReleasedCommissionsPayload>(
    `/api/commissions/payment-batches/unpaid-released?${queryString}`
  );
}

export async function createPaymentBatchApi(body: Record<string, unknown>) {
  return fetchJsonOk<CommissionsPaymentBatchDetail>("/api/commissions/payment-batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function approvePaymentBatchApi(batchId: string) {
  return fetchJsonOk<CommissionsPaymentBatchDetail>(
    `/api/commissions/payment-batches/${batchId}/approve`,
    { method: "POST" }
  );
}

export async function markPaymentBatchPaidApi(batchId: string, paymentDate: string) {
  return fetchJsonOk<CommissionsPaymentBatchDetail>(
    `/api/commissions/payment-batches/${batchId}/mark-paid`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentDate }),
    }
  );
}

export async function cancelPaymentBatchApi(batchId: string) {
  return fetchJsonOk<CommissionsPaymentBatchDetail>(
    `/api/commissions/payment-batches/${batchId}/cancel`,
    { method: "POST" }
  );
}
