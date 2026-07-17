/** Lógica pura de CLI/query/paginação/persistência para sync de documentosEstoque. */

import type {
  MappedNomusStockDocument,
  StockDocumentItemsReliability,
} from "./nomusStockDocumentsMapper.js";

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

/** Decisão centralizada sobre a lista de itens do documento. */
export type StockDocumentItemsPersistAction = "replace" | "preserve" | "ignore";

export type StockDocumentItemsDecision = {
  action: StockDocumentItemsPersistAction;
  reason: string;
  reliability: StockDocumentItemsReliability | "invalid";
};

export type StockDocumentPersistPlan = {
  externalId: number;
  action: "create" | "update" | "unchanged";
  headerAction: "write" | "unchanged";
  itemsAction: StockDocumentItemsPersistAction;
  itemsReason: string;
  itemsReliability: StockDocumentItemsReliability;
  itemCount: number;
  existingItemCount: number;
  payloadHash: string;
};

export type StockDocumentExistingSnapshot = {
  externalId: number;
  payloadHash: string | null;
  itemCount: number;
};

export type StockDocumentsSyncCounters = {
  documentsReceived: number;
  documentsCreated: number;
  documentsUpdated: number;
  documentsUnchanged: number;
  itemsReplaced: number;
  itemsPreservedDueToPartialPayload: number;
  emptyPayloads: number;
  invalidPayloads: number;
  partialPayloads: number;
  itemsDiscardedByMapper: number;
  duplicateItemsCollapsed: number;
  errors: number;
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

/**
 * Regra final de itens (DS-03.2, sem schema):
 * - complete_with_items → replace (comportamento atual)
 * - complete_empty → replace (documento comprovadamente sem itens)
 * - partial_* → preserve se já houver itens; senão ignore (nada a apagar/escrever)
 * - invalid → ignore (documento não entra no plano de persistência)
 */
export function decideStockDocumentItemsAction(input: {
  reliability: StockDocumentItemsReliability | "invalid";
  existingItemCount: number;
}): StockDocumentItemsDecision {
  if (input.reliability === "invalid") {
    return {
      action: "ignore",
      reason: "INVALID_PAYLOAD",
      reliability: "invalid",
    };
  }

  if (input.reliability === "complete_with_items") {
    return {
      action: "replace",
      reason: "ITEMS_ARRAY_COMPLETE",
      reliability: input.reliability,
    };
  }

  if (input.reliability === "complete_empty") {
    return {
      action: "replace",
      reason: "ITEMS_ARRAY_EXPLICITLY_EMPTY",
      reliability: input.reliability,
    };
  }

  // partial_absent_array | partial_unmapped
  if (input.existingItemCount > 0) {
    return {
      action: "preserve",
      reason: "UNRELIABLE_ITEMS_PAYLOAD_PRESERVE_EXISTING",
      reliability: input.reliability,
    };
  }

  return {
    action: "ignore",
    reason: "UNRELIABLE_ITEMS_PAYLOAD_NO_EXISTING",
    reliability: input.reliability,
  };
}

/**
 * Decisão de cabeçalho via payloadHash (DS-03.4):
 * - sem registro → create/write
 * - hash igual (não vazio) → unchanged (só presença/timestamps no sync)
 * - hash diferente ou legado vazio → update/write
 */
export function decideStockDocumentHeaderAction(input: {
  exists: boolean;
  existingPayloadHash: string | null | undefined;
  incomingPayloadHash: string;
}): {
  action: "create" | "update" | "unchanged";
  headerAction: "write" | "unchanged";
  reason: string;
} {
  if (!input.exists) {
    return { action: "create", headerAction: "write", reason: "HEADER_CREATE" };
  }
  const existingHash = (input.existingPayloadHash ?? "").trim();
  if (
    existingHash.length > 0 &&
    existingHash === input.incomingPayloadHash
  ) {
    return {
      action: "unchanged",
      headerAction: "unchanged",
      reason: "PAYLOAD_HASH_UNCHANGED",
    };
  }
  return {
    action: "update",
    headerAction: "write",
    reason: existingHash.length === 0 ? "HEADER_BACKFILL_HASH" : "PAYLOAD_HASH_CHANGED",
  };
}

/** Plano de escrita idempotente: hash + decisão de itens. */
export function planStockDocumentPersist(
  row: MappedNomusStockDocument,
  existing: StockDocumentExistingSnapshot | null | ReadonlySet<number>,
  existingItemCount = 0
): StockDocumentPersistPlan {
  // Compat: testes legados passam Set<number> de externalIds.
  let snapshot: StockDocumentExistingSnapshot | null = null;
  if (existing instanceof Set) {
    snapshot = existing.has(row.externalId)
      ? {
          externalId: row.externalId,
          payloadHash: null,
          itemCount: existingItemCount,
        }
      : null;
  } else {
    snapshot = existing;
  }

  const headerDecision = decideStockDocumentHeaderAction({
    exists: snapshot != null,
    existingPayloadHash: snapshot?.payloadHash,
    incomingPayloadHash: row.payloadHash,
  });

  const itemCountExisting = snapshot?.itemCount ?? existingItemCount;
  const itemsDecision =
    headerDecision.headerAction === "unchanged"
      ? {
          action: "ignore" as const,
          reason: "HEADER_UNCHANGED_SKIP_ITEMS",
          reliability: row.itemsReliability,
        }
      : decideStockDocumentItemsAction({
          reliability: row.itemsReliability,
          existingItemCount: itemCountExisting,
        });

  return {
    externalId: row.externalId,
    action: headerDecision.action,
    headerAction: headerDecision.headerAction,
    itemsAction: itemsDecision.action,
    itemsReason: itemsDecision.reason,
    itemsReliability: row.itemsReliability,
    itemCount: row.items.length,
    existingItemCount: itemCountExisting,
    payloadHash: row.payloadHash,
  };
}

export function emptyStockDocumentsSyncCounters(): StockDocumentsSyncCounters {
  return {
    documentsReceived: 0,
    documentsCreated: 0,
    documentsUpdated: 0,
    documentsUnchanged: 0,
    itemsReplaced: 0,
    itemsPreservedDueToPartialPayload: 0,
    emptyPayloads: 0,
    invalidPayloads: 0,
    partialPayloads: 0,
    itemsDiscardedByMapper: 0,
    duplicateItemsCollapsed: 0,
    errors: 0,
  };
}

export function summarizeStockDocumentPersistPlans(
  plans: readonly StockDocumentPersistPlan[]
): {
  documentsToCreate: number;
  documentsToUpdate: number;
  documentsUnchanged: number;
  itemsToWrite: number;
  documentsWithoutItems: number;
  itemsToPreserve: number;
  emptyPayloads: number;
  partialPayloads: number;
} {
  return {
    documentsToCreate: plans.filter((p) => p.action === "create").length,
    documentsToUpdate: plans.filter((p) => p.action === "update").length,
    documentsUnchanged: plans.filter((p) => p.action === "unchanged").length,
    itemsToWrite: plans
      .filter((p) => p.itemsAction === "replace")
      .reduce((sum, p) => sum + p.itemCount, 0),
    documentsWithoutItems: plans.filter(
      (p) => p.itemsReliability === "complete_empty"
    ).length,
    itemsToPreserve: plans
      .filter((p) => p.itemsAction === "preserve")
      .reduce((sum, p) => sum + p.existingItemCount, 0),
    emptyPayloads: plans.filter((p) => p.itemsReliability === "complete_empty")
      .length,
    partialPayloads: plans.filter(
      (p) =>
        p.itemsReliability === "partial_absent_array" ||
        p.itemsReliability === "partial_unmapped"
    ).length,
  };
}

/** Preview nunca deve disparar persistência. */
export function shouldWriteStockDocuments(mode: StockDocumentsSyncMode): boolean {
  return mode === "apply";
}

/** Exit code ≠ 0 quando houver erros de persistência ou payloads inválidos. */
export function resolveStockDocumentsSyncExitCode(counters: {
  errors: number;
  invalidPayloads: number;
}): number {
  if (counters.errors > 0 || counters.invalidPayloads > 0) return 1;
  return 0;
}
