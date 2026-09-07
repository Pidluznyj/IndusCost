/**
 * Pedido Nomus ↔ Contas a Pagar — cliente HTTP (browser-safe).
 * A UI só consome a reconciliação calculada no servidor.
 */
import { fetchJsonOk } from "@/src/lib/http";
import { invalidateUiSessionGetCache } from "@/src/lib/uiSessionGetCache";
import type {
  PurchaseOrderPayableLinkMethod,
  PurchaseOrderPayableReconciliation,
} from "./nomusPurchaseOrderPayableLink";

export type { PurchaseOrderPayableReconciliation } from "./nomusPurchaseOrderPayableLink";

function basePath(orderId: string): string {
  return `/api/nomus/purchase-orders/${encodeURIComponent(orderId)}/payables`;
}

export function fetchPurchaseOrderPayableReconciliation(
  orderId: string,
  signal?: AbortSignal
): Promise<PurchaseOrderPayableReconciliation> {
  return fetchJsonOk<PurchaseOrderPayableReconciliation>(basePath(orderId), signal ? { signal } : undefined);
}

export type ConfirmPurchaseOrderPayableLinkInput = {
  payableExternalId: number;
  installmentIndex: number | null;
  method: Extract<PurchaseOrderPayableLinkMethod, "INSTALLMENT_MATCH" | "MANUAL">;
  reason: string | null;
};

/** Invalida o cache do 360 (status financeiro da listagem/modal muda com o vínculo). */
function invalidateOrderCaches(orderId: string): void {
  invalidateUiSessionGetCache(`/api/nomus/purchase-orders/${orderId}`);
  invalidateUiSessionGetCache("/api/nomus/purchase-orders?");
}

export async function confirmPurchaseOrderPayableLinkRequest(
  orderId: string,
  input: ConfirmPurchaseOrderPayableLinkInput
): Promise<PurchaseOrderPayableReconciliation> {
  const payload = await fetchJsonOk<PurchaseOrderPayableReconciliation>(`${basePath(orderId)}/links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  invalidateOrderCaches(orderId);
  return payload;
}

export async function removePurchaseOrderPayableLinkRequest(
  orderId: string,
  payableExternalId: number,
  reason: string
): Promise<PurchaseOrderPayableReconciliation> {
  const payload = await fetchJsonOk<PurchaseOrderPayableReconciliation>(
    `${basePath(orderId)}/links/${encodeURIComponent(String(payableExternalId))}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }
  );
  invalidateOrderCaches(orderId);
  return payload;
}
