/**
 * Cliente HTTP — importação OFX e listagem de movimentos/lotes (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_BANK_IMPORTS_OFX_APPLY_PATH,
  TREASURY_BANK_IMPORTS_OFX_PREVIEW_PATH,
  TREASURY_BANK_IMPORTS_PATH,
  TREASURY_BANK_MOVEMENTS_PATH,
  type TreasuryBankImportBatchDto,
  type TreasuryBankMovementDto,
  type TreasuryPaginationMeta,
} from "@/src/lib/treasury/contracts/index.js";

export type TreasuryOfxPreviewMovement = {
  sortOrder: number;
  status: "NEW" | "DUPLICATE" | "INVALID" | string;
  fingerprint: string | null;
  fitId: string | null;
  direction: "DEBIT" | "CREDIT" | string | null;
  amount: string | null;
  currency: string | null;
  postedCivilDate: string | null;
  description: string | null;
  documentNumber: string | null;
  counterpartyName: string | null;
  trnType: string | null;
  invalidReason: string | null;
  duplicateReason: string | null;
};

export type TreasuryOfxPreviewResponse = {
  ok: true;
  persisted: false;
  previewToken: string;
  expiresAt: string;
  accountId: string;
  companyCode: string;
  fileSha256: string;
  originalFileName: string;
  format: string;
  byteLength: number;
  fileAlreadyImported: boolean;
  period: { startCivilDate: string | null; endCivilDate: string | null };
  totals: {
    movementCount: number;
    newCount: number;
    duplicateCount: number;
    invalidCount: number;
    creditAmount: string;
    debitAmount: string;
    netAmount: string;
  };
  movements: TreasuryOfxPreviewMovement[];
  warnings: string[];
  requestId?: string;
};

export type TreasuryOfxApplyResponse = {
  ok: true;
  idempotent: boolean;
  batchId: string;
  accountId: string;
  companyCode: string;
  fileSha256: string;
  status: string;
  created: { count: number; movementIds: string[]; fingerprints: string[] };
  ignored: {
    count: number;
    items: Array<{
      fingerprint: string | null;
      fitId: string | null;
      reason: string;
      duplicateReason: string | null;
    }>;
  };
  invalid: {
    count: number;
    items: Array<{ sortOrder: number; fitId: string | null; reason: string }>;
  };
  errors: Array<{ code: string; message: string; field?: string }>;
  suggestionsRequested?: { accepted: boolean; deferred: boolean; reason: string };
  projectionRecalc?: { accepted: boolean; deferred: boolean; reason: string };
  requestId?: string;
};

export async function previewTreasuryOfxImport(input: {
  accountId: string;
  file: File;
  signal?: AbortSignal;
}): Promise<TreasuryOfxPreviewResponse> {
  const fd = new FormData();
  fd.append("file", input.file);
  fd.append("accountId", input.accountId);
  const res = await fetch(TREASURY_BANK_IMPORTS_OFX_PREVIEW_PATH, {
    method: "POST",
    credentials: "include",
    body: fd,
    signal: input.signal,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(
      String(data.error ?? "Falha no preview OFX.")
    ) as Error & { code?: string; status?: number };
    err.code = typeof data.code === "string" ? data.code : undefined;
    err.status = res.status;
    throw err;
  }
  return data as TreasuryOfxPreviewResponse;
}

export async function applyTreasuryOfxImport(input: {
  previewToken: string;
  contentHash?: string | null;
  notes?: string | null;
  signal?: AbortSignal;
}): Promise<TreasuryOfxApplyResponse> {
  return fetchJsonOk<TreasuryOfxApplyResponse>(
    TREASURY_BANK_IMPORTS_OFX_APPLY_PATH,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        previewToken: input.previewToken,
        contentHash: input.contentHash ?? undefined,
        notes: input.notes ?? undefined,
      }),
      signal: input.signal,
    }
  );
}

export type TreasuryBankImportsListParams = {
  page?: number;
  pageSize?: number;
  companyCode?: string | null;
  accountId?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  signal?: AbortSignal;
};

export async function fetchTreasuryBankImportBatches(
  params: TreasuryBankImportsListParams = {}
): Promise<{
  ok: true;
  items: TreasuryBankImportBatchDto[];
  pagination: TreasuryPaginationMeta;
}> {
  const qs = new URLSearchParams();
  if (params.page != null) qs.set("page", String(params.page));
  if (params.pageSize != null) qs.set("pageSize", String(params.pageSize));
  if (params.companyCode?.trim()) qs.set("companyCode", params.companyCode.trim());
  if (params.accountId?.trim()) qs.set("accountId", params.accountId.trim());
  if (params.status) qs.set("status", params.status);
  if (params.from?.trim()) qs.set("from", params.from.trim());
  if (params.to?.trim()) qs.set("to", params.to.trim());
  const query = qs.toString();
  const url = query
    ? `${TREASURY_BANK_IMPORTS_PATH}?${query}`
    : TREASURY_BANK_IMPORTS_PATH;
  return fetchJsonOk(url, { credentials: "include", signal: params.signal });
}

export type TreasuryBankMovementsListParams = {
  page?: number;
  pageSize?: number;
  companyCode?: string | null;
  accountId?: string | null;
  batchId?: string | null;
  bucket?: string | null;
  search?: string | null;
  from?: string | null;
  to?: string | null;
  signal?: AbortSignal;
};

export async function fetchTreasuryBankMovements(
  params: TreasuryBankMovementsListParams = {}
): Promise<{
  ok: true;
  items: TreasuryBankMovementDto[];
  pagination: TreasuryPaginationMeta;
  duplicatesNotPersisted: boolean;
  message: string | null;
}> {
  const qs = new URLSearchParams();
  if (params.page != null) qs.set("page", String(params.page));
  if (params.pageSize != null) qs.set("pageSize", String(params.pageSize));
  if (params.companyCode?.trim()) qs.set("companyCode", params.companyCode.trim());
  if (params.accountId?.trim()) qs.set("accountId", params.accountId.trim());
  if (params.batchId?.trim()) qs.set("batchId", params.batchId.trim());
  if (params.bucket) qs.set("bucket", params.bucket);
  if (params.search?.trim()) qs.set("search", params.search.trim());
  if (params.from?.trim()) qs.set("from", params.from.trim());
  if (params.to?.trim()) qs.set("to", params.to.trim());
  const query = qs.toString();
  const url = query
    ? `${TREASURY_BANK_MOVEMENTS_PATH}?${query}`
    : TREASURY_BANK_MOVEMENTS_PATH;
  return fetchJsonOk(url, { credentials: "include", signal: params.signal });
}

export async function fetchTreasuryBankMovement(
  id: string,
  signal?: AbortSignal
): Promise<{ ok: true; movement: TreasuryBankMovementDto }> {
  return fetchJsonOk(
    `${TREASURY_BANK_MOVEMENTS_PATH}/${encodeURIComponent(id)}`,
    { credentials: "include", signal }
  );
}
