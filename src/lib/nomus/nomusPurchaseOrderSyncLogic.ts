import { pickPurchaseOrderArray } from "./nomusPurchaseOrderParser.js";

export const NOMUS_PURCHASE_ORDER_RESOURCE = "pedidoscompra" as const;
export const NOMUS_PURCHASE_ORDER_PAGE_SIZE = 50;
export const NOMUS_PURCHASE_ORDER_BACKFILL_MONTHS = 12;
export const NOMUS_PURCHASE_ORDER_INCREMENTAL_DAYS = 45;

export type PurchaseOrderSyncCliOptions = {
  mode: "preview" | "apply";
  startPage: number;
  maxPages: number;
  singlePage: number | null;
  incremental: boolean;
  backfill: boolean;
  syncStrategy: string;
};

export function formatNomusBrDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

export function resolvePurchaseOrderWindow(input: {
  now?: Date;
  incremental: boolean;
  backfill: boolean;
  startDate?: string | null;
  endDate?: string | null;
}): { startDate: string; endDate: string; days: number } {
  const now = input.now ?? new Date();
  const endDate = input.endDate?.trim() || formatNomusBrDate(now);
  if (input.startDate?.trim()) {
    return { startDate: input.startDate.trim(), endDate, days: 0 };
  }
  const start = new Date(now);
  if (input.incremental) {
    start.setDate(start.getDate() - NOMUS_PURCHASE_ORDER_INCREMENTAL_DAYS);
  } else {
    start.setMonth(start.getMonth() - NOMUS_PURCHASE_ORDER_BACKFILL_MONTHS);
  }
  return {
    startDate: formatNomusBrDate(start),
    endDate,
    days: input.incremental ? NOMUS_PURCHASE_ORDER_INCREMENTAL_DAYS : 0,
  };
}

export function parsePurchaseOrderSyncCli(argv: string[]): PurchaseOrderSyncCliOptions {
  const mode = argv.includes("apply") || argv.includes("--apply") ? "apply" : "preview";
  const incremental =
    argv.includes("--incremental") ||
    argv.includes("incremental") ||
    process.env.NOMUS_PO_INCREMENTAL === "1";
  const backfill = argv.includes("--backfill") || argv.includes("backfill");

  let startPage = 1;
  let maxPages = incremental ? 80 : 200;
  let singlePage: number | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--page" && argv[i + 1]) {
      singlePage = Math.max(1, Number.parseInt(argv[i + 1], 10) || 1);
      i += 1;
    } else if (arg === "--maxPages" && argv[i + 1]) {
      maxPages = Math.max(1, Number.parseInt(argv[i + 1], 10) || 1);
      i += 1;
    } else if (arg === "--startPage" && argv[i + 1]) {
      startPage = Math.max(1, Number.parseInt(argv[i + 1], 10) || 1);
      i += 1;
    }
  }

  if (singlePage != null) {
    startPage = singlePage;
    maxPages = 1;
  }

  const syncStrategy = incremental
    ? "sliding_window_upsert"
    : backfill
      ? "backfill_12m_upsert"
      : "full_initial_or_manual";

  return { mode, startPage, maxPages, singlePage, incremental, backfill, syncStrategy };
}

export function resolvePurchaseOrderPageSize(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.NOMUS_PO_PAGE_SIZE ?? env.NOMUS_PAGE_SIZE ?? "").trim();
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 200) return parsed;
  return NOMUS_PURCHASE_ORDER_PAGE_SIZE;
}

export function buildPurchaseOrderPageParams(
  page: number,
  pageSize: number,
  window?: { startDate?: string; endDate?: string }
): Record<string, string> {
  const params: Record<string, string> = {
    pagina: String(Math.max(1, page)),
    tamanhoPagina: String(Math.max(1, pageSize)),
  };
  if (window?.startDate) params.dataInicio = window.startDate;
  if (window?.endDate) params.dataFim = window.endDate;
  return params;
}

export function shouldStopPurchaseOrderPagination(
  pageItemsLength: number,
  pageSize: number = NOMUS_PURCHASE_ORDER_PAGE_SIZE
): boolean {
  return pageItemsLength === 0 || pageItemsLength < pageSize;
}

export function hasNextPurchaseOrderPage(
  payload: unknown,
  page: number,
  currentLen: number,
  pageSize: number = NOMUS_PURCHASE_ORDER_PAGE_SIZE
): boolean {
  if (shouldStopPurchaseOrderPagination(currentLen, pageSize)) return false;
  if (!payload || typeof payload !== "object") return currentLen > 0;
  const data = payload as Record<string, unknown>;
  const totalPages =
    Number(data.totalPaginas ?? data.totalPages ?? data.paginas ?? data.total_paginas) || null;
  if (totalPages != null && Number.isFinite(totalPages)) {
    return page < totalPages;
  }
  if (typeof data.hasMore === "boolean") return data.hasMore;
  return currentLen >= pageSize;
}

export function computePurchaseOrderPaginationPlan(options: PurchaseOrderSyncCliOptions): {
  firstPage: number;
  lastPage: number;
} {
  return {
    firstPage: options.startPage,
    lastPage: options.startPage + options.maxPages - 1,
  };
}

export function pickPurchaseOrderPageItems(payload: unknown): Record<string, unknown>[] {
  return pickPurchaseOrderArray(payload).filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === "object" && !Array.isArray(item)
  );
}

export type PurchaseOrderApplyDecision = "create" | "update" | "unchanged";

export function decidePurchaseOrderApply(
  existingHash: string | null | undefined,
  incomingHash: string
): PurchaseOrderApplyDecision {
  if (!existingHash) return "create";
  return existingHash === incomingHash ? "unchanged" : "update";
}
