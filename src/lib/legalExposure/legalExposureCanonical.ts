/**
 * Identidade canônica por CNJ. Duplicatas físicas históricas não são apagadas.
 */

import type { LegalCasePole, LegalEvidenceConfidence, LegalExposureSource } from "./legalExposureContracts.js";
import type {
  ExposureCaseRecord,
  ExposureEntityLinkRecord,
  LegalExposureMemory,
} from "./legalExposureStore.js";

export function pickCanonicalCase(cases: ExposureCaseRecord[]): ExposureCaseRecord | null {
  if (cases.length === 0) return null;
  return [...cases].sort((left, right) => {
    const created = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    if (created !== 0) return created;
    return left.id.localeCompare(right.id);
  })[0] ?? null;
}

export function casesForProcess(
  memory: LegalExposureMemory,
  processNumberNormalized: string
): ExposureCaseRecord[] {
  return memory.cases.filter((row) => row.processNumberNormalized === processNumberNormalized);
}

export function derivedEntityLinks(memory: LegalExposureMemory): ExposureEntityLinkRecord[] {
  const out: ExposureEntityLinkRecord[] = [...memory.entityLinks];
  const seen = new Set(out.map((row) => `${row.caseId}:${row.entityId}`));
  for (const legalCase of memory.cases) {
    const key = `${legalCase.id}:${legalCase.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `legacy-link:${legalCase.id}:${legalCase.entityId}`,
      caseId: legalCase.id,
      entityId: legalCase.entityId,
      pole: legalCase.entityPole,
      confidence: "CONFIRMED",
      firstSource: legalCase.primarySource,
      lastSource: legalCase.primarySource,
      firstSeenAt: legalCase.firstSeenAt,
      lastSeenAt: legalCase.lastSeenAt,
      createdAt: legalCase.createdAt,
      updatedAt: legalCase.updatedAt,
    });
  }
  return out;
}

export function upsertEntityLink(
  memory: LegalExposureMemory,
  input: {
    caseId: string;
    entityId: string;
    pole: LegalCasePole;
    source: LegalExposureSource;
    now: string;
    createId: () => string;
    confidence?: LegalEvidenceConfidence;
  }
): ExposureEntityLinkRecord {
  const existing = memory.entityLinks.find(
    (row) => row.caseId === input.caseId && row.entityId === input.entityId
  );
  if (existing) {
    existing.lastSeenAt = input.now;
    existing.lastSource = input.source;
    existing.updatedAt = input.now;
    if (input.pole !== "UNKNOWN" && existing.pole === "UNKNOWN") existing.pole = input.pole;
    if (input.confidence) existing.confidence = input.confidence;
    return existing;
  }
  const row: ExposureEntityLinkRecord = {
    id: input.createId(),
    caseId: input.caseId,
    entityId: input.entityId,
    pole: input.pole,
    confidence: input.confidence ?? "CONFIRMED",
    firstSource: input.source,
    lastSource: input.source,
    firstSeenAt: input.now,
    lastSeenAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  };
  memory.entityLinks.push(row);
  return row;
}

export function resolveCanonicalCaseGroup(
  memory: LegalExposureMemory,
  processNumberNormalized: string
): {
  canonicalCase: ExposureCaseRecord | null;
  caseIds: string[];
  entityLinks: ExposureEntityLinkRecord[];
} {
  const siblings = casesForProcess(memory, processNumberNormalized);
  const canonicalCase = pickCanonicalCase(siblings);
  const caseIds = siblings.map((row) => row.id);
  const idSet = new Set(caseIds);
  const entityLinks = derivedEntityLinks(memory).filter((row) => idSet.has(row.caseId));
  const unique = new Map<string, ExposureEntityLinkRecord>();
  for (const link of entityLinks) {
    const current = unique.get(link.entityId);
    if (!current) {
      unique.set(link.entityId, link);
      continue;
    }
    if (current.pole === "UNKNOWN" && link.pole !== "UNKNOWN") unique.set(link.entityId, link);
  }
  return { canonicalCase, caseIds, entityLinks: [...unique.values()] };
}

export function previewCanonicalGroups(memory: LegalExposureMemory) {
  const byProcess = new Map<string, ExposureCaseRecord[]>();
  for (const row of memory.cases) {
    const list = byProcess.get(row.processNumberNormalized) ?? [];
    list.push(row);
    byProcess.set(row.processNumberNormalized, list);
  }
  const groups = [...byProcess.entries()].map(([processNumberNormalized, siblings]) => {
    const group = resolveCanonicalCaseGroup(memory, processNumberNormalized);
    const caseIdSet = new Set(group.caseIds);
    return {
      processNumberNormalized,
      processNumber: group.canonicalCase?.processNumber ?? siblings[0]?.processNumber ?? "",
      physicalCaseCount: siblings.length,
      caseIds: group.caseIds,
      entityIds: group.entityLinks.map((row) => row.entityId),
      evidenceCount: memory.evidences.filter((row) => caseIdSet.has(row.caseId)).length,
      movementCount: memory.movements.filter((row) => caseIdSet.has(row.caseId)).length,
      communicationCount: memory.communications.filter((row) => row.caseId && caseIdSet.has(row.caseId)).length,
      eventCount: memory.events.filter((row) => row.caseId && caseIdSet.has(row.caseId)).length,
    };
  });
  return {
    physicalCases: memory.cases.length,
    uniqueProcesses: groups.length,
    duplicatedProcesses: groups.filter((row) => row.physicalCaseCount > 1),
    groups,
  };
}
