/**
 * Cliente HTTP — Central de Relatórios da Tesouraria (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_REPORTS_PATH,
  type TreasuryProjectionLayer,
  type TreasuryReportDto,
  type TreasuryReportKey,
} from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryReportExportFormat } from "./treasuryReportsUi.js";

export type TreasuryReportFetchParams = {
  reportKey: TreasuryReportKey;
  from?: string | null;
  to?: string | null;
  accountIds?: string[] | null;
  scenario?: TreasuryProjectionLayer | string | null;
  status?: string | null;
  severity?: string | null;
  search?: string | null;
  companyCode?: string | null;
  page?: number | null;
  pageSize?: number | null;
  signal?: AbortSignal;
};

export type TreasuryReportPayload = TreasuryReportDto & {
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

export function buildTreasuryReportQueryString(
  params: Omit<TreasuryReportFetchParams, "reportKey" | "signal">
): string {
  const qs = new URLSearchParams();
  setIf(qs, "from", params.from?.trim());
  setIf(qs, "to", params.to?.trim());
  setIf(qs, "scenario", params.scenario?.toString().trim());
  setIf(qs, "status", params.status?.trim());
  setIf(qs, "severity", params.severity?.trim());
  setIf(qs, "search", params.search?.trim());
  setIf(qs, "companyCode", params.companyCode?.trim());
  setIf(qs, "page", params.page ?? undefined);
  setIf(qs, "pageSize", params.pageSize ?? undefined);
  if (params.accountIds?.length) {
    qs.set("accountIds", params.accountIds.join(","));
  }
  return qs.toString();
}

export function buildTreasuryReportUrl(
  params: TreasuryReportFetchParams
): string {
  const q = buildTreasuryReportQueryString(params);
  const base = `${TREASURY_REPORTS_PATH}/${params.reportKey}`;
  return q ? `${base}?${q}` : base;
}

export function buildTreasuryReportExportUrl(
  params: TreasuryReportFetchParams & { format: TreasuryReportExportFormat }
): string {
  const q = buildTreasuryReportQueryString(params);
  const base = `${TREASURY_REPORTS_PATH}/${params.reportKey}/export.${params.format}`;
  return q ? `${base}?${q}` : base;
}

export async function fetchTreasuryReport(
  params: TreasuryReportFetchParams
): Promise<TreasuryReportPayload> {
  return fetchJsonOk<TreasuryReportPayload>(buildTreasuryReportUrl(params), {
    signal: params.signal,
  });
}
