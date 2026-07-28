/**
 * Cliente browser-safe — GET histórico de conferência (somente leitura).
 */
import {
  MATERIAL_STOCK_CONFERENCE_REASON_LABELS,
  type MaterialStockConferenceReason,
} from "./materialStockConferenceClient.js";
import type {
  MaterialStockHistoryListItem,
  MaterialStockHistoryResponse,
} from "./materialStockTabletTypes.js";
import { MATERIAL_STOCK_TABLET_DEFAULT_PAGE_SIZE } from "./materialStockTabletTypes.js";

export function materialStockHistoryApiPath(
  materialId: string,
  query?: { page?: number; pageSize?: number }
): string {
  const base = `/api/materials/stock-tablet/${encodeURIComponent(materialId)}/history`;
  const qs = new URLSearchParams();
  qs.set("page", String(query?.page ?? 1));
  qs.set(
    "pageSize",
    String(query?.pageSize ?? MATERIAL_STOCK_TABLET_DEFAULT_PAGE_SIZE)
  );
  return `${base}?${qs.toString()}`;
}

export async function fetchMaterialStockHistory(input: {
  materialId: string;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}): Promise<MaterialStockHistoryResponse> {
  const res = await fetch(
    materialStockHistoryApiPath(input.materialId, {
      page: input.page,
      pageSize: input.pageSize,
    }),
    { credentials: "include", signal: input.signal }
  );
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      (typeof payload.message === "string" && payload.message) ||
        "Não foi possível carregar o histórico."
    );
  }
  return payload as unknown as MaterialStockHistoryResponse;
}

export function formatHistoryReasonLabel(reason: string): string {
  if (reason in MATERIAL_STOCK_CONFERENCE_REASON_LABELS) {
    return MATERIAL_STOCK_CONFERENCE_REASON_LABELS[
      reason as MaterialStockConferenceReason
    ];
  }
  return reason;
}

export function appendHistoryPages(
  previous: MaterialStockHistoryListItem[],
  next: MaterialStockHistoryListItem[]
): MaterialStockHistoryListItem[] {
  const seen = new Set(previous.map((r) => r.id));
  const merged = [...previous];
  for (const row of next) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push(row);
    }
  }
  return merged;
}
