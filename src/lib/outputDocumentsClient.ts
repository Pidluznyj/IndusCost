/**
 * Cliente HTTP tipado de Documentos de Saída.
 * Somente APIs locais do IndusCost; nunca chama o Nomus.
 */
import { fetchJsonOk } from "@/src/lib/http.js";
import type {
  OutputDocumentsListPayload,
  OutputDocumentsSortBy,
  OutputDocumentsSortDir,
  OutputDocumentsSummaryPayload,
  OutputDocumentsTriState,
} from "@/src/lib/output-documents/outputDocumentsListTypes.js";
import type { OutputDocumentDetailPayload } from "@/src/lib/output-documents/outputDocumentsDetailTypes.js";
import type { OutputDocumentFinancialStatus } from "@/src/lib/output-documents/outputDocumentFinancialStatusResolver.js";

export type OutputDocumentsClientQuery = {
  page?: number;
  pageSize?: number;
  sortBy?: OutputDocumentsSortBy;
  sortDir?: OutputDocumentsSortDir;
  search?: string;
  from?: string;
  to?: string;
  year?: string | number;
  month?: string | number;
  company?: string;
  customer?: string;
  personExternalId?: number;
  status?: string;
  cancelled?: OutputDocumentsTriState;
  order?: string;
  nfe?: string;
  hasReceivable?: OutputDocumentsTriState;
  financialStatus?: OutputDocumentFinancialStatus;
};

export type {
  OutputDocumentDetailPayload,
  OutputDocumentsListPayload,
  OutputDocumentsSummaryPayload,
};

export const OUTPUT_DOCUMENTS_LIST_API_PATH =
  "/api/commercial/output-documents";
export const OUTPUT_DOCUMENTS_SUMMARY_API_PATH =
  "/api/commercial/output-documents/summary";

export function buildOutputDocumentsQueryString(
  query: OutputDocumentsClientQuery = {}
): string {
  const params = new URLSearchParams();
  const textEntries: Array<[string, string | null | undefined]> = [
    ["search", query.search],
    ["from", query.from],
    ["to", query.to],
    ["company", query.company],
    ["customer", query.customer],
    ["status", query.status],
    ["order", query.order],
    ["nfe", query.nfe],
    ["financialStatus", query.financialStatus],
  ];
  if (query.page != null) params.set("page", String(query.page));
  if (query.pageSize != null) params.set("pageSize", String(query.pageSize));
  if (query.sortBy) params.set("sortBy", query.sortBy);
  if (query.sortDir) params.set("sortDir", query.sortDir);
  if (query.year != null && String(query.year).trim()) {
    params.set("year", String(query.year).trim());
  }
  if (query.month != null && String(query.month).trim()) {
    params.set("month", String(query.month).trim());
  }
  if (
    query.personExternalId != null &&
    Number.isFinite(query.personExternalId)
  ) {
    params.set("personExternalId", String(query.personExternalId));
  }
  if (query.cancelled && query.cancelled !== "all") {
    params.set("cancelled", query.cancelled);
  }
  if (query.hasReceivable && query.hasReceivable !== "all") {
    params.set("hasReceivable", query.hasReceivable);
  }
  for (const [key, value] of textEntries) {
    if (value?.trim()) params.set(key, value.trim());
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchOutputDocumentsList(
  query: OutputDocumentsClientQuery = {},
  signal?: AbortSignal
): Promise<OutputDocumentsListPayload> {
  return fetchJsonOk<OutputDocumentsListPayload>(
    `${OUTPUT_DOCUMENTS_LIST_API_PATH}${buildOutputDocumentsQueryString(query)}`,
    { signal }
  );
}

export async function fetchOutputDocumentsSummary(
  query: OutputDocumentsClientQuery = {},
  signal?: AbortSignal
): Promise<OutputDocumentsSummaryPayload> {
  return fetchJsonOk<OutputDocumentsSummaryPayload>(
    `${OUTPUT_DOCUMENTS_SUMMARY_API_PATH}${buildOutputDocumentsQueryString(query)}`,
    { signal }
  );
}

export async function fetchOutputDocumentDetail(
  id: string,
  options: { includeRaw?: boolean; signal?: AbortSignal } = {}
): Promise<OutputDocumentDetailPayload> {
  const raw = options.includeRaw ? "?includeRaw=true" : "";
  return fetchJsonOk<OutputDocumentDetailPayload>(
    `${OUTPUT_DOCUMENTS_LIST_API_PATH}/${encodeURIComponent(id)}${raw}`,
    { signal: options.signal }
  );
}
