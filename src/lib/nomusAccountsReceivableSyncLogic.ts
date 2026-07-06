/** Lógica pura de paginação/extração para sync de contas a receber Nomus. */

import {
  buildNomusFinancialPageParams,
  resolveNomusFinancialPageSize,
  type NomusFinancialQueryEnv,
} from "./nomusFinancialSyncQueryParams.js";

export type JsonObject = Record<string, unknown>;

export const NOMUS_ACCOUNTS_RECEIVABLE_PAGE_SIZE = 50;

export type AccountsReceivableSyncCliOptions = {
  mode: "preview" | "apply";
  startPage: number;
  maxPages: number;
  singlePage: number | null;
};

export function parseAccountsReceivableSyncCli(argv: string[]): AccountsReceivableSyncCliOptions & {
  incremental: boolean;
  syncStrategy: string;
} {
  const mode = argv.includes("apply") || argv.includes("--apply") ? "apply" : "preview";
  const incremental =
    argv.includes("--incremental") ||
    argv.includes("incremental") ||
    process.env.NOMUS_AR_INCREMENTAL === "1";

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

  const syncStrategy = incremental
    ? "full_refresh_upsert"
    : "full_initial_or_manual";

  return { mode, startPage, maxPages, singlePage, incremental, syncStrategy };
}

export function pickAccountsReceivableArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const nested = data.data as Record<string, unknown> | undefined;
  const candidates = [
    data.contasReceber,
    data.contas_receber,
    data.dados,
    data.data,
    data.results,
    data.items,
    nested?.contasReceber,
    nested?.contas_receber,
    nested?.dados,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function shouldStopAccountsReceivablePagination(
  pageItemsLength: number,
  pageSize: number = NOMUS_ACCOUNTS_RECEIVABLE_PAGE_SIZE
): boolean {
  return pageItemsLength === 0 || pageItemsLength < pageSize;
}

export function hasNextAccountsReceivablePage(
  payload: unknown,
  page: number,
  currentLen: number,
  pageSize: number = NOMUS_ACCOUNTS_RECEIVABLE_PAGE_SIZE
): boolean {
  if (shouldStopAccountsReceivablePagination(currentLen, pageSize)) return false;
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

export function computePaginationPlan(options: AccountsReceivableSyncCliOptions): {
  firstPage: number;
  lastPage: number;
} {
  const firstPage = options.startPage;
  const lastPage = options.startPage + options.maxPages - 1;
  return { firstPage, lastPage };
}

export type AccountsReceivablePageEnv = NomusFinancialQueryEnv;

/**
 * Query params da página AR — alinhados à chamada funcional do Power BI
 * (pagina, tamanhoPagina, dataInicio, dataFim, apenasPendentes, ordenacao).
 * Delega ao helper financeiro compartilhado para AP e AR usarem a mesma estratégia.
 */
export function buildAccountsReceivablePageParams(
  page: number,
  pageSize: number,
  env: AccountsReceivablePageEnv = process.env
): Record<string, string> {
  return buildNomusFinancialPageParams(page, pageSize, env);
}

/** Resolve o tamanho de página financeiro (default 1000) para Contas a Receber. */
export function resolveAccountsReceivablePageSize(
  env: NomusFinancialQueryEnv = process.env
): number {
  return resolveNomusFinancialPageSize(env);
}
