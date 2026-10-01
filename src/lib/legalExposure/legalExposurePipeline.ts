/**
 * Agregação entity-scoped: DJEN multi-termo + DataJud known-process.
 * Sem chamada concorrente.
 */

import type {
  LegalQueryOutcome,
  NormalizedCaseObservation,
  NormalizedSourceBatch,
} from "./legalExposureContracts.js";
import type { DjenDiscoveryTrust } from "./legalExposureDiscovery.js";
import { canonicalProcessKey, normalizeProcessNumber } from "./legalExposureNormalization.js";
import type { ExposureCaseRecord, LegalExposureMemory } from "./legalExposureStore.js";

export type DatajudTarget = {
  processNumber: string;
  tribunalAlias: string;
  origin: "DJEN" | "KNOWN_CASE";
};

export type EntitySyncCounters = {
  discoveryTermsConsulted: string[];
  djenQueries: number;
  uniqueProcessesDiscovered: number;
  knownProcessesRefreshed: number;
  datajudTargets: number;
  successfulSources: number;
  noResultSources: number;
  rateLimitedSources: number;
  failedSources: number;
};

export function datajudTribunalAlias(value: string | null | undefined): string | null {
  const alias = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  return alias || null;
}

export function collectDatajudTargetsFromBatch(
  batch: NormalizedSourceBatch | null | undefined
): DatajudTarget[] {
  if (!batch) return [];
  const seen = new Set<string>();
  const out: DatajudTarget[] = [];
  for (const observation of batch.cases) {
    const processNumber = normalizeProcessNumber(observation.processNumber);
    const tribunalAlias = datajudTribunalAlias(observation.tribunal);
    if (!processNumber || !tribunalAlias) continue;
    const key = `${processNumber}:${tribunalAlias}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ processNumber, tribunalAlias, origin: "DJEN" });
  }
  return out;
}

export function collectKnownCaseDatajudTargets(
  memory: LegalExposureMemory,
  entityId: string
): { targets: DatajudTarget[]; skippedWithoutTribunal: ExposureCaseRecord[] } {
  const seen = new Set<string>();
  const targets: DatajudTarget[] = [];
  const skippedWithoutTribunal: ExposureCaseRecord[] = [];
  const linkedCaseIds = new Set(
    memory.entityLinks.filter((row) => row.entityId === entityId).map((row) => row.caseId)
  );
  for (const row of memory.cases) {
    if (row.entityId !== entityId && !linkedCaseIds.has(row.id)) continue;
    const processNumber = canonicalProcessKey(row.processNumberNormalized || row.processNumber, row.id);
    if (!processNumber.ok) continue;
    const tribunalAlias = datajudTribunalAlias(row.tribunal);
    if (!tribunalAlias) {
      skippedWithoutTribunal.push(row);
      continue;
    }
    const key = `${processNumber.key}:${tribunalAlias}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ processNumber: processNumber.key, tribunalAlias, origin: "KNOWN_CASE" });
  }
  return { targets, skippedWithoutTribunal };
}

export function collectGlobalCanonicalDatajudTargets(memory: LegalExposureMemory): DatajudTarget[] {
  const seen = new Set<string>();
  const targets: DatajudTarget[] = [];
  for (const row of memory.cases) {
    const processNumber = canonicalProcessKey(row.processNumberNormalized || row.processNumber, row.id);
    if (!processNumber.ok) continue;
    const tribunalAlias = datajudTribunalAlias(row.tribunal);
    if (!tribunalAlias) continue;
    const key = `${processNumber.key}:${tribunalAlias}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ processNumber: processNumber.key, tribunalAlias, origin: "KNOWN_CASE" });
  }
  return targets;
}

export function unionDatajudTargets(
  discovered: DatajudTarget[],
  known: DatajudTarget[]
): DatajudTarget[] {
  const seen = new Set<string>();
  const out: DatajudTarget[] = [];
  for (const target of [...discovered, ...known]) {
    const key = `${target.processNumber}:${target.tribunalAlias}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

export function tagDiscoveryConfirmation(
  batch: NormalizedSourceBatch,
  trust: DjenDiscoveryTrust
): NormalizedSourceBatch {
  if (trust !== "GENERIC") return batch;
  return {
    ...batch,
    cases: batch.cases.map((row) => ({
      ...row,
      discoveryConfirmation: row.discoveryConfirmation === "TRUSTED" ? "TRUSTED" : "GENERIC",
    })),
  };
}

function strongerConfirmation(
  left: NormalizedCaseObservation["discoveryConfirmation"],
  right: NormalizedCaseObservation["discoveryConfirmation"]
): NormalizedCaseObservation["discoveryConfirmation"] {
  if (left === "TRUSTED" || right === "TRUSTED") return "TRUSTED";
  if (left === "GENERIC" || right === "GENERIC") return "GENERIC";
  return left ?? right;
}

export function mergeDjenBatches(batches: NormalizedSourceBatch[]): NormalizedSourceBatch {
  if (batches.length === 0) {
    return {
      source: "DJEN",
      outcome: "NO_RESULTS",
      errorCode: null,
      errorMessageSanitized: null,
      retryAfterSeconds: null,
      externalCall: false,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  const caseByKey = new Map<string, NormalizedCaseObservation>();
  const candidates = [];
  const communications = [];
  for (const batch of batches) {
    for (const observation of batch.cases) {
      const processNumber = normalizeProcessNumber(observation.processNumber) ?? observation.processNumber;
      const tribunal = datajudTribunalAlias(observation.tribunal) ?? "";
      const key = `${processNumber}:${tribunal}:${observation.sourceIdentifier}`;
      const existing = caseByKey.get(key);
      if (!existing) {
        caseByKey.set(key, observation);
        continue;
      }
      caseByKey.set(key, {
        ...existing,
        discoveryConfirmation: strongerConfirmation(
          existing.discoveryConfirmation,
          observation.discoveryConfirmation
        ),
      });
    }
    candidates.push(...batch.candidates);
    communications.push(...batch.communications);
  }
  const cases = [...caseByKey.values()];
  const hadResults = cases.length + candidates.length + communications.length > 0;
  const rateLimited = batches.filter((batch) => batch.outcome === "RATE_LIMITED");
  const failed = batches.filter(
    (batch) =>
      batch.outcome !== "SUCCESS" &&
      batch.outcome !== "NO_RESULTS" &&
      batch.outcome !== "PARTIAL" &&
      batch.outcome !== "RATE_LIMITED"
  );
  if (rateLimited.length > 0 && hadResults) {
    const last = rateLimited[rateLimited.length - 1]!;
    return {
      source: "DJEN",
      outcome: "PARTIAL",
      errorCode: "RATE_LIMITED",
      errorMessageSanitized: last.errorMessageSanitized,
      retryAfterSeconds: last.retryAfterSeconds,
      externalCall: batches.some((batch) => batch.externalCall),
      cases,
      communications,
      candidates,
    };
  }
  if (rateLimited.length > 0 && !hadResults) {
    return rateLimited[rateLimited.length - 1]!;
  }
  if (failed.length > 0 && hadResults) {
    const last = failed[failed.length - 1]!;
    return {
      source: "DJEN",
      outcome: "PARTIAL",
      errorCode: last.errorCode,
      errorMessageSanitized: last.errorMessageSanitized,
      retryAfterSeconds: last.retryAfterSeconds,
      externalCall: batches.some((batch) => batch.externalCall),
      cases,
      communications,
      candidates,
    };
  }
  if (failed.length > 0 && !hadResults) return failed[failed.length - 1]!;
  return {
    source: "DJEN",
    outcome: hadResults ? "SUCCESS" : "NO_RESULTS",
    errorCode: null,
    errorMessageSanitized: null,
    retryAfterSeconds: null,
    externalCall: batches.some((batch) => batch.externalCall),
    cases,
    communications,
    candidates,
  };
}

export function countSourceOutcomes(batches: NormalizedSourceBatch[]): Pick<
  EntitySyncCounters,
  "successfulSources" | "noResultSources" | "rateLimitedSources" | "failedSources"
> {
  let successfulSources = 0;
  let noResultSources = 0;
  let rateLimitedSources = 0;
  let failedSources = 0;
  for (const batch of batches) {
    if (batch.outcome === "SUCCESS" || batch.outcome === "PARTIAL") successfulSources += 1;
    else if (batch.outcome === "NO_RESULTS") noResultSources += 1;
    else if (batch.outcome === "RATE_LIMITED") rateLimitedSources += 1;
    else failedSources += 1;
  }
  return { successfulSources, noResultSources, rateLimitedSources, failedSources };
}

export function emptyEntitySyncCounters(): EntitySyncCounters {
  return {
    discoveryTermsConsulted: [],
    djenQueries: 0,
    uniqueProcessesDiscovered: 0,
    knownProcessesRefreshed: 0,
    datajudTargets: 0,
    successfulSources: 0,
    noResultSources: 0,
    rateLimitedSources: 0,
    failedSources: 0,
  };
}

export function uniqueDiscoveredProcessCount(batch: NormalizedSourceBatch | null): number {
  if (!batch) return 0;
  const seen = new Set<string>();
  for (const observation of batch.cases) {
    const processNumber = normalizeProcessNumber(observation.processNumber);
    if (processNumber) seen.add(processNumber);
  }
  return seen.size;
}

export function missingTribunalBatch(processNumber: string): NormalizedSourceBatch {
  return {
    source: "DATAJUD",
    outcome: "CONFIGURATION_ERROR",
    errorCode: "DATAJUD_TRIBUNAL_UNKNOWN",
    errorMessageSanitized: `DataJud exige tribunal do processo conhecido (${processNumber}).`,
    retryAfterSeconds: null,
    externalCall: false,
    cases: [],
    communications: [],
    candidates: [],
  };
}

export function classifyOutcome(outcome: LegalQueryOutcome): keyof Pick<
  EntitySyncCounters,
  "successfulSources" | "noResultSources" | "rateLimitedSources" | "failedSources"
> {
  if (outcome === "SUCCESS" || outcome === "PARTIAL") return "successfulSources";
  if (outcome === "NO_RESULTS") return "noResultSources";
  if (outcome === "RATE_LIMITED") return "rateLimitedSources";
  return "failedSources";
}
