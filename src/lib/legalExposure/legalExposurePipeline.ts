/**
 * Agregação entity-scoped: DJEN multi-termo + DataJud known-process.
 * Sem chamada concorrente.
 */

import type {
  DjenPaginationMeta,
  LegalQueryOutcome,
  NormalizedCaseObservation,
  NormalizedSourceBatch,
} from "./legalExposureContracts.js";
import type { DjenDiscoveryTrust } from "./legalExposureDiscovery.js";
import { canonicalProcessKey, normalizeProcessNumber } from "./legalExposureNormalization.js";
import { inferTribunalAlias } from "./legalTribunalPublicRegistry.js";
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
  pagesFetched: number;
  itemsFetched: number;
  truncated: boolean;
  newProcesses: number;
  existingProcesses: number;
  newEntityLinks: number;
  newCommunications: number;
  newParties: number;
  newAttorneys: number;
  newHearings: number;
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

export function resolveDatajudTribunalAlias(
  processNumber: string,
  hinted?: string | null
): string | null {
  return (
    datajudTribunalAlias(hinted) ??
    datajudTribunalAlias(inferTribunalAlias(processNumber, hinted))
  );
}

export function collectDatajudTargetsFromBatch(
  batch: NormalizedSourceBatch | null | undefined
): DatajudTarget[] {
  if (!batch) return [];
  const seen = new Set<string>();
  const out: DatajudTarget[] = [];
  for (const observation of batch.cases) {
    const processNumber = normalizeProcessNumber(observation.processNumber);
    if (!processNumber) continue;
    const tribunalAlias = resolveDatajudTribunalAlias(processNumber, observation.tribunal);
    if (!tribunalAlias) continue;
    if (seen.has(processNumber)) continue;
    seen.add(processNumber);
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
    const tribunalAlias = resolveDatajudTribunalAlias(processNumber.key, row.tribunal);
    if (!tribunalAlias) {
      skippedWithoutTribunal.push(row);
      continue;
    }
    if (seen.has(processNumber.key)) continue;
    seen.add(processNumber.key);
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
    const tribunalAlias = resolveDatajudTribunalAlias(processNumber.key, row.tribunal);
    if (!tribunalAlias) continue;
    if (seen.has(processNumber.key)) continue;
    seen.add(processNumber.key);
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
    if (seen.has(target.processNumber)) continue;
    seen.add(target.processNumber);
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

function mergeDjenPagination(batches: NormalizedSourceBatch[]): DjenPaginationMeta | undefined {
  const metas = batches.map((row) => row.pagination).filter((row): row is DjenPaginationMeta => Boolean(row));
  if (metas.length === 0) return undefined;
  return {
    totalReported: metas.reduce((max, row) => Math.max(max, row.totalReported ?? 0), 0) || metas[0]!.totalReported || null,
    pagesFetched: metas.reduce((sum, row) => sum + row.pagesFetched, 0),
    itemsFetched: metas.reduce((sum, row) => sum + row.itemsFetched, 0),
    truncated: metas.some((row) => row.truncated),
  };
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
  const pagination = mergeDjenPagination(batches);
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
      pagination,
    };
  }
  if (rateLimited.length > 0 && !hadResults) {
    return { ...rateLimited[rateLimited.length - 1]!, pagination };
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
      pagination,
    };
  }
  if (failed.length > 0 && !hadResults) return { ...failed[failed.length - 1]!, pagination };
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
    pagination,
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
    pagesFetched: 0,
    itemsFetched: 0,
    truncated: false,
    newProcesses: 0,
    existingProcesses: 0,
    newEntityLinks: 0,
    newCommunications: 0,
    newParties: 0,
    newAttorneys: 0,
    newHearings: 0,
    successfulSources: 0,
    noResultSources: 0,
    rateLimitedSources: 0,
    failedSources: 0,
  };
}

export function uniqueProcessNumbersFromBatch(batch: NormalizedSourceBatch | null | undefined): string[] {
  if (!batch) return [];
  const seen = new Set<string>();
  for (const observation of batch.cases) {
    const processNumber = normalizeProcessNumber(observation.processNumber);
    if (processNumber) seen.add(processNumber);
  }
  for (const observation of batch.communications) {
    const processNumber = normalizeProcessNumber(observation.processNumber);
    if (processNumber) seen.add(processNumber);
  }
  return [...seen];
}

export function uniqueDiscoveredProcessCount(batch: NormalizedSourceBatch | null): number {
  return uniqueProcessNumbersFromBatch(batch).length;
}

export const DATAJUD_STALE_MS = 24 * 60 * 60 * 1000;

export function datajudTargetNeedsRefresh(
  memory: LegalExposureMemory,
  processNumber: string,
  nowMs: number,
  staleMs = DATAJUD_STALE_MS
): boolean {
  const caseIds = memory.cases
    .filter((row) => canonicalProcessKey(row.processNumberNormalized || row.processNumber, row.id).key === processNumber)
    .map((row) => row.id);
  if (caseIds.length === 0) return true;
  const caseIdSet = new Set(caseIds);
  const cases = memory.cases.filter((row) => caseIdSet.has(row.id));
  const datajud = memory.evidences.filter((row) => caseIdSet.has(row.caseId) && row.source === "DATAJUD");
  if (datajud.length === 0) return true;
  if (cases.some((row) => !row.className || !row.currentStatus)) return true;
  const lastDatajud = Math.max(...datajud.map((row) => Date.parse(row.lastSeenAt)));
  if (!Number.isFinite(lastDatajud) || nowMs - lastDatajud > staleMs) return true;
  const lastPub = memory.communications
    .filter((row) => normalizeProcessNumber(row.processNumber) === processNumber)
    .map((row) => Date.parse(row.lastSeenAt));
  return lastPub.some((stamp) => Number.isFinite(stamp) && stamp > lastDatajud);
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
