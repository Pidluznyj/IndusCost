/**
 * Projeções do motor oficial AR/AP — uma regra financeira, múltiplas projeções.
 *
 * `full` monta dashboard + grids + horizonte.
 * `metrics` reutiliza os mesmos primitives/cards e omite apresentação pesada.
 *
 * O tracker é opt-in (testes / PERF) — custo zero quando não há listener.
 */

export type FinanceOfficialDashboardProjection = "full" | "cards";
export type FinanceOfficialRulesProjection = "full" | "metrics";

export type OfficialEngineKind = "ar" | "ap";

export type OfficialEngineProjectionCall = {
  kind: OfficialEngineKind;
  mode: FinanceOfficialRulesProjection;
  fingerprint: string;
};

export type OfficialEnginePopulationInput = {
  kind: OfficialEngineKind;
  rowExternalIds: number[];
  rowOpenAmounts: number[];
  filters: unknown;
  referenceDate: Date;
  syncCutoff?: { maxSyncedAt?: Date | null; minEligibleSyncedAt?: Date | null } | null;
  year?: number;
  month?: number;
};

const trackers = new Set<OfficialEngineProjectionCall[]>();

export function startOfficialEngineProjectionTracker(): {
  getCalls: () => OfficialEngineProjectionCall[];
  stop: () => OfficialEngineProjectionCall[];
} {
  const calls: OfficialEngineProjectionCall[] = [];
  trackers.add(calls);
  return {
    getCalls: () => [...calls],
    stop: () => {
      trackers.delete(calls);
      return calls;
    },
  };
}

export function noteOfficialEngineProjectionCall(
  build: () => OfficialEngineProjectionCall
): void {
  if (trackers.size === 0) return;
  const call = build();
  for (const tracker of trackers) tracker.push(call);
}

function stableJson(value: unknown): string {
  if (value instanceof Date) return `Date:${value.getTime()}`;
  if (value == null) return String(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(",")}}`;
}

function cutoffKey(
  cutoff?: { maxSyncedAt?: Date | null; minEligibleSyncedAt?: Date | null } | null
): string {
  if (!cutoff) return "null";
  return `${cutoff.maxSyncedAt?.getTime() ?? ""}:${cutoff.minEligibleSyncedAt?.getTime() ?? ""}`;
}

export function fingerprintOfficialEnginePopulation(input: OfficialEnginePopulationInput): string {
  return [
    input.kind,
    input.rowExternalIds.join(","),
    input.rowOpenAmounts.join(","),
    stableJson(input.filters ?? null),
    String(input.referenceDate.getTime()),
    cutoffKey(input.syncCutoff),
    String(input.year ?? ""),
    String(input.month ?? ""),
  ].join("|");
}

export type OfficialEngineReuseInput = {
  rows: readonly unknown[];
  filters?: unknown;
  referenceDate?: Date;
  syncCutoff?: { maxSyncedAt?: Date | null; minEligibleSyncedAt?: Date | null } | null;
  year?: number;
  month?: number;
  horizonSourceRows?: readonly unknown[];
};

function sameOptionalDate(a?: Date, b?: Date): boolean {
  const at = a?.getTime() ?? null;
  const bt = b?.getTime() ?? null;
  return at === bt;
}

/**
 * Reutilização só quando população (mesma referência de array), cutoff, período,
 * filtros e horizonte são semanticamente iguais. Arrays distintos nunca reutilizam
 * só porque os IDs parecem iguais.
 */
export function officialEngineInputsMatch(
  cached: OfficialEngineReuseInput,
  next: OfficialEngineReuseInput
): boolean {
  if (cached.rows !== next.rows) return false;
  if (cached.horizonSourceRows !== next.horizonSourceRows) return false;
  if ((cached.year ?? undefined) !== (next.year ?? undefined)) return false;
  if ((cached.month ?? undefined) !== (next.month ?? undefined)) return false;
  if (!sameOptionalDate(cached.referenceDate, next.referenceDate)) return false;
  if (cutoffKey(cached.syncCutoff) !== cutoffKey(next.syncCutoff)) return false;
  return stableJson(cached.filters ?? null) === stableJson(next.filters ?? null);
}

export function reuseOfficialEngineResultIfSamePopulation<T>(
  cached:
    | {
        input: OfficialEngineReuseInput;
        result: T;
      }
    | null
    | undefined,
  nextInput: OfficialEngineReuseInput
): T | null {
  if (!cached) return null;
  if (!officialEngineInputsMatch(cached.input, nextInput)) return null;
  return cached.result;
}
