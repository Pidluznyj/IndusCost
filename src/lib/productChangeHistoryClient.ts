/**
 * Cliente REST frontend-safe do histórico de alterações de produto.
 * NÃO importa Prisma ou libs server-side.
 */

import { fetchJsonOk } from "@/src/lib/http";
import type { ProductChangeHistoryResult } from "@/src/lib/productChangeHistoryTypes";

export async function fetchProductChangeHistory(
  productId: string,
  options: { limit?: number; offset?: number; signal?: AbortSignal } = {}
): Promise<ProductChangeHistoryResult> {
  const params = new URLSearchParams();
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.offset != null) params.set("offset", String(options.offset));
  const qs = params.toString();
  return fetchJsonOk<ProductChangeHistoryResult>(
    `/api/products/${encodeURIComponent(productId)}/change-history${qs ? `?${qs}` : ""}`,
    { signal: options.signal }
  );
}
