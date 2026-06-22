/** Lógica pura de paginação/extração para sync de contas a pagar Nomus. */

import {
  buildNomusFinancialPageParams,
  resolveNomusFinancialPageSize,
  type NomusFinancialQueryEnv,
} from "./nomusFinancialSyncQueryParams.js";

export type JsonObject = Record<string, unknown>;

export const NOMUS_ACCOUNTS_PAYABLE_PAGE_SIZE = 50;
export const NOMUS_ACCOUNTS_PAYABLE_RESOURCE = "contasPagar" as const;

export type AccountsPayableSyncCliOptions = {
  mode: "preview" | "apply";
  startPage: number;
  maxPages: number;
  singlePage: number | null;
};

export function parseAccountsPayableSyncCli(argv: string[]): AccountsPayableSyncCliOptions & {
  incremental: boolean;
  syncStrategy: string;
} {
  const mode = argv.includes("apply") || argv.includes("--apply") ? "apply" : "preview";
  const incremental =
    argv.includes("--incremental") ||
    argv.includes("incremental") ||
    process.env.NOMUS_AP_INCREMENTAL === "1";

  let startPage = 1;
  let maxPages = 200;
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

  const syncStrategy = incremental ? "full_refresh_upsert" : "full_initial_or_manual";

  return { mode, startPage, maxPages, singlePage, incremental, syncStrategy };
}

export function pickAccountsPayableArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const nested = data.data as Record<string, unknown> | undefined;
  const candidates = [
    data.contasPagar,
    data.contas_pagar,
    data.dados,
    data.data,
    data.results,
    data.items,
    nested?.contasPagar,
    nested?.contas_pagar,
    nested?.dados,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function shouldStopAccountsPayablePagination(
  pageItemsLength: number,
  pageSize: number = NOMUS_ACCOUNTS_PAYABLE_PAGE_SIZE
): boolean {
  return pageItemsLength === 0 || pageItemsLength < pageSize;
}

export function hasNextAccountsPayablePage(
  payload: unknown,
  page: number,
  currentLen: number,
  pageSize: number = NOMUS_ACCOUNTS_PAYABLE_PAGE_SIZE
): boolean {
  if (shouldStopAccountsPayablePagination(currentLen, pageSize)) return false;
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

export function computePaginationPlan(options: AccountsPayableSyncCliOptions): {
  firstPage: number;
  lastPage: number;
} {
  const firstPage = options.startPage;
  const lastPage = options.startPage + options.maxPages - 1;
  return { firstPage, lastPage };
}

export type AccountsPayablePageEnv = NomusFinancialQueryEnv;

/**
 * Query params da página AP — alinhados à chamada funcional do Power BI
 * (pagina, tamanhoPagina, dataInicio, dataFim, apenasPendentes, ordenacao).
 * Delega ao helper financeiro compartilhado para AP e AR usarem a mesma estratégia.
 */
export function buildAccountsPayablePageParams(
  page: number,
  pageSize: number,
  env: AccountsPayablePageEnv = process.env
): Record<string, string> {
  return buildNomusFinancialPageParams(page, pageSize, env);
}

/** Resolve o tamanho de página financeiro (default 1000) para Contas a Pagar. */
export function resolveAccountsPayablePageSize(
  env: NomusFinancialQueryEnv = process.env
): number {
  return resolveNomusFinancialPageSize(env);
}
