/**
 * DS-03.6 — Reparo aditivo do cabeçalho normalizado de NomusStockDocument
 * a partir exclusivamente do rawJson já armazenado.
 *
 * Não consulta Nomus. Não apaga dados. Não altera itens, vínculos, IDs nem rawJson.
 */

import { Prisma } from "@prisma/client";
import { asString, parseNomusBrDateTime } from "@/src/lib/nomusAccountsReceivableParser.js";
import {
  mapNomusStockDocumentPayload,
  type JsonObject,
  type NormalizedStockDocumentHeader,
} from "@/src/lib/nomusStockDocumentsMapper.js";

/** Campos normalizados que o reparo pode preencher (nunca rawJson / itens / IDs). */
export type StockDocumentRepairableFields = {
  documentNumber: string | null;
  statusRaw: string | null;
  isCancelled: boolean;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  totalValue: Prisma.Decimal | null;
  personExternalId: number | null;
  personName: string | null;
  companyExternalId: number | null;
  companyName: string | null;
  movementDate: Date | null;
  paymentTermsRaw: string | null;
  payloadHash: string;
};

export const STOCK_DOCUMENT_REPAIRABLE_KEYS = [
  "documentNumber",
  "statusRaw",
  "isCancelled",
  "cancelledAt",
  "cancellationReason",
  "totalValue",
  "personExternalId",
  "personName",
  "companyExternalId",
  "companyName",
  "movementDate",
  "paymentTermsRaw",
  "payloadHash",
] as const satisfies ReadonlyArray<keyof StockDocumentRepairableFields>;

export type StockDocumentRepairableKey =
  (typeof STOCK_DOCUMENT_REPAIRABLE_KEYS)[number];

export type StockDocumentRepairFieldError = {
  field: string;
  error: string;
  rawValue: string | null;
};

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.getTime() === b.getTime();
}

function sameString(a: string | null, b: string | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a === b;
}

function sameInt(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a === b;
}

export function sameDecimal(
  a: Prisma.Decimal | null,
  b: Prisma.Decimal | null
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.equals(b);
}

function isEmptyPayloadHash(hash: string | null | undefined): boolean {
  return hash == null || hash.trim() === "";
}

function isFieldEmpty(
  key: StockDocumentRepairableKey,
  current: StockDocumentRepairableFields
): boolean {
  if (key === "isCancelled") return current.isCancelled === false;
  if (key === "payloadHash") return isEmptyPayloadHash(current.payloadHash);
  if (key === "totalValue") return current.totalValue == null;
  const value = current[key];
  return value == null;
}

function hasNextValue(
  key: StockDocumentRepairableKey,
  next: StockDocumentRepairableFields
): boolean {
  if (key === "isCancelled") return next.isCancelled === true;
  if (key === "payloadHash") return !isEmptyPayloadHash(next.payloadHash);
  if (key === "totalValue") return next.totalValue != null;
  return next[key] != null;
}

function fieldEquals(
  key: StockDocumentRepairableKey,
  current: StockDocumentRepairableFields,
  next: StockDocumentRepairableFields
): boolean {
  switch (key) {
    case "isCancelled":
      return current.isCancelled === next.isCancelled;
    case "cancelledAt":
    case "movementDate":
      return sameInstant(current[key], next[key]);
    case "totalValue":
      return sameDecimal(current.totalValue, next.totalValue);
    case "personExternalId":
    case "companyExternalId":
      return sameInt(current[key], next[key]);
    default:
      return sameString(current[key] as string | null, next[key] as string | null);
  }
}

function serializeFieldValue(
  key: StockDocumentRepairableKey,
  fields: StockDocumentRepairableFields
): string | number | boolean | null {
  const value = fields[key];
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  return value;
}

/**
 * Detecta datas presentes no raw mas inválidas (não inventa; só registra).
 */
export function collectStockDocumentInvalidDateFields(
  raw: JsonObject
): StockDocumentRepairFieldError[] {
  const errors: StockDocumentRepairFieldError[] = [];

  const cancelledRaw =
    raw.dataCancelamento ?? raw.dataHoraCancelamento ?? raw.cancelledAt;
  if (cancelledRaw != null && String(cancelledRaw).trim() !== "") {
    if (parseNomusBrDateTime(cancelledRaw) == null) {
      errors.push({
        field: "cancelledAt",
        error: "INVALID_DATE",
        rawValue: asString(cancelledRaw),
      });
    }
  }

  const movementRaw = raw.dataMovimentacao ?? raw.dataMov ?? raw.movementDate;
  if (movementRaw != null && String(movementRaw).trim() !== "") {
    if (parseNomusBrDateTime(movementRaw) == null) {
      errors.push({
        field: "movementDate",
        error: "INVALID_DATE",
        rawValue: asString(movementRaw),
      });
    }
  }

  return errors;
}

export function extractRepairableFromHeader(
  header: Pick<NormalizedStockDocumentHeader, StockDocumentRepairableKey>
): StockDocumentRepairableFields {
  return {
    documentNumber: header.documentNumber,
    statusRaw: header.statusRaw,
    isCancelled: header.isCancelled,
    cancelledAt: header.cancelledAt,
    cancellationReason: header.cancellationReason,
    totalValue: header.totalValue,
    personExternalId: header.personExternalId,
    personName: header.personName,
    companyExternalId: header.companyExternalId,
    companyName: header.companyName,
    movementDate: header.movementDate,
    paymentTermsRaw: header.paymentTermsRaw,
    payloadHash: header.payloadHash,
  };
}

export function mapStockDocumentRepairFieldsFromRawJson(
  rawJson: unknown
):
  | {
      ok: true;
      fields: StockDocumentRepairableFields;
      fieldErrors: StockDocumentRepairFieldError[];
      absentKeys: StockDocumentRepairableKey[];
      totalValueSource: "raw" | "items_sum" | null;
    }
  | { ok: false; reasons: string[] } {
  const obj = asObject(rawJson);
  if (!obj) {
    return { ok: false, reasons: ["INVALID_RAW_JSON"] };
  }

  const mapped = mapNomusStockDocumentPayload(obj);
  if (!mapped.ok) {
    return { ok: false, reasons: mapped.reasons };
  }

  const fields = extractRepairableFromHeader(mapped.row);
  const fieldErrors = collectStockDocumentInvalidDateFields(obj);
  const absentKeys = STOCK_DOCUMENT_REPAIRABLE_KEYS.filter((key) => {
    if (key === "isCancelled") return false;
    if (key === "payloadHash") return isEmptyPayloadHash(fields.payloadHash);
    return !hasNextValue(key, fields);
  });

  return {
    ok: true,
    fields,
    fieldErrors,
    absentKeys,
    totalValueSource: mapped.row.totalValueSource,
  };
}

/**
 * Diff fill-only: nunca limpa campo existente com null do raw parcial.
 * Com onlyNull, só preenche campos atualmente vazios.
 */
export function buildStockDocumentRepairPatch(
  current: StockDocumentRepairableFields,
  next: StockDocumentRepairableFields,
  options?: { onlyNull?: boolean }
): Partial<StockDocumentRepairableFields> {
  const onlyNull = options?.onlyNull ?? false;
  const patch: Partial<StockDocumentRepairableFields> = {};

  for (const key of STOCK_DOCUMENT_REPAIRABLE_KEYS) {
    if (key === "isCancelled") {
      if (current.isCancelled === next.isCancelled) continue;
      if (onlyNull && !(current.isCancelled === false && next.isCancelled === true)) {
        continue;
      }
      patch.isCancelled = next.isCancelled;
      continue;
    }

    // Ausente no raw → não inventa e não limpa valor já persistido.
    if (!hasNextValue(key, next)) continue;
    if (fieldEquals(key, current, next)) continue;
    if (onlyNull && !isFieldEmpty(key, current)) continue;

    (patch as Record<string, unknown>)[key] = next[key];
  }

  return patch;
}

export function stockDocumentNeedsRepair(
  current: StockDocumentRepairableFields,
  next: StockDocumentRepairableFields,
  options?: { onlyNull?: boolean }
): boolean {
  return Object.keys(buildStockDocumentRepairPatch(current, next, options)).length > 0;
}

export function summarizeStockDocumentRepairDiff(
  current: StockDocumentRepairableFields,
  patch: Partial<StockDocumentRepairableFields>
): Partial<
  Record<
    StockDocumentRepairableKey,
    { from: string | number | boolean | null; to: string | number | boolean | null }
  >
> {
  const diff: Partial<
    Record<
      StockDocumentRepairableKey,
      { from: string | number | boolean | null; to: string | number | boolean | null }
    >
  > = {};
  for (const key of STOCK_DOCUMENT_REPAIRABLE_KEYS) {
    if (!(key in patch)) continue;
    const merged = { ...current, ...patch };
    diff[key] = {
      from: serializeFieldValue(key, current),
      to: serializeFieldValue(key, merged),
    };
  }
  return diff;
}

export function countStockDocumentFieldsToFill(
  patch: Partial<StockDocumentRepairableFields>
): Record<StockDocumentRepairableKey, number> {
  const counts = emptyStockDocumentFieldFillCounters();
  for (const key of STOCK_DOCUMENT_REPAIRABLE_KEYS) {
    if (key in patch) counts[key] = 1;
  }
  return counts;
}

export type StockDocumentRepairCli = {
  mode: "preview" | "apply";
  limit: number | null;
  batchSize: number;
  afterExternalId: number | null;
  externalId: number | null;
  onlyNull: boolean;
  checkpointFile: string | null;
};

export const NOMUS_STOCK_DOCUMENTS_REPAIR_CHECKPOINT_ENV =
  "NOMUS_STOCK_DOCUMENTS_REPAIR_CHECKPOINT_FILE";

export const NOMUS_STOCK_DOCUMENTS_REPAIR_DEFAULT_BATCH_SIZE = 200;

export function parseStockDocumentRepairCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): StockDocumentRepairCli {
  const mode = argv.includes("apply") || argv[0] === "apply" ? "apply" : "preview";
  let limit: number | null = null;
  let batchSize = NOMUS_STOCK_DOCUMENTS_REPAIR_DEFAULT_BATCH_SIZE;
  let afterExternalId: number | null = null;
  let externalId: number | null = null;
  let onlyNull = false;
  let checkpointFile: string | null =
    (env[NOMUS_STOCK_DOCUMENTS_REPAIR_CHECKPOINT_ENV] ?? "").trim() || null;

  for (const arg of argv) {
    if (arg === "preview" || arg === "apply") continue;
    if (arg === "--only-null" || arg === "--only-null-fields") {
      onlyNull = true;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) limit = Math.trunc(n);
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      const n = Number(arg.slice("--batch-size=".length));
      if (Number.isFinite(n) && n > 0) batchSize = Math.trunc(n);
      continue;
    }
    if (arg.startsWith("--after-externalId=") || arg.startsWith("--afterExternalId=")) {
      const raw = arg.includes("after-externalId=")
        ? arg.slice("--after-externalId=".length)
        : arg.slice("--afterExternalId=".length);
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) afterExternalId = Math.trunc(n);
      continue;
    }
    if (arg.startsWith("--externalId=")) {
      const n = Number(arg.slice("--externalId=".length));
      if (Number.isFinite(n)) externalId = Math.trunc(n);
      continue;
    }
    if (arg.startsWith("--checkpoint-file=")) {
      checkpointFile = arg.slice("--checkpoint-file=".length).trim() || null;
    }
  }

  return {
    mode,
    limit,
    batchSize,
    afterExternalId,
    externalId,
    onlyNull,
    checkpointFile,
  };
}

export type StockDocumentRepairFieldFillCounters = Record<
  StockDocumentRepairableKey,
  number
>;

export type StockDocumentRepairCounters = {
  scanned: number;
  wouldUpdate: number;
  updated: number;
  unchanged: number;
  skippedInvalid: number;
  invalidDates: number;
  absentFields: number;
  errors: number;
  fieldsToFill: StockDocumentRepairFieldFillCounters;
  fieldsFilled: StockDocumentRepairFieldFillCounters;
};

export function emptyStockDocumentFieldFillCounters(): StockDocumentRepairFieldFillCounters {
  return {
    documentNumber: 0,
    statusRaw: 0,
    isCancelled: 0,
    cancelledAt: 0,
    cancellationReason: 0,
    totalValue: 0,
    personExternalId: 0,
    personName: 0,
    companyExternalId: 0,
    companyName: 0,
    movementDate: 0,
    paymentTermsRaw: 0,
    payloadHash: 0,
  };
}

export function emptyStockDocumentRepairCounters(): StockDocumentRepairCounters {
  return {
    scanned: 0,
    wouldUpdate: 0,
    updated: 0,
    unchanged: 0,
    skippedInvalid: 0,
    invalidDates: 0,
    absentFields: 0,
    errors: 0,
    fieldsToFill: emptyStockDocumentFieldFillCounters(),
    fieldsFilled: emptyStockDocumentFieldFillCounters(),
  };
}

export type StockDocumentRepairCheckpoint = {
  version: 1;
  lastProcessedExternalId: number;
  updatedAt: string;
  mode: "preview" | "apply";
};

export function parseStockDocumentRepairCheckpoint(
  raw: string | null | undefined
): StockDocumentRepairCheckpoint | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<StockDocumentRepairCheckpoint>;
    if (parsed.version !== 1) return null;
    if (typeof parsed.lastProcessedExternalId !== "number") return null;
    return {
      version: 1,
      lastProcessedExternalId: parsed.lastProcessedExternalId,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date(0).toISOString(),
      mode: parsed.mode === "apply" ? "apply" : "preview",
    };
  } catch {
    return null;
  }
}

export function serializeStockDocumentRepairCheckpoint(
  checkpoint: StockDocumentRepairCheckpoint
): string {
  return `${JSON.stringify(checkpoint, null, 2)}\n`;
}

export function hasRepairableFieldsEmpty(
  fields: StockDocumentRepairableFields
): boolean {
  return STOCK_DOCUMENT_REPAIRABLE_KEYS.some((key) => isFieldEmpty(key, fields));
}
