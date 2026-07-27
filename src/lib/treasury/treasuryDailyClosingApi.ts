/**
 * Cliente HTTP — fechamento diário da Tesouraria (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_DAILY_CLOSING_PATH,
  TREASURY_DAILY_CLOSING_PREVIEW_PATH,
  type TreasuryDailyClosingAccountPositionDto,
  type TreasuryDailyClosingDto,
  type TreasuryDailyClosingPreviewDto,
  type TreasuryClosingStatus,
} from "@/src/lib/treasury/contracts/index.js";

export type TreasuryDailyClosingCaveatDto = {
  id: string;
  closingId: string;
  code: string | null;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  acknowledged: boolean;
  sortOrder: number;
};

export type TreasuryDailyClosingDetailDto = TreasuryDailyClosingDto & {
  accountPositions: TreasuryDailyClosingAccountPositionDto[];
  caveats: TreasuryDailyClosingCaveatDto[];
  reopening: null | {
    id: string;
    fromClosingId: string;
    toClosingId: string;
    reason: string;
  };
};

export type TreasuryDailyClosingPreviewPayload =
  TreasuryDailyClosingPreviewDto & {
    requestId?: string;
  };

export type TreasuryDailyClosingListPayload = {
  ok: true;
  items: TreasuryDailyClosingDto[];
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  requestId?: string;
};

export type TreasuryDailyClosingDetailPayload = {
  ok: true;
  closing: TreasuryDailyClosingDetailDto;
  requestId?: string;
};

export type TreasuryDailyClosingClosePayload = {
  ok: true;
  closing: TreasuryDailyClosingDto;
  projectionRecalc?: { accepted: boolean; deferred: boolean; reason: string };
  requestId?: string;
};

export type TreasuryDailyClosingReopenPayload = {
  ok: true;
  previous: TreasuryDailyClosingDto;
  next: TreasuryDailyClosingDto;
  projectionRecalc?: { accepted: boolean; deferred: boolean; reason: string };
  requestId?: string;
};

function setIf(
  qs: URLSearchParams,
  key: string,
  value: string | number | null | undefined
) {
  if (value == null || value === "") return;
  qs.set(key, String(value));
}

export function buildTreasuryDailyClosingPreviewUrl(params: {
  date?: string | null;
  companyCode?: string | null;
  accountIds?: string[] | null;
}): string {
  const qs = new URLSearchParams();
  setIf(qs, "date", params.date?.trim());
  setIf(qs, "companyCode", params.companyCode?.trim());
  if (params.accountIds?.length) {
    qs.set("accountIds", params.accountIds.join(","));
  }
  const q = qs.toString();
  return q
    ? `${TREASURY_DAILY_CLOSING_PREVIEW_PATH}?${q}`
    : TREASURY_DAILY_CLOSING_PREVIEW_PATH;
}

export function buildTreasuryDailyClosingListUrl(params: {
  companyCode?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  status?: TreasuryClosingStatus | string | null;
  page?: number;
  pageSize?: number;
}): string {
  const qs = new URLSearchParams();
  setIf(qs, "companyCode", params.companyCode?.trim());
  setIf(qs, "dateFrom", params.dateFrom?.trim());
  setIf(qs, "dateTo", params.dateTo?.trim());
  setIf(qs, "status", params.status?.trim());
  setIf(qs, "page", params.page);
  setIf(qs, "pageSize", params.pageSize);
  const q = qs.toString();
  return q ? `${TREASURY_DAILY_CLOSING_PATH}?${q}` : TREASURY_DAILY_CLOSING_PATH;
}

export async function fetchTreasuryDailyClosingPreview(params: {
  date?: string | null;
  companyCode?: string | null;
  accountIds?: string[] | null;
  signal?: AbortSignal;
}): Promise<TreasuryDailyClosingPreviewPayload> {
  return fetchJsonOk<TreasuryDailyClosingPreviewPayload>(
    buildTreasuryDailyClosingPreviewUrl(params),
    { signal: params.signal }
  );
}

export async function fetchTreasuryDailyClosings(params: {
  companyCode?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  status?: string | null;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}): Promise<TreasuryDailyClosingListPayload> {
  return fetchJsonOk<TreasuryDailyClosingListPayload>(
    buildTreasuryDailyClosingListUrl(params),
    { signal: params.signal }
  );
}

export async function fetchTreasuryDailyClosingById(
  id: string,
  signal?: AbortSignal
): Promise<TreasuryDailyClosingDetailPayload> {
  return fetchJsonOk<TreasuryDailyClosingDetailPayload>(
    `${TREASURY_DAILY_CLOSING_PATH}/${encodeURIComponent(id)}`,
    { signal }
  );
}

export async function closeTreasuryDailyClosing(body: {
  companyCode: string;
  date: string;
  sourceHash: string;
  accountIds?: string[] | null;
  notes?: string | null;
  caveats: Array<{
    code: string;
    message: string;
    severity?: "INFO" | "WARNING" | "CRITICAL";
  }>;
}): Promise<TreasuryDailyClosingClosePayload> {
  return fetchJsonOk<TreasuryDailyClosingClosePayload>(
    TREASURY_DAILY_CLOSING_PATH,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export async function reopenTreasuryDailyClosing(
  id: string,
  body: { reason: string }
): Promise<TreasuryDailyClosingReopenPayload> {
  return fetchJsonOk<TreasuryDailyClosingReopenPayload>(
    `${TREASURY_DAILY_CLOSING_PATH}/${encodeURIComponent(id)}/reopen`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}
