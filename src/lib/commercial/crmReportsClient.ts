/**
 * CRM > Relatórios — cliente HTTP do frontend. Sem regra de negócio.
 *
 * Leituras passam pelo wrapper central (`fetchJsonOk`: cookie de sessão,
 * 401/403 tipados) e aceitam `AbortSignal` para cancelar pedido obsoleto.
 * Exportações (CSV/XLSX) enviam o MESMO corpo de filtros/visões da tela —
 * o backend roda o mesmo pipeline; o navegador só salva o arquivo.
 */

import { isNonSessionUnauthorizedCode } from "@/src/lib/auth/adminElevation.shared";
import {
  AuthRequiredError,
  HttpError,
  PERMISSIONS_VERSION_STALE_CODE,
  PermissionsStaleError,
  fetchJsonOk,
  notifyAuthRequired,
  notifyPermissionsStale,
  parseApiErrorPayload,
} from "@/src/lib/http";
import {
  CRM_REPORTS_CUSTOMER_OPTIONS_DEFAULT_LIMIT,
  type CrmCustomReportRequest,
  type CrmCustomReportResponse,
  type CrmReportsCustomerOptionsResponse,
  type CrmReportsFilterOptionsResponse,
  type CrmReportsListKey,
  type CrmReportsOperationalRequest,
  type CrmReportsOperationalResponse,
} from "@/src/lib/commercial/crmReportsTypes";

export const CRM_REPORTS_API = {
  operational: "/api/crm/reports/operational",
  operationalExport: "/api/crm/reports/operational/export",
  filterOptions: "/api/crm/reports/filter-options",
  customerOptions: "/api/crm/reports/customer-options",
  custom: "/api/crm/reports/custom",
  customExport: "/api/crm/reports/custom/export",
} as const;

export type CrmReportsExportFormatChoice = "csv" | "xlsx";

function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return fetchJsonOk<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/** Universo, cards e as 3 listas (página pedida de cada uma). */
export function fetchCrmReportsOperational(
  body: CrmReportsOperationalRequest,
  signal?: AbortSignal
): Promise<CrmReportsOperationalResponse> {
  return postJson<CrmReportsOperationalResponse>(CRM_REPORTS_API.operational, body, signal);
}

/** Metadados leves dos filtros (responsáveis, vendedores, cidades, UFs) — sem lista de clientes. */
export function fetchCrmReportsFilterOptions(signal?: AbortSignal): Promise<CrmReportsFilterOptionsResponse> {
  return fetchJsonOk<CrmReportsFilterOptionsResponse>(CRM_REPORTS_API.filterOptions, { signal });
}

/** Busca de clientes do escopo (nome, fantasia, CNPJ) — limitada no backend. */
export function searchCrmReportsCustomerOptions(
  query: string,
  signal?: AbortSignal,
  limit = CRM_REPORTS_CUSTOMER_OPTIONS_DEFAULT_LIMIT
): Promise<CrmReportsCustomerOptionsResponse> {
  const qs = new URLSearchParams({ q: query, limit: String(limit) });
  return fetchJsonOk<CrmReportsCustomerOptionsResponse>(`${CRM_REPORTS_API.customerOptions}?${qs.toString()}`, {
    signal,
  });
}

/** Relatório personalizado — chamado SÓ pelo clique em "Gerar relatório" (e pela paginação do resultado). */
export function fetchCrmCustomReport(
  body: CrmCustomReportRequest,
  signal?: AbortSignal
): Promise<CrmCustomReportResponse> {
  return postJson<CrmCustomReportResponse>(CRM_REPORTS_API.custom, body, signal);
}

export type CrmReportsDownloadResult = { filename: string; rowCount: number | null };

function filenameFromDisposition(disposition: string | null): string | null {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? null;
}

async function raiseDownloadError(res: Response): Promise<never> {
  const payload = await parseApiErrorPayload(res);
  if (res.status === 401) {
    if (isNonSessionUnauthorizedCode(payload.code)) throw new HttpError(401, payload.message, payload.code);
    notifyAuthRequired();
    throw new AuthRequiredError(payload.message || undefined);
  }
  if (res.status === 403 && payload.code === PERMISSIONS_VERSION_STALE_CODE) {
    notifyPermissionsStale();
    throw new PermissionsStaleError(payload.message);
  }
  throw new HttpError(res.status, payload.message, payload.code);
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadExport(url: string, body: unknown, fallbackFilename: string): Promise<CrmReportsDownloadResult> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await raiseDownloadError(res);
  const blob = await res.blob();
  const filename = filenameFromDisposition(res.headers.get("Content-Disposition")) ?? fallbackFilename;
  saveBlob(blob, filename);
  const rowCount = Number(res.headers.get("X-Export-Row-Count"));
  return { filename, rowCount: Number.isFinite(rowCount) ? rowCount : null };
}

/** Lista inteira (1, 2 ou 3) com o mesmo corpo da tela (filtros + visões). */
export function downloadCrmReportsListExport(
  request: CrmReportsOperationalRequest,
  list: CrmReportsListKey,
  format: CrmReportsExportFormatChoice
): Promise<CrmReportsDownloadResult> {
  return downloadExport(
    CRM_REPORTS_API.operationalExport,
    { ...request, list, format },
    `crm-relatorio-${list}.${format}`
  );
}

/** Relatório personalizado inteiro com o spec GERADO (o mesmo da tabela na tela). */
export function downloadCrmCustomReportExport(
  request: CrmCustomReportRequest,
  format: CrmReportsExportFormatChoice
): Promise<CrmReportsDownloadResult> {
  return downloadExport(CRM_REPORTS_API.customExport, { ...request, format }, `crm-relatorio-personalizado.${format}`);
}

/** Mensagem legível de erro de request (AbortError é tratado pelo chamador). */
export function describeCrmReportsError(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    return error.message || (error.status === 403 ? "Sem permissão para os relatórios do CRM." : fallback);
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Classificação do erro para escolher o estado da tela. */
export function classifyCrmReportsError(error: unknown): "forbidden" | "too-large" | "invalid" | "failed" {
  if (error instanceof HttpError) {
    if (error.status === 403) return "forbidden";
    if (error.status === 422) return "too-large";
    if (error.status === 400) return "invalid";
  }
  return "failed";
}

export function isCrmReportsAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
