/**
 * Lifecycle puro do sync de Documentos de Saída (DS-03.5).
 * Sem I/O de banco/Nomus — testável unitariamente.
 */

import type {
  StockDocumentsSyncCounters,
  StockDocumentsSyncCliOptions,
  StockDocumentsSyncMode,
} from "./nomusStockDocumentsSyncLogic.js";
import { emptyStockDocumentsSyncCounters } from "./nomusStockDocumentsSyncLogic.js";
import {
  NOMUS_STOCK_DOCUMENTS_INCREMENTAL_LOOKBACK_DAYS,
  NOMUS_STOCK_DOCUMENTS_INCREMENTAL_OVERLAP_DAYS,
} from "./nomusStockDocumentsSyncConstants.js";

export type StockDocumentsSyncRunCompleteness =
  | "complete"
  | "partial"
  | "failed"
  | "lock_skipped";

export type StockDocumentsSyncCheckpoint = {
  version: 1;
  mode: StockDocumentsSyncMode;
  from: string | null;
  to: string | null;
  idNfes: number[];
  tipo: string;
  completedAt: string;
  documentsReceived: number;
  documentsCreated: number;
  documentsUpdated: number;
  documentsUnchanged: number;
};

export type StockDocumentsSyncAuditRecord = {
  mode: StockDocumentsSyncMode;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number;
  completeness: StockDocumentsSyncRunCompleteness;
  lockAcquired: boolean;
  lockSkipped: boolean;
  checkpointAdvanced: boolean;
  markAbsentApplied: boolean;
  rateLimit429: number;
  counters: StockDocumentsSyncCounters;
  options: {
    from: string | null;
    to: string | null;
    tipo: string;
    pageSize: number;
    maxPages: number | null;
    idNfes: number[];
  };
  errorMessage: string | null;
};

/** Presence: nunca marcar ausência em execução parcial/falha/lock skip. */
export function shouldMarkStockDocumentsAbsent(input: {
  mode: StockDocumentsSyncMode;
  completeness: StockDocumentsSyncRunCompleteness;
}): boolean {
  void input;
  // Sync é por janela/idNfe — mark-absent global seria falso-positivo.
  return false;
}

export function classifyStockDocumentsSyncCompleteness(input: {
  lockSkipped?: boolean;
  fetchComplete: boolean;
  errors: number;
  fatalError?: boolean;
}): StockDocumentsSyncRunCompleteness {
  if (input.lockSkipped) return "lock_skipped";
  if (input.fatalError || input.errors > 0) return "failed";
  if (!input.fetchComplete) return "partial";
  return "complete";
}

/** Checkpoint só avança em apply completo com exit 0. */
export function shouldAdvanceStockDocumentsCheckpoint(input: {
  mode: StockDocumentsSyncMode;
  completeness: StockDocumentsSyncRunCompleteness;
  exitCode: number;
}): boolean {
  return (
    input.mode === "apply" &&
    input.completeness === "complete" &&
    input.exitCode === 0
  );
}

/**
 * Quando hash é igual: só presença + syncedAt (nunca reescreve cabeçalho/itens).
 */
export function buildStockDocumentPresenceOnlyUpdate(syncedAt: Date): {
  syncedAt: Date;
  lastSeenAt: Date;
  presentInLastPayload: true;
} {
  return {
    syncedAt,
    lastSeenAt: syncedAt,
    presentInLastPayload: true,
  };
}

export function buildStockDocumentsCheckpoint(input: {
  mode: StockDocumentsSyncMode;
  options: StockDocumentsSyncCliOptions;
  counters: StockDocumentsSyncCounters;
  completedAt: Date;
}): StockDocumentsSyncCheckpoint {
  return {
    version: 1,
    mode: input.mode,
    from: input.options.from,
    to: input.options.to,
    idNfes: [...input.options.idNfes],
    tipo: input.options.tipo,
    completedAt: input.completedAt.toISOString(),
    documentsReceived: input.counters.documentsReceived,
    documentsCreated: input.counters.documentsCreated,
    documentsUpdated: input.counters.documentsUpdated,
    documentsUnchanged: input.counters.documentsUnchanged,
  };
}

export function parseStockDocumentsCheckpoint(
  raw: string | null | undefined
): StockDocumentsSyncCheckpoint | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StockDocumentsSyncCheckpoint>;
    if (parsed.version !== 1) return null;
    if (parsed.mode !== "preview" && parsed.mode !== "apply") return null;
    return {
      version: 1,
      mode: parsed.mode,
      from: typeof parsed.from === "string" ? parsed.from : null,
      to: typeof parsed.to === "string" ? parsed.to : null,
      idNfes: Array.isArray(parsed.idNfes)
        ? parsed.idNfes.filter((n): n is number => typeof n === "number")
        : [],
      tipo: typeof parsed.tipo === "string" ? parsed.tipo : "DocumentoSaida",
      completedAt:
        typeof parsed.completedAt === "string" ? parsed.completedAt : "",
      documentsReceived: Number(parsed.documentsReceived) || 0,
      documentsCreated: Number(parsed.documentsCreated) || 0,
      documentsUpdated: Number(parsed.documentsUpdated) || 0,
      documentsUnchanged: Number(parsed.documentsUnchanged) || 0,
    };
  } catch {
    return null;
  }
}

export function serializeStockDocumentsCheckpoint(
  checkpoint: StockDocumentsSyncCheckpoint
): string {
  return `${JSON.stringify(checkpoint, null, 2)}\n`;
}

function toIsoDateOnlyUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseIsoDateOnlyUtc(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Janela incremental a partir do checkpoint (ou lookback inicial).
 * Nunca é backfill amplo — só overlap curto + até hoje.
 */
export function computeStockDocumentsIncrementalWindow(input: {
  checkpointTo?: string | null;
  now?: Date;
  overlapDays?: number;
  lookbackDays?: number;
}): { from: string; to: string; source: "checkpoint_overlap" | "initial_lookback" } {
  const now = input.now ?? new Date();
  const to = toIsoDateOnlyUtc(now);
  const overlapDays =
    input.overlapDays ?? NOMUS_STOCK_DOCUMENTS_INCREMENTAL_OVERLAP_DAYS;
  const lookbackDays =
    input.lookbackDays ?? NOMUS_STOCK_DOCUMENTS_INCREMENTAL_LOOKBACK_DAYS;

  const checkpointDate = input.checkpointTo
    ? parseIsoDateOnlyUtc(input.checkpointTo)
    : null;
  if (checkpointDate) {
    const fromDate = addUtcDays(checkpointDate, -Math.max(0, overlapDays));
    let from = toIsoDateOnlyUtc(fromDate);
    if (from > to) from = to;
    return { from, to, source: "checkpoint_overlap" };
  }

  const fromDate = addUtcDays(now, -Math.max(1, lookbackDays));
  return {
    from: toIsoDateOnlyUtc(fromDate),
    to,
    source: "initial_lookback",
  };
}

export function buildStockDocumentsSyncAuditRecord(input: {
  mode: StockDocumentsSyncMode;
  options: StockDocumentsSyncCliOptions;
  startedAt: Date;
  finishedAt: Date;
  exitCode: number;
  completeness: StockDocumentsSyncRunCompleteness;
  lockAcquired: boolean;
  lockSkipped: boolean;
  checkpointAdvanced: boolean;
  rateLimit429: number;
  counters?: StockDocumentsSyncCounters;
  errorMessage?: string | null;
}): StockDocumentsSyncAuditRecord {
  return {
    mode: input.mode,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    durationMs: Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime()),
    exitCode: input.exitCode,
    completeness: input.completeness,
    lockAcquired: input.lockAcquired,
    lockSkipped: input.lockSkipped,
    checkpointAdvanced: input.checkpointAdvanced,
    markAbsentApplied: shouldMarkStockDocumentsAbsent({
      mode: input.mode,
      completeness: input.completeness,
    }),
    rateLimit429: input.rateLimit429,
    counters: input.counters ?? emptyStockDocumentsSyncCounters(),
    options: {
      from: input.options.from,
      to: input.options.to,
      tipo: input.options.tipo,
      pageSize: input.options.pageSize,
      maxPages: input.options.maxPages,
      idNfes: [...input.options.idNfes],
    },
    errorMessage: input.errorMessage ?? null,
  };
}

export function resolveStockDocumentsLifecycleExitCode(input: {
  lockSkipped: boolean;
  completeness: StockDocumentsSyncRunCompleteness;
  errors: number;
  invalidPayloads: number;
}): number {
  if (input.lockSkipped) return 0; // overlap skip — não é falha operacional
  if (input.completeness === "failed") return 1;
  if (input.errors > 0 || input.invalidPayloads > 0) return 1;
  if (input.completeness === "partial") return 1;
  return 0;
}
