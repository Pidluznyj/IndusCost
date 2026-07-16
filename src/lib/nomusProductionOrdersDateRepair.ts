/**
 * Reparo aditivo de datas de OP a partir do rawJson já persistido (OP-14.1).
 * Não consulta Nomus. Não altera rawJson, payloadHash nem timestamps de sync.
 */

import type { MappedNomusProductionOrder } from "@/src/lib/nomusProductionOrdersMapper.js";
import {
  asNomusProductionOrderObject,
  type JsonObject,
} from "@/src/lib/nomusProductionOrdersParsers.js";
import { mapNomusProductionOrderPayload } from "@/src/lib/nomusProductionOrdersMapper.js";

export type ProductionOrderDateFields = {
  openedAt: Date | null;
  releasedAt: Date | null;
  plannedAt: Date | null;
  deliveryAt: Date | null;
  closedAt: Date | null;
  nomusUpdatedAt: Date | null;
};

export const PRODUCTION_ORDER_DATE_FIELD_KEYS = [
  "openedAt",
  "releasedAt",
  "plannedAt",
  "deliveryAt",
  "closedAt",
  "nomusUpdatedAt",
] as const satisfies ReadonlyArray<keyof ProductionOrderDateFields>;

export type ProductionOrderDateFieldKey = (typeof PRODUCTION_ORDER_DATE_FIELD_KEYS)[number];

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.getTime() === b.getTime();
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

export function mapProductionOrderDatesFromRawJson(
  rawJson: unknown
):
  | { ok: true; dates: ProductionOrderDateFields; fieldErrors: Array<{ field: string; error: string }> }
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
    dates: extractMappedProductionOrderDates(mapped.row),
    fieldErrors: mapped.fieldErrors,
  };
}

export function productionOrderDatesNeedRepair(
  current: ProductionOrderDateFields,
  next: ProductionOrderDateFields
): boolean {
  for (const key of PRODUCTION_ORDER_DATE_FIELD_KEYS) {
    if (!sameInstant(current[key], next[key])) return true;
  }
  return false;
}

export function summarizeProductionOrderDateRepairDiff(
  current: ProductionOrderDateFields,
  next: ProductionOrderDateFields
): Partial<Record<ProductionOrderDateFieldKey, { from: string | null; to: string | null }>> {
  const diff: Partial<
    Record<ProductionOrderDateFieldKey, { from: string | null; to: string | null }>
  > = {};
  for (const key of PRODUCTION_ORDER_DATE_FIELD_KEYS) {
    if (sameInstant(current[key], next[key])) continue;
    diff[key] = {
      from: current[key]?.toISOString() ?? null,
      to: next[key]?.toISOString() ?? null,
    };
  }
  return diff;
}

export type ProductionOrderDateRepairCli = {
  mode: "preview" | "apply";
  limit: number | null;
  offset: number;
  externalId: number | null;
  onlyNullDates: boolean;
};

export function parseProductionOrderDateRepairCli(argv: string[]): ProductionOrderDateRepairCli {
  const mode = argv[0] === "apply" ? "apply" : "preview";
  let limit: number | null = null;
  let offset = 0;
  let externalId: number | null = null;
  let onlyNullDates = false;

  for (const arg of argv.slice(1)) {
    if (arg === "--only-null-dates") {
      onlyNullDates = true;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) limit = Math.trunc(n);
      continue;
    }
    if (arg.startsWith("--offset=")) {
      const n = Number(arg.slice("--offset=".length));
      if (Number.isFinite(n) && n >= 0) offset = Math.trunc(n);
      continue;
    }
    if (arg.startsWith("--externalId=")) {
      const n = Number(arg.slice("--externalId=".length));
      if (Number.isFinite(n)) externalId = Math.trunc(n);
    }
  }

  return { mode, limit, offset, externalId, onlyNullDates };
}

export type ProductionOrderDateRepairCounters = {
  scanned: number;
  wouldUpdate: number;
  updated: number;
  unchanged: number;
  skippedInvalid: number;
  errors: number;
};

export function emptyProductionOrderDateRepairCounters(): ProductionOrderDateRepairCounters {
  return {
    scanned: 0,
    wouldUpdate: 0,
    updated: 0,
    unchanged: 0,
    skippedInvalid: 0,
    errors: 0,
  };
}
