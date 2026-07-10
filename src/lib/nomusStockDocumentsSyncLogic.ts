/** Lógica pura de CLI/query/paginação/persistência para sync de documentosEstoque. */

import type { MappedNomusStockDocument } from "./nomusStockDocumentsMapper.js";

export type JsonObject = Record<string, unknown>;

export const NOMUS_STOCK_DOCUMENTS_DEFAULT_PAGE_SIZE = 50;
export const NOMUS_STOCK_DOCUMENTS_DEFAULT_TIPO = "DocumentoSaida";
export const NOMUS_STOCK_DOCUMENTS_RESOURCE = "documentosEstoque";

export type StockDocumentsSyncMode = "preview" | "apply";

export type StockDocumentsSyncCliOptions = {
  mode: StockDocumentsSyncMode;
  from: string | null;
  to: string | null;
  tipo: string;
  pageSize: number;
  maxPages: number | null;
  idNfes: number[];
};

export type StockDocumentPersistPlan = {
  externalId: number;
  action: "create" | "update";
  replaceItems: true;
  itemCount: number;
};

function parseIsoDateArg(raw: string, label: string): string {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error(`${label} inválida: "${raw}". Use YYYY-MM-DD.`);
  }
  const [y, m, d] = trimmed.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(y!, m! - 1, d!);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m! - 1 ||
    date.getDate() !== d
  ) {
    throw new Error(`${label} inválida: "${raw}".`);
  }
  return trimmed;
}

/** YYYY-MM-DD → dd/MM/yyyy (filtro RSQL Nomus). */
export function isoDateToNomusBrDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function parseIdNfeList(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const n = Number.parseInt(part, 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`idNfe inválido: ${part}`);
      return n;
    });
}

export function parseStockDocumentsSyncCli(argv: string[]): StockDocumentsSyncCliOptions {
  const mode: StockDocumentsSyncMode =
    argv.includes("apply") || argv.includes("--apply") ? "apply" : "preview";

  let from: string | null = null;
  let to: string | null = null;
  let tipo = NOMUS_STOCK_DOCUMENTS_DEFAULT_TIPO;
  let pageSize = NOMUS_STOCK_DOCUMENTS_DEFAULT_PAGE_SIZE;
  let maxPages: number | null = null;
  const idNfes: number[] = [];

  for (const arg of argv) {
    if (arg.startsWith("--from=")) {
      from = parseIsoDateArg(arg.slice("--from=".length), "--from");
      continue;
    }
    if (arg.startsWith("--to=")) {
      to = parseIsoDateArg(arg.slice("--to=".length), "--to");
      continue;
    }
    if (arg.startsWith("--tipo=")) {
      tipo = arg.slice("--tipo=".length).trim() || NOMUS_STOCK_DOCUMENTS_DEFAULT_TIPO;
      continue;
    }
    if (arg.startsWith("--page-size=")) {
      const parsed = Number.parseInt(arg.slice("--page-size=".length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--page-size inválido: ${arg}`);
      pageSize = parsed;
      continue;
    }
    if (arg.startsWith("--max-pages=")) {
      const parsed = Number.parseInt(arg.slice("--max-pages=".length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--max-pages inválido: ${arg}`);
      maxPages = parsed;
      continue;
    }
    if (arg.startsWith("--idNfe=")) {
      idNfes.push(...parseIdNfeList(arg.slice("--idNfe=".length)));
    }
  }

  if (idNfes.length === 0 && (!from || !to)) {
    throw new Error("Informe --from=YYYY-MM-DD e --to=YYYY-MM-DD, ou --idNfe=... para teste pontual.");
  }

  return {
    mode,
    from,
    to,
    tipo,
    pageSize,
    maxPages,
    idNfes: [...new Set(idNfes)],
  };
}

/**
 * Monta filtro RSQL Nomus (documentosEstoque).
 * Período: dataEmissao>=dd/MM/yyyy;dataEmissao<=dd/MM/yyyy;tipoDocumentoEstoque==...
 * Pontual: idNfe==N;tipoDocumentoEstoque==... (um id por request quando múltiplos).
 * Seletor de data: dataEmissao (não "data").
 */
export function buildStockDocumentsQuery(options: {
  tipo: string;
  from?: string | null;
  to?: string | null;
  idNfe?: number | null;
}): string {
  const parts: string[] = [];
  if (options.idNfe != null) {
    parts.push(`idNfe==${options.idNfe}`);
  }
  if (options.from) {
    parts.push(`dataEmissao>=${isoDateToNomusBrDate(options.from)}`);
  }
  if (options.to) {
    parts.push(`dataEmissao<=${isoDateToNomusBrDate(options.to)}`);
  }
  parts.push(`tipoDocumentoEstoque==${options.tipo}`);
  return parts.join(";");
}

export function buildStockDocumentsPageParams(
  page: number,
  pageSize: number,
  query: string
): Record<string, string> {
  return {
    query,
    pagina: String(Math.max(1, Math.trunc(page))),
    tamanhoPagina: String(Math.max(1, Math.trunc(pageSize))),
  };
}

export function pickStockDocumentsArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const nested = data.data as Record<string, unknown> | undefined;
  const candidates = [
    data.documentosEstoque,
    data.documentoEstoque,
    data.dados,
    data.data,
    data.results,
    data.items,
    data.content,
    nested?.documentosEstoque,
    nested?.dados,
    nested?.items,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function shouldStopStockDocumentsPagination(
  pageItemsLength: number,
  pageSize: number
): boolean {
  return pageItemsLength === 0 || pageItemsLength < pageSize;
}

export function hasNextStockDocumentsPage(
  payload: unknown,
  page: number,
  currentLen: number,
  pageSize: number
): boolean {
  if (shouldStopStockDocumentsPagination(currentLen, pageSize)) return false;
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

/** Plano de escrita idempotente: upsert cabeçalho + replace total dos itens. */
export function planStockDocumentPersist(
  row: MappedNomusStockDocument,
  existingExternalIds: ReadonlySet<number>
): StockDocumentPersistPlan {
  return {
    externalId: row.externalId,
    action: existingExternalIds.has(row.externalId) ? "update" : "create",
    replaceItems: true,
    itemCount: row.items.length,
  };
}

export function summarizeStockDocumentPersistPlans(plans: StockDocumentPersistPlan[]): {
  documentsToCreate: number;
  documentsToUpdate: number;
  itemsToWrite: number;
  documentsWithoutItems: number;
} {
  return {
    documentsToCreate: plans.filter((p) => p.action === "create").length,
    documentsToUpdate: plans.filter((p) => p.action === "update").length,
    itemsToWrite: plans.reduce((sum, p) => sum + p.itemCount, 0),
    documentsWithoutItems: plans.filter((p) => p.itemCount === 0).length,
  };
}

/** Preview nunca deve disparar persistência. */
export function shouldWriteStockDocuments(mode: StockDocumentsSyncMode): boolean {
  return mode === "apply";
}
