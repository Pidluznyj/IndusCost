/**
 * Cliente HTTP — Apoio ao Caixa (CS-007). Client-safe: sem Prisma/I/O.
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_CASH_SUPPORT_AUTO_RECONCILE_PATH,
  TREASURY_CASH_SUPPORT_HISTORY_PATH,
  TREASURY_CASH_SUPPORT_PATH,
  TREASURY_CASH_SUPPORT_SUGGESTIONS_PATH,
  TREASURY_CASH_SUPPORT_TITLE_GRID_PATH,
} from "@/src/lib/treasury/contracts/index.js";
import type { CashSupportReadModel } from "@/src/lib/treasury/contracts/cashSupportContracts.js";
import type { TreasuryReconciliationMatchDto } from "@/src/lib/treasury/contracts/treasuryDto.js";
import type { CashSupportTitleGridViewModel } from "@/src/lib/treasury/domain/cashSupportTitleGrid.js";
import type { TreasuryReconciliationSuggestionEngineResult } from "@/src/lib/treasury/domain/treasuryReconciliationSuggestionEngine.js";

export type CashSupportFetchParams = {
  civilDateFrom: string;
  civilDateTo: string;
  companyCode?: string | null;
  accountId?: string | null;
  direction?: "IN" | "OUT" | null;
  search?: string | null;
  onlyPending?: boolean;
  onlyWarnings?: boolean;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
};

export type CashSupportPayload = CashSupportReadModel & { requestId?: string };

export function buildCashSupportUrl(params: CashSupportFetchParams): string {
  const qs = new URLSearchParams();
  qs.set("civilDateFrom", params.civilDateFrom);
  qs.set("civilDateTo", params.civilDateTo);
  if (params.companyCode) qs.set("companyCode", params.companyCode);
  if (params.accountId) qs.set("accountId", params.accountId);
  if (params.direction) qs.set("direction", params.direction);
  if (params.search) qs.set("search", params.search);
  if (params.onlyPending) qs.set("onlyPending", "true");
  if (params.onlyWarnings) qs.set("onlyWarnings", "true");
  if (params.page) qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  return `${TREASURY_CASH_SUPPORT_PATH}?${qs.toString()}`;
}

export async function fetchCashSupport(
  params: CashSupportFetchParams
): Promise<CashSupportPayload> {
  return fetchJsonOk<CashSupportPayload>(buildCashSupportUrl(params), {
    signal: params.signal,
  });
}

function buildCashSupportQuery(params: CashSupportFetchParams): string {
  const qs = new URLSearchParams();
  qs.set("civilDateFrom", params.civilDateFrom);
  qs.set("civilDateTo", params.civilDateTo);
  if (params.companyCode) qs.set("companyCode", params.companyCode);
  if (params.accountId) qs.set("accountId", params.accountId);
  return qs.toString();
}

export type CashSupportTitleGridPayload = CashSupportTitleGridViewModel & {
  analysisAsOfDateTime: string;
  requestId?: string;
};

export async function fetchCashSupportTitleGrid(
  params: CashSupportFetchParams
): Promise<CashSupportTitleGridPayload> {
  return fetchJsonOk<CashSupportTitleGridPayload>(
    `${TREASURY_CASH_SUPPORT_TITLE_GRID_PATH}?${buildCashSupportQuery(params)}`,
    { signal: params.signal }
  );
}

export type CashSupportAutoReconcilePayload = {
  algorithmVersion: string;
  ruleVersion: string;
  analyzedMovements: number;
  autoAccepted: number;
  alreadyReconciled: number;
  needsReview: number;
  unmatched: number;
  failures: Array<{ suggestionKey: string; movementId: string; message: string }>;
  requestId?: string;
};

/** Dispara a auto-conciliação conservadora (idempotente no backend). */
export async function runCashSupportAutoReconcile(params: {
  civilDateFrom: string;
  civilDateTo: string;
  companyCode?: string | null;
  accountId?: string | null;
}): Promise<CashSupportAutoReconcilePayload> {
  return fetchJsonOk<CashSupportAutoReconcilePayload>(
    TREASURY_CASH_SUPPORT_AUTO_RECONCILE_PATH,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        civilDateFrom: params.civilDateFrom,
        civilDateTo: params.civilDateTo,
        companyCode: params.companyCode ?? undefined,
        accountId: params.accountId ?? undefined,
      }),
    }
  );
}

export type CashSupportSuggestionsPayload =
  TreasuryReconciliationSuggestionEngineResult & { requestId?: string };

export async function fetchCashSupportSuggestions(
  params: CashSupportFetchParams
): Promise<CashSupportSuggestionsPayload> {
  return fetchJsonOk<CashSupportSuggestionsPayload>(
    `${TREASURY_CASH_SUPPORT_SUGGESTIONS_PATH}?${buildCashSupportQuery(params)}`,
    { signal: params.signal }
  );
}

export type CashSupportHistoryPayload = {
  matches: TreasuryReconciliationMatchDto[];
  analysisAsOfDateTime: string;
  requestId?: string;
};

export async function fetchCashSupportHistory(
  params: CashSupportFetchParams
): Promise<CashSupportHistoryPayload> {
  return fetchJsonOk<CashSupportHistoryPayload>(
    `${TREASURY_CASH_SUPPORT_HISTORY_PATH}?${buildCashSupportQuery(params)}`,
    { signal: params.signal }
  );
}
