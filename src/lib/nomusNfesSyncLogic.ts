/** Lógica pura de paginação/filtro para sync de NF-e Nomus (`/rest/nfes`). */

import { parseNomusBrDate } from "@/src/lib/nomusAccountsPayableParser.js";
import {
  NOMUS_NFE_CLIENT_ISSUED,
  NOMUS_NFE_PRODUCTION_ENV,
  NOMUS_NFE_SAIDA_TIPO_OPERACAO,
  NOMUS_NFE_STATUS_CANCELLED,
} from "@/src/lib/nomusNfeClassification.js";

export type JsonObject = Record<string, unknown>;

export const NOMUS_NFES_PAGE_SIZE = 50;
export const NOMUS_NFES_RESOURCE = "nfes" as const;
export const NOMUS_NFES_INITIAL_CUTOFF = "2024-01-01";
export const NOMUS_NFES_INCREMENTAL_OVERLAP_DAYS = 60;

export type NfesSyncCliOptions = {
  mode: "preview" | "apply";
  startPage: number;
  maxPages: number;
  singlePage: number | null;
};

export function parseNfesSyncCli(argv: string[]): NfesSyncCliOptions & {
  incremental: boolean;
  syncStrategy: string;
} {
  const mode = argv.includes("apply") || argv.includes("--apply") ? "apply" : "preview";
  const incremental =
    argv.includes("--incremental") ||
    argv.includes("incremental") ||
    process.env.NOMUS_NFE_INCREMENTAL === "1";

  let startPage = 1;
  let maxPages = 500;
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

  const syncStrategy = incremental ? "incremental_overlap_upsert" : "full_initial_or_manual";

  return { mode, startPage, maxPages, singlePage, incremental, syncStrategy };
}

export function pickNfesArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const candidates = [
    data.nfes,
    data.NFes,
    data.data,
    data.results,
    data.items,
    (data.data as Record<string, unknown> | undefined)?.nfes,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function shouldStopNfesPagination(
  pageItemsLength: number,
  pageSize: number = NOMUS_NFES_PAGE_SIZE
): boolean {
  return pageItemsLength === 0 || pageItemsLength < pageSize;
}

export function hasNextNfesPage(
  payload: unknown,
  page: number,
  currentLen: number,
  pageSize: number = NOMUS_NFES_PAGE_SIZE
): boolean {
  if (shouldStopNfesPagination(currentLen, pageSize)) return false;
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

export function computeNfesPaginationPlan(options: NfesSyncCliOptions): {
  firstPage: number;
  lastPage: number;
} {
  const firstPage = options.startPage;
  const lastPage = options.startPage + options.maxPages - 1;
  return { firstPage, lastPage };
}

export type NfesPageEnv = {
  NOMUS_NFE_SEND_PAGE_SIZE?: string;
};

export function buildNfesPageParams(
  page: number,
  pageSize: number,
  env: NfesPageEnv = process.env
): Record<string, string> {
  const params: Record<string, string> = { pagina: String(page) };
  if (env.NOMUS_NFE_SEND_PAGE_SIZE === "1") {
    params.tamanhoPagina = String(pageSize);
  }
  return params;
}

function toIntLocal(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseDataProcessamento(raw: JsonObject): Date | null {
  const value = raw.dataProcessamento;
  if (typeof value !== "string") return null;
  return parseNomusBrDate(value.trim());
}

export function resolveNfesSyncCutoffDate(incremental: boolean, now: Date = new Date()): Date {
  if (!incremental) {
    return new Date(`${NOMUS_NFES_INITIAL_CUTOFF}T00:00:00`);
  }
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - NOMUS_NFES_INCREMENTAL_OVERLAP_DAYS);
  cutoff.setHours(0, 0, 0, 0);
  return cutoff;
}

/** Filtro local alinhado ao Power BI: saída, produção, emitida pelo cliente, período e status útil. */
export function passesNfesSyncLocalFilter(
  raw: JsonObject,
  cutoffDate: Date
): { pass: boolean; reason?: string } {
  const tipoOperacao = toIntLocal(raw.tipoOperacao ?? raw.tipo_operacao);
  if (tipoOperacao != null && tipoOperacao !== NOMUS_NFE_SAIDA_TIPO_OPERACAO) {
    return { pass: false, reason: "tipoOperacao!=1" };
  }

  const isFornecedor = toIntLocal(raw.isFornecedor ?? raw.is_fornecedor);
  if (isFornecedor != null && isFornecedor !== NOMUS_NFE_CLIENT_ISSUED) {
    return { pass: false, reason: "isFornecedor!=0" };
  }

  const ambiente = toIntLocal(raw.ambiente);
  if (ambiente != null && ambiente !== NOMUS_NFE_PRODUCTION_ENV) {
    return { pass: false, reason: "ambiente!=1" };
  }

  const status = toIntLocal(raw.status);
  const allowedStatuses = new Set([1, 2, NOMUS_NFE_STATUS_CANCELLED]);
  if (status != null && !allowedStatuses.has(status)) {
    return { pass: false, reason: `status=${status}` };
  }

  const dataProcessamento = parseDataProcessamento(raw);
  if (dataProcessamento && dataProcessamento < cutoffDate) {
    return { pass: false, reason: "dataProcessamento antes do cutoff" };
  }

  return { pass: true };
}
