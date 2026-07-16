/**
 * Reparo aditivo de datas + empresa de OP a partir do rawJson (OP-14.1).
 * Não consulta Nomus. Não altera closedAt, rawJson, payloadHash nem timestamps de sync.
 */

import type { MappedNomusProductionOrder } from "@/src/lib/nomusProductionOrdersMapper.js";
import {
  asNomusProductionOrderObject,
  type JsonObject,
} from "@/src/lib/nomusProductionOrdersParsers.js";
import { mapNomusProductionOrderPayload } from "@/src/lib/nomusProductionOrdersMapper.js";

/** Campos que o reparo pode atualizar (closedAt fica de fora). */
export type ProductionOrderRepairableDateFields = {
  openedAt: Date | null;
  releasedAt: Date | null;
  plannedAt: Date | null;
  deliveryAt: Date | null;
  nomusUpdatedAt: Date | null;
};

export type ProductionOrderRepairableCompanyFields = {
  externalCompanyId: number | null;
  companyName: string | null;
};

export type ProductionOrderRepairableFields = ProductionOrderRepairableDateFields &
  ProductionOrderRepairableCompanyFields;

export type ProductionOrderDateFields = ProductionOrderRepairableDateFields & {
  closedAt: Date | null;
};

export const PRODUCTION_ORDER_REPAIRABLE_DATE_KEYS = [
  "openedAt",
  "releasedAt",
  "plannedAt",
  "deliveryAt",
  "nomusUpdatedAt",
] as const satisfies ReadonlyArray<keyof ProductionOrderRepairableDateFields>;

export const PRODUCTION_ORDER_REPAIRABLE_COMPANY_KEYS = [
  "externalCompanyId",
  "companyName",
] as const satisfies ReadonlyArray<keyof ProductionOrderRepairableCompanyFields>;

export const PRODUCTION_ORDER_REPAIRABLE_KEYS = [
  ...PRODUCTION_ORDER_REPAIRABLE_DATE_KEYS,
  ...PRODUCTION_ORDER_REPAIRABLE_COMPANY_KEYS,
] as const;

export type ProductionOrderRepairableDateKey =
  (typeof PRODUCTION_ORDER_REPAIRABLE_DATE_KEYS)[number];

export type ProductionOrderRepairableCompanyKey =
  (typeof PRODUCTION_ORDER_REPAIRABLE_COMPANY_KEYS)[number];

export type ProductionOrderRepairableKey =
  (typeof PRODUCTION_ORDER_REPAIRABLE_KEYS)[number];

/** @deprecated Prefer PRODUCTION_ORDER_REPAIRABLE_DATE_KEYS — closedAt não entra no reparo. */
export const PRODUCTION_ORDER_DATE_FIELD_KEYS = [
  ...PRODUCTION_ORDER_REPAIRABLE_DATE_KEYS,
  "closedAt",
] as const;

export type ProductionOrderDateFieldKey = (typeof PRODUCTION_ORDER_DATE_FIELD_KEYS)[number];

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.getTime() === b.getTime();
}

function sameCompanyValue(
  a: string | number | null,
  b: string | number | null
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a === b;
}

export function extractMappedProductionOrderDates(
  mapped: Pick<MappedNomusProductionOrder, ProductionOrderDateFieldKey>
): ProductionOrderDateFields {
  return {
    openedAt: mapped.openedAt,
    releasedAt: mapped.releasedAt,
    plannedAt: mapped.plannedAt,
    deliveryAt: mapped.deliveryAt,
    closedAt: mapped.closedAt,
    nomusUpdatedAt: mapped.nomusUpdatedAt,
  };
}

export function extractRepairableDates(
  dates: ProductionOrderDateFields
): ProductionOrderRepairableDateFields {
  return {
    openedAt: dates.openedAt,
    releasedAt: dates.releasedAt,
    plannedAt: dates.plannedAt,
    deliveryAt: dates.deliveryAt,
    nomusUpdatedAt: dates.nomusUpdatedAt,
  };
}

export function extractRepairableFields(
  mapped: Pick<
    MappedNomusProductionOrder,
    ProductionOrderRepairableKey | "closedAt"
  >
): ProductionOrderRepairableFields {
  return {
    openedAt: mapped.openedAt,
    releasedAt: mapped.releasedAt,
    plannedAt: mapped.plannedAt,
    deliveryAt: mapped.deliveryAt,
    nomusUpdatedAt: mapped.nomusUpdatedAt,
    externalCompanyId: mapped.externalCompanyId,
    companyName: mapped.companyName,
  };
}

export function mapProductionOrderDatesFromRawJson(
  rawJson: unknown
):
  | { ok: true; dates: ProductionOrderDateFields; fieldErrors: Array<{ field: string; error: string }> }
  | { ok: false; reasons: string[] } {
  const mapped = mapProductionOrderRepairFieldsFromRawJson(rawJson);
  if (!mapped.ok) return mapped;
  return {
    ok: true,
    dates: {
      ...extractRepairableDates(mapped.fields),
      closedAt: mapped.closedAt,
    },
    fieldErrors: mapped.fieldErrors,
  };
}

export function mapProductionOrderRepairFieldsFromRawJson(
  rawJson: unknown
):
  | {
      ok: true;
      fields: ProductionOrderRepairableFields;
      closedAt: Date | null;
      fieldErrors: Array<{ field: string; error: string }>;
    }
  | { ok: false; reasons: string[] } {
  const obj = asNomusProductionOrderObject(rawJson);
  if (!obj) {
    return { ok: false, reasons: ["INVALID_RAW_JSON"] };
  }
  const mapped = mapNomusProductionOrderPayload(obj as JsonObject);
  if (!mapped.ok) {
    return { ok: false, reasons: mapped.reasons };
  }
  return {
    ok: true,
    fields: extractRepairableFields(mapped.row),
    closedAt: mapped.row.closedAt,
    fieldErrors: mapped.fieldErrors,
  };
}

export function productionOrderDatesNeedRepair(
  current: ProductionOrderRepairableDateFields,
  next: ProductionOrderRepairableDateFields
): boolean {
  for (const key of PRODUCTION_ORDER_REPAIRABLE_DATE_KEYS) {
    if (!sameInstant(current[key], next[key])) return true;
  }
  return false;
}

export function productionOrderFieldsNeedRepair(
  current: ProductionOrderRepairableFields,
  next: ProductionOrderRepairableFields
): boolean {
  if (productionOrderDatesNeedRepair(current, next)) return true;
  if (!sameCompanyValue(current.externalCompanyId, next.externalCompanyId)) return true;
  if (!sameCompanyValue(current.companyName, next.companyName)) return true;
  return false;
}

export function summarizeProductionOrderDateRepairDiff(
  current: ProductionOrderRepairableDateFields,
  next: ProductionOrderRepairableDateFields
): Partial<
  Record<ProductionOrderRepairableDateKey, { from: string | null; to: string | null }>
> {
  const diff: Partial<
    Record<ProductionOrderRepairableDateKey, { from: string | null; to: string | null }>
  > = {};
  for (const key of PRODUCTION_ORDER_REPAIRABLE_DATE_KEYS) {
    if (sameInstant(current[key], next[key])) continue;
    diff[key] = {
      from: current[key]?.toISOString() ?? null,
      to: next[key]?.toISOString() ?? null,
    };
  }
  return diff;
}

export function summarizeProductionOrderRepairDiff(
  current: ProductionOrderRepairableFields,
  next: ProductionOrderRepairableFields
): Partial<
  Record<
    ProductionOrderRepairableKey,
    { from: string | number | null; to: string | number | null }
  >
> {
  const diff: Partial<
    Record<
      ProductionOrderRepairableKey,
      { from: string | number | null; to: string | number | null }
    >
  > = {
    ...summarizeProductionOrderDateRepairDiff(current, next),
  };
  if (!sameCompanyValue(current.externalCompanyId, next.externalCompanyId)) {
    diff.externalCompanyId = {
      from: current.externalCompanyId,
      to: next.externalCompanyId,
    };
  }
  if (!sameCompanyValue(current.companyName, next.companyName)) {
    diff.companyName = {
      from: current.companyName,
      to: next.companyName,
    };
  }
  return diff;
}

export function countFieldsToFill(
  current: ProductionOrderRepairableDateFields,
  next: ProductionOrderRepairableDateFields
): Record<ProductionOrderRepairableDateKey, number> {
  const counts = {
    openedAt: 0,
    releasedAt: 0,
    plannedAt: 0,
    deliveryAt: 0,
    nomusUpdatedAt: 0,
  } satisfies Record<ProductionOrderRepairableDateKey, number>;
  for (const key of PRODUCTION_ORDER_REPAIRABLE_DATE_KEYS) {
    if (current[key] == null && next[key] != null) counts[key] = 1;
  }
  return counts;
}

export function countRepairFieldsToFill(
  current: ProductionOrderRepairableFields,
  next: ProductionOrderRepairableFields
): Record<ProductionOrderRepairableKey, number> {
  return {
    ...countFieldsToFill(current, next),
    externalCompanyId:
      current.externalCompanyId == null && next.externalCompanyId != null ? 1 : 0,
    companyName: current.companyName == null && next.companyName != null ? 1 : 0,
  };
}

export type ProductionOrderDateRepairCli = {
  mode: "preview" | "apply";
  limit: number | null;
  batchSize: number;
  /** Retomada: processar externalId > afterExternalId */
  afterExternalId: number | null;
  externalId: number | null;
  onlyNullDates: boolean;
  checkpointFile: string | null;
};

export const NOMUS_PRODUCTION_ORDERS_DATE_REPAIR_CHECKPOINT_ENV =
  "NOMUS_PRODUCTION_ORDERS_DATE_REPAIR_CHECKPOINT_FILE";

export const NOMUS_PRODUCTION_ORDERS_DATE_REPAIR_DEFAULT_BATCH_SIZE = 200;

export function parseProductionOrderDateRepairCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): ProductionOrderDateRepairCli {
  const mode = argv.includes("apply") || argv[0] === "apply" ? "apply" : "preview";
  let limit: number | null = null;
  let batchSize = NOMUS_PRODUCTION_ORDERS_DATE_REPAIR_DEFAULT_BATCH_SIZE;
  let afterExternalId: number | null = null;
  let externalId: number | null = null;
  let onlyNullDates = false;
  let checkpointFile: string | null =
    (env[NOMUS_PRODUCTION_ORDERS_DATE_REPAIR_CHECKPOINT_ENV] ?? "").trim() || null;

  for (const arg of argv) {
    if (arg === "preview" || arg === "apply") continue;
    if (arg === "--only-null-dates" || arg === "--only-null") {
      onlyNullDates = true;
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
    if (arg.startsWith("--offset=")) {
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
    onlyNullDates,
    checkpointFile,
  };
}

export type ProductionOrderDateRepairFieldFillCounters = Record<
  ProductionOrderRepairableKey,
  number
>;

export type ProductionOrderDateRepairCounters = {
  scanned: number;
  wouldUpdate: number;
  updated: number;
  unchanged: number;
  skippedInvalid: number;
  invalidDates: number;
  errors: number;
  fieldsToFill: ProductionOrderDateRepairFieldFillCounters;
  fieldsFilled: ProductionOrderDateRepairFieldFillCounters;
};

export function emptyFieldFillCounters(): ProductionOrderDateRepairFieldFillCounters {
  return {
    openedAt: 0,
    releasedAt: 0,
    plannedAt: 0,
    deliveryAt: 0,
    nomusUpdatedAt: 0,
    externalCompanyId: 0,
    companyName: 0,
  };
}

export function emptyProductionOrderDateRepairCounters(): ProductionOrderDateRepairCounters {
  return {
    scanned: 0,
    wouldUpdate: 0,
    updated: 0,
    unchanged: 0,
    skippedInvalid: 0,
    invalidDates: 0,
    errors: 0,
    fieldsToFill: emptyFieldFillCounters(),
    fieldsFilled: emptyFieldFillCounters(),
  };
}

export type ProductionOrderDateRepairCheckpoint = {
  version: 1;
  lastProcessedExternalId: number;
  updatedAt: string;
  mode: "preview" | "apply";
};

export function parseProductionOrderDateRepairCheckpoint(
  raw: string | null | undefined
): ProductionOrderDateRepairCheckpoint | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<ProductionOrderDateRepairCheckpoint>;
    if (parsed.version !== 1) return null;
    if (typeof parsed.lastProcessedExternalId !== "number") return null;
    return {
      version: 1,
      lastProcessedExternalId: parsed.lastProcessedExternalId,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      mode: parsed.mode === "apply" ? "apply" : "preview",
    };
  } catch {
    return null;
  }
}

export function serializeProductionOrderDateRepairCheckpoint(
  checkpoint: ProductionOrderDateRepairCheckpoint
): string {
  return `${JSON.stringify(checkpoint, null, 2)}\n`;
}

export function hasRepairableDatesNull(dates: ProductionOrderRepairableDateFields): boolean {
  return PRODUCTION_ORDER_REPAIRABLE_DATE_KEYS.every((key) => dates[key] == null);
}

/** True se algum campo reparável (data ou empresa) ainda está nulo. */
export function hasRepairableFieldsNull(fields: ProductionOrderRepairableFields): boolean {
  return PRODUCTION_ORDER_REPAIRABLE_KEYS.some((key) => fields[key] == null);
}
